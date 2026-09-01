import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWebDiscovery, loadAudit } from './web-only-discovery-audit.mjs';

test('committed web-only matrix is valid and remains visibly unfinished', () => {
  const audit = loadAudit();
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.expected, 240);
  assert.ok(audit.completed > 0, 'the committed ledger should retain completed coverage work');
  assert.equal(audit.completed + audit.missing.length, audit.expected);
  assert.ok(audit.missing.length > 0, 'the exhaustion gate must remain visibly unfinished');
  assert.deepEqual(audit.completePasses, []);
  assert.ok(audit.rechecks > 0, 'productive passes must retain independently auditable repeat work');
  assert.ok(audit.candidates >= 3, 'the seed candidate history must not be lost');
});

test('a coverage cell counts only with reproducible evidence', () => {
  const matrix = {
    schema: 'cruxcoach-web-only-discovery-matrix-v1',
    minimum_completed_passes: 2,
    boards: [{ id: 'moonboard' }], regions: [{ id: 'east-asia' }], passes: [{ id: 'A' }, { id: 'B' }],
  };
  const ledger = { schema: 'cruxcoach-web-only-discovery-ledger-v1', candidates: [], rechecks: [], coverage: [
    { pass: 'A', board: 'moonboard', region: 'east-asia', status: 'complete', checked: '2026-09-01', languages: ['ja'], queries: ['MoonBoard クライミングジム'], results_reviewed: 10, candidates_found: 1 },
    { pass: 'B', board: 'moonboard', region: 'east-asia', status: 'complete' },
  ] };
  const audit = auditWebDiscovery(matrix, ledger);
  assert.equal(audit.completed, 1);
  assert.deepEqual(audit.completePasses, ['A']);
  assert.ok(audit.errors.some(error => error.includes('lacks exact queries')));
});

test('repeat runs preserve separate exact-query and yield evidence', () => {
  const matrix = {
    schema: 'cruxcoach-web-only-discovery-matrix-v1',
    minimum_completed_passes: 2,
    boards: [{ id: 'kilter', spellings: ['Kilter Board'] }],
    regions: [{ id: 'north-america', countries: ['US'], languages: ['en'] }],
    lexicons: { en: {} },
    passes: [{ id: 'A', query_families: [] }, { id: 'B', query_families: [] }],
  };
  const ledger = { schema: 'cruxcoach-web-only-discovery-ledger-v1', candidates: [], coverage: [], rechecks: [
    { pass: 'A', board: 'kilter', region: 'north-america', iteration: 2, status: 'complete', checked: '2026-09-01', languages: ['en'], queries: ['different exact query'], results_reviewed: 12, candidates_found: 1, production_changes: 0, note: 'No new production fact.' },
  ] };
  const audit = auditWebDiscovery(matrix, ledger);
  assert.equal(audit.rechecks, 1);
  assert.deepEqual(audit.errors, []);
});
