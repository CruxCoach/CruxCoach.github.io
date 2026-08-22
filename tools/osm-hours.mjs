// Curated OpenStreetMap ↔ venue matches, and the ODbL sidecar built from them.
//
// LICENSING IS WHY THIS IS A SIDECAR. boards/data/boards.geojson is our own
// CC-BY dataset. Opening hours come from OpenStreetMap and are ODbL 1.0 —
// a share-alike licence with different obligations. Mixing them into one file
// would quietly relicense (or misdeclare) the whole thing, so the OSM-derived
// values live in boards/data/osm-opening-hours.json with their own licence
// block, their own attribution, and their own provenance per venue. Nothing
// from OSM is ever written into boards.geojson.
//
// MATCHES ARE CURATED, NEVER INFERRED. tools/osm-venues.json binds a venue to
// one exact OSM object by type + id, recorded by a person who looked at both.
// Nothing here searches for the nearest climbing gym and attaches it: a wrong
// match publishes wrong opening hours under a real venue's name, which is
// worse than publishing none. Every rule below therefore fails closed —
// structurally invalid, duplicated or ambiguous entries abort the build, and
// an object that has been deleted or no longer looks like a public venue
// loses its hours rather than keeping the last value that happened to work.

import { existsSync, readFileSync } from 'node:fs';

import { renderFreshness, renderOpeningHours, STRINGS } from './opening-hours.mjs';
import { venueKey } from './venue-key.mjs';

export const SCHEMA_VERSION = 1;

export const OSM_TYPES = ['node', 'way', 'relation'];

// Ways a curated match may have been established. Both are a person's
// decision; they differ in how the candidate was put in front of that person.
// Nothing proximity-based is allowed here, and there is no third value.
export const MATCH_METHODS = [
  // Investigated on its own: candidates read one by one.
  'manual',
  // Proposed by the sweep because exactly one candidate's name was identical
  // (or contained) and no other candidate shared a distinctive word with it,
  // then read line by line before being recorded. See
  // tools/dev/RUNBOOK-osm-opening-hours.md, "Sweeping a country".
  'manual-exact-name',
];

/**
 * The outcome every venue on the map ends up with. Exactly one of these, and
 * only `accepted` is ever enriched.
 *
 *   accepted     bound to one exact OSM object (which may or may not carry hours)
 *   private      a home or garage setup — never enriched, whatever OSM says
 *   no-object    documented checks found no object that IS this venue
 *   ambiguous    two or more plausible objects; picking one would be a guess
 *   closed       the venue is gone, or its object is tagged disused
 *   unreachable  discovery could not complete — this is the retry queue
 */
export const DECISIONS = ['accepted', 'private', 'no-object', 'ambiguous', 'closed', 'unreachable'];

// A venue with one of these is settled; the sweep skips it. `unreachable` is
// deliberately absent — it is a queue entry, so the next sweep picks it up.
export const SETTLED = DECISIONS.filter((d) => d !== 'unreachable');

export const SOURCE_BLOCK = {
  name: 'OpenStreetMap',
  url: 'https://www.openstreetmap.org/',
  copyright_url: 'https://www.openstreetmap.org/copyright',
  api: 'https://api.openstreetmap.org/api/0.6/',
  license: 'Open Database License (ODbL) v1.0',
  license_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors',
  note: 'Opening hours and the OSM object metadata in this file are derived from OpenStreetMap and are licensed ODbL 1.0. They are deliberately kept out of boards.geojson, which is CC-BY-4.0.',
};

// Only these OSM tags mark an object as the kind of public sports venue whose
// opening hours belong on a public map. A curated match whose object stops
// matching this list loses its hours on the next refresh — that is what
// catches a retagged, demolished or re-purposed object.
export const PUBLIC_VENUE_TAGS = [
  ['leisure', ['sports_centre', 'climbing', 'fitness_centre', 'sports_hall']],
  ['sport', ['climbing', 'climbing_adventure', 'bouldering']],
  ['shop', ['sports']],
  ['amenity', ['gym']],
];

export const OSM_URL_BASE = 'https://www.openstreetmap.org';

/**
 * Names compared the way a person compares them: case, accents, punctuation
 * and ß/ss are noise. Used for the duplicate-listing rule below and by the
 * curation sweep, which must agree with it.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function metresBetween(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Upstream lists a good number of gyms twice — the source registers a venue
// once per board system, so one hall arrives as "Steil Boulderhalle" and
// "Steil Boulderhalle Karlsruhe", or as "VELS Boulderhalle Stuttgart" and
// "VELS Moonboard24", at coordinates a few metres apart and just far enough
// not to collapse into one venue. Both rows are the same business, so both may
// point at the same OSM object; refusing the second would leave one of two
// adjacent markers mysteriously without hours.
//
// Two ways to establish it, both narrow:
//
//   1. Identical names within DUPLICATE_LISTING_MAX_M. No judgement needed.
//   2. An explicit `duplicate_listing_of` on the second entry, naming the
//      other listing. That is a curator saying "I looked, and these two rows
//      are one gym" — the same standard as the match itself.
//
// What neither allows is two DIFFERENT venues sharing an object. "Boulderbar
// Hauptbahnhof" and "… Hauptbahnhof Plus" are 60 m apart with one name inside
// the other, and are still two halls; they stay refused unless somebody
// deliberately writes the assertion, which for that pair would be wrong.
const DUPLICATE_LISTING_MAX_M = 150;

export function osmObjectUrl(type, id) {
  return `${OSM_URL_BASE}/${type}/${id}`;
}

// ── The curated match file ────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(where, message) {
  throw new Error(`tools/osm-venues.json: ${where}: ${message}`);
}

/**
 * Read and validate tools/osm-venues.json.
 *
 * Throws on anything structurally wrong, duplicated or contradictory. Returns
 * `{ accepted, decisions, counts, settled }` — `decisions` is every venue that
 * has an outcome, because a documented "we looked and could not tell" is the
 * part of the record that stops the same venue being re-examined every sweep,
 * and `settled` is the subset the next sweep may skip.
 */
export function loadCuratedMatches(file) {
  if (!existsSync(file)) return { accepted: [], decisions: [], counts: {}, settled: new Set() };

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`tools/osm-venues.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) fail('file', 'must be a JSON array of decision objects');

  const accepted = [];
  const decisions = [];
  const counts = Object.fromEntries(DECISIONS.map((d) => [d, 0]));
  const settled = new Set();
  const seenVenue = new Map();
  const seenObject = new Map();

  raw.forEach((entry, i) => {
    const where = `entry ${i}${entry && entry.name ? ` ("${entry.name}")` : ''}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(where, 'not an object');
    if (typeof entry.name !== 'string' || !entry.name.trim()) fail(where, 'needs a non-empty "name"');
    if (typeof entry.lat !== 'number' || typeof entry.lon !== 'number') fail(where, 'needs numeric "lat"/"lon"');
    if (entry.lat < -90 || entry.lat > 90 || entry.lon < -180 || entry.lon > 180) {
      fail(where, 'coordinates out of range');
    }
    if (!DECISIONS.includes(entry.status)) {
      fail(where, `"status" must be one of ${DECISIONS.join(', ')}`);
    }

    const key = venueKey(entry.lat, entry.lon);
    const previous = seenVenue.get(key);
    if (previous !== undefined) {
      fail(where, `venue ${key} is already decided by entry ${previous} — one venue, one outcome`);
    }
    seenVenue.set(key, i);
    counts[entry.status]++;
    decisions.push({ ...entry, key });
    if (entry.status !== 'unreachable') settled.add(key);

    if (entry.status !== 'accepted') {
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
        fail(where, `a "${entry.status}" entry needs a "reason"`);
      }
      if (!ISO_DATE.test(entry.reviewed_on ?? '')) {
        fail(where, `a "${entry.status}" entry needs "reviewed_on" as YYYY-MM-DD`);
      }
      return;
    }

    if (!OSM_TYPES.includes(entry.osm_type)) {
      fail(where, `"osm_type" must be one of ${OSM_TYPES.join(', ')}`);
    }
    if (!Number.isInteger(entry.osm_id) || entry.osm_id <= 0) {
      fail(where, '"osm_id" must be a positive integer');
    }
    if (!MATCH_METHODS.includes(entry.match_method)) {
      fail(where, `"match_method" must be one of ${MATCH_METHODS.join(', ')} — nothing here may be matched by proximity`);
    }
    if (!ISO_DATE.test(entry.verified_on ?? '')) {
      fail(where, '"verified_on" must be YYYY-MM-DD');
    }
    if (typeof entry.evidence !== 'string' || entry.evidence.trim().length < 20) {
      fail(where, '"evidence" must describe what was compared (min. 20 characters)');
    }
    // The curator asserts this is a public venue. The automated guards below
    // and in the refresh command can only ever add refusals on top of it.
    if (entry.venue !== 'public') {
      fail(where, '"venue" must be "public" — private and home setups are never enriched');
    }

    if (entry.duplicate_listing_of !== undefined
        && (typeof entry.duplicate_listing_of !== 'string' || !entry.duplicate_listing_of.includes('|'))) {
      fail(where, '"duplicate_listing_of" must name the other listing of the same venue');
    }

    // Whether several listings may share one object is decided below, once
    // every entry has been read: the assertion can point forwards as easily as
    // backwards, so it cannot be judged in file order.
    const objectId = `${entry.osm_type}/${entry.osm_id}`;
    if (!seenObject.has(objectId)) seenObject.set(objectId, []);
    seenObject.get(objectId).push({ index: i, id: key, name: entry.name, entry });

    accepted.push({ ...entry, key, osm_url: osmObjectUrl(entry.osm_type, entry.osm_id) });
  });

  // One object, one venue — unless the listings are demonstrably the same
  // venue. Every listing on an object must be within DUPLICATE_LISTING_MAX_M
  // of every other, and the "same venue" links (identical names, or an
  // explicit duplicate_listing_of in either direction) must connect the whole
  // group. A listing that is merely near the others, with a name of its own
  // and nobody vouching for it, is the ambiguous case and is refused.
  for (const [objectId, claimants] of seenObject) {
    if (claimants.length < 2) continue;
    for (let a = 0; a < claimants.length; a++) {
      for (let b = a + 1; b < claimants.length; b++) {
        const x = claimants[a];
        const y = claimants[b];
        const metres = metresBetween(x.entry.lat, x.entry.lon, y.entry.lat, y.entry.lon);
        if (metres > DUPLICATE_LISTING_MAX_M) {
          fail(`entry ${y.index} ("${y.name}")`,
            `OSM object ${objectId} is also matched by entry ${x.index} ("${x.name}", `
            + `${Math.round(metres)} m away) — too far apart to be one venue listed twice `
            + `(limit ${DUPLICATE_LISTING_MAX_M} m)`);
        }
      }
    }
    // Connectivity: walk the links out from the first listing.
    const byId = new Map(claimants.map((c) => [c.id, c]));
    const reached = new Set([claimants[0].id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of claimants) {
        if (reached.has(c.id)) continue;
        const linked = claimants.some((other) => reached.has(other.id) && (
          normalizeName(other.name) === normalizeName(c.name)
          || c.entry.duplicate_listing_of === other.id
          || other.entry.duplicate_listing_of === c.id));
        if (linked) { reached.add(c.id); grew = true; }
      }
    }
    for (const c of claimants) {
      if (reached.has(c.id)) continue;
      fail(`entry ${c.index} ("${c.name}")`,
        `OSM object ${objectId} is also matched by entry ${claimants[0].index} `
        + `("${claimants[0].name}") — ambiguous unless the two are the same venue listed `
        + `twice, which needs identical names or an explicit "duplicate_listing_of"`);
    }
    if (byId.size !== claimants.length) fail(`object ${objectId}`, 'duplicate venue listing');
  }

  // A declared duplicate has to name a venue that exists, is accepted, and
  // carries the same OSM object — otherwise the assertion is decoration.
  const acceptedById = new Map(accepted.map((e) => [e.key, e]));
  for (const entry of accepted) {
    if (!entry.duplicate_listing_of) continue;
    const partner = acceptedById.get(entry.duplicate_listing_of);
    const where = `entry "${entry.name}"`;
    if (!partner) {
      fail(where, `"duplicate_listing_of": "${entry.duplicate_listing_of}" names no accepted venue`);
    }
    if (partner.osm_type !== entry.osm_type || partner.osm_id !== entry.osm_id) {
      fail(where, `"duplicate_listing_of" points at "${partner.name}", which is matched to a different OSM object`);
    }
    if (partner.key === entry.key) fail(where, '"duplicate_listing_of" points at itself');
  }

  return { accepted, decisions, counts, settled };
}

// ── Guards ────────────────────────────────────────────────────────────────

/**
 * Does this OSM object still look like the public sports venue it was matched
 * as? Returns `{ ok: true, kind }` or `{ ok: false, reason }`.
 */
export function classifyOsmTags(tags) {
  if (!tags || typeof tags !== 'object') return { ok: false, reason: 'no-tags' };
  if (tags.access === 'private' || tags.access === 'no') return { ok: false, reason: 'access-restricted' };
  for (const [key, values] of PUBLIC_VENUE_TAGS) {
    const value = tags[key];
    if (typeof value !== 'string') continue;
    // Multi-values are semicolon-separated in OSM ("sport=climbing;fitness").
    for (const part of value.split(';').map((v) => v.trim())) {
      if (values.includes(part)) return { ok: true, kind: `${key}=${part}` };
    }
  }
  return { ok: false, reason: 'not-a-public-venue' };
}

/**
 * Home and garage walls are on the map because an owner listed a location,
 * not because they run a business. Publishing "opening hours" for someone's
 * basement would be both wrong and intrusive, so a venue that shows a home
 * signal and no commercial signal is refused even if a curated match exists.
 */
export function venueLooksPrivate(feature) {
  const boards = feature?.properties?.boards;
  if (!Array.isArray(boards)) return { private: true, reason: 'no board data' };
  let home = null;
  let commercial = null;
  for (const b of boards) {
    if (b.commercial === true) commercial ??= 'moonboard marked commercial';
    if (b.commercial === false) home ??= 'moonboard marked as a home setup';
    if (typeof b.address === 'string' && b.address.trim()) commercial ??= 'street address on file';
    for (const wall of b.walls ?? []) {
      if (wall.layout === 'Homewall') home ??= 'Kilter wall with the Homewall layout';
      else if (wall.layout) commercial ??= `Kilter wall with the ${wall.layout} layout`;
    }
  }
  if (home && !commercial) return { private: true, reason: home };
  return { private: false, reason: commercial ?? 'no home signal' };
}

// ── The sidecar ───────────────────────────────────────────────────────────

// Statuses a curated, accepted match can end up in after a refresh.
export const STATUS = {
  OK: 'ok',                    // object read, tagged as a public venue, has hours
  NO_HOURS: 'no-opening-hours', // object read, but nothing tagged
  NOT_PUBLIC: 'not-a-public-venue', // retagged since curation — fail closed
  GONE: 'gone',                // deleted or unknown id — fail closed
  UNREACHABLE: 'unreachable',  // the source did not answer; last values kept
};

/**
 * Assemble the sidecar. Pure: same inputs, same bytes out — the network lives
 * in refresh-osm-hours.mjs, so this can be re-run offline to re-render the
 * committed file after a wording or renderer change.
 *
 * @param {object} args
 * @param {Array}  args.accepted  curated accepted matches
 * @param {Map}    args.features  venueKey → GeoJSON feature
 * @param {Map}    args.fetched   venueKey → { status, tags?, timestamp?, version?, kind? }
 * @param {string} args.refreshedAt ISO timestamp of the fetch this reflects
 * @param {object} [args.coverage]  { venues_on_map, venues_decided } — how much
 *   of the map had an outcome when this file was written. Recorded rather than
 *   recomputed by readers: it is a statement about that moment, and upstream
 *   adds venues on its own schedule.
 */
function bump(counter, code) {
  const cc = code ?? 'ZZ';
  counter[cc] = (counter[cc] ?? 0) + 1;
}

function sortCounts(counter) {
  return Object.fromEntries(
    Object.entries(counter).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

export function buildSidecar({ accepted, features, fetched, refreshedAt, coverage }) {
  const venues = [];
  const stats = {
    curated_accepted: accepted.length,
    matched_to_venue: 0,
    unmatched_venue: 0,
    with_opening_hours: 0,
    rendered_schedule: 0,
    raw_only: 0,
    without_opening_hours: 0,
    gone: 0,
    not_a_public_venue: 0,
    unreachable: 0,
    countries_matched: {},
    countries_with_hours: {},
  };

  for (const match of [...accepted].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const feature = features.get(match.key);
    if (!feature) {
      stats.unmatched_venue++;
      continue;
    }
    stats.matched_to_venue++;

    const privacy = venueLooksPrivate(feature);
    if (privacy.private) {
      throw new Error(
        `tools/osm-venues.json: "${match.name}" (${match.key}) looks like a private setup ` +
        `(${privacy.reason}) — private and home setups are never enriched`,
      );
    }

    const props = feature.properties ?? {};
    const [lon, lat] = feature.geometry.coordinates;
    const result = fetched.get(match.key) ?? { status: STATUS.UNREACHABLE };

    const entry = {
      key: match.key,
      lat,
      lon,
      name: props.name ?? match.name,
      country: props.country ?? null,
      osm_type: match.osm_type,
      osm_id: match.osm_id,
      osm_url: osmObjectUrl(match.osm_type, match.osm_id),
      // The evidence a curator wrote down stays in tools/osm-venues.json,
      // which is the record of the decision. What ships to visitors is the
      // claim itself: this was matched by hand, and on which day.
      match: {
        method: match.match_method,
        verified_on: match.verified_on,
      },
      status: result.status,
    };

    if (result.osm_name) entry.osm_name = result.osm_name;
    if (result.kind) entry.osm_kind = result.kind;
    if (result.timestamp) entry.osm_timestamp = result.timestamp;
    if (Number.isInteger(result.version)) entry.osm_version = result.version;
    if (result.status === STATUS.UNREACHABLE && result.refresh_error) {
      entry.refresh_error = result.refresh_error;
    }

    if (result.opening_hours) {
      entry.opening_hours = result.opening_hours;
      if (result.check_date) entry.check_date = result.check_date;
      const display = renderOpeningHours(result.opening_hours);
      display.freshness = renderFreshness({
        checkDate: result.check_date,
        timestamp: result.timestamp,
      });
      entry.display = display;
      stats.with_opening_hours++;
      if (display.kind === 'schedule') stats.rendered_schedule++;
      else stats.raw_only++;
      bump(stats.countries_with_hours, entry.country);
    } else if (result.status === STATUS.NO_HOURS) {
      stats.without_opening_hours++;
    }

    if (result.status === STATUS.GONE) stats.gone++;
    if (result.status === STATUS.NOT_PUBLIC) stats.not_a_public_venue++;
    if (result.status === STATUS.UNREACHABLE) stats.unreachable++;

    bump(stats.countries_matched, entry.country);
    venues.push(entry);
  }

  stats.countries_matched = sortCounts(stats.countries_matched);
  stats.countries_with_hours = sortCounts(stats.countries_with_hours);

  if (coverage) {
    stats.venues_on_map = coverage.venues_on_map;
    stats.venues_decided = coverage.venues_decided;
    stats.venues_without_decision = coverage.venues_on_map - coverage.venues_decided;
  }

  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_BLOCK,
    refreshed_at: refreshedAt,
    generator: 'tools/refresh-osm-hours.mjs',
    matches_source: 'tools/osm-venues.json',
    strings: STRINGS,
    stats,
    venues,
  };
}

/** Read the committed sidecar. Returns null when it is absent. */
export function loadSidecar(file) {
  if (!existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.venues)) {
    throw new Error(`${file}: expected an object with a "venues" array`);
  }
  if (data.schema_version !== SCHEMA_VERSION) {
    throw new Error(`${file}: schema_version ${data.schema_version} — this build expects ${SCHEMA_VERSION}`);
  }
  return data;
}

/**
 * venueKey → displayable entry, for the consumers (static directory, map).
 * Entries without a `display` block — deleted objects, retagged objects,
 * venues with no hours tagged — are dropped here, so a consumer that iterates
 * this map cannot accidentally render a venue we have nothing to say about.
 */
export function indexSidecar(sidecar) {
  const index = new Map();
  if (!sidecar) return index;
  for (const entry of sidecar.venues) {
    if (!entry.display || !entry.opening_hours) continue;
    index.set(entry.key, entry);
  }
  return index;
}

/** Recompute every rendered string from the raw values already committed. */
export function rerenderSidecar(sidecar) {
  const out = { ...sidecar, strings: STRINGS, venues: [] };
  for (const entry of sidecar.venues) {
    const next = { ...entry };
    if (entry.opening_hours) {
      const display = renderOpeningHours(entry.opening_hours);
      display.freshness = renderFreshness({
        checkDate: entry.check_date,
        timestamp: entry.osm_timestamp,
      });
      next.display = display;
    } else {
      delete next.display;
    }
    out.venues.push(next);
  }
  return out;
}
