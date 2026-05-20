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

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as hangtime from './sources/hangtime.mjs';

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

  for (const venue of venues.values()) {
    // Pick canonical name + city + country from the highest-priority
    // entry. Higher-priority sources (Kilter > MoonBoard > Tension > …)
    // tend to ship the richest metadata, so this also surfaces the most
    // complete address text per venue.
    const ranked = [...venue.entries].sort(
      (a, b) => (NAME_PRIORITY[b.board] ?? 0) - (NAME_PRIORITY[a.board] ?? 0),
    );
    const lead = ranked[0];
    const props = {
      name: lead.name,
    };
    // city/country only come from Kilter today; fall through if absent.
    const kilterEntry = venue.entries.find(e => e.board === 'kilter');
    if (kilterEntry?.city) props.city = kilterEntry.city;
    if (kilterEntry?.country) props.country = kilterEntry.country;

    props.boards = venue.entries.map(stripInternal);

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
    per_board: perBoard,
    per_source: perSource,
    sources: sourceMeta,
  };
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

  process.stderr.write(`[build] wrote ${features.length} venues (from ${allEntries.length} raw entries) → ${OUT_GEOJSON}\n`);
  process.stderr.write(`[build]   ${venuesWithMulti} venues host more than one board type\n`);
  process.stderr.write(`[build]   meta → ${OUT_META}\n`);
  for (const [b, n] of Object.entries(perBoard)) {
    if (n > 0) process.stderr.write(`[build]   ${b.padEnd(12)} ${n}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
