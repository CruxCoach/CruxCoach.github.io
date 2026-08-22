// Curated venue-level official-website links.
//
// `tools/venue-links.json` is a committed, hand-edited array in the same spirit
// as `tools/overrides.json` and `tools/wellpass.json`: one record per *venue*
// (never per board — a gym with a Kilter and a MoonBoard has one website), each
// carrying the URL, the UTC date it was last opened and verified, how it was
// verified, and which independent signals matched.
//
// This module is the single place that knows how such a record is validated,
// how its URL is canonicalized, and how it is matched onto a venue feature.
// `build-boards-data.mjs` applies it, `venue-links-report.mjs` reports on it and
// `venue-links.test.mjs` tests it — all against these same functions, so the
// rules cannot drift apart.
//
// Two properties matter more than convenience here:
//
//   1. **Fail closed.** Every ambiguity — a coordinate that has moved, a name
//      that no longer resembles the venue, two records fighting over one venue —
//      drops the link and logs it. A wrong link on the wrong gym is worse than
//      no link, because a visitor cannot tell it is wrong.
//   2. **Nothing is inferred.** A record exists only because a human opened the
//      page and matched at least two independent signals against the venue. The
//      schema refuses to store a link that does not say which two.
//
// No DOM, no network, no filesystem beyond the explicit `readFileSync` in
// `loadVenueLinks()` — so `node --test` can exercise all of it.

import { existsSync, readFileSync } from 'node:fs';

// 4-decimal precision ≈ 11 m. Identical to the venue grouping in
// build-boards-data.mjs — a curated record addresses a venue the same way the
// build assembles one.
export function venueKey(lat, lon) {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

// ── URL policy ──────────────────────────────────────────────────────
//
// A curated link is a normal editorial outbound link, but it is rendered into
// two static pages and a map popup, so what may enter the dataset is narrow:
// https only, no credentials, a real public hostname, no tracking cruft.

// Query parameters that only ever carry campaign attribution. Stripped
// silently. `ref` is deliberately NOT in this list — a few small sites use it
// as a real routing parameter — but the report flags it for a human.
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'yclid',
  'twclid', 'ttclid', 'igshid', 'srsltid', 'ref_src', 'mc_cid', 'mc_eid',
  '_hsenc', '_hsmi', '_ga', '_gl', 'pk_campaign', 'pk_kwd', 'piwik_campaign',
  'matomo_campaign', 's_kwcid', 'vero_id', 'oly_anon_id', 'oly_enc_id',
]);

const TRACKING_PREFIXES = ['utm_'];

// Hosts that are never an "official website" in the sense this field means.
// A gym whose only web presence is a Facebook page is a real and common case —
// it belongs in the research file as `social-only`, not in production data
// under a field that promises an official site. Social profiles are a separate
// link class with its own verification policy (see tools/VENUE-LINKS.md).
const NON_WEBSITE_HOSTS = [
  'facebook.com', 'fb.com', 'fb.me', 'messenger.com',
  'instagram.com', 'instagr.am', 'threads.net', 'threads.com',
  'twitter.com', 'x.com', 't.co',
  'tiktok.com', 'youtube.com', 'youtu.be', 'vimeo.com',
  'linkedin.com', 'vk.com', 'ok.ru', 'weibo.com', 'wechat.com',
  'meetup.com', 'eventbrite.com',
  'yelp.com', 'tripadvisor.com', 'foursquare.com', 'yellowpages.com',
  'google.com', 'goo.gl', 'maps.app.goo.gl', 'business.site',
  'linktr.ee', 'linkin.bio', 'beacons.ai', 'bio.link',
  'wa.me', 't.me', 'telegram.me',
  'bit.ly', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'rb.gy', 'cutt.ly',
  'openstreetmap.org', 'wikipedia.org', 'wikidata.org',
  'kilterboardapp.com', 'moonboard.com', 'tensionclimbing.com',
];

// Conservative ASCII hostname grammar, applied after WHATWG URL parsing has
// already done IDN → punycode. Requires at least one dot and an alphabetic TLD,
// which rejects `localhost`, bare intranet names and IPv4 literals alike.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const MAX_URL_LENGTH = 300;

function isIpLiteral(hostname) {
  if (hostname.startsWith('[')) return true;                 // IPv6, per WHATWG
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function registrableSuffixMatch(hostname, blocked) {
  return hostname === blocked || hostname.endsWith(`.${blocked}`);
}

// Canonicalize a curated URL, or throw with a reason a curator can act on.
// Returns the exact string that belongs in venue-links.json — the file is
// required to store URLs already in this form, so a review diff shows the link
// a visitor gets rather than something the build silently rewrote.
export function normalizeVenueUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('website must be a non-empty string');
  }
  if (raw !== raw.trim()) {
    throw new Error('website must not have leading or trailing whitespace');
  }
  if (/[\s<>"'\\^`{|}]/.test(raw)) {
    throw new Error('website must not contain whitespace or unescaped delimiters');
  }
  if (raw.length > MAX_URL_LENGTH) {
    throw new Error(`website exceeds ${MAX_URL_LENGTH} characters`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('website is not a parseable absolute URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error(`website must use https (got "${url.protocol}")`);
  }
  if (url.username || url.password) {
    throw new Error('website must not carry credentials');
  }
  if (url.port) {
    throw new Error('website must not specify a port');
  }

  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) {
    throw new Error('website must name a host, not an IP address');
  }
  if (!HOSTNAME_RE.test(host)) {
    throw new Error(`website has an unusable hostname "${url.hostname}"`);
  }
  for (const blocked of NON_WEBSITE_HOSTS) {
    if (registrableSuffixMatch(host, blocked)) {
      throw new Error(`"${host}" is a social/aggregator host, not an official website`);
    }
  }

  url.hostname = host;
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some(p => lower.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }
  // URLSearchParams re-serializes even an untouched query; drop a query that is
  // now empty so `?` never survives alone.
  if ([...url.searchParams.keys()].length === 0) url.search = '';

  if (url.pathname === '') url.pathname = '/';

  return url.toString();
}

// True when the URL would survive normalizeVenueUrl unchanged.
export function isCanonicalVenueUrl(raw) {
  try {
    return normalizeVenueUrl(raw) === raw;
  } catch {
    return false;
  }
}

// Query parameters that are legal but worth a human glance in the report.
export function suspiciousParams(raw) {
  let url;
  try { url = new URL(raw); } catch { return []; }
  return [...url.searchParams.keys()].filter(k => /^(ref|source|from|campaign)$/i.test(k));
}

// ── Name matching ───────────────────────────────────────────────────
//
// Upstream names are user-supplied and noisy: mixed case, mojibake, legal
// suffixes, "Boulderhalle" spelled four ways. Matching therefore compares
// normalized token sets, never raw strings.

// Legal-form and punctuation-only tokens carry no identity.
const NAME_STOPWORDS = new Set([
  'gmbh', 'ag', 'kg', 'ug', 'ohg', 'gbr', 'mbh', 'co', 'kgaa',
  'ev', 'e', 'v', 'inc', 'llc', 'ltd', 'bv', 'nv', 'sarl', 'sas', 'srl',
  'spa', 'oy', 'ab', 'as', 'aps', 'sp', 'zoo', 'doo', 'the',
]);

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining marks
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/đ/g, 'd').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameTokens(s) {
  return new Set(
    normalizeName(s).split(' ').filter(t => t && !NAME_STOPWORDS.has(t)),
  );
}

// Jaccard over identity-bearing tokens, with subset counted as a full match so
// "Boulderwelt München Ost" still matches "Boulderwelt München Ost GmbH" and
// "Kletterzentrum Innsbruck" matches "Kletterzentrum Innsbruck (KI)".
export function nameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === ta.size || shared === tb.size) return 1;
  return shared / (ta.size + tb.size - shared);
}

// Below this two names are considered different venues and the link is dropped.
export const NAME_MATCH_MIN = 0.5;

// ── Geometry ────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6371008.8;

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// How far a curated coordinate may sit from the venue it names before the
// record is treated as stale rather than as drift. Upstream coordinates get
// re-derived and nudged; 250 m absorbs that without reaching the next gym in a
// dense city.
export const MATCH_RADIUS_M = 250;

// ── Record schema ───────────────────────────────────────────────────

export const PROVENANCE = new Set([
  // The venue's own site, and the page is specific to this location.
  'official-location-page',
  // The venue's own site; it has a single location, so the homepage *is* the
  // location page.
  'official-site',
  // A chain site with no per-location page. Accepted only when the page itself
  // names this location.
  'official-chain-page',
]);

export const SIGNALS = new Set([
  'name',            // the venue name appears on the page
  'brand',           // the chain/brand name appears and the venue carries it
  'street-address',  // the street line matches the venue's upstream address
  'postal-code',     // postal code matches
  'city',            // city matches
  'location-page',   // the page is an explicit per-location page for this venue
  'coordinates',     // the page publishes coordinates within ~250 m
  'board-mention',   // the page names the board system the venue is listed for
]);

// Two signals from the *same* observation would not be independent, so signals
// that restate one another may not both be counted toward the minimum.
const REDUNDANT_SIGNAL_PAIRS = [['name', 'brand']];

export const MIN_SIGNALS = 2;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function isValidIsoDate(s) {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const ALLOWED_KEYS = new Set([
  'lat', 'lon', 'name', 'country', 'website', 'verified', 'provenance',
  'signals', 'note',
]);

// Validate one curated record. Returns an array of human-readable problems;
// empty means the record may be applied.
export function validateVenueLink(entry, index = 0) {
  const where = `venue-links[${index}]${entry && entry.name ? ` "${entry.name}"` : ''}`;
  const problems = [];
  const fail = msg => problems.push(`${where}: ${msg}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where}: not an object`];
  }
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_KEYS.has(key)) fail(`unknown field "${key}"`);
  }

  if (typeof entry.lat !== 'number' || !Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) {
    fail('"lat" must be a number in [-90, 90]');
  }
  if (typeof entry.lon !== 'number' || !Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) {
    fail('"lon" must be a number in [-180, 180]');
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    fail('"name" must be a non-empty string');
  }
  if (typeof entry.country !== 'string' || !COUNTRY_RE.test(entry.country)) {
    fail('"country" must be an uppercase ISO-3166-1 alpha-2 code');
  }
  if (typeof entry.verified !== 'string' || !isValidIsoDate(entry.verified)) {
    fail('"verified" must be a real UTC date as YYYY-MM-DD');
  }
  if (typeof entry.provenance !== 'string' || !PROVENANCE.has(entry.provenance)) {
    fail(`"provenance" must be one of ${[...PROVENANCE].join(', ')}`);
  }
  if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.trim() === '')) {
    fail('"note" must be a non-empty string when present');
  }

  if (!Array.isArray(entry.signals)) {
    fail('"signals" must be an array');
  } else {
    const seen = new Set();
    for (const s of entry.signals) {
      if (typeof s !== 'string' || !SIGNALS.has(s)) {
        fail(`unknown signal ${JSON.stringify(s)}`);
        continue;
      }
      if (seen.has(s)) fail(`duplicate signal "${s}"`);
      seen.add(s);
    }
    let independent = seen.size;
    for (const [a, b] of REDUNDANT_SIGNAL_PAIRS) {
      if (seen.has(a) && seen.has(b)) independent--;
    }
    if (independent < MIN_SIGNALS) {
      fail(`needs at least ${MIN_SIGNALS} independent signals, has ${independent}`);
    }
    // A chain page earns its place only by naming the specific location.
    if (entry.provenance === 'official-chain-page'
      && !seen.has('street-address') && !seen.has('city') && !seen.has('location-page')) {
      fail('"official-chain-page" requires street-address, city or location-page among its signals');
    }
  }

  if (typeof entry.website !== 'string') {
    fail('"website" must be a string');
  } else {
    try {
      const canonical = normalizeVenueUrl(entry.website);
      if (canonical !== entry.website) {
        fail(`"website" is not canonical — store ${JSON.stringify(canonical)}`);
      }
    } catch (err) {
      fail(err.message);
    }
  }

  return problems;
}

// Read + validate the curated file. Throws on anything that makes the file as a
// whole unusable (unreadable, not JSON, not an array, duplicate coordinates);
// per-record problems come back in `errors` so the report can show them all at
// once instead of one per run.
export function loadVenueLinks(file) {
  if (!existsSync(file)) return { entries: [], errors: [], present: false };

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${file} must be a JSON array of venue-link objects`);
  }

  const errors = [];
  raw.forEach((entry, i) => errors.push(...validateVenueLink(entry, i)));

  const byKey = new Map();
  raw.forEach((entry, i) => {
    if (!entry || typeof entry.lat !== 'number' || typeof entry.lon !== 'number') return;
    const k = venueKey(entry.lat, entry.lon);
    if (byKey.has(k)) {
      errors.push(`venue-links[${i}] "${entry.name}": duplicate coordinate — already claimed by venue-links[${byKey.get(k)}]`);
    } else {
      byKey.set(k, i);
    }
  });

  return { entries: raw, errors, present: true };
}

// ── Research log ────────────────────────────────────────────────────
//
// `tools/venue-links-research.json` records every venue that was looked at and
// did NOT get a link, with the reason. It is deliberately not production data:
// nothing in it reaches boards.geojson, the map or the directories.
//
// It exists because "no link" is otherwise indistinguishable from "nobody has
// looked yet", which would make every later pass redo the same dead ends — and
// because a rejected candidate URL is exactly the kind of thing that must not
// sit in a field a renderer might one day read.

export const RESEARCH_STATUS = new Set([
  'ambiguous',    // more than one plausible official site, none decisive
  'closed',       // venue is permanently closed
  'private',      // home wall / not open to the public
  'duplicate',    // same venue as another dataset entry
  'unavailable',  // candidate site does not resolve, or is parked
  'unverified',   // a candidate exists but the second signal never matched
  'no-website',   // venue genuinely has no site of its own
  'social-only',  // only a social-media presence, which this field never holds
  'http-only',    // site serves no https, so it is not linkable from here
]);

const RESEARCH_KEYS = new Set([
  'lat', 'lon', 'name', 'country', 'status', 'checked', 'reason', 'candidate',
]);

// Validate one research record. Same shape discipline as a link record, minus
// the URL policy: a candidate URL here is explicitly *not* trusted, so it is
// only required to be a string, and it is never rendered anywhere.
export function validateResearchEntry(entry, index = 0) {
  const where = `venue-links-research[${index}]${entry && entry.name ? ` "${entry.name}"` : ''}`;
  const problems = [];
  const fail = msg => problems.push(`${where}: ${msg}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where}: not an object`];
  }
  for (const key of Object.keys(entry)) {
    if (!RESEARCH_KEYS.has(key)) fail(`unknown field "${key}"`);
  }
  if (typeof entry.lat !== 'number' || !Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) {
    fail('"lat" must be a number in [-90, 90]');
  }
  if (typeof entry.lon !== 'number' || !Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) {
    fail('"lon" must be a number in [-180, 180]');
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') fail('"name" must be a non-empty string');
  if (typeof entry.country !== 'string' || !COUNTRY_RE.test(entry.country)) {
    fail('"country" must be an uppercase ISO-3166-1 alpha-2 code');
  }
  if (typeof entry.status !== 'string' || !RESEARCH_STATUS.has(entry.status)) {
    fail(`"status" must be one of ${[...RESEARCH_STATUS].join(', ')}`);
  }
  if (typeof entry.checked !== 'string' || !isValidIsoDate(entry.checked)) {
    fail('"checked" must be a real UTC date as YYYY-MM-DD');
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    fail('"reason" must say why this venue got no link');
  }
  if (entry.candidate !== undefined && (typeof entry.candidate !== 'string' || entry.candidate.trim() === '')) {
    fail('"candidate" must be a non-empty string when present');
  }
  return problems;
}

// ── Public / private classification ─────────────────────────────────
//
// A curated website link is only ever appropriate for a venue the public can
// visit. Home walls are in the dataset too — MoonBoard's upstream marks them
// `commercial: false`, and roughly a fifth of every MoonBoard entry is one —
// and attaching a "website" to somebody's garage would be wrong twice over:
// wrong for the visitor, and an unwanted spotlight on a private address.
//
// The three classes below are decided from upstream fields only:
//
//   commercial — a Kilter installation (that upstream is a gym directory and
//                ships street addresses) or a MoonBoard flagged commercial.
//   private    — MoonBoard-only and every MoonBoard flagged non-commercial.
//   unknown    — everything else, chiefly Tension/Grasshopper/Decoy entries
//                that carry nothing but an owner username.
//
// `private` is a hard refusal in applyVenueLinks(). `unknown` is allowed, but
// only because the curation standard requires a human to have opened the
// official page first — which is exactly what establishes that the venue is
// open to the public. It is never an invitation to guess.
export function classifyVenue(props) {
  const boards = Array.isArray(props?.boards) ? props.boards : [];
  if (boards.some(b => b.board === 'kilter')) return 'commercial';
  if (boards.some(b => b.commercial === true)) return 'commercial';
  const moon = boards.filter(b => b.board === 'moonboard');
  if (moon.length > 0 && moon.every(b => b.commercial === false)
    && boards.every(b => b.board === 'moonboard')) {
    return 'private';
  }
  return 'unknown';
}

// ── Matching ────────────────────────────────────────────────────────

// Properties this overlay owns. Cleared before every application so that
// deleting a record actually removes its link, including in the overlay-only
// rebuild that starts from an already-populated boards.geojson.
export const MANAGED_PROPERTIES = ['website', 'website_checked'];

export function clearVenueLinkProperties(features) {
  for (const f of features) {
    for (const key of MANAGED_PROPERTIES) delete f.properties[key];
  }
}

// Resolve one record against the venue features. Never guesses: returns either
// a single unambiguous feature or a reason it refused.
function resolveOne(entry, index, byKey, features) {
  const where = `venue-links[${index}] "${entry.name}"`;
  const exact = byKey.get(venueKey(entry.lat, entry.lon));

  let candidate = exact;
  let how = 'exact';

  if (!candidate) {
    // The coordinate moved. Re-find the venue by identity — same country, same
    // name, close by — and accept only if exactly one venue answers to all three.
    const near = features.filter(f => {
      const [lon, lat] = f.geometry.coordinates;
      if (f.properties.country !== entry.country) return false;
      if (distanceMeters(entry.lat, entry.lon, lat, lon) > MATCH_RADIUS_M) return false;
      return nameSimilarity(entry.name, f.properties.name) >= NAME_MATCH_MIN;
    });
    if (near.length === 0) {
      return { status: 'unmatched', reason: `${where}: no venue within ${MATCH_RADIUS_M} m of ${entry.lat}, ${entry.lon} answering to this name — stale record?` };
    }
    if (near.length > 1) {
      return { status: 'ambiguous', reason: `${where}: ${near.length} venues within ${MATCH_RADIUS_M} m match this name — refusing to guess` };
    }
    candidate = near[0];
    how = 'proximity';
  }

  if (candidate.properties.country !== entry.country) {
    return { status: 'country-mismatch', reason: `${where}: record says ${entry.country}, venue is in ${candidate.properties.country || 'an unknown country'}` };
  }

  const similarity = nameSimilarity(entry.name, candidate.properties.name);
  if (similarity < NAME_MATCH_MIN) {
    return { status: 'name-mismatch', reason: `${where}: venue at this coordinate is named "${candidate.properties.name}" — refusing to attach the link` };
  }

  if (classifyVenue(candidate.properties) === 'private') {
    return { status: 'private-venue', reason: `${where}: venue is a non-commercial home setup — no website link is published for private venues` };
  }

  return { status: 'ok', feature: candidate, how, similarity };
}

// Apply every curated record onto `features`, in place.
//
// Returns { stats, problems, notes }:
//   stats    — counts for boards.meta.json (no URLs, no names)
//   problems — one line per refused record, for stderr and the report
//   notes    — non-fatal observations (proximity rematches, shared URLs)
export function applyVenueLinks(features, entries) {
  const stats = {
    defined: entries.length,
    applied: 0,
    matched_by_proximity: 0,
    unmatched: 0,
    ambiguous: 0,
    private_refused: 0,
    rejected: 0,
    countries: 0,
    by_provenance: {},
  };
  const problems = [];
  const notes = [];

  clearVenueLinkProperties(features);

  const byKey = new Map();
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    byKey.set(venueKey(lat, lon), f);
  }

  // Pass 1 — validate and resolve, without writing anything.
  const resolved = [];
  entries.forEach((entry, i) => {
    const invalid = validateVenueLink(entry, i);
    if (invalid.length) {
      stats.rejected++;
      problems.push(...invalid);
      return;
    }
    const r = resolveOne(entry, i, byKey, features);
    if (r.status !== 'ok') {
      if (r.status === 'unmatched') stats.unmatched++;
      else if (r.status === 'ambiguous') stats.ambiguous++;
      else if (r.status === 'private-venue') stats.private_refused++;
      else stats.rejected++;
      problems.push(r.reason);
      return;
    }
    resolved.push({ entry, index: i, ...r });
  });

  // Pass 2 — refuse collisions. Two records resolving onto one venue means at
  // least one of them is wrong, and nothing in the data says which, so both go.
  const claims = new Map();
  for (const r of resolved) {
    const [lon, lat] = r.feature.geometry.coordinates;
    const k = venueKey(lat, lon);
    if (!claims.has(k)) claims.set(k, []);
    claims.get(k).push(r);
  }
  const accepted = [];
  for (const [, group] of claims) {
    if (group.length > 1) {
      stats.ambiguous += group.length;
      problems.push(
        `venue-links ${group.map(g => `[${g.index}] "${g.entry.name}"`).join(' and ')}: `
        + 'resolve onto the same venue — dropping all of them',
      );
      continue;
    }
    accepted.push(group[0]);
  }

  // Pass 3 — write.
  const countries = new Set();
  const urlUsers = new Map();
  for (const { entry, feature, how, similarity } of accepted) {
    feature.properties.website = entry.website;
    feature.properties.website_checked = entry.verified;
    stats.applied++;
    countries.add(entry.country);
    stats.by_provenance[entry.provenance] = (stats.by_provenance[entry.provenance] ?? 0) + 1;
    if (how === 'proximity') {
      stats.matched_by_proximity++;
      notes.push(`venue-links "${entry.name}": coordinate drifted — rematched by name/proximity (similarity ${similarity.toFixed(2)})`);
    }
    const list = urlUsers.get(entry.website) ?? [];
    list.push(entry.name);
    urlUsers.set(entry.website, list);
  }
  stats.countries = countries.size;

  for (const [url, users] of urlUsers) {
    if (users.length > 1) {
      notes.push(`venue-links: ${users.length} venues share ${url} (${users.join(', ')}) — prefer a per-location page where one exists`);
    }
  }

  // Sort by provenance key so meta.json is byte-stable across runs.
  stats.by_provenance = Object.fromEntries(
    Object.entries(stats.by_provenance).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  return { stats, problems, notes };
}
