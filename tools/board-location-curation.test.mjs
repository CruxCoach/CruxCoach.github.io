import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadCurated } from './sources/curated.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const MAP_JS = join(REPO_ROOT, 'boards', 'map.js');

const boardIds = feature => feature.properties.boards.map(board => board.board);
const at = (features, lat, lon) => features.filter(feature => {
  const [featureLon, featureLat] = feature.geometry.coordinates;
  return featureLat.toFixed(4) === lat.toFixed(4) && featureLon.toFixed(4) === lon.toFixed(4);
});

test('curated source contains only the explicitly reviewed primary-source gaps', async () => {
  const { entries, meta } = await loadCurated();
  assert.equal(meta.verified_on, '2026-08-31');
  assert.deepEqual(entries.map(entry => [entry.name, entry.board]), [
    ['Boulderwelt München Ost', 'moonboard'],
    ['Boulderwelt Hamburg', 'moonboard'],
    ['ICP Boulder Hall & Showroom', 'kilter'],
    ['ICP Boulder Hall & Showroom', 'tension'],
    ['BLOCK DOCK Petržalka', 'kilter'],
    ['BLOCK DOCK Rača', 'moonboard'],
    ['Spire Climbing + Fitness Training Center', 'kilter'],
    ['Far North Climbing Gym', 'kilter'],
    ['Iron Cliffs Gym', 'kilter'],
    ['Climbing SPACE', '12climb'],
    ['Funattic', '12climb'],
    ['Hyperion Kyiv', '12climb'],
  ]);
  for (const entry of entries) {
    assert.equal(entry.source, 'curated');
    assert.ok(Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
    if (entry.board === 'moonboard') assert.equal(entry.commercial, true);
    if (entry.board === 'kilter') assert.ok(Array.isArray(entry.walls));
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

  const blockDockPetrzalka = at(features, 48.1312802, 17.0998312);
  assert.equal(blockDockPetrzalka.length, 1);
  assert.deepEqual(boardIds(blockDockPetrzalka[0]), ['kilter']);
  const blockDockRaca = at(features, 48.2146345, 17.1641254);
  assert.equal(blockDockRaca.length, 1);
  assert.deepEqual(boardIds(blockDockRaca[0]), ['moonboard']);
  assert.equal(at(features, 48.1485965, 17.1077478).length, 0);

  const spire = at(features, 45.67642, -111.14422);
  assert.equal(spire.length, 1);
  assert.deepEqual(new Set(boardIds(spire[0])), new Set(['kilter', 'tension']));
  assert.equal(at(features, 45.656304, -111.069708).length, 0);

  for (const [name, lat, lon] of [
    ['Climbing SPACE', 50.4887793, 30.4906293],
    ['Funattic', 50.4464461, 30.4430291],
    ['Hyperion Kyiv', 50.4734096, 30.498501],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(boardIds(venue[0]), ['12climb']);
    assert.ok(venue[0].properties.website);
    assert.equal(venue[0].properties.hours.length, 7);
  }
  assert.equal(at(features, 50.416134, 30.4683816).length, 0);
  assert.equal(at(features, 50.472918, 30.5129492).length, 0);
});

test('the map bypasses pre-Quantum service-worker cache entries', () => {
  const map = readFileSync(MAP_JS, 'utf8');
  assert.match(map, /fetch\('\/boards\/data\/boards\.geojson\?v=20260831-quantum9'\)/);

  for (const page of ['boards/index.html', 'de/boards/index.html']) {
    const html = readFileSync(join(REPO_ROOT, page), 'utf8');
    assert.match(html, /rel="preload" href="\/boards\/data\/boards\.geojson\?v=20260831-quantum9"/);
    assert.match(html, /map\.js\?v=20260831-2/);
  }
});
