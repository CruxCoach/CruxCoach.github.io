// Nearest-city lookup for the boards pipeline.
//
// Only about a third of the venues arrive from upstream with a `city`, which
// used to leave the map's text search unable to find most of them by place:
// "New York" reached 2 of the 18 boards standing within 15 km of it. The
// place index built by build-cities-data.mjs already knows where 17k towns
// are, so the boards build can borrow it and label the rest.
//
// The result is deliberately kept in its own field rather than filling `city`.
// A gym 13 km outside Bangor is not *in* Bangor, and the map should be able to
// say "near Bangor" instead of quietly claiming otherwise.

import { existsSync, readFileSync } from 'node:fs';

import { haversineKm } from './build-cities-data.mjs';

// Same 1° bucketing the cities build uses against the boards: a brute-force
// pass would be 2.8k venues × 17.8k cities.
export function buildCityIndex(cities) {
  const grid = new Map();
  for (const city of cities) {
    if (!Array.isArray(city) || city.length < 4) continue;
    const lat = city[2];
    const lon = city[3];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${Math.floor(lat)}:${Math.floor(lon)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(city);
  }
  return grid;
}

export function findNearestCity(grid, lat, lon, maxKm) {
  const span = Math.ceil(maxKm / 111) + 1;
  const baseLat = Math.floor(lat);
  const baseLon = Math.floor(lon);
  let best = null;
  let bestKm = Infinity;
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const cell = grid.get(`${baseLat + dy}:${baseLon + dx}`);
      if (!cell) continue;
      for (const city of cell) {
        const km = haversineKm(lat, lon, city[2], city[3]);
        if (km < bestKm) { bestKm = km; best = city; }
      }
    }
  }
  if (!best || bestKm > maxKm) return null;
  // Row shape: [name, country, lat, lon, region?, alternates?, name_de?].
  // The German form is carried through so the /de/ pages can print "bei
  // München" where the language-neutral index says "Munich".
  return { name: best[0], country: best[1], nameDe: best[6] || '', km: bestKm };
}

// The boards build must not fail because the optional place index is absent
// (a fresh clone that has not run build-cities-data.mjs yet, say). Returning
// null lets the caller skip enrichment with a warning.
export function loadCityIndex(path) {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data || !Array.isArray(data.cities)) return null;
    return buildCityIndex(data.cities);
  } catch {
    return null;
  }
}
