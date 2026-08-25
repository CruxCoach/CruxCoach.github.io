import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { boardVenueCounts, renderStatsBlock } from './render-static.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function feature(name, lat, lon, boards) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name, country: 'DE', boards },
  };
}

test('board counts count venues, not duplicate registrations', () => {
  const features = [
    feature('One gym', 48, 11, [
      { board: 'moonboard', variant: 'mb2016' },
      { board: 'moonboard', variant: 'mb2024' },
      { board: 'kilter' },
    ]),
    feature('Second gym', 49, 12, [{ board: 'moonboard' }]),
  ];
  const counts = boardVenueCounts(features);
  assert.equal(counts.moonboard, 2);
  assert.equal(counts.kilter, 1);

  const html = renderStatsBlock(features, { venue_features: 2 }, 'en');
  assert.match(html, /<tr><td>MoonBoard<\/td><td>2<\/td><\/tr>/);
  assert.match(html, /<tr><td>Kilter Board<\/td><td>1<\/td><\/tr>/);
});

test('committed map contains no null-island, Antarctic or transposed coordinates', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'boards/data/boards.geojson'), 'utf8'));
  for (const item of data.features) {
    const [lon, lat] = item.geometry.coordinates;
    assert.notDeepEqual([lon, lat], [0, 0], `${item.properties.name} sits on Null Island`);
    assert.ok(lat > -70, `${item.properties.name} is implausibly mapped to Antarctica`);
  }

  const upTheBloc = data.features.filter(item => item.properties.name === 'Up The Bloc');
  assert.equal(upTheBloc.length, 1, 'transposed Up The Bloc must merge into the verified venue');
  assert.deepEqual(upTheBloc[0].geometry.coordinates, [-79.58441, 43.60385]);
  assert.ok(upTheBloc[0].properties.boards.some(board => board.board === 'kilter'));
  assert.ok(upTheBloc[0].properties.boards.some(board => board.board === 'moonboard'));
});
