import test from 'node:test';
import assert from 'node:assert/strict';

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
  ],
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
