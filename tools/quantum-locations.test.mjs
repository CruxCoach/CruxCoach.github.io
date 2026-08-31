import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseLocations } from './sources/quantum.mjs';

function fixture(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: '2026-08-25',
    locations: [{
      id: 'example-gym', name: 'Example Gym', address: 'Example Street 1',
      city: 'Example City', country: 'DE', lat: 48.1, lon: 11.5,
      models: ['Quantum Board XL 15×15'], website: 'https://example.com/quantum',
      public: true, verification: 'primary',
      evidence: [{ url: 'https://example.com/quantum', claim: 'Venue names the Quantum Board.', checked_at: '2026-08-25' }],
      ...overrides,
    }],
  };
}

test('curated Quantum records expose map fields but not research evidence', () => {
  const { entries } = parseLocations(fixture());
  assert.deepEqual(entries, [{
    source: 'quantum', board: 'quantum', name: 'Example Gym',
    lat: 48.1, lon: 11.5, address: 'Example Street 1', city: 'Example City',
    country: 'DE', models: ['Quantum Board XL 15×15'], website: 'https://example.com/quantum',
  }]);
  assert.equal('evidence' in entries[0], false);
  assert.equal('verification' in entries[0], false);
});

test('private, origin-less and unverified records fail closed', () => {
  assert.throws(() => parseLocations(fixture({ public: false })), /only public locations/);
  assert.throws(() => parseLocations(fixture({ lat: 0, lon: 0 })), /invalid public coordinates/);
  assert.throws(() => parseLocations(fixture({ evidence: [] })), /evidence must not be empty/);
  assert.throws(() => parseLocations(fixture({ verification: 'secondary' })), /primary source/);
});

test('credentials and non-HTTPS links are rejected', () => {
  assert.throws(() => parseLocations(fixture({ website: 'http://example.com' })), /public HTTPS/);
  assert.throws(() => parseLocations(fixture({ website: 'https://user:pass@example.com' })), /public HTTPS/);
});

test('committed map data publishes all verified Quantum venues without research evidence', () => {
  const geojson = JSON.parse(readFileSync(new URL('../boards/data/boards.geojson', import.meta.url), 'utf8'));
  const quantum = geojson.features.flatMap((feature) =>
    feature.properties.boards
      .filter((board) => board.board === 'quantum')
      .map((board) => ({ feature, board })),
  );

  assert.equal(quantum.length, 9);
  assert.ok(quantum.every(({ board }) => board._source === 'quantum'));
  assert.ok(quantum.every(({ board }) => Array.isArray(board.models) && board.models.length > 0));
  assert.ok(quantum.every(({ board }) => !('evidence' in board) && !('website' in board)));

  const sofia = quantum.find(({ feature }) => feature.properties.name === 'Momentum Climbing Sofia');
  assert.deepEqual(sofia.feature.properties.boards.map((board) => board.board).sort(), ['kilter', 'quantum']);

  const boulderRoom = quantum.find(({ feature }) => feature.properties.name === 'The Boulder Room');
  assert.equal(boulderRoom.feature.properties.wellpass, true);
  assert.equal(boulderRoom.feature.properties.website, 'https://www.theboulderroom.com/');
  assert.equal(boulderRoom.feature.properties.hours.length, 7);
});
