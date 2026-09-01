import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditInventory, mapInventory } from './moonboard-japan-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the Japan audit fails closed on malformed, stale and unreviewed rows', () => {
  const inventory = {
    venues: [
      { name: 'Reviewed Gym', lat: 35.1, lon: 139.1, board_rows: 1 },
      { name: 'Unknown Gym', lat: 35.2, lon: 139.2, board_rows: 1 },
    ],
    rawBoardRows: 2,
  };
  const decisions = [
    { name: 'Reviewed Gym', lat: 35.1, lon: 139.1, status: 'current', sources: ['https://example.com/'], note: 'Checked.' },
    { name: 'Wrong Name', lat: 35.1, lon: 139.1, status: 'pending', note: 'Not checked.' },
  ];
  const audit = auditInventory(inventory, decisions);
  assert.deepEqual(audit.malformed, [
    'pending decision 1 must not claim evidence',
    'duplicate decision 1',
  ]);
  assert.equal(audit.stale.length, 1);
  assert.deepEqual(audit.unknownMapVenues.map(row => row.name), ['Unknown Gym']);
});

test('the committed ledger accounts for every Japanese MoonBoard venue and setup', () => {
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/moonboard-japan-decisions.json'), 'utf8'));
  const audit = auditInventory(mapInventory(geojson), decisions);
  assert.equal(decisions.length, 45);
  assert.equal(audit.venues, 45);
  assert.equal(audit.rawBoardRows, 46);
  assert.deepEqual(audit.counts, {
    pending: 33,
    current: 12,
    unverified: 0,
    closed: 0,
    private: 0,
    ambiguous: 0,
    mislocated: 0,
  });
  assert.deepEqual(audit.malformed, []);
  assert.deepEqual(audit.stale, []);
  assert.deepEqual(audit.unknownMapVenues, []);
});
