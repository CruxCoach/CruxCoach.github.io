import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CompetitionStore, LOG_PAGE_SIZE, boundedMissingSequence, logPageDTags,
} from '../competitions/app/ui/store.mjs';

const fixture = JSON.parse(fs.readFileSync(
  new URL('../competitions/fixtures/streams/authority-operations.json', import.meta.url),
  'utf8',
));
const payload = JSON.parse(fixture.competition_event.content);
const definitionDTag = fixture.competition_event.tags.find((tag) => tag[0] === 'd')[1];

class ClampedPool {
  constructor({ incomplete = false, failed = 0 } = {}) {
    this.urls = ['wss://relay.example.invalid'];
    this.connectedUrls = [...this.urls];
    this.incomplete = incomplete;
    this.failed = failed;
    this.logQueries = [];
  }

  async query(filters) {
    const filter = filters[0];
    if (filter['#d']?.includes(definitionDTag)) {
      return {
        events: [fixture.competition_event], complete: true, answered: 1, failed: this.failed,
      };
    }
    const wanted = filter['#d'] || [];
    this.logQueries.push(filter);
    const events = fixture.log_events.filter((event) => {
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
      return wanted.includes(dTag);
    }).slice(0, 20); // emulate a relay with a hard twenty-event response cap
    return {
      events,
      complete: !this.incomplete,
      answered: this.incomplete ? 0 : 1,
      failed: this.failed,
    };
  }

  subscribe() {
    return { ready: Promise.resolve(true), close() {} };
  }
}

test('stored history walks exact d-tag pages despite a twenty-event relay cap', async () => {
  const pool = new ClampedPool();
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();

  const snapshot = store.snapshot();
  assert.equal(LOG_PAGE_SIZE, 20);
  assert.equal(snapshot.entryCount, fixture.log_events.length);
  assert.equal(snapshot.state.seq, fixture.expected.state.seq);
  assert.equal(snapshot.stateHash, fixture.expected.state_hash);
  assert.equal(snapshot.historyComplete, true);
  assert.equal(snapshot.trustworthy, true);
  assert.deepEqual(pool.logQueries[0]['#d'], logPageDTags(payload.comp_id, 1));
  assert.deepEqual(pool.logQueries[1]['#d'], logPageDTags(payload.comp_id, 21));
  assert.equal(pool.logQueries.every((filter) => filter.limit === 100), true);
});

test('a non-live organizer summary hydrates the same complete effective state', async () => {
  const pool = new ClampedPool();
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.equal((await store.loadCompetition()).ok, true);
  const snapshot = await store.hydrateHistory();

  assert.equal(snapshot.trustworthy, true);
  assert.equal(snapshot.stateHash, fixture.expected.state_hash);
  assert.equal(snapshot.state.status, fixture.expected.state.status);
  assert.equal(snapshot.state.config_revision, 4);
});

test('an incomplete stored query never becomes trustworthy personal state', async () => {
  const pool = new ClampedPool({ incomplete: true });
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();

  const snapshot = store.snapshot();
  assert.equal(snapshot.historyComplete, false);
  assert.equal(snapshot.trustworthy, false);
  assert.ok(snapshot.problems.includes('history_incomplete'));
});

test('a partial multi-relay answer never proves complete history', async () => {
  const pool = new ClampedPool({ failed: 1 });
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();

  const snapshot = store.snapshot();
  assert.equal(snapshot.entryCount, 20, 'partial events remain available for later convergence');
  assert.equal(snapshot.historyComplete, false);
  assert.equal(snapshot.trustworthy, false);
  assert.ok(snapshot.problems.includes('history_incomplete'));
});

test('bounded gap detection distinguishes a hole from a contiguous prefix', () => {
  assert.equal(boundedMissingSequence(new Set([1, 2, 4, 5])), 3);
  assert.equal(boundedMissingSequence(new Set([1, 2, 3])), null);
  assert.equal(boundedMissingSequence(new Set()), null);
});
