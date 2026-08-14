/**
 * Map work with a fixed concurrency ceiling and progressive result delivery.
 * Results retain input order; `onResult` may render each settled row without
 * waiting for an unrelated slow item.
 */
export async function mapConcurrent(values, worker, { limit = 4, onResult = () => {} } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      const result = await worker(values[index], index);
      results[index] = result;
      onResult(result, index, results);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return results;
}

/** Issue opaque generations so obsolete async UI work cannot publish state. */
export function createLatestRun() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      const mine = generation;
      return { isCurrent: () => generation === mine };
    },
  };
}

/** One active task plus at most one merged-arguments rerun. */
export function createCoalescedRunner(task, {
  mergeArgs = (_pending, latest) => latest,
} = {}) {
  let active = null;
  let pendingArgs = null;
  return (...args) => {
    if (active) {
      pendingArgs = pendingArgs ? mergeArgs(pendingArgs, args) : args;
      return active;
    }
    active = (async () => {
      let passArgs = args;
      while (passArgs) {
        // eslint-disable-next-line no-await-in-loop
        await task(...passArgs);
        passArgs = pendingArgs;
        pendingArgs = null;
      }
    })().finally(() => { active = null; });
    return active;
  };
}

/** Replace one progressively refreshed row without hiding untouched old rows. */
export function mergeProgressive(values, value, key) {
  const wanted = key(value);
  const next = values.filter((item) => key(item) !== wanted);
  next.push(value);
  return next;
}
