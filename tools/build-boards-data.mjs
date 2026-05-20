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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
