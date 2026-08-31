import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { applyLocationExclusions, loadLocationExclusions } from './location-exclusions.mjs';
import { venueKey } from './venue-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUSIONS = join(ROOT, 'tools', 'location-exclusions.json');
const RESEARCH = join(ROOT, 'tools', 'venue-links-research.json');
const GEOJSON = join(ROOT, 'boards', 'data', 'boards.geojson');

test('every production exclusion is backed by a dated research outcome', () => {
  const loaded = loadLocationExclusions(EXCLUSIONS, RESEARCH);
  assert.deepEqual(loaded.errors, []);
  assert.ok(loaded.entries.length > 0);
});

test('exclusions remove every entry at a backed coordinate and report stale rows', () => {
  const source = [
    { name: 'Closed', board: 'kilter', lat: 1, lon: 2 },
    { name: 'Closed second wall', board: 'moonboard', lat: 1, lon: 2 },
    { name: 'Open', board: 'kilter', lat: 3, lon: 4 },
  ];
  const result = applyLocationExclusions(source, [
    { name: 'Closed', status: 'closed', lat: 1, lon: 2 },
    { name: 'Gone upstream', status: 'closed', lat: 5, lon: 6 },
  ]);
  assert.deepEqual(result.entries.map(row => row.name), ['Open']);
  assert.equal(result.stats.excluded_entries, 2);
  assert.equal(result.stats.unmatched, 1);
  assert.equal(result.problems.length, 1);
});

test('committed excluded coordinates do not reach the public dataset', () => {
  const exclusions = JSON.parse(readFileSync(EXCLUSIONS, 'utf8'));
  const excluded = new Set(exclusions.map(row => venueKey(row.lat, row.lon)));
  const features = JSON.parse(readFileSync(GEOJSON, 'utf8')).features;
  const leaked = features.filter(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    return excluded.has(venueKey(lat, lon));
  });
  assert.deepEqual(leaked, []);
});

test('mislocated entries are an explicit supported exclusion outcome', () => {
  const result = applyLocationExclusions(
    [{ name: 'Wrong city point', board: 'moonboard', lat: 48.1, lon: 17.1 }],
    [{ name: 'Wrong city point', status: 'mislocated', lat: 48.1, lon: 17.1 }],
  );
  assert.equal(result.stats.excluded_entries, 1);
  assert.deepEqual(result.entries, []);
});

test('institution-only installations are an explicit non-public outcome', () => {
  const result = applyLocationExclusions(
    [{ name: 'School board', board: '12climb', lat: 50.4, lon: 30.4 }],
    [{ name: 'School board', status: 'non-public', lat: 50.4, lon: 30.4 }],
  );
  assert.equal(result.stats.excluded_entries, 1);
  assert.deepEqual(result.entries, []);
});

test('an announced pin is withheld until the venue says it is current', () => {
  const result = applyLocationExclusions(
    [{ name: 'Future board', board: 'tension', lat: 49.3, lon: -123.0 }],
    [{ name: 'Future board', status: 'announced', lat: 49.3, lon: -123.0 }],
  );
  assert.equal(result.stats.excluded_entries, 1);
  assert.deepEqual(result.entries, []);
});
