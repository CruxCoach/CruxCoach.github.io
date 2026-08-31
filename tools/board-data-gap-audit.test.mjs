import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAudit } from './board-data-gap-audit.mjs';

test('board data gap audit accounts for every committed venue and board entry', () => {
  const audit = buildAudit();
  assert.ok(audit.totals.venues > 0);
  assert.equal(
    Object.values(audit.per_board).reduce((sum, row) => sum + row.entries, 0),
    audit.totals.board_entries,
  );
  assert.equal(
    audit.totals.city_exact + audit.totals.city_nearest_only + audit.totals.city_missing,
    audit.totals.venues,
  );
});

test('board data gap audit keeps retryable and stale-marker findings visible', () => {
  const audit = buildAudit();
  assert.ok(Number.isInteger(audit.research.retry_queue));
  assert.ok(Array.isArray(audit.quality_findings.closed_or_duplicate_markers_still_published));
  assert.ok(Array.isArray(audit.quality_findings.null_island_markers));
});
