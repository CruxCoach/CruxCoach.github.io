import test from 'node:test';
import assert from 'node:assert/strict';

import { accessClass, compareLocator, normalizeLocatorRows } from './kilter-locator-audit.mjs';

const filters = (...names) => names.map(name => ({ name }));

test('accessClass normalizes the locator inconsistent spacing and fails closed', () => {
  assert.equal(accessClass({ filters: filters('Access:  Public') }), 'public');
  assert.equal(accessClass({ filters: filters('Access: Members/ Reservations') }), 'restricted');
  assert.equal(accessClass({ filters: filters('Access: Public', 'Access: Private') }), 'private');
  assert.equal(accessClass({ filters: [] }), 'unspecified');
});

test('normalizeLocatorRows rejects missing and null-island coordinates', () => {
  const result = normalizeLocatorRows([
    { id: 1, name: 'Public Gym', lat: '48.1', lng: '11.5', filters: filters('Access: Public') },
    { id: 2, name: 'Default Point', lat: '0', lng: '0' },
    { id: 3, name: '', lat: '48', lng: '11' },
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].access, 'public');
  assert.deepEqual(result.invalid.map(row => row.id), [2, 3]);
});

test('compareLocator separates matches, exclusions, private rows, drift and candidates', () => {
  const rows = [
    { id: 1, name: 'Present Gym', lat: '48.1001', lng: '11.5001', filters: filters('Access: Public') },
    { id: 2, name: 'Closed Gym', lat: '47', lng: '10', filters: filters('Access: Public') },
    { id: 3, name: 'Some Garage', lat: '46', lng: '9', filters: filters('Access: Private') },
    { id: 4, name: 'Present Gym GmbH', lat: '48.12', lng: '11.5', filters: filters('Access: Public') },
    { id: 5, name: 'New Public Gym', lat: '45', lng: '8', filters: filters('Access: Public') },
  ];
  const venues = [{ name: 'Present Gym', lat: 48.1, lon: 11.5, country: 'DE' }];
  const exclusions = [{ name: 'Closed Gym', lat: 47, lon: 10, status: 'closed' }];
  const audit = compareLocator(rows, venues, exclusions);
  assert.deepEqual(audit.counts, {
    matched_coordinate: 1,
    excluded: 1,
    private: 1,
    probable_coordinate_drift: 1,
    candidates: 1,
  });
  assert.equal(audit.candidates[0].name, 'New Public Gym');
});
