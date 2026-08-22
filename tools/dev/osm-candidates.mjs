#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY curation aid for tools/osm-venues.json.
 *
 * It prints OpenStreetMap objects near a venue so a person can decide whether
 * one of them IS that venue. It deliberately cannot decide that itself and it
 * writes nothing into the repository: the value of the curated match file is
 * that every row in it was looked at, and a script that "found a good enough
 * candidate" would destroy exactly that. What it prints is evidence — name,
 * distance, the classifying tag, the address, whether opening hours are even
 * tagged — and the answer is still a human's.
 *
 * The one judgement it does make is *bucketing*, so that a sweep of thousands
 * of venues can be reviewed at all:
 *
 *   EXACT   one candidate whose name is identical to the venue's, and no other
 *           candidate shares a distinctive word with it
 *   STRONG  no exact match, but exactly one candidate whose name contains or
 *           is contained by the venue's, sharing a distinctive word
 *   MULTI   two or more candidates with a name link — ambiguous by definition
 *   WEAK    candidates exist, none whose name relates to the venue's
 *   NONE    no candidate object at all within the radius
 *
 * Buckets are about NAMES, never about distance. The nearest object is never
 * promoted for being nearest, and MULTI is an outcome ("ambiguous"), not a tie
 * to be broken. WEAK and NONE never produce a proposal — a match there has to
 * be argued individually, which does happen: "INWALL Climbing Center" and
 * "In Wall Climbing Center" are the same gym and no rule will say so.
 *
 *   node tools/dev/osm-candidates.mjs --country DE
 *   node tools/dev/osm-candidates.mjs --country DE --bucket MULTI --verbose
 *   node tools/dev/osm-candidates.mjs --country FR --json > /tmp/fr.json
 *   node tools/dev/osm-candidates.mjs --name "boulderwelt" --verbose
 *
 * Reads the public Overpass API — a shared resource. One request covers a
 * whole chunk of venues (default 40) through a multi-coordinate `around`,
 * every response is cached on disk so a re-run costs nothing, and endpoints
 * rotate with bounded backoff when one is unwell. Never run it from a test.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCuratedMatches, venueLooksPrivate } from '../osm-hours.mjs';
import { venueKey } from '../venue-key.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const CURATED_FILE = join(REPO_ROOT, 'tools', 'osm-venues.json');

// Ordered by preference. A mirror is only tried when the one before it fails.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const USER_AGENT =
  'CruxCoachPages/1.0 (opening-hours curation; +https://cruxcoach.org/; contact https://cruxcoach.org/imprint.html)';

const DEFAULTS = {
  radius: 250,
  limit: Infinity,
  chunk: 40,
  delayMs: 6000,
  timeoutMs: 180000,
  retries: 3,
  backoffMs: 30000,
  cacheDir: join(tmpdir(), 'cruxcoach-osm-candidates'),
};

// Words that say what kind of place it is rather than which place it is.
// Two venues sharing only these do not share a name.
const GENERIC = new Set([
  'boulder', 'bouldering', 'boulders', 'bouldern', 'boulderhalle', 'boulderzentrum',
  'climb', 'climbing', 'climbers', 'kletter', 'kletterhalle', 'kletterzentrum',
  'kletterwald', 'klettern', 'escalade', 'escalada', 'arrampicata', 'klimhal',
  'klatring', 'klatresenter', 'buldring', 'kiipeily', 'wspinaczka', 'lezecke',
  'centrum', 'centre', 'center', 'centro', 'zentrum', 'halle', 'hall', 'haus',
  'gym', 'gimnasio', 'fitness', 'sport', 'sports', 'sportzentrum', 'sportcentrum',
  'wall', 'walls', 'wand', 'arena', 'park', 'studio', 'club', 'the', 'and',
  'der', 'die', 'das', 'den', 'des', 'dem', 'ein', 'eine', 'and', 'und',
  'de', 'la', 'le', 'les', 'el', 'los', 'las', 'du', 'des', 'di', 'da', 'do',
  'van', 'den', 'het', 'een', 'og', 'och', 'ja', 'et', 'y', 'e', 'a', 'i',
  'gmbh', 'ltd', 'llc', 'inc', 'ev', 'asd', 'ssd', 'dav', 'sac', 'oeav',
  'indoor', 'outdoor', 'training', 'academy', 'factory', 'house', 'room',
]);

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS,
    country: null, name: null, key: null, all: false,
    includeCurated: false, verbose: false, json: false,
    buckets: null, endpoints: [...ENDPOINTS], noCache: false, offline: false,
    recheck: null, broad: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--country': opts.country = String(argv[++i]).toUpperCase(); break;
      case '--all': opts.all = true; break;
      case '--name': opts.name = String(argv[++i]).toLowerCase(); break;
      case '--key': opts.key = String(argv[++i]); break;
      case '--radius': opts.radius = Number(argv[++i]); break;
      case '--limit': opts.limit = Number(argv[++i]); break;
      case '--chunk': opts.chunk = Number(argv[++i]); break;
      case '--delay-ms': opts.delayMs = Number(argv[++i]); break;
      case '--retries': opts.retries = Number(argv[++i]); break;
      case '--endpoint': opts.endpoints = [String(argv[++i])]; break;
      case '--cache-dir': opts.cacheDir = String(argv[++i]); break;
      case '--no-cache': opts.noCache = true; break;
      // Report from the cache only. Nothing is fetched, so an unreachable
      // Overpass turns into "queued", not into a wrong answer.
      case '--offline': opts.offline = true; break;
      case '--bucket': opts.buckets = String(argv[++i]).toUpperCase().split(','); break;
      case '--include-curated': opts.includeCurated = true; break;
      // Re-examine venues that already have an outcome of this kind — the way
      // to give the 900-odd "no-object" venues a second chance with a
      // different question, without disturbing anything already matched.
      case '--recheck': opts.recheck = String(argv[++i]); break;
      // Ask for named objects of any kind, not just climbing-tagged ones: a
      // gym mapped as a plain named building is invisible to the normal sweep.
      // Only name matches are reported; at this breadth everything else is
      // noise.
      case '--broad': opts.broad = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--json': opts.json = true; break;
      default:
        process.stderr.write(`unknown option: ${argv[i]}\n`);
        process.exit(2);
    }
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Names ─────────────────────────────────────────────────────────────────

export function normalizeName(value) {
  return String(value ?? '')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(normalized) {
  return normalized.split(' ').filter(Boolean);
}

function distinctive(list) {
  return list.filter((t) => t.length >= 4 && !GENERIC.has(t));
}

/**
 * How two names relate. 'exact' | 'contains' | 'shared' | null.
 * Never uses distance: proximity is not evidence of identity.
 */
export function nameRelation(venueName, osmName) {
  const a = normalizeName(venueName);
  const b = normalizeName(osmName);
  if (!a || !b) return null;
  if (a === b) return 'exact';

  const ta = tokens(a);
  const tb = tokens(b);
  const da = new Set(distinctive(ta));
  const db = new Set(distinctive(tb));
  const shared = [...da].filter((t) => db.has(t));
  if (!shared.length) return null;

  // One name inside the other ("Boulderwelt" ⊂ "Boulderwelt Dortmund"), with
  // every distinctive word of the shorter one present in the longer.
  const shorter = da.size <= db.size ? da : db;
  if (shared.length === shorter.size && shorter.size > 0) return 'contains';
  return 'shared';
}

// ── Venue selection ───────────────────────────────────────────────────────

function selectVenues(opts) {
  const data = JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8'));
  // `settled` deliberately excludes the "unreachable" queue, so a venue whose
  // discovery failed last time is swept again rather than written off.
  const { settled, decisions } = loadCuratedMatches(CURATED_FILE);
  const byStatus = new Map(decisions.map((d) => [d.key, d.status]));

  const out = [];
  for (const feature of data.features ?? []) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = venueKey(lat, lon);
    const props = feature.properties ?? {};
    if (opts.recheck) {
      if (byStatus.get(key) !== opts.recheck) continue;
    } else if (!opts.includeCurated && settled.has(key)) continue;
    if (opts.key && key !== opts.key) continue;
    if (opts.country && props.country !== opts.country) continue;
    if (!opts.country && !opts.all && !opts.name && !opts.key && !opts.recheck) continue;
    if (opts.name && !String(props.name ?? '').toLowerCase().includes(opts.name)) continue;
    const privacy = venueLooksPrivate(feature);
    if (privacy.private) continue; // home walls are never candidates
    out.push({
      key,
      lat,
      lon,
      name: props.name ?? '',
      city: props.city ?? props.city_nearest ?? '',
      country: props.country ?? '',
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}

// ── Overpass ──────────────────────────────────────────────────────────────

// One `around` statement per venue per filter. The tempting shorter form —
// a single `around` carrying every coordinate — reliably times out on the
// public instance: Overpass evaluates a coordinate list far less efficiently
// than a union of single-centre lookups. This shape answers a 40-venue chunk
// in a few seconds.
// Broad mode asks for anything named that could be a business or a building.
// It deliberately does not ask for highways, benches or bus stops: a gym is
// mapped as one of these six things or it is not mapped.
const BROAD_FILTERS = ['["building"]', '["leisure"]', '["amenity"]', '["shop"]', '["office"]', '["club"]'];
// These mirror PUBLIC_VENUE_TAGS in tools/osm-hours.mjs, which is the list the
// refresh will accept. Asking for anything wider finds objects whose hours can
// never be published — `sport=bouldering` and `amenity=gym` are in here
// because they are in that list and were missed by an earlier, narrower query.
export const NARROW_FILTERS = [
  '["sport"~"climbing"]',
  '["sport"~"boulder"]',
  '["leisure"~"^(sports_centre|climbing|fitness_centre|sports_hall)$"]',
  '["amenity"="gym"]',
  '["shop"="sports"]',
  '["disused:leisure"~"^(sports_centre|climbing)$"]',
];

function overpassQuery(venues, radius, broad = false) {
  const clause = (filter) => venues
    .map((v) => `  nwr(around:${radius},${v.lat.toFixed(6)},${v.lon.toFixed(6)})${filter};`)
    .join('\n');
  const filters = broad ? BROAD_FILTERS.map((f) => `["name"]${f}`) : NARROW_FILTERS;
  return `[out:json][timeout:180];
(
${filters.map(clause).join('\n')}
);
out tags center;`;
}

function cachePath(opts, query) {
  const digest = createHash('sha256').update(query).digest('hex').slice(0, 32);
  return join(opts.cacheDir, `${digest}.json`);
}

async function overpassFetch(url, query, opts) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'text/plain' },
    body: query,
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (res.ok) return res.json();
  const err = new Error(`HTTP ${res.status}`);
  err.status = res.status;
  throw err;
}

/**
 * One chunk of venues → the Overpass answer, or null when every endpoint
 * refused. Cached on disk, so re-running a sweep costs nothing and an
 * interrupted sweep resumes where it stopped.
 */
async function askOverpass(query, opts) {
  const file = cachePath(opts, query);
  if (!opts.noCache && existsSync(file)) {
    try {
      return { body: JSON.parse(readFileSync(file, 'utf-8')), cached: true };
    } catch { /* a truncated cache entry is simply refetched */ }
  }
  if (opts.offline) return { body: null, cached: false, reason: 'not-cached' };

  let lastReason = 'unknown';
  for (const endpoint of opts.endpoints) {
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      try {
        const body = await overpassFetch(endpoint, query, opts);
        if (!opts.noCache) {
          mkdirSync(opts.cacheDir, { recursive: true });
          writeFileSync(file, JSON.stringify(body));
        }
        return { body, cached: false, endpoint };
      } catch (err) {
        lastReason = `${endpoint.replace(/^https:\/\//, '').split('/')[0]}: ${err.message}`;
        // 429 (slot exhausted) and 504 (query timed out) mean "come back
        // later"; anything else means "ask someone else".
        const retryable = err.status === 429 || err.status === 504;
        if (!retryable) break;
        if (attempt === opts.retries) break;
        const wait = opts.backoffMs * (attempt + 1);
        process.stderr.write(`[candidates] ${lastReason} — waiting ${wait / 1000}s\n`);
        await sleep(wait);
      }
    }
    process.stderr.write(`[candidates] ${lastReason} — trying the next endpoint\n`);
  }
  return { body: null, cached: false, reason: lastReason };
}

// ── Classification ────────────────────────────────────────────────────────

function summarize(element) {
  const t = element.tags ?? {};
  // `access` is in here because a gym tagged access=private loses its hours at
  // refresh time, and a curator should see that while deciding, not after.
  const kind = ['leisure', 'sport', 'shop', 'amenity', 'disused:leisure', 'access']
    .filter((k) => t[k])
    .map((k) => `${k}=${t[k]}`)
    .join(' ');
  return {
    id: `${element.type}/${element.id}`,
    type: element.type,
    osmId: element.id,
    name: t.name ?? '',
    kind,
    climbing: /climbing/.test(t.sport ?? '') || t.leisure === 'climbing',
    shopOnly: !t.leisure && !t.sport && t.shop === 'sports',
    disused: Boolean(t['disused:leisure']),
    address: [t['addr:street'], t['addr:housenumber'], t['addr:city']].filter(Boolean).join(' '),
    opening_hours: t.opening_hours ?? null,
    check_date: t['check_date:opening_hours'] ?? null,
    lat: element.lat ?? element.center?.lat,
    lon: element.lon ?? element.center?.lon,
  };
}

const RANK = { exact: 3, contains: 2, shared: 1 };

function classify(venue, elements, radius) {
  const near = elements
    .map((e) => ({ ...e, m: Math.round(haversineM(venue.lat, venue.lon, e.lat, e.lon)) }))
    .filter((e) => e.m <= radius)
    .map((e) => ({ ...e, relation: e.name ? nameRelation(venue.name, e.name) : null }))
    .sort((a, b) => (RANK[b.relation] ?? 0) - (RANK[a.relation] ?? 0) || a.m - b.m);

  const linked = near.filter((e) => e.relation);
  // A gear shop that happens to share a name is not the gym; it can still be
  // matched by hand, but it never carries a bucket on its own.
  const matchable = linked.filter((e) => !e.shopOnly);

  let bucket;
  if (!near.length) bucket = 'NONE';
  else if (!matchable.length) bucket = 'WEAK';
  else if (matchable.length > 1) bucket = 'MULTI';
  else if (matchable[0].relation === 'exact') bucket = 'EXACT';
  else if (matchable[0].relation === 'contains') bucket = 'STRONG';
  else bucket = 'MULTI'; // a single merely-shared word is not identity

  return { bucket, near, best: matchable[0] ?? null };
}

// ── Output ────────────────────────────────────────────────────────────────

function line(venue, result) {
  const b = result.best;
  const head = `${result.bucket.padEnd(6)} ${venue.country} ${venue.key.padEnd(20)} ${venue.name.slice(0, 38).padEnd(38)}`;
  if (!b) {
    const others = result.near.slice(0, 2).map((e) => `${e.name || '(unnamed)'} ${e.m}m`).join('; ');
    return `${head} —  ${others || 'nothing in range'}`;
  }
  return `${head} → ${b.id.padEnd(16)} ${(b.name || '(unnamed)').slice(0, 34).padEnd(34)} ${String(b.m).padStart(4)}m  ${b.kind}${b.opening_hours ? '  OH' : ''}`;
}

function detail(venue, result) {
  const out = [`\n=== ${venue.name} — ${venue.city}, ${venue.country}  [${result.bucket}]`,
    `    venue key ${venue.key} @ ${venue.lat}, ${venue.lon}`];
  if (!result.near.length) out.push('    no candidate objects within the radius');
  for (const c of result.near) {
    out.push(`    ${String(c.m).padStart(4)} m  ${c.id.padEnd(16)} ${c.name || '(unnamed)'}   [${c.relation ?? 'no name link'}]`);
    out.push(`             ${c.kind}${c.address ? ` | ${c.address}` : ''}`);
    out.push(`             opening_hours: ${c.opening_hours ?? '—'}${c.check_date ? `  (check_date ${c.check_date})` : ''}`);
  }
  return out.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const venues = selectVenues(opts);
  if (!venues.length) {
    process.stderr.write('no venues match that selection (already decided ones are skipped)\n');
    if (opts.json) process.stdout.write('[]\n');
    return;
  }
  process.stderr.write(`[candidates] ${venues.length} venue(s), radius ${opts.radius} m, chunks of ${opts.chunk}\n`);

  const results = [];
  const unreachable = [];
  let fetched = 0;

  for (let i = 0; i < venues.length; i += opts.chunk) {
    const chunk = venues.slice(i, i + opts.chunk);
    const query = overpassQuery(chunk, opts.radius, opts.broad);
    const answer = await askOverpass(query, opts);
    if (!answer.body) {
      for (const venue of chunk) unreachable.push({ venue, reason: answer.reason });
      process.stderr.write(`[candidates] chunk ${i / opts.chunk + 1}: unreachable (${answer.reason})\n`);
      continue;
    }
    if (!answer.cached) {
      fetched++;
      process.stderr.write(`[candidates] chunk ${i / opts.chunk + 1}/${Math.ceil(venues.length / opts.chunk)} fetched\n`);
      await sleep(opts.delayMs);
    }
    const elements = (answer.body.elements ?? []).map(summarize).filter((e) => e.lat != null);
    for (const venue of chunk) {
      const result = classify(venue, elements, opts.radius);
      // At this breadth "three unnamed buildings nearby" is not evidence of
      // anything, so only rows with a name link are worth a person's time.
      if (opts.broad && !result.best) continue;
      results.push({ venue, ...result });
    }
  }

  const wanted = opts.buckets ? results.filter((r) => opts.buckets.includes(r.bucket)) : results;

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      radius: opts.radius,
      results: wanted.map((r) => ({
        key: r.venue.key,
        name: r.venue.name,
        lat: r.venue.lat,
        lon: r.venue.lon,
        country: r.venue.country,
        bucket: r.bucket,
        best: r.best ?? null,
        near: r.near.map((c) => ({ id: c.id, name: c.name, m: c.m, kind: c.kind, relation: c.relation, oh: c.opening_hours })),
      })),
      unreachable: unreachable.map((u) => ({ key: u.venue.key, name: u.venue.name, country: u.venue.country, reason: u.reason })),
    }, null, 1)}\n`);
  } else if (opts.verbose) {
    for (const r of wanted) process.stdout.write(`${detail(r.venue, r)}\n`);
  } else {
    for (const r of wanted) process.stdout.write(`${line(r.venue, r)}\n`);
  }

  const counts = {};
  for (const r of results) counts[r.bucket] = (counts[r.bucket] ?? 0) + 1;
  process.stderr.write(`[candidates] ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}` +
    `${unreachable.length ? `, UNREACHABLE ${unreachable.length}` : ''} (${fetched} request(s))\n`);
  if (!opts.json) {
    process.stderr.write('[candidates] EXACT/STRONG still need reading; MULTI means "ambiguous"; WEAK/NONE need an individual argument to become anything.\n');
  }
}

// Only sweep when run as a command; the name helpers above are imported by
// the unit test, and importing a module must not fire off Overpass queries.
if (process.argv[1] && process.argv[1].endsWith('osm-candidates.mjs')) {
  main().catch((err) => {
    process.stderr.write(`[candidates] ${err.stack ?? err.message}\n`);
    process.exit(1);
  });
}
