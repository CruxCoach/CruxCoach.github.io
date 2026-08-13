import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeVenueText, searchVenues, venueEntries,
} from '../competitions/app/data/venue-catalogue.mjs';

const catalogue = venueEntries({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', properties: {
        name: 'Kletterzentrum München', city: 'München', country: 'DE',
        boards: [{ board: 'moonboard', address: 'Thalkirchner Straße 207, München' }],
      },
    },
    {
      type: 'Feature', properties: {
        name: 'Boulderwelt München Ost', city: 'München', country: 'DE',
        boards: [{ board: 'kilter', address: 'Hanne-Hiob-Straße 4, München' }],
      },
    },
    {
      type: 'Feature', properties: {
        name: 'Map Address Gym', city: 'Berlin', country: 'DE', address: 'Mapstraße 7, Berlin',
        boards: [{ board: 'moonboard' }],
      },
    },
  ],
});

test('venue-level map addresses are retained when no board-specific address exists', () => {
  const found = searchVenues(catalogue, 'map address', 'moonboard');
  assert.equal(found[0]?.address, 'Mapstraße 7, Berlin');
});

test('venue catalogue search ignores accents and prefers the selected board', () => {
  assert.equal(normalizeVenueText('München'), 'munchen');
  const found = searchVenues(catalogue, 'munchen', 'kilter');
  assert.equal(found.length, 2);
  assert.equal(found[0].name, 'Boulderwelt München Ost');
  assert.equal(found[0].address, 'Hanne-Hiob-Straße 4, München');
});

test('venue suggestions require a useful query and never invent entries', () => {
  assert.deepEqual(searchVenues(catalogue, 'm'), []);
  assert.deepEqual(searchVenues(catalogue, 'not in the map'), []);
});

test('the curated Madeira venue identifies its 2019 Masters MoonBoard', () => {
  const geojson = JSON.parse(fs.readFileSync(new URL('../boards/data/boards.geojson', import.meta.url), 'utf8'));
  const madeira = venueEntries(geojson).find((entry) => entry.name === 'Madeira Climbing Center');
  assert.equal(madeira?.boards.find((board) => board.id === 'moonboard')?.variant, 'mb2019-masters');
});
