import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadCurated } from './sources/curated.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');

const boardIds = feature => feature.properties.boards.map(board => board.board);
const at = (features, lat, lon) => features.filter(feature => {
  const [featureLon, featureLat] = feature.geometry.coordinates;
  return featureLat.toFixed(4) === lat.toFixed(4) && featureLon.toFixed(4) === lon.toFixed(4);
});

test('curated source contains only the two officially verified MoonBoard gaps', async () => {
  const { entries, meta } = await loadCurated();
  assert.equal(meta.verified_on, '2026-08-31');
  assert.deepEqual(entries.map(entry => [entry.name, entry.board]), [
    ['Boulderwelt München Ost', 'moonboard'],
    ['Boulderwelt Hamburg', 'moonboard'],
  ]);
  for (const entry of entries) {
    assert.equal(entry.source, 'curated');
    assert.equal(entry.commercial, true);
    assert.ok(Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
  }
});

test('committed map data includes the missing boards and merges the corrected venues', () => {
  const features = JSON.parse(readFileSync(GEOJSON, 'utf8')).features;

  const munichEast = at(features, 48.12578, 11.61108);
  assert.equal(munichEast.length, 1);
  assert.equal(munichEast[0].properties.name, 'Boulderwelt München Ost');
  assert.deepEqual(boardIds(munichEast[0]), ['moonboard']);
  assert.equal(munichEast[0].properties.wellpass, true);
  assert.equal(munichEast[0].properties.boards[0].led, true);
  assert.equal(munichEast[0].properties.boards[0].angle, 40);
  assert.equal(munichEast[0].properties.boards[0].variant, null);

  const hamburg = at(features, 53.55395, 10.02095);
  assert.equal(hamburg.length, 1);
  assert.deepEqual(new Set(boardIds(hamburg[0])), new Set(['kilter', 'moonboard']));

  const thalkirchen = at(features, 48.107, 11.54568);
  assert.equal(thalkirchen.length, 1);
  assert.deepEqual(new Set(boardIds(thalkirchen[0])), new Set(['kilter', 'moonboard']));
  assert.equal(at(features, 48.1067623, 11.5456929).length, 0);

  const gilching = at(features, 48.10135, 11.30113);
  assert.equal(gilching.length, 1);
  assert.deepEqual(new Set(boardIds(gilching[0])), new Set(['kilter', 'moonboard']));
  assert.equal(at(features, 48.1092285, 11.2899694).length, 0);
});
