#!/usr/bin/env node
// Refresh boards/data/osm-opening-hours.json from OpenStreetMap.
//
// This is the ONLY code in the repository that talks to OpenStreetMap for
// opening hours, and it runs at build time, on demand. No visitor's browser
// ever asks OSM about a venue: the site ships the committed sidecar and
// nothing else, so a reader is never announced to a third party for looking
// at a gym's hours, and the site keeps working when OSM does not.
//
// It only ever reads objects it was told about. tools/osm-venues.json lists
// exact osm_type/osm_id pairs that a person verified; this command re-reads
// those ids and nothing else. It does not search, it does not follow the
// nearest match, and it cannot discover a new venue.
//
//   node tools/refresh-osm-hours.mjs              # refresh from OpenStreetMap
//   node tools/refresh-osm-hours.mjs --force      # ignore the interval guard
//   node tools/refresh-osm-hours.mjs --dry-run    # fetch, report, write nothing
//   node tools/refresh-osm-hours.mjs --offline    # re-render committed values
//   node tools/refresh-osm-hours.mjs --check      # verify the committed file
//
// Exit codes: 0 success (see the `result:` line for changed/unchanged/
// skipped), 1 a failure that should stop a build, 2 bad usage.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSidecar, classifyOsmTags, loadCuratedMatches, loadSidecar, rerenderSidecar, STATUS,
  venueLooksPrivate,
} from './osm-hours.mjs';
import { venueKey } from './venue-key.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const CURATED_FILE = join(REPO_ROOT, 'tools', 'osm-venues.json');
const SIDECAR_FILE = join(REPO_ROOT, 'boards', 'data', 'osm-opening-hours.json');

const API_BASE = 'https://api.openstreetmap.org/api/0.6';

// Identifies us to the OSM API operators, as their usage policy asks: a name,
// a version, and a URL that says who we are and how to reach us.
const USER_AGENT =
  'CruxCoachPages/1.0 (opening-hours refresh; +https://cruxcoach.org/; contact https://cruxcoach.org/imprint.html)';

const DEFAULTS = {
  batchSize: 40,      // ids per multi-fetch request; the API allows far more
  delayMs: 1200,      // between requests — one client, deliberately slow
  timeoutMs: 20000,
  minIntervalHours: 144, // ~weekly; opening hours do not change by the hour
};

// The only tags read out of a response. Everything else in an OSM object —
// phone numbers, e-mail addresses, operator names, contact details, notes —
// is dropped where it arrives and never reaches the repository.
const WANTED_TAGS = ['opening_hours', 'check_date:opening_hours', 'name'];

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS, offline: false, check: false, force: false, dryRun: false, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const numeric = (name) => {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        throw Object.assign(new Error(`--${name} needs a positive number`), { usage: true });
      }
      return value;
    };
    switch (arg) {
      case '--offline': opts.offline = true; break;
      case '--check': opts.check = true; opts.offline = true; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--batch-size': opts.batchSize = numeric('batch-size'); break;
      case '--delay-ms': opts.delayMs = numeric('delay-ms'); break;
      case '--timeout-ms': opts.timeoutMs = numeric('timeout-ms'); break;
      case '--min-interval-hours': opts.minIntervalHours = numeric('min-interval-hours'); break;
      case '--help': case '-h': opts.help = true; break;
      default:
        throw Object.assign(new Error(`unknown option: ${arg}`), { usage: true });
    }
  }
  return opts;
}

const USAGE = `usage: node tools/refresh-osm-hours.mjs [options]

  --offline              re-render the committed sidecar; no network
  --check                verify the committed sidecar is current (implies --offline)
  --force                refresh even if the interval guard says it is too soon
  --dry-run              fetch and report, but write nothing
  --batch-size N         ids per request (default ${DEFAULTS.batchSize})
  --delay-ms N           pause between requests (default ${DEFAULTS.delayMs})
  --timeout-ms N         per-request timeout (default ${DEFAULTS.timeoutMs})
  --min-interval-hours N interval guard (default ${DEFAULTS.minIntervalHours})
  --quiet                only print the result line
`;

function log(opts, message) {
  if (!opts.quiet) process.stderr.write(`[osm-hours] ${message}\n`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Every venue on the map should carry exactly one outcome. This does not fail
// the build — upstream adds venues nightly and the sweep runs on its own
// schedule — but an undecided venue is work, so it is counted out loud.
function reportCoverage(opts, decisions, features) {
  const decided = new Set(decisions.map((d) => d.key));
  const stale = decisions.filter((d) => !features.has(d.key)).length;
  let undecided = 0;
  let privateNowCommercial = 0;
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  for (const [key, feature] of features) {
    const decision = byKey.get(key);
    if (!decision) { undecided++; continue; }
    if (decision.status === 'private' && !venueLooksPrivate(feature).private) privateNowCommercial++;
  }
  log(opts, `coverage: ${decided.size} decided, ${undecided} venue(s) still without an outcome` +
    `${stale ? `, ${stale} decision(s) no longer resolve to a venue` : ''}`);
  if (privateNowCommercial) {
    log(opts, `WARN ${privateNowCommercial} venue(s) recorded as private no longer look private upstream — re-review them`);
  }
}

function loadFeatures() {
  const data = JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8'));
  const byKey = new Map();
  for (const feature of data.features ?? []) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    byKey.set(venueKey(coords[1], coords[0]), feature);
  }
  return byKey;
}

// ── Fetching ──────────────────────────────────────────────────────────────

async function getJson(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, httpStatus: res.status };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// One OSM element → the handful of fields the sidecar is allowed to carry.
function readElement(element) {
  const tags = element.tags ?? {};
  const wanted = {};
  for (const key of WANTED_TAGS) if (typeof tags[key] === 'string') wanted[key] = tags[key].trim();

  const classification = classifyOsmTags(tags);
  if (!classification.ok) {
    return { status: STATUS.NOT_PUBLIC, reason: classification.reason, osm_name: wanted.name };
  }

  const out = {
    status: wanted.opening_hours ? STATUS.OK : STATUS.NO_HOURS,
    kind: classification.kind,
    timestamp: typeof element.timestamp === 'string' ? element.timestamp : undefined,
    version: Number.isInteger(element.version) ? element.version : undefined,
  };
  if (wanted.name) out.osm_name = wanted.name;
  if (wanted.opening_hours) out.opening_hours = wanted.opening_hours;
  if (wanted['check_date:opening_hours']) out.check_date = wanted['check_date:opening_hours'];
  return out;
}

/**
 * Read the given ids of one OSM type. Batched through the API's multi-fetch
 * endpoint, which answers 404 for the whole batch if a single member has been
 * deleted — so a failed batch is retried one id at a time, both to find out
 * which one is gone and to keep the rest of the batch usable.
 */
async function fetchType(type, ids, opts, results) {
  const plural = `${type}s`;
  for (let i = 0; i < ids.length; i += opts.batchSize) {
    const batch = ids.slice(i, i + opts.batchSize);
    const url = `${API_BASE}/${plural}.json?${plural}=${batch.join(',')}`;
    log(opts, `GET ${plural} × ${batch.length}`);
    const res = await getJson(url, opts);
    await sleep(opts.delayMs);

    if (res.ok) {
      const seen = new Set();
      for (const element of res.body.elements ?? []) {
        if (element.type !== type) continue;
        seen.add(element.id);
        results.set(`${type}/${element.id}`, readElement(element));
      }
      // The API omits nothing on a successful multi-fetch, so anything the
      // batch did not carry is an id that no longer resolves.
      for (const id of batch) {
        if (!seen.has(id)) results.set(`${type}/${id}`, { status: STATUS.GONE });
      }
      continue;
    }

    log(opts, `  batch failed (${res.httpStatus ?? res.error}) — retrying one at a time`);
    for (const id of batch) {
      const single = await getJson(`${API_BASE}/${type}/${id}.json`, opts);
      await sleep(opts.delayMs);
      if (single.ok) {
        const element = (single.body.elements ?? []).find((e) => e.type === type && e.id === id);
        results.set(`${type}/${id}`, element
          ? readElement(element)
          : { status: STATUS.GONE });
      } else if (single.httpStatus === 404 || single.httpStatus === 410) {
        results.set(`${type}/${id}`, { status: STATUS.GONE });
      } else {
        results.set(`${type}/${id}`, {
          status: STATUS.UNREACHABLE,
          refresh_error: String(single.httpStatus ?? single.error),
        });
      }
    }
  }
}

// A previously fetched value is kept when the source cannot be reached now:
// losing hours because OSM had a bad minute would be a worse outcome than
// showing last week's value with its (unchanged) freshness date. An object
// that is confirmed deleted or retagged does lose its hours — that is a fact
// about the object, not an outage.
function carryForward(previousEntry, result) {
  if (result.status !== STATUS.UNREACHABLE || !previousEntry?.opening_hours) return result;
  return {
    ...result,
    opening_hours: previousEntry.opening_hours,
    check_date: previousEntry.check_date,
    timestamp: previousEntry.osm_timestamp,
    version: previousEntry.osm_version,
    kind: previousEntry.osm_kind,
    osm_name: previousEntry.osm_name,
  };
}

// ── Comparison ────────────────────────────────────────────────────────────

function withoutTimestamps(sidecar) {
  const { refreshed_at: _r, checked_at: _c, ...rest } = sidecar;
  return JSON.stringify(rest);
}

function serialize(sidecar) {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { accepted, decisions, counts } = loadCuratedMatches(CURATED_FILE);
  log(opts, `decisions: ${decisions.length} venue(s) — ` +
    Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', '));
  const features = loadFeatures();
  reportCoverage(opts, decisions, features);
  const previous = loadSidecar(SIDECAR_FILE);
  const previousByKey = new Map((previous?.venues ?? []).map((v) => [v.key, v]));

  // ── offline / check ──
  if (opts.offline) {
    if (!previous) {
      process.stderr.write('[osm-hours] no committed sidecar to re-render\n');
      process.exit(1);
    }
    const rerendered = rerenderSidecar(previous);
    const current = readFileSync(SIDECAR_FILE, 'utf-8');
    const next = serialize(rerendered);
    if (opts.check) {
      if (next !== current) {
        process.stderr.write(
          '[osm-hours] committed sidecar is stale — its rendered text does not match the renderer.\n' +
          '            Run: node tools/refresh-osm-hours.mjs --offline\n',
        );
        process.exit(1);
      }
      process.stdout.write('[osm-hours] result: current\n');
      return;
    }
    if (next === current) {
      process.stdout.write('[osm-hours] result: unchanged\n');
      return;
    }
    if (!opts.dryRun) writeFileSync(SIDECAR_FILE, next);
    process.stdout.write(`[osm-hours] result: ${opts.dryRun ? 'would-change' : 'changed'}\n`);
    return;
  }

  // ── interval guard ──
  const checkedAt = previous?.checked_at ?? previous?.refreshed_at;
  if (checkedAt && !opts.force) {
    const ageHours = (Date.now() - Date.parse(checkedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours < opts.minIntervalHours) {
      log(opts, `last checked ${ageHours.toFixed(1)} h ago (< ${opts.minIntervalHours} h) — skipping`);
      process.stdout.write('[osm-hours] result: skipped\n');
      return;
    }
  }

  if (!accepted.length) {
    log(opts, 'no accepted matches — nothing to fetch');
    process.stdout.write('[osm-hours] result: unchanged\n');
    return;
  }

  // ── fetch ──
  const byType = new Map();
  for (const match of accepted) {
    if (!byType.has(match.osm_type)) byType.set(match.osm_type, []);
    byType.get(match.osm_type).push(match.osm_id);
  }
  const results = new Map();
  for (const [type, ids] of [...byType].sort()) {
    ids.sort((a, b) => a - b);
    try {
      await fetchType(type, ids, opts, results);
    } catch (err) {
      // Graceful source failure: an unreachable OSM leaves the committed
      // values in place and reports it, it never empties the sidecar.
      log(opts, `  ${type} lookups failed outright: ${err.message}`);
    }
  }

  const fetched = new Map();
  for (const match of accepted) {
    const result = results.get(`${match.osm_type}/${match.osm_id}`)
      ?? { status: STATUS.UNREACHABLE, refresh_error: 'not-attempted' };
    fetched.set(match.key, carryForward(previousByKey.get(match.key), result));
  }

  const now = new Date().toISOString();
  const sidecar = buildSidecar({ accepted, features, fetched, refreshedAt: now });
  sidecar.checked_at = now;

  const changed = !previous || withoutTimestamps(sidecar) !== withoutTimestamps(previous);
  if (!changed) sidecar.refreshed_at = previous.refreshed_at;

  const s = sidecar.stats;
  log(opts, `venues: ${s.matched_to_venue} matched, ${s.with_opening_hours} with hours ` +
    `(${s.rendered_schedule} rendered, ${s.raw_only} raw), ${s.without_opening_hours} untagged, ` +
    `${s.gone} gone, ${s.not_a_public_venue} retagged, ${s.unreachable} unreachable`);
  if (s.unmatched_venue) log(opts, `WARN ${s.unmatched_venue} curated match(es) no longer resolve to a venue`);

  if (opts.dryRun) {
    process.stdout.write(`[osm-hours] result: ${changed ? 'would-change' : 'unchanged'}\n`);
    return;
  }
  writeFileSync(SIDECAR_FILE, serialize(sidecar));
  process.stdout.write(`[osm-hours] result: ${changed ? 'changed' : 'unchanged'}\n`);
}

main().catch((err) => {
  process.stderr.write(`[osm-hours] ${err.stack ?? err.message}\n`);
  process.exit(1);
});
