#!/usr/bin/env node
// Compare Kilter's public manufacturer locator with the committed map.
//
// This is a manual, networked research tool, not a production adapter. The
// locator contains stale, private and badly geocoded records, so unmatched
// rows are candidates that still need venue-primary-source review.
//
//   node tools/kilter-locator-audit.mjs
//   node tools/kilter-locator-audit.mjs --json
//   node tools/kilter-locator-audit.mjs --input /tmp/locations.json

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { haversineKm } from './build-cities-data.mjs';
import { nameSimilarity } from './venue-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCATOR_URL = 'https://storerocket.io/api/user/vo8xyNypgn/locations?list_limit=25';
export const MATCH_RADIUS_KM = 0.25;
export const DRIFT_RADIUS_KM = 25;
export const NAME_MATCH_MIN = 0.72;

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function accessClass(row) {
  const labels = Array.isArray(row?.filters)
    ? row.filters.map(filter => String(filter?.name ?? '').trim().replace(/\s+/g, ' '))
    : [];
  const access = labels.filter(label => /^access\s*:/i.test(label));
  if (access.some(label => /\bprivate\b/i.test(label))) return 'private';
  if (access.some(label => /\bpublic\b/i.test(label))) return 'public';
  if (access.some(label => /\bmembers?\b|reservations?/i.test(label))) return 'restricted';
  return 'unspecified';
}

export function normalizeLocatorRows(rows) {
  const valid = [];
  const invalid = [];
  for (const row of rows) {
    const lat = finiteCoordinate(row?.lat, -90, 90);
    const lon = finiteCoordinate(row?.lng, -180, 180);
    if (!row || !String(row.name ?? '').trim() || lat == null || lon == null || (lat === 0 && lon === 0)) {
      invalid.push({ id: row?.id ?? null, name: String(row?.name ?? '').trim() || null });
      continue;
    }
    valid.push({ ...row, name: String(row.name).trim(), lat, lon, access: accessClass(row) });
  }
  return { valid, invalid };
}

function closest(row, venues) {
  let best = null;
  for (const venue of venues) {
    const km = haversineKm(row.lat, row.lon, venue.lat, venue.lon);
    if (!best || km < best.km) best = { ...venue, km };
  }
  return best;
}

function matchingName(row, venues) {
  let best = null;
  for (const venue of venues) {
    const similarity = nameSimilarity(row.name, venue.name);
    if (similarity < NAME_MATCH_MIN) continue;
    const km = haversineKm(row.lat, row.lon, venue.lat, venue.lon);
    if (!best || similarity > best.similarity || (similarity === best.similarity && km < best.km)) {
      best = { ...venue, km, similarity };
    }
  }
  return best;
}

function safeCandidate(row, nearest) {
  return {
    id: row.id ?? null,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    city: row.city || null,
    country: row.country || null,
    access: row.access,
    official_url: row.url || null,
    nearest_map_venue: nearest ? { name: nearest.name, distance_km: Number(nearest.km.toFixed(1)) } : null,
  };
}

export function compareLocator(rows, venues, exclusions = []) {
  const { valid, invalid } = normalizeLocatorRows(rows);
  const categories = {
    matched_coordinate: [],
    excluded: [],
    private: [],
    probable_coordinate_drift: [],
    candidates: [],
  };

  for (const row of valid) {
    const nearest = closest(row, venues);
    if (nearest && nearest.km <= MATCH_RADIUS_KM) {
      categories.matched_coordinate.push(safeCandidate(row, nearest));
      continue;
    }
    const excluded = exclusions.find(item =>
      haversineKm(row.lat, row.lon, Number(item.lat), Number(item.lon)) <= MATCH_RADIUS_KM
      || nameSimilarity(row.name, item.name) >= 0.9);
    if (excluded) {
      categories.excluded.push({ ...safeCandidate(row, nearest), exclusion: excluded.status });
      continue;
    }
    if (row.access === 'private') {
      categories.private.push(safeCandidate(row, nearest));
      continue;
    }
    const nameMatch = matchingName(row, venues);
    if (nameMatch && nameMatch.km <= DRIFT_RADIUS_KM) {
      categories.probable_coordinate_drift.push({
        ...safeCandidate(row, nearest),
        name_match: { name: nameMatch.name, distance_km: Number(nameMatch.km.toFixed(1)), similarity: Number(nameMatch.similarity.toFixed(2)) },
      });
      continue;
    }
    categories.candidates.push(safeCandidate(row, nearest));
  }

  return {
    locator_url: LOCATOR_URL,
    locator_rows: rows.length,
    invalid_rows: invalid,
    valid_rows: valid.length,
    map_kilter_venues: venues.length,
    counts: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.length])),
    ...categories,
  };
}

function mapVenues() {
  const geo = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  return geo.features.filter(feature => feature.properties.boards.some(board => board.board === 'kilter')).map(feature => ({
    name: feature.properties.name,
    lat: feature.geometry.coordinates[1],
    lon: feature.geometry.coordinates[0],
    country: feature.properties.country ?? null,
  }));
}

function parseInput(argv) {
  const at = argv.indexOf('--input');
  return at >= 0 ? argv[at + 1] : null;
}

async function locatorRows(input) {
  const document = input
    ? JSON.parse(readFileSync(input, 'utf8'))
    : await fetch(LOCATOR_URL, { signal: AbortSignal.timeout(30_000) }).then(response => {
      if (!response.ok) throw new Error(`Kilter locator returned HTTP ${response.status}`);
      return response.json();
    });
  const rows = document?.results?.locations;
  if (!Array.isArray(rows)) throw new Error('Kilter locator response has no results.locations array');
  return rows;
}

function printText(audit) {
  process.stdout.write(`Kilter manufacturer-locator audit\n`);
  process.stdout.write(`  locator ${audit.locator_rows} rows (${audit.valid_rows} valid; ${audit.invalid_rows.length} invalid)\n`);
  process.stdout.write(`  map ${audit.map_kilter_venues} Kilter venues\n`);
  for (const [key, count] of Object.entries(audit.counts)) process.stdout.write(`  ${key.replaceAll('_', ' ')}: ${count}\n`);
  process.stdout.write('\nUnresolved candidates (primary venue review required)\n');
  for (const row of audit.candidates) {
    process.stdout.write(`  ${row.id ?? '?'}\t${row.country ?? '??'}\t${row.city ?? ''}\t${row.name}\t${row.lat},${row.lon}\t${row.access}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('kilter-locator-audit.mjs')) {
  const input = parseInput(process.argv.slice(2));
  if (process.argv.includes('--input') && !input) throw new Error('--input needs a JSON file');
  const rows = await locatorRows(input);
  const exclusions = JSON.parse(readFileSync(join(ROOT, 'tools/location-exclusions.json'), 'utf8'));
  const audit = compareLocator(rows, mapVenues(), exclusions);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else printText(audit);
}
