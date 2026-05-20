#!/usr/bin/env node
// Builds boards/data/boards.geojson from the registered source adapters.
//
// Each adapter in tools/sources/*.mjs exports an async `load()` returning
// { entries: NormalizedEntry[], meta: object }. NormalizedEntry shape:
//
//   { source: string, board: BoardId, name: string, lat: number, lon: number,
//     username?: string }
//
// To add a new source: write tools/sources/<name>.mjs with the same shape,
// then add it to the SOURCES array below. The frontend only sees the merged
// GeoJSON and never knows which source a feature came from.

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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const OUT_META = join(REPO_ROOT, 'boards', 'data', 'boards.meta.json');

function dedupKey(e) {
  // Round to ~10m precision (4 decimals) so coincident installations from
  // different sources collapse without losing distinct city-level locations.
  return `${e.board}|${e.lat.toFixed(4)}|${e.lon.toFixed(4)}`;
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

  const byKey = new Map();
  for (const e of allEntries) {
    const k = dedupKey(e);
    if (!byKey.has(k)) byKey.set(k, e);
    // First-source-wins; later sources will need a richer merge policy if and
    // when we have richer data (city/country/url). Keeping the policy explicit
    // and centralized so future sources don't silently shadow hangtime data.
  }
  const merged = [...byKey.values()];

  const features = merged.map(e => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
    properties: {
      board: e.board,
      name: e.name,
      ...(e.username ? { username: e.username } : {}),
      src: e._source,
    },
  }));

  const collection = { type: 'FeatureCollection', features };
  writeFileSync(OUT_GEOJSON, JSON.stringify(collection) + '\n');

  const perBoard = Object.fromEntries(BOARDS.map(b => [b, 0]));
  const perSource = Object.fromEntries(SOURCES.map(s => [s.id, 0]));
  for (const e of merged) { perBoard[e.board]++; perSource[e._source]++; }

  const meta = {
    generated_at: new Date().toISOString(),
    total_features: features.length,
    raw_entries: allEntries.length,
    deduped: allEntries.length - features.length,
    per_board: perBoard,
    per_source: perSource,
    sources: sourceMeta,
  };
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

  process.stderr.write(`[build] wrote ${features.length} features → ${OUT_GEOJSON}\n`);
  process.stderr.write(`[build] meta → ${OUT_META}\n`);
  for (const [b, n] of Object.entries(perBoard)) {
    if (n > 0) process.stderr.write(`[build]   ${b.padEnd(12)} ${n}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
