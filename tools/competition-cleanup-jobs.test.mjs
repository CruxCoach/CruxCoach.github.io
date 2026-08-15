import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CleanupJobStore, executeCleanupJob, newCleanupJob, validateCleanupJob,
} from '../competitions/app/cleanup-jobs.mjs';
import {
  buildCompetitionDeletionRequest, buildCompetitionTombstoneEvent,
} from '../competitions/app/protocol/competition.mjs';
import {
  finalizeEvent, generateSecretKey, getPublicKey,
} from '../competitions/app/protocol/nostr-event.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

async function fixture() {
  const secret = generateSecretKey();
  const ownerPubkey = getPublicKey(secret);
  const compId = '0123456789abcdef';
  const definitionEventId = 'b'.repeat(64);
  const tombstoneEvent = await finalizeEvent(
    buildCompetitionTombstoneEvent({ compId, deletedAt: 1234 }), secret,
  );
  const deletionEvent = await finalizeEvent(
    buildCompetitionDeletionRequest({ definitionEventId, at: 1235 }), secret,
  );
  return newCleanupJob({
    ownerPubkey, compId, title: 'Durable cleanup test', definitionEventId,
    relays: ['ws://127.0.0.1:7447', 'ws://localhost:7448'],
    tombstoneEvent, deletionEvent, updatedAt: 1235,
  });
}

test('cleanup is persisted before publish and survives a partial attempt', async () => {
  const storage = memoryStorage();
  const store = new CleanupJobStore(storage);
  const job = await fixture();
  const published = [];
  const pool = { publish: async (event) => {
    assert.equal(store.list(job.owner_pubkey).length, 1, 'job must predate every publish');
    published.push(event.id);
    return {
      attempted: 2, accepted: 1,
      results: job.relays.map((url, index) => ({ url, ok: index === 0, reason: index ? 'offline' : '' })),
    };
  } };

  const result = await executeCleanupJob(job, pool, store, () => 1240);
  assert.equal(result.complete, false);
  assert.deepEqual(published, [job.tombstone_event.id, job.deletion_event.id]);
  const restored = store.list(job.owner_pubkey)[0];
  assert.equal(restored.outcomes.tombstone[1].reason, 'offline');
  assert.equal(restored.outcomes.deletion[1].reason, 'offline');
});

test('restart retry republishes identical signed bytes and clears only after all acknowledgements', async () => {
  const storage = memoryStorage();
  const firstStore = new CleanupJobStore(storage);
  const job = await fixture();
  firstStore.save(job);
  const restored = new CleanupJobStore(storage).get(job.owner_pubkey, job.comp_id);
  const ids = [];
  const pool = { publish: async (event) => {
    ids.push(event.id);
    return { attempted: 2, accepted: 2, results: job.relays.map((url) => ({ url, ok: true, reason: '' })) };
  } };
  const result = await executeCleanupJob(restored, pool, new CleanupJobStore(storage));
  assert.equal(result.complete, true);
  assert.deepEqual(ids, [job.tombstone_event.id, job.deletion_event.id]);
  assert.equal(firstStore.get(job.owner_pubkey, job.comp_id), null);
});

test('acknowledgements accumulate across retries instead of regressing', async () => {
  const storage = memoryStorage();
  const store = new CleanupJobStore(storage);
  const job = await fixture();
  let attempt = 0;
  const pool = { publish: async () => {
    const acceptedIndex = Math.floor(attempt / 2);
    attempt += 1;
    return {
      attempted: 2, accepted: 1,
      results: job.relays.map((url, index) => ({ url, ok: index === acceptedIndex, reason: 'offline' })),
    };
  } };
  const first = await executeCleanupJob(job, pool, store);
  assert.equal(first.complete, false);
  const second = await executeCleanupJob(store.get(job.owner_pubkey, job.comp_id), pool, store);
  assert.equal(second.complete, true);
  assert.equal(store.get(job.owner_pubkey, job.comp_id), null);
});

test('tampered persisted cleanup events fail closed', async () => {
  const job = await fixture();
  job.deletion_event = { ...job.deletion_event, content: 'publish something else' };
  assert.equal(await validateCleanupJob(job), false);
  let published = false;
  await assert.rejects(
    executeCleanupJob(job, { publish: async () => { published = true; } }, new CleanupJobStore(memoryStorage())),
    /invalid/,
  );
  assert.equal(published, false);
});

test('unavailable durable storage blocks cleanup before publication', async () => {
  const job = await fixture();
  let published = false;
  await assert.rejects(
    executeCleanupJob(job, { publish: async () => { published = true; } }, new CleanupJobStore(null)),
    /storage is unavailable/,
  );
  assert.equal(published, false);
});
