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
const OVERRIDES_FILE = join(REPO_ROOT, 'tools', 'overrides.json');
const WELLPASS_FILE = join(REPO_ROOT, 'tools', 'wellpass.json');

// 4-decimal precision ≈ 11 m at the equator. Tight enough to keep
// neighbouring gyms separate, loose enough to collapse multi-board
// installations that almost always share coordinates.
function venueKey(lat, lon) {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
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

async function main() {
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
  const perBoard = Object.fromEntries(BOARDS.map(b => [b, 0]));
  const perSource = Object.fromEntries(SOURCES.map(s => [s.id, 0]));
  let venuesWithMulti = 0;
  let countryFromCoder = 0;
  let countryFallback = 0;

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
      perBoard[e.board]++;
      perSource[e._source]++;
    }
    if (seenBoards.size > 1) venuesWithMulti++;
  }

  const wellpassStats = applyWellpass(features);
  process.stderr.write(
    `[build] wellpass: ${wellpassStats.applied} applied, ` +
    `${wellpassStats.unmatched} unmatched (of ${wellpassStats.defined} defined)\n`,
  );

  const collection = { type: 'FeatureCollection', features };
  writeFileSync(OUT_GEOJSON, JSON.stringify(collection) + '\n');

  const meta = {
    generated_at: new Date().toISOString(),
    venue_features: features.length,
    raw_entries: allEntries.length,
    venues_with_multiple_boards: venuesWithMulti,
    country_from_coder: countryFromCoder,
    country_from_fallback: countryFallback,
    country_missing: features.length - countryFromCoder - countryFallback,
    overrides: overrideStats,
    wellpass: wellpassStats,
    per_board: perBoard,
    per_source: perSource,
    sources: sourceMeta,
  };
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

  process.stderr.write(`[build] wrote ${features.length} venues (from ${allEntries.length} raw entries) → ${OUT_GEOJSON}\n`);
  process.stderr.write(`[build]   ${venuesWithMulti} venues host more than one board type\n`);
  process.stderr.write(`[build]   country resolved: ${countryFromCoder} via coder, ${countryFallback} via fallback, ${features.length - countryFromCoder - countryFallback} unresolved\n`);
  process.stderr.write(`[build]   meta → ${OUT_META}\n`);
  for (const [b, n] of Object.entries(perBoard)) {
    if (n > 0) process.stderr.write(`[build]   ${b.padEnd(12)} ${n}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
