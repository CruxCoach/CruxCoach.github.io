import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MODELS, parseLocations } from './sources/shinywall.mjs';

function fixture(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: '2026-10-25',
    locations: [{
      id: 'example-gym', name: 'Example Gym', address: 'Example Street 1',
      city: 'Example City', country: 'ES', lat: 41.5, lon: 2.1,
      coordinate: { source: 'osm', ref: 'node/1' },
      models: ['Shiny Wall Standard Max'], website: 'https://example.com/',
      public: true,
      evidence: [{ url: 'https://example.com/', claim: 'Venue names its Shiny Wall.', checked_at: '2026-10-25' }],
      ...overrides,
    }],
  };
}

const committed = JSON.parse(readFileSync(new URL('./shinywall-locations.json', import.meta.url), 'utf8'));

test('curated Shiny Wall records expose map fields but not research evidence', () => {
  const { entries } = parseLocations(fixture());
  assert.deepEqual(entries, [{
    source: 'shinywall', board: 'shinywall', name: 'Example Gym',
    lat: 41.5, lon: 2.1, address: 'Example Street 1', city: 'Example City',
    country: 'ES', models: ['Shiny Wall Standard Max'], website: 'https://example.com/',
  }]);
  for (const field of ['evidence', 'coordinate', 'public', 'id']) {
    assert.equal(field in entries[0], false, `${field} must stay in the source file`);
  }
});

test('the website is optional, but never insecure', () => {
  const { entries } = parseLocations(fixture({ website: undefined }));
  assert.equal('website' in entries[0], false);
  assert.throws(() => parseLocations(fixture({ website: 'http://example.com' })), /public HTTPS/);
  assert.throws(() => parseLocations(fixture({ website: 'https://user:pass@example.com' })), /public HTTPS/);
});

test('private, origin-less and unsourced records fail closed', () => {
  assert.throws(() => parseLocations(fixture({ public: false })), /publicly accessible/);
  assert.throws(() => parseLocations(fixture({ public: undefined })), /publicly accessible/);
  assert.throws(() => parseLocations(fixture({ lat: 0, lon: 0 })), /invalid public coordinates/);
  assert.throws(() => parseLocations(fixture({ lat: '41.5' })), /invalid public coordinates/);
  assert.throws(() => parseLocations(fixture({ evidence: [] })), /evidence must not be empty/);
  assert.throws(() => parseLocations(fixture({ coordinate: { source: 'guess', ref: 'x' } })), /coordinate.source/);
  assert.throws(() => parseLocations(fixture({ coordinate: { source: 'osm', ref: '' } })), /coordinate.ref/);
});

test('only Standard-family model labels are publishable', () => {
  assert.throws(() => parseLocations(fixture({ models: [] })), /models must not be empty/);
  // Free text such as a gym's own wall name must never reach the map.
  assert.throws(() => parseLocations(fixture({ models: ['Deportiva'] })), /unknown model/);
  assert.throws(() => parseLocations(fixture({ models: ['Shiny Wall Custom'] })), /unknown model/);
  assert.throws(() => parseLocations(fixture({ models: ['Shiny Wall Standard', 'Shiny Wall Standard'] })), /duplicate model/);
});

test('committed Shiny Wall records are valid and carry primary references', () => {
  const { entries } = parseLocations(committed);
  assert.ok(entries.length >= 15, `expected the reviewed allowlist, got ${entries.length}`);
  for (const row of committed.locations) {
    assert.ok(row.models.every((model) => MODELS.has(model)));
    if (row.coordinate.source === 'osm') assert.match(row.coordinate.ref, /^(node|way|relation)\/\d+$/);
    for (const proof of row.evidence) assert.ok(proof.checked_at <= committed.checked_at);
  }
});

test('committed map data publishes all curated Shiny Wall venues without research evidence', () => {
  const geojson = JSON.parse(readFileSync(new URL('../boards/data/boards.geojson', import.meta.url), 'utf8'));
  const shiny = geojson.features.flatMap((feature) =>
    feature.properties.boards
      .filter((board) => board.board === 'shinywall')
      .map((board) => ({ feature, board })),
  );

  assert.equal(shiny.length, committed.locations.length);
  assert.ok(shiny.every(({ board }) => board._source === 'shinywall'));
  assert.ok(shiny.every(({ board }) => Array.isArray(board.models) && board.models.length > 0));
  assert.ok(shiny.every(({ board }) => !('evidence' in board) && !('website' in board) && !('coordinate' in board)));

  // Venues that already carry another board keep one shared marker and their name.
  const boardsAt = (name) => shiny
    .filter(({ feature }) => feature.properties.name === name)
    .map(({ feature }) => feature.properties.boards.map((board) => board.board).sort());
  assert.deepEqual(boardsAt('The Boulder Room'), [['quantum', 'shinywall']]);
  assert.deepEqual(boardsAt('Rocódromo Rawindoor'), [['kilter', 'shinywall']]);
  assert.deepEqual(boardsAt('Hangout'), [['moonboard', 'shinywall']]);
  assert.deepEqual(boardsAt('Gravetat Zero'), [['kilter', 'shinywall']]);
});
