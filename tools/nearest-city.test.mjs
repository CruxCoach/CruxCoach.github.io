import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCityIndex, findNearestCity, loadCityIndex } from './nearest-city.mjs';

// Row shape as written by build-cities-data.mjs:
// [name, country, lat, lon, region?, alternates?]
const BERLIN = ['Berlin', 'DE', 52.52, 13.41];
const POTSDAM = ['Potsdam', 'DE', 52.4, 13.07];
const MUNICH = ['Munich', 'DE', 48.14, 11.58, '', ['München']];

test('findNearestCity returns the closest city inside the radius', () => {
  const grid = buildCityIndex([BERLIN, POTSDAM, MUNICH]);
  const hit = findNearestCity(grid, 52.5, 13.4, 25);
  assert.equal(hit.name, 'Berlin');
  assert.equal(hit.country, 'DE');
  assert.ok(hit.km < 3, `expected a short distance, got ${hit.km}`);
});

test('findNearestCity prefers the genuinely nearest, not the first indexed', () => {
  const grid = buildCityIndex([BERLIN, POTSDAM]);
  // Just outside Potsdam, ~25 km from Berlin's centre.
  const hit = findNearestCity(grid, 52.39, 13.06, 25);
  assert.equal(hit.name, 'Potsdam');
});

test('findNearestCity returns null beyond the radius rather than a far guess', () => {
  const grid = buildCityIndex([BERLIN]);
  assert.equal(findNearestCity(grid, 48.14, 11.58, 25), null, 'Munich is not near Berlin');
  assert.ok(findNearestCity(grid, 48.14, 11.58, 600), 'but it is within 600 km');
});

test('findNearestCity searches neighbouring grid cells', () => {
  // 51.999 and 52.001 sit in different 1° buckets but ~200 m apart.
  const grid = buildCityIndex([['Edge', 'DE', 51.999, 13.0]]);
  const hit = findNearestCity(grid, 52.001, 13.0, 5);
  assert.equal(hit.name, 'Edge');
});

test('buildCityIndex skips malformed rows instead of throwing', () => {
  const grid = buildCityIndex([null, ['NoCoords', 'DE'], ['Bad', 'DE', 'x', 'y'], BERLIN]);
  let total = 0;
  for (const cell of grid.values()) total += cell.length;
  assert.equal(total, 1);
});

test('loadCityIndex returns null for a missing or unusable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-nearest-'));
  assert.equal(loadCityIndex(join(dir, 'nope.json')), null, 'missing file');

  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  assert.equal(loadCityIndex(broken), null, 'unparseable file');

  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify({ places: [] }));
  assert.equal(loadCityIndex(wrongShape), null, 'no cities array');
});

test('loadCityIndex reads a well-formed index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-nearest-'));
  const good = join(dir, 'cities.json');
  writeFileSync(good, JSON.stringify({ cities: [BERLIN, MUNICH] }));
  const grid = loadCityIndex(good);
  assert.ok(grid);
  assert.equal(findNearestCity(grid, 52.5, 13.4, 25).name, 'Berlin');
});
