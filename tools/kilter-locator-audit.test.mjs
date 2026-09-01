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
    { id: 6, name: 'Different Gym', lat: '48.1018', lng: '11.5', address: 'Another Street 9', filters: filters('Access: Public') },
  ];
  const venues = [{ name: 'Present Gym', lat: 48.1, lon: 11.5, country: 'DE', addresses: ['Main Street 1'] }];
  const exclusions = [{ name: 'Closed Gym', lat: 47, lon: 10, status: 'closed' }];
  const audit = compareLocator(rows, venues, exclusions);
  assert.deepEqual(audit.counts, {
    matched_coordinate: 1,
    excluded: 1,
    private: 1,
    probable_coordinate_drift: 1,
    candidates: 2,
    duplicate_locator: 0,
  });
  assert.deepEqual(audit.candidates.map(row => row.name), ['New Public Gym', 'Different Gym']);
});

test('compareLocator accepts address and compact-name identities across approximate pins', () => {
  const rows = [
    { id: 1, name: 'Renamed Hall', lat: '48.1018', lng: '11.5', address: 'Main Street 1, Munich, Germany' },
    { id: 2, name: 'TOP OUT Climbing', lat: '48.1018', lng: '11.51', address: 'Different address' },
  ];
  const venues = [
    { name: 'Present Gym', lat: 48.1, lon: 11.5, country: 'DE', addresses: ['Main Street 1'] },
    { name: 'TOPOUT Climbing', lat: 48.1, lon: 11.51, country: 'DE', addresses: [] },
  ];
  const audit = compareLocator(rows, venues);
  assert.equal(audit.counts.matched_coordinate, 2);
  assert.equal(audit.counts.candidates, 0);
});

test('compareLocator recognizes renamed distant venues by an exact address identity', () => {
  const rows = [{
    id: 1,
    name: 'Former Operator Name',
    lat: '48.15',
    lng: '11.5',
    address: 'Unit 30, Canal Place, Andrews Road, E8 4FX, London',
  }];
  const venues = [{
    name: 'Current Operator Name',
    lat: 48.1,
    lon: 11.5,
    country: 'GB',
    addresses: ['Unit 30 Canal Pl, Andrews Rd, London E8 4FX'],
  }];
  const audit = compareLocator(rows, venues);
  assert.equal(audit.counts.probable_coordinate_drift, 1);
  assert.equal(audit.probable_coordinate_drift[0].name_match.match_basis, 'address');
});

test('compareLocator accepts only name-matched conclusive research decisions', () => {
  const rows = [
    { id: 1, name: 'Invitation Homewall', lat: '48.1', lng: '11.5' },
    { id: 2, name: 'Unrelated Gym', lat: '48.1', lng: '11.5' },
  ];
  const research = [{
    name: 'Invitation Homewall', lat: 48.1, lon: 11.5, status: 'private',
  }];
  const audit = compareLocator(rows, [], [], research);
  assert.equal(audit.counts.private, 1);
  assert.deepEqual(audit.candidates.map(row => row.name), ['Unrelated Gym']);
});

test('compareLocator collapses same-venue duplicate submissions and keeps the richer row', () => {
  const rows = [
    { id: 1, name: 'Example Gym', lat: '48.1', lng: '11.5', filters: [] },
    { id: 2, name: 'example gym', lat: '48.1', lng: '11.5', filters: [{ name: 'Access: Public' }] },
  ];
  const audit = compareLocator(rows, []);
  assert.equal(audit.counts.candidates, 1);
  assert.equal(audit.candidates[0].id, 2);
  assert.equal(audit.candidates[0].access, 'public');
  assert.equal(audit.counts.duplicate_locator, 1);
  assert.equal(audit.duplicate_locator[0].duplicate_of.id, 2);
});
