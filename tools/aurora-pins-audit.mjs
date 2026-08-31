#!/usr/bin/env node
// Compare the anonymous manufacturer-app gym pins for the Aurora-family board
// systems with the committed map. This is a research audit, not a production
// adapter: the endpoint can expose announced, private or stale pins, and it
// carries no licence or venue details sufficient for automatic publication.
//
//   node tools/aurora-pins-audit.mjs
//   node tools/aurora-pins-audit.mjs --json
//   node tools/aurora-pins-audit.mjs --input /tmp/aurora-pins.json

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { haversineKm } from './build-cities-data.mjs';
import { venueKey } from './venue-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MATCH_RADIUS_KM = 0.25;
export const BOARD_ENDPOINTS = Object.freeze({
  tension: 'https://tensionboardapp2.com/pins?gyms=1',
  grasshopper: 'https://grasshopperboardapp.com/pins?gyms=1',
  decoy: 'https://decoyboardapp.com/pins?gyms=1',
  soill: 'https://soillboardapp.com/pins?gyms=1',
  touchstone: 'https://touchstoneboardapp.com/pins?gyms=1',
  aurora: 'https://auroraboardapp.com/pins?gyms=1',
});

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function normalizePins(board, rows) {
  const valid = [];
  let invalid = 0;
  for (const row of rows) {
    const name = String(row?.name ?? '').trim();
    const lat = finiteCoordinate(row?.latitude, -90, 90);
    const lon = finiteCoordinate(row?.longitude, -180, 180);
    if (!name || lat == null || lon == null || (lat === 0 && lon === 0)) {
      invalid++;
      continue;
    }
    // Deliberately retain only the public location fields required by this
    // comparison. Account ids and usernames are neither printed nor stored.
    valid.push({ board, name, lat, lon });
  }
  return { valid, invalid };
}

function closest(pin, venues) {
  let best = null;
  for (const venue of venues) {
    const km = haversineKm(pin.lat, pin.lon, venue.lat, venue.lon);
    if (!best || km < best.km) best = { ...venue, km };
  }
  return best;
}

function publicRow(pin, nearest = null) {
  return {
    name: pin.name,
    lat: pin.lat,
    lon: pin.lon,
    nearest_map_venue: nearest
      ? { name: nearest.name, distance_km: Number(nearest.km.toFixed(1)) }
      : null,
  };
}

export function comparePinSets(documents, venuesByBoard, exclusions = []) {
  const excludedByKey = new Map(exclusions.map(row => [venueKey(row.lat, row.lon), row]));
  const boards = {};
  for (const board of Object.keys(BOARD_ENDPOINTS)) {
    const rows = documents?.[board]?.gyms;
    if (!Array.isArray(rows)) throw new Error(`${board} response has no gyms array`);
    const { valid, invalid } = normalizePins(board, rows);
    const venues = venuesByBoard[board] ?? [];
    const matched = [];
    const excluded = [];
    const candidates = [];
    for (const pin of valid) {
      const nearest = closest(pin, venues);
      if (nearest && nearest.km <= MATCH_RADIUS_KM) {
        matched.push(publicRow(pin, nearest));
        continue;
      }
      const exclusion = excludedByKey.get(venueKey(pin.lat, pin.lon));
      if (exclusion) {
        excluded.push({ ...publicRow(pin, nearest), exclusion: exclusion.status });
        continue;
      }
      candidates.push(publicRow(pin, nearest));
    }
    boards[board] = {
      endpoint: BOARD_ENDPOINTS[board],
      rows: rows.length,
      valid: valid.length,
      invalid,
      map_venues: venues.length,
      counts: { matched: matched.length, excluded: excluded.length, candidates: candidates.length },
      matched,
      excluded,
      candidates,
    };
  }
  return {
    audit: 'aurora-anonymous-pins',
    totals: Object.fromEntries(['rows', 'valid', 'invalid', 'map_venues'].map(key => [
      key,
      Object.values(boards).reduce((sum, board) => sum + board[key], 0),
    ])),
    boards,
  };
}

function mapVenuesByBoard() {
  const features = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8')).features;
  const result = Object.fromEntries(Object.keys(BOARD_ENDPOINTS).map(board => [board, []]));
  for (const feature of features) {
    const [lon, lat] = feature.geometry.coordinates;
    for (const board of feature.properties.boards) {
      if (result[board.board]) result[board.board].push({ name: feature.properties.name, lat, lon });
    }
  }
  return result;
}

async function fetchDocuments() {
  const entries = await Promise.all(Object.entries(BOARD_ENDPOINTS).map(async ([board, url]) => {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CruxCoach-board-data-audit/1.0 (+https://cruxcoach.org)',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${board} pins returned HTTP ${response.status}`);
    return [board, await response.json()];
  }));
  return Object.fromEntries(entries);
}

function inputPath(argv) {
  const index = argv.indexOf('--input');
  return index >= 0 ? argv[index + 1] : null;
}

function printText(audit) {
  process.stdout.write('Aurora-family anonymous-pins audit\n');
  for (const [board, result] of Object.entries(audit.boards)) {
    process.stdout.write(`  ${board.padEnd(12)} ${String(result.rows).padStart(4)} pins; ${result.counts.matched} matched, ${result.counts.excluded} excluded, ${result.counts.candidates} candidates\n`);
  }
  process.stdout.write('\nUnresolved candidates (manufacturer pin + venue-primary-source review required)\n');
  for (const [board, result] of Object.entries(audit.boards)) {
    for (const row of result.candidates) {
      process.stdout.write(`  ${board}\t${row.name}\t${row.lat},${row.lon}\n`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('aurora-pins-audit.mjs')) {
  const input = inputPath(process.argv.slice(2));
  if (process.argv.includes('--input') && !input) throw new Error('--input needs a JSON file');
  const documents = input ? JSON.parse(readFileSync(input, 'utf8')) : await fetchDocuments();
  const exclusions = JSON.parse(readFileSync(join(ROOT, 'tools/location-exclusions.json'), 'utf8'));
  const audit = comparePinSets(documents, mapVenuesByBoard(), exclusions);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else printText(audit);
}
