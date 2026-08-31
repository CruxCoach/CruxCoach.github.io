import assert from 'node:assert/strict';
import test from 'node:test';

import { BOARD_ENDPOINTS, comparePinSets, normalizePins } from './aurora-pins-audit.mjs';

const emptyDocuments = () => Object.fromEntries(
  Object.keys(BOARD_ENDPOINTS).map(board => [board, { gyms: [] }]),
);

test('normalizePins retains only valid public location fields', () => {
  const result = normalizePins('tension', [
    { id: 12, username: 'personal', name: 'Public Gym', latitude: '48.1', longitude: '11.5' },
    { name: 'Null Island', latitude: 0, longitude: 0 },
    { name: '', latitude: 48, longitude: 11 },
  ]);
  assert.deepEqual(result, {
    valid: [{ board: 'tension', name: 'Public Gym', lat: 48.1, lon: 11.5 }],
    invalid: 2,
  });
});

test('comparePinSets separates mapped, backed-excluded and unresolved pins', () => {
  const documents = emptyDocuments();
  documents.tension.gyms = [
    { name: 'Mapped', latitude: 48.1001, longitude: 11.5001 },
    { name: 'Announced', latitude: 49, longitude: 12 },
    { name: 'Candidate', latitude: 50, longitude: 13 },
  ];
  const venues = { tension: [{ name: 'Mapped venue', lat: 48.1, lon: 11.5 }] };
  const exclusions = [{ name: 'Announced', lat: 49, lon: 12, status: 'announced' }];
  const audit = comparePinSets(documents, venues, exclusions);
  assert.deepEqual(audit.boards.tension.counts, {
    matched: 1, excluded: 1, overridden: 0, candidates: 1,
  });
  assert.equal(audit.boards.tension.excluded[0].exclusion, 'announced');
  assert.equal(audit.boards.tension.candidates[0].name, 'Candidate');
  assert.equal(audit.totals.rows, 3);
});

test('a coordinate override resolves a stale pin only when its target exists', () => {
  const documents = emptyDocuments();
  documents.tension.gyms = [
    { name: 'Moved Gym', latitude: 48.1, longitude: 11.5 },
    { name: 'Missing Target', latitude: 49.1, longitude: 12.5 },
  ];
  const venues = { tension: [{ name: 'Moved Gym', lat: 48.2, lon: 11.6 }] };
  const overrides = [
    { board: 'tension', name: 'Moved Gym', lat: 48.1, lon: 11.5, set: { lat: 48.2, lon: 11.6 } },
    { board: 'tension', name: 'Missing Target', lat: 49.1, lon: 12.5, set: { lat: 49.2, lon: 12.6 } },
  ];
  const audit = comparePinSets(documents, venues, [], overrides);
  assert.equal(audit.boards.tension.counts.overridden, 1);
  assert.equal(audit.boards.tension.overridden[0].name, 'Moved Gym');
  assert.deepEqual(audit.boards.tension.overridden[0].override_target, {
    name: 'Moved Gym', lat: 48.2, lon: 11.6,
  });
  assert.deepEqual(audit.boards.tension.candidates.map(row => row.name), ['Missing Target']);
});

test('a malformed manufacturer response fails closed', () => {
  const documents = emptyDocuments();
  documents.decoy = {};
  assert.throws(() => comparePinSets(documents, {}, []), /decoy response has no gyms array/);
});
