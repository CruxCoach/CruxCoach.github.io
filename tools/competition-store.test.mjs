import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CompetitionStore, LOG_PAGE_SIZE, boundedMissingSequence, logPageDTags, relayQuorum,
} from '../competitions/app/ui/store.mjs';
import {
  buildCompetitionEvent, buildIntentEvent, intentDTag,
} from '../competitions/app/protocol/competition.mjs';
import {
  finalizeEvent, getPublicKey, hexToBytes,
} from '../competitions/app/protocol/nostr-event.mjs';

const fixture = JSON.parse(fs.readFileSync(
  new URL('../competitions/fixtures/streams/authority-operations.json', import.meta.url),
  'utf8',
));
const payload = JSON.parse(fixture.competition_event.content);
const definitionDTag = fixture.competition_event.tags.find((tag) => tag[0] === 'd')[1];
const participantFixture = JSON.parse(fs.readFileSync(
  new URL('../competitions/fixtures/streams/paid-unique-async.json', import.meta.url),
  'utf8',
));

class ClampedPool {
  constructor({ incomplete = false, failed = 0, queryDelayMs = 0, liveDuringFirstLog = false } = {}) {
    this.urls = ['wss://relay.example.invalid'];
    this.connectedUrls = [...this.urls];
    this.incomplete = incomplete;
    this.failed = failed;
    this.queryDelayMs = queryDelayMs;
    this.liveDuringFirstLog = liveDuringFirstLog;
    this.liveDelivered = false;
    this.logQueries = [];
    this.activeLogQueries = 0;
    this.maxActiveLogQueries = 0;
    this.subscribed = false;
    this.subscriptionOptions = null;
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
    this.activeLogQueries += 1;
    this.maxActiveLogQueries = Math.max(this.maxActiveLogQueries, this.activeLogQueries);
    try {
      if (this.queryDelayMs) await new Promise((resolve) => setTimeout(resolve, this.queryDelayMs));
      if (this.liveDuringFirstLog && !this.liveDelivered) {
        this.liveDelivered = true;
        void this.subscriptionOptions.onEvent(fixture.log_events.at(-1));
      }
      const events = fixture.log_events.filter((event, index) => {
        if (this.liveDuringFirstLog && index === fixture.log_events.length - 1) return false;
        const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
        return wanted.includes(dTag);
      }).slice(0, 20); // emulate a relay with a hard twenty-event response cap
      return {
        events,
        complete: !this.incomplete,
        answered: this.incomplete ? 0 : 1,
        failed: this.failed,
      };
    } finally {
      this.activeLogQueries -= 1;
    }
  }

  subscribe(_filters, options) {
    this.subscribed = true;
    this.subscriptionOptions = options;
    return { ready: Promise.resolve(true), close() {} };
  }
}

test('a definition candidate is actionable only after a signed relay majority answers', async () => {
  const pool = new ClampedPool();
  pool.urls = ['wss://signed-one.example', 'wss://signed-two.example'];
  pool.query = async () => ({
    events: [fixture.competition_event], complete: true, answered: 1, failed: 1,
  });
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.deepEqual(await store.loadCompetition(), { ok: false, error: 'unreachable' });
  assert.equal(store.snapshot().competition, null);
  assert.equal((await store.loadCompetition({ requireAllRelays: false })).ok, true);

  pool.urls = Array.from({ length: 5 }, (_, index) => `wss://signed-${index}.example`);
  pool.query = async () => ({
    events: [fixture.competition_event], complete: false, answered: 3, failed: 2,
  });
  assert.equal((await store.loadCompetition()).ok, true);
});

test('equal-second definitions converge on the NIP-01 lower event id in either arrival order', async () => {
  const secret = hexToBytes('41'.repeat(32));
  const pubkey = getPublicKey(secret);
  const at = 1789019000;
  const events = await Promise.all(['Alpha revision', 'Beta revision'].map((title) =>
    finalizeEvent(buildCompetitionEvent({ ...payload, title }, at), secret)));
  const expected = [...events].sort((a, b) => a.id.localeCompare(b.id))[0];

  for (const order of [events, [...events].reverse()]) {
    const pool = new ClampedPool();
    pool.query = async () => ({ events: order, complete: true, answered: 1, failed: 0 });
    const store = new CompetitionStore({
      pool, organizerPubkey: pubkey, compId: payload.comp_id, now: () => 1789020000,
    });
    assert.equal((await store.loadCompetition()).ok, true);
    assert.equal(store.competitionEventId, expected.id);
    assert.equal(store.competition.title, JSON.parse(expected.content).title);
  }
});

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

test('live delivery is armed before hydration and closes the EOSE-to-follow race', async () => {
  const pool = new ClampedPool({ liveDuringFirstLog: true });
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });
  assert.equal((await store.loadCompetition()).ok, true);
  const observations = [];
  store.onChange((snapshot) => observations.push({ trustworthy: snapshot.trustworthy, subscribed: pool.subscribed }));

  await store.follow();

  assert.equal(pool.liveDelivered, true);
  assert.equal(store.state.seq, fixture.expected.state.seq,
    'the event omitted from stored pages must arrive through the already-armed subscription');
  assert.equal(store.stateHash, fixture.expected.state_hash);
  assert.ok(observations.some((item) => item.trustworthy));
  assert.ok(observations.filter((item) => item.trustworthy).every((item) => item.subscribed),
    'no trusted snapshot may escape before live delivery is armed');
});

test('relay loss immediately makes a trusted projection stale until exact recovery', async () => {
  const pool = new ClampedPool();
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });
  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();
  const verifiedHash = store.snapshot().stateHash;
  assert.equal(store.snapshot().trustworthy, true);

  store.connectionChanged(`disconnected:${pool.urls[0]}`);
  assert.equal(store.snapshot().trustworthy, false);
  assert.equal(store.snapshot().historyComplete, false);
  assert.equal(store.snapshot().stateHash, verifiedHash,
    'the last projection stays visible but is explicitly stale');

  pool.subscriptionOptions.onEose(pool.urls[0]);
  await new Promise((resolve) => setImmediate(resolve));
  await store.historyHydrationPromise;
  assert.equal(store.snapshot().trustworthy, true);
  assert.equal(store.snapshot().stateHash, verifiedHash);
});

test('one lost relay does not invalidate a five-relay majority projection', () => {
  const pool = new ClampedPool();
  pool.urls = Array.from({ length: 5 }, (_, index) => `wss://signed-${index}.example`);
  pool.connectedUrls = pool.urls.slice(0, 4);
  const store = new CompetitionStore({
    pool, organizerPubkey: fixture.competition_event.pubkey, compId: payload.comp_id,
  });
  store.historyComplete = true;

  store.connectionChanged(`disconnected:${pool.urls[4]}`);

  assert.equal(store.snapshot().historyComplete, true);
  assert.equal(store.snapshot().problems.includes('history_incomplete'), false);
});

test('a missed final entry stays stale through a same-count wrong-relay reconnect', async () => {
  const pool = new ClampedPool();
  pool.urls = ['wss://signed-one.example', 'wss://signed-two.example'];
  pool.connectedUrls = [...pool.urls];
  let finalPublished = false;
  let everySignedRelayAvailable = true;
  pool.query = async (filters) => {
    const filter = filters[0];
    if (filter['#d']?.includes(definitionDTag)) {
      return {
        events: [fixture.competition_event], complete: everySignedRelayAvailable,
        answered: everySignedRelayAvailable ? 2 : 1, failed: everySignedRelayAvailable ? 0 : 1,
      };
    }
    const wanted = filter['#d'] || [];
    pool.logQueries.push(filter);
    const visible = finalPublished && everySignedRelayAvailable
      ? fixture.log_events : fixture.log_events.slice(0, -1);
    return {
      events: visible.filter((event) => wanted.includes(
        event.tags.find((tag) => tag[0] === 'd')?.[1],
      )).slice(0, 20),
      complete: everySignedRelayAvailable,
      answered: everySignedRelayAvailable ? 2 : 1,
      failed: everySignedRelayAvailable ? 0 : 1,
    };
  };

  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });
  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();
  const prefixSeq = store.snapshot().state.seq;
  assert.equal(prefixSeq, fixture.expected.state.seq - 1);
  assert.equal(store.snapshot().trustworthy, true);

  finalPublished = true;
  everySignedRelayAvailable = false;
  pool.connectedUrls = ['wss://signed-one.example', 'wss://unrelated.example'];
  store.connectionChanged('disconnected:wss://signed-two.example');
  assert.equal(store.snapshot().connectedRelays, 2, 'raw connection count deliberately did not change');
  assert.equal(store.snapshot().trustworthy, false);

  pool.subscriptionOptions.onEose('wss://signed-one.example');
  await new Promise((resolve) => setImmediate(resolve));
  await store.historyHydrationPromise;
  assert.equal(store.snapshot().state.seq, prefixSeq, 'the answering stale relay does not have the final entry');
  assert.equal(store.snapshot().trustworthy, false, 'an unrelated replacement cannot satisfy signed scope');

  everySignedRelayAvailable = true;
  pool.connectedUrls = [...pool.urls];
  pool.subscriptionOptions.onEose('wss://signed-two.example');
  await new Promise((resolve) => setImmediate(resolve));
  await store.historyHydrationPromise;
  assert.equal(store.snapshot().state.seq, fixture.expected.state.seq);
  assert.equal(store.snapshot().stateHash, fixture.expected.state_hash);
  assert.equal(store.snapshot().trustworthy, true);
});

test('a burst while history is incomplete coalesces exact recovery walks', async () => {
  const pool = new ClampedPool({ incomplete: true, queryDelayMs: 10 });
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });
  assert.equal((await store.loadCompetition()).ok, true);
  await store.follow();
  const burst = fixture.log_events.slice(-12);
  for (const event of burst) store.entries.delete(event.id);
  await store.recompute();
  const before = pool.logQueries.length;

  await Promise.all(burst.map((event) => pool.subscriptionOptions.onEvent(event)));

  assert.equal(pool.maxActiveLogQueries, 1, 'exact history walks must never overlap');
  assert.equal(pool.logQueries.length - before, 2,
    'unique overlapping events request one active walk and one dirty rerun');
  assert.equal(store.snapshot().trustworthy, false);
});

test('own replaceable intent is restored only from a complete exact d-tag query', async () => {
  const competition = JSON.parse(participantFixture.competition_event.content);
  const secret = hexToBytes('31'.repeat(32));
  const pubkey = getPublicKey(secret);
  const nonce = 'a1b2c3d4';
  const event = await finalizeEvent(buildIntentEvent({
    compId: competition.comp_id,
    organizerPubkey: participantFixture.competition_event.pubkey,
    authority: competition.authority,
    pubkey,
    nonce,
    op: 'climb_choice',
    data: { climb_id: competition.climb_pool.options[0].id },
    at: 1789005000,
  }), secret);
  const competing = await finalizeEvent(buildIntentEvent({
    compId: competition.comp_id,
    organizerPubkey: participantFixture.competition_event.pubkey,
    authority: competition.authority,
    pubkey,
    nonce,
    op: 'climb_choice',
    data: { climb_id: competition.climb_pool.options[1].id },
    at: 1789005000,
  }), secret);
  const queries = [];
  const pool = {
    urls: ['wss://one.invalid'], connectedUrls: ['wss://one.invalid'],
    async query(filters) {
      queries.push(filters[0]);
      return { events: [event], complete: true, answered: 1, failed: 0 };
    },
  };
  const store = new CompetitionStore({
    pool, organizerPubkey: participantFixture.competition_event.pubkey,
    compId: competition.comp_id, now: () => 1789006000,
  });
  store.competition = competition;
  const restored = await store.loadOwnIntent(pubkey, 'climb_choice', nonce);
  assert.equal(restored.trustworthy, true);
  assert.equal(restored.intent.intent.data.climb_id, competition.climb_pool.options[0].id);
  assert.deepEqual(queries[0]['#d'], [intentDTag(competition.comp_id, pubkey, nonce)]);

  const expected = [event, competing].sort((a, b) => a.id.localeCompare(b.id))[0];
  for (const order of [[event, competing], [competing, event]]) {
    pool.query = async () => ({ events: order, complete: true, answered: 1, failed: 0 });
    const converged = await store.loadOwnIntent(pubkey, 'climb_choice', nonce);
    assert.equal(converged.intent.eventId, expected.id);
  }

  pool.urls = ['wss://one.invalid', 'wss://two.invalid', 'wss://three.invalid'];
  pool.query = async () => ({ events: [event], complete: false, answered: 1, failed: 2 });
  assert.deepEqual(await store.loadOwnIntent(pubkey, 'climb_choice', nonce), {
    trustworthy: false, intent: null,
  });
});

test('the broad intent inbox is compatible, signature-checked and majority complete', async () => {
  const competition = JSON.parse(participantFixture.competition_event.content);
  const secret = hexToBytes('32'.repeat(32));
  const pubkey = getPublicKey(secret);
  const event = await finalizeEvent(buildIntentEvent({
    compId: competition.comp_id,
    organizerPubkey: participantFixture.competition_event.pubkey,
    authority: competition.authority,
    pubkey,
    nonce: 'feedcafe',
    op: 'climb_choice',
    data: { climb_id: competition.climb_pool.options[0].id },
    at: 1789005000,
  }), secret);
  const tampered = { ...event, content: event.content.replace('climb_choice', 'attempt_report') };
  const calls = [];
  const pool = {
    urls: [
      'wss://one.invalid', 'wss://two.invalid', 'wss://three.invalid',
      'wss://four.invalid', 'wss://five.invalid',
    ],
    connectedUrls: [],
    subscribe(filters, options = {}) {
      calls.push({ kind: 'subscribe', filters });
      for (const [index, url] of this.urls.entries()) options.onEose?.(url, index + 1, {
        failed: index >= 3, settled: index + 1,
      });
      return { ready: Promise.resolve(true), close() {} };
    },
    async query(filters) {
      calls.push({ kind: 'query', filters });
      return { events: [event, tampered], complete: false, answered: 3, failed: 2 };
    },
  };
  const store = new CompetitionStore({
    pool, organizerPubkey: participantFixture.competition_event.pubkey,
    compId: competition.comp_id, now: () => 1789006000,
  });
  store.competition = competition;
  const accepted = [];
  await store.followIntents((candidate) => accepted.push(candidate.id));

  assert.deepEqual(accepted, [event.id]);
  assert.equal(store.snapshot().intentHistoryComplete, true);
  assert.equal(calls[0].kind, 'subscribe', 'live delivery is armed before history is fetched');
  assert.equal(calls[1].filters.length, 1, 'one broadly indexed request works across public relays');
  assert.equal(calls[1].filters[0].limit, 1000);
  assert.equal('#op' in calls[1].filters[0], false, 'operation tags are filtered locally');
  assert.equal('#l' in calls[1].filters[0], false, 'label tags are filtered locally');
  assert.equal(relayQuorum(pool.urls.length), 3);

  store.connectionChanged('disconnected:wss://one.invalid');
  assert.equal(store.snapshot().intentHistoryComplete, false,
    'dropping below the majority invalidates a previously complete inbox');

  pool.query = async () => ({ events: [event], complete: false, answered: 2, failed: 3 });
  await store.followIntents(() => {});
  assert.equal(store.snapshot().intentHistoryComplete, false);
  assert.ok(store.snapshot().problems.includes('intents_incomplete'));
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

test('a recompute caller waits for an overlapping dirty pass that includes its event', async () => {
  const pool = new ClampedPool();
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });
  assert.equal((await store.loadCompetition()).ok, true);
  await store.hydrateHistory();

  const last = [...store.entries.entries()].find(([, parsed]) =>
    parsed.entry.seq === fixture.expected.state.seq);
  assert.ok(last);
  store.entries.delete(last[0]);
  await store.recompute();
  assert.equal(store.state.seq, fixture.expected.state.seq - 1);

  const active = store.recompute();
  store.entries.set(last[0], last[1]);
  const joined = store.recompute();
  await Promise.all([active, joined]);
  assert.equal(store.state.seq, fixture.expected.state.seq);
  assert.equal(store.stateHash, fixture.expected.state_hash,
    'the joined caller must not resolve against the stale in-flight hash pass');
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

test('a relay minority never proves complete history', async () => {
  const pool = new ClampedPool({ failed: 1 });
  pool.urls = ['wss://one.invalid', 'wss://two.invalid', 'wss://three.invalid'];
  pool.connectedUrls = [pool.urls[0]];
  const store = new CompetitionStore({
    pool,
    organizerPubkey: fixture.competition_event.pubkey,
    compId: payload.comp_id,
    now: () => 1789020000,
  });

  assert.equal((await store.loadCompetition({ requireAllRelays: false })).ok, true);
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
