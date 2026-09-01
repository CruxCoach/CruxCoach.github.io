import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWebDiscovery, loadAudit } from './web-only-discovery-audit.mjs';

test('committed web-only matrix is valid and remains visibly unfinished', () => {
  const audit = loadAudit();
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.expected, 240);
  assert.equal(audit.completed, 0);
  assert.equal(audit.missing.length, 240);
  assert.deepEqual(audit.completePasses, []);
  assert.equal(audit.candidates, 3);
});

test('a coverage cell counts only with reproducible evidence', () => {
  const matrix = {
    schema: 'cruxcoach-web-only-discovery-matrix-v1',
    minimum_completed_passes: 2,
    boards: [{ id: 'moonboard' }], regions: [{ id: 'east-asia' }], passes: [{ id: 'A' }, { id: 'B' }],
  };
  const ledger = { schema: 'cruxcoach-web-only-discovery-ledger-v1', candidates: [], coverage: [
    { pass: 'A', board: 'moonboard', region: 'east-asia', status: 'complete', checked: '2026-09-01', languages: ['ja'], queries: ['MoonBoard クライミングジム'], results_reviewed: 10, candidates_found: 1 },
    { pass: 'B', board: 'moonboard', region: 'east-asia', status: 'complete' },
  ] };
  const audit = auditWebDiscovery(matrix, ledger);
  assert.equal(audit.completed, 1);
  assert.deepEqual(audit.completePasses, ['A']);
  assert.ok(audit.errors.some(error => error.includes('lacks exact queries')));
});
