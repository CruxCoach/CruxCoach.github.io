import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLatestRun, mapConcurrent, mergeProgressive,
} from '../competitions/app/ui/concurrency.mjs';

test('one slow competition does not withhold faster organizer rows', async () => {
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const shown = [];
  const mapping = mapConcurrent(['slow', 'fast-a', 'fast-b'], async (value) => {
    if (value === 'slow') await slow;
    return value.toUpperCase();
  }, { limit: 2, onResult: (value) => shown.push(value) });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shown, ['FAST-A', 'FAST-B'],
    'fast cards must render while an unrelated relay summary remains pending');
  releaseSlow();
  assert.deepEqual(await mapping, ['SLOW', 'FAST-A', 'FAST-B']);
  assert.deepEqual(shown, ['FAST-A', 'FAST-B', 'SLOW']);
});

test('organizer summary concurrency is bounded', async () => {
  let active = 0;
  let peak = 0;
  await mapConcurrent(Array.from({ length: 20 }, (_, index) => index), async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value;
  }, { limit: 4 });
  assert.equal(peak, 4);
});

test('obsolete organizer loads cannot overwrite a newer refresh', () => {
  const loads = createLatestRun();
  const old = loads.begin();
  assert.equal(old.isCurrent(), true);
  const fresh = loads.begin();
  assert.equal(old.isCurrent(), false);
  assert.equal(fresh.isCurrent(), true);
});

test('progressive organizer refresh preserves untouched rendered rows', () => {
  const old = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  assert.deepEqual(
    mergeProgressive(old, { id: 'a', value: 3 }, (item) => item.id),
    [{ id: 'b', value: 2 }, { id: 'a', value: 3 }],
  );
});
