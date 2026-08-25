#!/usr/bin/env node
// Builds boards/data/boards.geojson from the registered source adapters.
//
// Each adapter in tools/sources/*.mjs exports an async `load()` returning
// { entries: NormalizedEntry[], meta: object }. NormalizedEntry shape:
//
//   { source: string, board: BoardId, name: string, lat: number, lon: number,
//     // plus board-specific richness — Kilter has walls[]+address+instagram,
//     // MoonBoard has commercial/led, others have username. }
//
// We group entries by (lat, lon) rounded to ~10 m into a single venue
// feature so multi-board gyms render as one composite marker instead of
// overlapping single-board markers. The boards[] array on each venue
// preserves the per-board richness.
//
// To add a new source: write tools/sources/<name>.mjs with the same shape,
// then add it to the SOURCES array below. The frontend reads only the
// merged GeoJSON and doesn't know which source a board came from.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import * as hangtime from './sources/hangtime.mjs';
import { boardVenueCounts, renderListPage, renderStatsBlock, injectBetweenMarkers } from './render-static.mjs';
import { findNearestCity, loadCityIndex } from './nearest-city.mjs';
import { applyVenueLinks, loadVenueLinks } from './venue-links.mjs';
import { applyVenueHours, loadVenueHours } from './venue-hours.mjs';
import { assignVenueIds, clearVenueIds, loadVenueIdLedger } from './venue-ids.mjs';

const COUNTRY_CODER_PACKAGE = '@rapideditor/country-coder';
const COUNTRY_CACHE = join(tmpdir(), 'cruxcoach-build-deps');

// Lazily install country-coder into a per-tmp prefix on first run so the
// repo doesn't carry a node_modules. Returns the loaded iso1A2Code fn.
async function loadCountryCoder() {
  const moduleEntry = join(COUNTRY_CACHE, 'node_modules', '@rapideditor', 'country-coder', 'dist', 'country-coder.mjs');
  if (!existsSync(moduleEntry)) {
    process.stderr.write(`[build] installing ${COUNTRY_CODER_PACKAGE} into ${COUNTRY_CACHE}\n`);
    mkdirSync(COUNTRY_CACHE, { recursive: true });
    execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', `${COUNTRY_CODER_PACKAGE}@latest`],
      { cwd: COUNTRY_CACHE, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const mod = await import(pathToFileURL(moduleEntry).href);
  return mod.iso1A2Code;
}

const SOURCES = [
  { id: 'hangtime', mod: hangtime },
];

const BOARDS = [
  'kilter', 'tension', 'grasshopper', 'decoy', 'soill',
  'touchstone', 'aurora', 'moonboard', '12climb',
];

// Priority when picking the venue's canonical name + city/country from
// among its boards. Higher = preferred. Kilter wins because it ships the
// most complete metadata (address/city/country/instagram) of any source.
const NAME_PRIORITY = {
  kilter: 100, moonboard: 50, tension: 40, grasshopper: 30,
  decoy: 30, soill: 30, touchstone: 30, aurora: 30, '12climb': 10,
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const OUT_META = join(REPO_ROOT, 'boards', 'data', 'boards.meta.json');
const OUT_LIST = join(REPO_ROOT, 'boards', 'list.html');
const OUT_LIST_DE = join(REPO_ROOT, 'de', 'boards', 'list.html');
const BOARDS_INDEX = join(REPO_ROOT, 'boards', 'index.html');
const BOARDS_INDEX_DE = join(REPO_ROOT, 'de', 'boards', 'index.html');
const CITIES_FILE = join(REPO_ROOT, 'boards', 'data', 'cities.json');
const OVERRIDES_FILE = join(REPO_ROOT, 'tools', 'overrides.json');

// How far a town may sit from a venue and still be a fair label for it. 25 km
// covers a metro area and its suburbs without pinning a rural gym to a city
// an hour's drive away.
const NEAREST_CITY_MAX_KM = 25;
const WELLPASS_FILE = join(REPO_ROOT, 'tools', 'wellpass.json');
const VENUE_LINKS_FILE = join(REPO_ROOT, 'tools', 'venue-links.json');
const VENUE_HOURS_FILE = join(REPO_ROOT, 'tools', 'venue-hours.json');
const VENUE_IDS_FILE = join(REPO_ROOT, 'tools', 'venue-ids.json');
const SOURCE_FRESHNESS_FILE = join(REPO_ROOT, 'tools', 'board-source-freshness.json');

// 4-decimal precision ≈ 11 m at the equator. Tight enough to keep
// neighbouring gyms separate, loose enough to collapse multi-board
// installations that almost always share coordinates.
function venueKey(lat, lon) {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

function loadSourceFreshness() {
  const parsed = JSON.parse(readFileSync(SOURCE_FRESHNESS_FILE, 'utf8'));
  if (parsed.repository !== 'Stevie-Ray/hangtime-climbing-boards' ||
      !parsed.boards || typeof parsed.boards !== 'object') {
    throw new Error('tools/board-source-freshness.json has an invalid source contract');
  }
  for (const board of BOARDS) {
    const item = parsed.boards[board];
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.last_data_change) ||
        !/^[0-9a-f]{40}$/.test(item.commit) ||
        !['available', 'frozen'].includes(item.status)) {
      throw new Error(`tools/board-source-freshness.json has invalid metadata for ${board}`);
    }
  }
  return parsed;
}

function stripInternal(entry) {
  const { source: _s, board: _b, lat: _lt, lon: _ln, name: _n, ...rest } = entry;
  // Keep board on the per-board object so the frontend can colour-code it.
  return { board: entry.board, ...rest };
}

// Apply hand-curated corrections from tools/overrides.json onto the loaded
// entries, before venue grouping. Overrides win over upstream values — a
// conflict (replacing a non-null upstream value) is logged so a stale
// override stays visible. An entry matches by board + (lat, lon) at
// venueKey precision (~11 m), so the hand-edited file may carry coordinates
// at any precision. Returns counts recorded in boards.meta.json.
function applyOverrides(entries) {
  const stats = { defined: 0, applied: 0, unmatched: 0, conflicts: 0 };
  if (!existsSync(OVERRIDES_FILE)) return stats;

  let overrides;
  try {
    overrides = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf-8'));
  } catch (err) {
    throw new Error(`tools/overrides.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(overrides)) {
    throw new Error('tools/overrides.json must be a JSON array of override objects');
  }
  stats.defined = overrides.length;

  const byKey = new Map();
  for (const e of entries) {
    const k = `${e.board}|${venueKey(e.lat, e.lon)}`;
    let list = byKey.get(k);
    if (!list) { list = []; byKey.set(k, list); }
    list.push(e);
  }

  overrides.forEach((ov, i) => {
    const where = `overrides[${i}]${ov && ov.name ? ` "${ov.name}"` : ''}`;
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) {
      process.stderr.write(`[build]   WARN ${where}: not an object — skipped\n`);
      return;
    }
    if (typeof ov.board !== 'string' || typeof ov.lat !== 'number' || typeof ov.lon !== 'number') {
      process.stderr.write(`[build]   WARN ${where}: needs string "board" and numeric "lat"/"lon" — skipped\n`);
      return;
    }
    if (!BOARDS.includes(ov.board)) {
      process.stderr.write(`[build]   WARN ${where}: unknown board "${ov.board}" — skipped\n`);
      return;
    }
    if (!ov.set || typeof ov.set !== 'object' || Array.isArray(ov.set) || Object.keys(ov.set).length === 0) {
      process.stderr.write(`[build]   WARN ${where}: missing non-empty "set" object — skipped\n`);
      return;
    }

    const matches = byKey.get(`${ov.board}|${venueKey(ov.lat, ov.lon)}`) ?? [];
    if (matches.length === 0) {
      stats.unmatched++;
      process.stderr.write(`[build]   WARN ${where}: no ${ov.board} entry near ${ov.lat}, ${ov.lon} — stale override?\n`);
      return;
    }
    if (matches.length > 1) {
      process.stderr.write(`[build]   WARN ${where}: ${matches.length} ${ov.board} entries share this coordinate — applied to all\n`);
    }

    for (const e of matches) {
      if (ov.name && e.name && ov.name.trim().toLowerCase() !== e.name.trim().toLowerCase()) {
        process.stderr.write(`[build]   WARN ${where}: name mismatch — matched entry is named "${e.name}"\n`);
      }
      for (const [field, value] of Object.entries(ov.set)) {
        if (e[field] != null && e[field] !== value) {
          stats.conflicts++;
          process.stderr.write(`[build]   WARN ${where}: ${field} "${e[field]}" → "${value}" — override replaces upstream value\n`);
        }
        e[field] = value;
      }
      stats.applied++;
    }
  });

  return stats;
}

// Apply curated egym Wellpass status (tools/wellpass.json) onto the
// assembled venue features. Each entry { lat, lon, [name], wellpass: true|
// false } sets the `wellpass` property on the matched feature; venues not
// listed simply stay undefined ("unknown") in the output. The file is a
// committed, hand-edited array — the personal scrape and matcher that
// seed it stay out of this repo (see .gitignore).
function applyWellpass(features) {
  const stats = { defined: 0, applied: 0, unmatched: 0 };
  if (!existsSync(WELLPASS_FILE)) return stats;

  let entries;
  try {
    entries = JSON.parse(readFileSync(WELLPASS_FILE, 'utf-8'));
  } catch (err) {
    throw new Error(`tools/wellpass.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error('tools/wellpass.json must be a JSON array of venue objects');
  }
  stats.defined = entries.length;

  const byKey = new Map();
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    byKey.set(venueKey(lat, lon), f);
  }

  entries.forEach((e, i) => {
    const where = `wellpass[${i}]${e && e.name ? ` "${e.name}"` : ''}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      process.stderr.write(`[build]   WARN ${where}: not an object — skipped\n`);
      return;
    }
    if (typeof e.lat !== 'number' || typeof e.lon !== 'number') {
      process.stderr.write(`[build]   WARN ${where}: needs numeric "lat"/"lon" — skipped\n`);
      return;
    }
    if (e.wellpass !== true && e.wellpass !== false) {
      process.stderr.write(`[build]   WARN ${where}: "wellpass" must be true or false — skipped\n`);
      return;
    }
    const f = byKey.get(venueKey(e.lat, e.lon));
    if (!f) {
      stats.unmatched++;
      process.stderr.write(`[build]   WARN ${where}: no venue near ${e.lat}, ${e.lon} — stale entry?\n`);
      return;
    }
    if (e.name && f.properties.name && e.name.trim().toLowerCase() !== f.properties.name.trim().toLowerCase()) {
      process.stderr.write(`[build]   WARN ${where}: name mismatch — venue is named "${f.properties.name}"\n`);
    }
    f.properties.wellpass = e.wellpass;
    stats.applied++;
  });

  return stats;
}

async function buildFromSources() {
  const allEntries = [];
  const sourceMeta = {};

  const iso1A2Code = await loadCountryCoder();

  for (const { id, mod } of SOURCES) {
    process.stderr.write(`[build] loading source: ${id}\n`);
    const { entries, meta } = await mod.load();
    process.stderr.write(`[build]   got ${entries.length} entries\n`);
    sourceMeta[id] = meta;
    for (const e of entries) {
      if (!BOARDS.includes(e.board)) {
        process.stderr.write(`[build]   skip unknown board "${e.board}" from ${id}\n`);
        continue;
      }
      e._source = id;
      allEntries.push(e);
    }
  }

  const overrideStats = applyOverrides(allEntries);
  process.stderr.write(
    `[build] overrides: ${overrideStats.applied} applied, ` +
    `${overrideStats.unmatched} unmatched, ${overrideStats.conflicts} conflicts\n`,
  );

  // Group into venues.
  const venues = new Map();
  for (const e of allEntries) {
    const k = venueKey(e.lat, e.lon);
    if (!venues.has(k)) {
      venues.set(k, { lat: e.lat, lon: e.lon, entries: [] });
    }
    venues.get(k).entries.push(e);
  }

  const features = [];
  const perSource = Object.fromEntries(SOURCES.map(s => [s.id, 0]));
  let venuesWithMulti = 0;
  let countryFromCoder = 0;
  let countryFallback = 0;
  let cityUpstream = 0;
  let cityNearest = 0;
  let cityMissing = 0;

  // Optional overlay: a fresh clone may not have run build-cities-data.mjs
  // yet, and the nightly refresh must not fail over a missing place index.
  const cityGrid = loadCityIndex(CITIES_FILE);
  if (!cityGrid) {
    process.stderr.write('[build]   WARN no place index at boards/data/cities.json — skipping nearest-city enrichment\n');
  }

  for (const venue of venues.values()) {
    // Pick canonical name + city from the highest-priority entry. Country
    // comes from country-coder (lookup by venue coordinates) — that makes
    // it universal across all board types and consistent ISO-3166-1
    // alpha-2, regardless of whether the upstream source carried one.
    const ranked = [...venue.entries].sort(
      (a, b) => (NAME_PRIORITY[b.board] ?? 0) - (NAME_PRIORITY[a.board] ?? 0),
    );
    const lead = ranked[0];
    const props = { name: lead.name };

    const kilterEntry = venue.entries.find(e => e.board === 'kilter');
    if (kilterEntry?.city) props.city = kilterEntry.city;

    // Where upstream gave us no city, borrow the nearest one from the place
    // index. It lands in its own field, never in `city`: this is "the closest
    // town we know of", not a claim about the venue's actual address.
    if (props.city) {
      cityUpstream++;
    } else if (cityGrid) {
      const near = findNearestCity(cityGrid, venue.lat, venue.lon, NEAREST_CITY_MAX_KM);
      if (near) {
        props.city_nearest = near.name;
        if (near.nameDe) props.city_nearest_de = near.nameDe;
        props.city_nearest_km = Number(near.km.toFixed(1));
        cityNearest++;
      } else {
        cityMissing++;
      }
    } else {
      cityMissing++;
    }

    const lookedUp = iso1A2Code([venue.lon, venue.lat]);
    if (lookedUp) {
      props.country = lookedUp;
      countryFromCoder++;
    } else if (kilterEntry?.country) {
      // Fallback for offshore / disputed regions country-coder doesn't
      // resolve. Hangtime's Kilter `country` is the only upstream we
      // have, and we accept its noisy values (USA/CAN/etc.) verbatim
      // here — the coder normally beats this path to the punch.
      props.country = kilterEntry.country;
      countryFallback++;
    }

    // Strip per-board city/country since they now live at the venue level.
    props.boards = venue.entries.map(e => {
      const stripped = stripInternal(e);
      delete stripped.city;
      delete stripped.country;
      return stripped;
    });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [venue.lon, venue.lat] },
      properties: props,
    });

    const seenBoards = new Set();
    for (const e of venue.entries) {
      seenBoards.add(e.board);
      perSource[e._source]++;
    }
    if (seenBoards.size > 1) venuesWithMulti++;
  }

  const overlayStats = applyVenueOverlays(features);
  const perBoard = boardVenueCounts(features);

  const meta = {
    generated_at: new Date().toISOString(),
    venue_features: features.length,
    raw_entries: allEntries.length,
    venues_with_multiple_boards: venuesWithMulti,
    country_from_coder: countryFromCoder,
    country_from_fallback: countryFallback,
    country_missing: features.length - countryFromCoder - countryFallback,
    city_from_upstream: cityUpstream,
    city_from_nearest: cityNearest,
    city_missing: cityMissing,
    nearest_city_max_km: NEAREST_CITY_MAX_KM,
    overrides: overrideStats,
    wellpass: overlayStats.wellpass,
    venue_links: overlayStats.venue_links,
    venue_hours: overlayStats.venue_hours,
    venue_ids: overlayStats.venue_ids,
    per_board: perBoard,
    per_source: perSource,
    sources: sourceMeta,
    source_freshness: loadSourceFreshness(),
  };

  writeOutputs(features, meta);

  process.stderr.write(`[build] wrote ${features.length} venues (from ${allEntries.length} raw entries) → ${OUT_GEOJSON}\n`);
  process.stderr.write(`[build]   ${venuesWithMulti} venues host more than one board type\n`);
  process.stderr.write(`[build]   country resolved: ${countryFromCoder} via coder, ${countryFallback} via fallback, ${features.length - countryFromCoder - countryFallback} unresolved\n`);
  process.stderr.write(`[build]   city: ${cityUpstream} upstream, ${cityNearest} nearest-town (<=${NEAREST_CITY_MAX_KM} km), ${cityMissing} none\n`);
  process.stderr.write(`[build]   meta → ${OUT_META}\n`);
  for (const [b, n] of Object.entries(perBoard)) {
    if (n > 0) process.stderr.write(`[build]   ${b.padEnd(12)} ${n}\n`);
  }
}

// Curated venue-level overlays, applied to assembled features. Kept in one
// place because the full build and the --overlays-only rebuild must apply
// exactly the same set in exactly the same order; a curation-only run that
// diverged from the nightly one would be worse than no shortcut at all.
function applyVenueOverlays(features) {
  // Identity first: every later overlay, and everything that reads the output,
  // refers to a venue by an id that must already exist and must be the same id
  // it had yesterday. Cleared and reassigned on every run so deleting a ledger
  // record actually returns a venue to its derived id.
  clearVenueIds(features);
  const { entries: idLedger, errors: idErrors } = loadVenueIdLedger(VENUE_IDS_FILE);
  for (const err of idErrors) process.stderr.write(`[build]   WARN ${err}\n`);
  const { stats: venueIds, problems: idProblems } = assignVenueIds(features, idLedger);
  for (const problem of idProblems) process.stderr.write(`[build]   WARN ${problem}\n`);
  process.stderr.write(
    `[build] venue ids: ${venueIds.derived} derived, ${venueIds.pinned} pinned, ` +
    `${venueIds.unmatched} unmatched, ${venueIds.ambiguous} ambiguous, ` +
    `${venueIds.collisions} collisions (of ${venueIds.defined} ledger records)\n`,
  );

  const wellpass = applyWellpass(features);
  process.stderr.write(
    `[build] wellpass: ${wellpass.applied} applied, ` +
    `${wellpass.unmatched} unmatched (of ${wellpass.defined} defined)\n`,
  );

  const { entries, errors } = loadVenueLinks(VENUE_LINKS_FILE);
  for (const err of errors) process.stderr.write(`[build]   WARN ${err}\n`);
  const { stats: venueLinks, problems, notes } = applyVenueLinks(features, entries);
  for (const note of notes) process.stderr.write(`[build]   note: ${note}\n`);
  for (const problem of problems) process.stderr.write(`[build]   WARN ${problem}\n`);
  process.stderr.write(
    `[build] venue links: ${venueLinks.applied} applied across ${venueLinks.countries} countries, ` +
    `${venueLinks.unmatched} unmatched, ${venueLinks.ambiguous} ambiguous, ` +
    `${venueLinks.rejected} rejected (of ${venueLinks.defined} defined)\n`,
  );

  // Opening hours last, and deliberately independent of the links: a venue may
  // carry one, both or neither. Only the schedule and the page it was read from
  // cross into the features — the check date, the quoted evidence and the
  // matched signals stay in the curated file, which is why applyVenueHours() is
  // the only thing that ever writes these two properties.
  const hoursFile = loadVenueHours(VENUE_HOURS_FILE);
  for (const err of hoursFile.errors) process.stderr.write(`[build]   WARN ${err}\n`);
  const { stats: venueHours, problems: hoursProblems, notes: hoursNotes } =
    applyVenueHours(features, hoursFile.entries);
  for (const note of hoursNotes) process.stderr.write(`[build]   note: ${note}\n`);
  for (const problem of hoursProblems) process.stderr.write(`[build]   WARN ${problem}\n`);
  process.stderr.write(
    `[build] venue hours: ${venueHours.applied} applied across ${venueHours.countries} countries, ` +
    `${venueHours.unmatched} unmatched, ${venueHours.ambiguous} ambiguous, ` +
    `${venueHours.rejected} rejected (of ${venueHours.defined} defined)\n`,
  );

  return {
    wellpass,
    venue_links: venueLinks,
    venue_hours: venueHours,
    venue_ids: venueIds,
  };
}

// Write the geojson, the meta, and both languages of static HTML.
function writeOutputs(features, meta) {
  writeFileSync(OUT_GEOJSON, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

  // Static HTML so non-JS crawlers (AI assistants read HTML snapshots, not the
  // runtime-fetched geojson) can see the venues. Pure function of the data —
  // no timestamp — so an unchanged dataset yields byte-identical output and the
  // nightly cron makes no no-op commit. Rendered once per language; the
  // geojson + meta above stay language-neutral and are written only once.
  const RENDER_TARGETS = [
    { lang: 'en', list: OUT_LIST, index: BOARDS_INDEX },
    { lang: 'de', list: OUT_LIST_DE, index: BOARDS_INDEX_DE },
  ];
  for (const { lang, list, index } of RENDER_TARGETS) {
    writeFileSync(list, renderListPage(features, meta, lang));
    process.stderr.write(`[build]   directory (${lang}) → ${list}\n`);

    const statsBlock = renderStatsBlock(features, meta, lang);
    const indexHtml = readFileSync(index, 'utf-8');
    const { html: injected, replaced } = injectBetweenMarkers(indexHtml, 'board-stats', statsBlock);
    if (replaced) {
      if (injected !== indexHtml) writeFileSync(index, injected);
      process.stderr.write(`[build]   stats block (${lang}) → ${index}\n`);
    } else {
      process.stderr.write(`[build]   WARN ${index}: GENERATED:board-stats markers not found — stats block NOT injected\n`);
    }
  }
}

// Re-apply the curated overlays to the venue data already committed under
// boards/data/, then re-render. No network, no npm, no upstream refresh: a
// curator editing wellpass.json or venue-links.json gets their change into the
// map and both directories without pulling a new upstream dataset into the
// same commit. `generated_at` is deliberately left alone — the upstream data it
// describes did not change.
function overlaysOnlyRebuild() {
  if (!existsSync(OUT_GEOJSON) || !existsSync(OUT_META)) {
    throw new Error('--overlays-only needs an existing boards/data/boards.geojson and boards.meta.json — run a full build first');
  }
  const collection = JSON.parse(readFileSync(OUT_GEOJSON, 'utf-8'));
  const meta = JSON.parse(readFileSync(OUT_META, 'utf-8'));
  const features = collection.features ?? [];
  process.stderr.write(`[build] --overlays-only: ${features.length} venues from ${OUT_GEOJSON}\n`);

  const overlayStats = applyVenueOverlays(features);
  meta.wellpass = overlayStats.wellpass;
  meta.venue_links = overlayStats.venue_links;
  meta.venue_hours = overlayStats.venue_hours;
  meta.venue_ids = overlayStats.venue_ids;

  writeOutputs(features, meta);
  process.stderr.write('[build] --overlays-only: geojson, meta and both directories rewritten\n');
}

async function main() {
  if (process.argv.includes('--overlays-only')) {
    overlaysOnlyRebuild();
    return;
  }
  await buildFromSources();
}

main().catch(err => { console.error(err); process.exit(1); });
