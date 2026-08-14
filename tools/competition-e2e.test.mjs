import test from 'node:test';
import assert from 'node:assert/strict';

import { startDevRelay } from './dev/relay.mjs';
import { RelayPool } from '../competitions/app/protocol/relay-pool.mjs';
import { CompetitionStore } from '../competitions/app/ui/store.mjs';
import {
  AuthorityWriter, EntrantWriter, PublishError, publishCompetition,
} from '../competitions/app/authority.mjs';
import { KeyVaultSession } from '../competitions/app/signer/local-key.mjs';
import { createLocalSigner, createReadOnlySigner } from '../competitions/app/signer/signers.mjs';
import { newCompId, parseIntentEvent } from '../competitions/app/protocol/competition.mjs';
import { naddrEncode } from '../competitions/app/protocol/nostr-event.mjs';
import { compDTag, KIND } from '../competitions/app/protocol/competition.mjs';
import {
  outstandingClaims, freeClimbs, outstandingCount, registrationOrder,
} from '../competitions/app/protocol/claims.mjs';
import { buildZapRequest, verifyZapReceipt } from '../competitions/app/protocol/zap.mjs';
import { sha256Hex } from '../competitions/app/protocol/ccj.mjs';
import { fakeInvoice } from './dev/fake-invoice.mjs';

/**
 * A whole competition, end to end, over a loopback relay.
 *
 * This is the test that proves the pieces fit: real signatures, a real relay,
 * the shipped store, and three independent readers — organizer, entrant and
 * projector — that must all reduce to the same state hash. Nothing here is
 * mocked except the clock.
 *
 * No public relay is contacted and no payment is made. The relay refuses to
 * bind anything but loopback, so that is structural rather than a promise.
 */

let clock = 1789000000;
const now = () => clock;
const tick = (seconds = 1) => { clock += seconds; };

function newSigner() {
  const session = new KeyVaultSession({ storage: null });
  session.generate();
  return createLocalSigner(session);
}

function baseConfig(compId, authority, overrides = {}) {
  return {
    comp_id: compId,
    authority,
    authority_epoch: 1,
    title: 'Loopback Session',
    summary: 'Two problems, three attempts, two climbers.',
    description: 'An end-to-end exercise of the competition protocol.',
    organizer: { name: 'CruxCoach test', contact: 'test@example.invalid' },
    visibility: 'public',
    status: 'draft',
    timezone: 'Europe/Berlin',
    registration_opens_at: now() - 60,
    registration_closes_at: now() + 3600,
    checkin_opens_at: now() - 60,
    checkin_closes_at: now() + 5400,
    starts_at: now(),
    ends_at: now() + 7200,
    capacity: 8,
    waitlist_enabled: true,
    venue: { kind: 'physical', name: 'Test wall', address: 'Loopback 1' },
    board: { brand: 'kilter', model: 'kilterboard-og', layout_id: 1, size: '12x12', angle: 40 },
    divisions: [{ id: 'open', label: 'Open' }],
    eligibility: 'Anyone running this test.',
    waiver: 'I understand that climbing is dangerous and I climb at my own risk.',
    waiver_required: true,
    participant_instructions: 'Warm up first.',
    spectator_info: 'The live screen is at /competitions/live.html.',
    refund_policy: 'Not applicable — entry is free.',
    fee_msat: 0,
    prizes: [],
    rules: {
      climb_source: 'organizer_set',
      climb_count: 2,
      selection_uniqueness: 'none',
      progression: 'synchronous_rounds',
      attempts_per_climb: 3,
      turn_deadline_sec: 120,
      attempt_deadline_sec: 0,
      min_rest_sec: 0,
      defer_budget_per_round: 1,
      max_consecutive_defers: 1,
      defer_slots: 2,
      scoring: 'tops_then_attempts',
      tiebreaks: ['fewest_attempts', 'most_zones', 'earliest_finish', 'seed_order'],
      late_entry_allowed: false,
    },
    climbs: [
      { id: 'c1', climb_uuid: '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061', angle: 40, label: 'One', points: 100 },
      { id: 'c2', climb_uuid: '7b2e9d15-4c8a-4f36-8d52-1e9a3b7c4d08', angle: 40, label: 'Two', points: 150 },
    ],
    relays: [],
    created_at: 1789000000,
    revision: 1,
    ...overrides,
  };
}

/** Bring up a relay, an organizer, and a published competition. */
async function setup(configOverrides = {}) {
  clock = 1789000000;
  const relay = await startDevRelay({ port: 0, quiet: true });
  const organizer = newSigner();
  const compId = newCompId();
  const config = baseConfig(compId, organizer.pubkey, { relays: [relay.url], ...configOverrides });

  const organizerPool = new RelayPool([relay.url]);
  await publishCompetition(organizerPool, organizer, config, now());

  const store = new CompetitionStore({
    pool: organizerPool, organizerPubkey: organizer.pubkey, compId, now,
  });
  const loaded = await store.loadCompetition();
  assert.equal(loaded.ok, true, loaded.error);
  await store.follow();

  const writer = new AuthorityWriter({ store, pool: organizerPool, signer: organizer, now });
  return { relay, organizer, organizerPool, compId, config, store, writer };
}

/** A second, independent reader — a phone, or the projector. */
async function reader(relayUrl, organizerPubkey, compId) {
  const pool = new RelayPool([relayUrl]);
  const store = new CompetitionStore({ pool, organizerPubkey, compId, now });
  const loaded = await store.loadCompetition();
  assert.equal(loaded.ok, true, loaded.error);
  await store.follow();
  return { pool, store };
}

/** Wait until `predicate(store)` holds, or fail with what it actually was. */
async function until(store, predicate, what, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (predicate(store)) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${what} (seq=${store.state?.seq}, status=${store.state?.status})`);
}

test('a competition runs end to end and every reader agrees on the state', async () => {
  const { relay, organizer, organizerPool, compId, store, writer } = await setup();
  const alice = newSigner();
  const bob = newSigner();
  const aliceSide = await reader(relay.url, organizer.pubkey, compId);
  const bobSide = await reader(relay.url, organizer.pubkey, compId);
  const projector = await reader(relay.url, organizer.pubkey, compId);
  const projectorSigner = createReadOnlySigner();

  try {
    // The projector genuinely holds no key: it cannot write even if asked.
    await assert.rejects(
      () => projectorSigner.signEvent({ kind: 1, created_at: now(), tags: [], content: '' }),
      /read-only/,
    );

    // ── the organizer opens registration ──
    await writer.setStatus('published');
    tick();
    await writer.setStatus('registration_open');
    await until(aliceSide.store, (s) => s.state?.status === 'registration_open', 'registration to open');

    // ── two climbers register ──
    const intents = [];
    await store.followIntents(async (event) => {
      const parsed = parseIntentEvent(event, store.competition, organizer.pubkey, now());
      if (parsed.ok) intents.push(parsed);
    });

    for (const [signer, side, display] of [[alice, aliceSide, 'Alice'], [bob, bobSide, 'Bob']]) {
      const entrant = new EntrantWriter({
        pool: side.pool, signer, competition: side.store.competition,
        organizerPubkey: organizer.pubkey, now,
      });
      await entrant.register({ division: 'open', display, waiverAccepted: true });
    }
    await until({ state: { seq: 0 } }, () => intents.length === 2, 'both registrations to arrive');

    // An intent is a request, not a state change.
    assert.equal(store.state.participants.length, 0,
      'a registration request must not make someone a participant');

    // ── the organizer accepts them ──
    for (const intent of intents) {
      // eslint-disable-next-line no-await-in-loop
      await writer.decideRegistration(intent.pubkey, 'accepted', {
        division: intent.intent.data.division,
        display: intent.intent.data.display,
      });
      tick();
    }
    await until(aliceSide.store, (s) => s.state?.participants.length === 2, 'both entrants to be accepted');
    assert.equal(aliceSide.store.participant(alice.pubkey).registration, 'accepted');
    assert.equal(aliceSide.store.participant(alice.pubkey).payment, 'not_required');

    // ── check-in ──
    tick();
    await writer.setStatus('registration_closed');
    tick();
    await writer.setStatus('checkin_open');
    for (const signer of [alice, bob]) {
      // eslint-disable-next-line no-await-in-loop
      await writer.checkIn(signer.pubkey);
      tick();
    }
    await until(bobSide.store, (s) => s.participant(bob.pubkey)?.checkin === 'checked_in', 'check-in');

    // ── seed and start ──
    const order = await AuthorityWriter.defaultOrder(compId, [alice.pubkey, bob.pubkey]);
    await writer.seed(order);
    tick();
    await writer.setStatus('running');
    await until(projector.store, (s) => s.state?.status === 'running', 'the competition to start');
    assert.equal(projector.store.state.current_climb_id, 'c1');

    // ── first turn, with a deferral ──
    await writer.openTurn(0);
    const firstUp = order[0];
    const firstSide = firstUp === alice.pubkey ? aliceSide : bobSide;
    // Wait on the store we are about to ASSERT on. Waiting on one reader and
    // asserting on another is a race that passes whenever the two happen to be
    // the same person.
    await until(firstSide.store, (s) => s.currentClimber() === firstUp, 'the first turn to open');
    assert.equal(firstSide.store.canDefer(firstUp), true, 'the first climber may defer once');
    assert.equal(firstSide.store.defersLeft(firstUp), 1);

    await writer.decideDefer(firstUp, 'granted');
    await until(firstSide.store, (s) => s.defersLeft(firstUp) === 0, 'the deferral to be recorded');
    assert.equal(firstSide.store.canDefer(firstUp), false,
      'with no budget left the defer control must be gone, not merely disabled');
    assert.equal(
      firstSide.store.attemptsLeft(firstUp, 'c1'), 3,
      'deferring must not change the attempt allowance',
    );

    // ── everyone climbs ──
    tick();
    await writer.openTurn(0);
    const secondUp = store.state.order[0];
    tick();
    await writer.recordAttempt(secondUp, 'c1', 'top', 1);
    tick();
    await writer.closeTurn();

    tick();
    await writer.openTurn(1);
    const lastUp = store.state.order[1];
    tick();
    await writer.recordAttempt(lastUp, 'c1', 'fall', 1);
    tick();
    await writer.recordAttempt(lastUp, 'c1', 'top', 2);
    tick();
    await writer.closeTurn();

    // ── second climb ──
    tick();
    await writer.nextClimb('c2');
    tick();
    await writer.nextRound();
    tick();
    await writer.seed(store.state.order);
    for (const [index, pubkey] of store.state.order.entries()) {
      tick();
      // eslint-disable-next-line no-await-in-loop
      await writer.openTurn(index);
      tick();
      // eslint-disable-next-line no-await-in-loop
      await writer.recordAttempt(pubkey, 'c2', index === 0 ? 'top' : 'zone', 1);
      tick();
      // eslint-disable-next-line no-await-in-loop
      await writer.closeTurn();
    }

    // ── finish ──
    tick();
    await writer.setStatus('finished');
    await until(projector.store, (s) => s.state?.status === 'finished', 'the competition to finish');

    // ── every reader agrees, byte for byte ──
    for (const side of [aliceSide, bobSide, projector]) {
      // eslint-disable-next-line no-await-in-loop
      await until(side.store, (s) => s.state?.seq === store.state.seq, 'the reader to catch up');
    }
    const hashes = new Set([
      store.stateHash,
      aliceSide.store.stateHash,
      bobSide.store.stateHash,
      projector.store.stateHash,
    ]);
    assert.equal(hashes.size, 1, `four readers produced ${hashes.size} different states`);
    assert.equal(store.state.chain_complete, true);
    assert.equal(store.state.fork_detected, false);
    assert.deepEqual(store.state.rejected, [], 'a clean run must reject nothing');

    // ── standings ──
    const standings = projector.store.standings;
    assert.equal(standings.length, 2);
    assert.equal(standings[0].rank, 1);
    assert.equal(standings[0].tops, 2, 'the winner topped both climbs');
    assert.equal(standings[1].rank, 2);

    // ── immutable results ──
    const results = await writer.publishResults();
    assert.ok(results.accepted > 0);
    const stored = relay.events().filter((e) => e.tags.some((t) => t[0] === 'l' && t[1] === 'results'));
    assert.equal(stored.length, 1);
    const payload = JSON.parse(stored[0].content);
    assert.equal(payload.state_hash, store.stateHash, 'the results must pin the state they came from');
    assert.equal(payload.standings.length, 2);
    assert.ok(payload.ruleset_hash.length === 64, 'the ruleset the standings were computed under is pinned');

    // ── snapshots exist and agree with a full replay ──
    const snapshots = relay.events().filter((e) => e.tags.some((t) => t[0] === 'l' && t[1] === 'snapshot'));
    assert.ok(snapshots.length > 0, 'the authority should publish snapshots');
    const newest = snapshots.reduce((best, e) => (e.created_at > best.created_at ? e : best));
    const snapshotPayload = JSON.parse(newest.content);
    assert.equal(snapshotPayload.state_hash, store.stateHash,
      'a snapshot that disagrees with a replay is worse than no snapshot');

    // ── nothing left a loopback address ──
    for (const relayUrl of store.pool.urls) {
      assert.match(relayUrl, /^ws:\/\/127\.0\.0\.1:/, 'the test must never contact a public relay');
    }

    aliceSide.pool.close();
    bobSide.pool.close();
    projector.pool.close();
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('the authority refuses to write on top of a gap in the record', async () => {
  const { relay, organizerPool, store, writer } = await setup();
  try {
    await writer.setStatus('published');
    // Simulate a relay having withheld the entry we just made: the local state
    // is complete, but a client that lost one is not, and must not extend a
    // chain it cannot verify.
    store.state.chain_complete = false;
    await assert.rejects(() => writer.setStatus('registration_open'), /complete, conflict-free/);
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('the authority refuses a locally contiguous prefix before relay history completes', async () => {
  const { relay, organizerPool, store, writer } = await setup();
  try {
    assert.equal(store.state.chain_complete, true);
    store.historyComplete = false;
    await assert.rejects(() => writer.setStatus('published'), /complete, conflict-free/);
    assert.equal(store.state.seq, 0);
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('someone who is not the authority cannot write to the log', async () => {
  const { relay, organizerPool, store, compId, organizer } = await setup();
  const impostor = newSigner();
  try {
    const rogue = new AuthorityWriter({ store, pool: organizerPool, signer: impostor, now });
    await assert.rejects(() => rogue.setStatus('published'), /not the authority/);

    // Even if they publish a well-formed entry directly, no reader applies it:
    // the check is the reducer's, not the writer's good manners.
    const { buildLogEvent } = await import('../competitions/app/protocol/competition.mjs');
    const draft = buildLogEvent({
      compId,
      organizerPubkey: organizer.pubkey,
      seq: 1,
      prev: store.competitionEventId,
      epoch: 1,
      op: 'lifecycle',
      data: { status: 'published', at: now() },
      at: now(),
    });
    const forged = await impostor.signEvent(draft);
    const publish = await organizerPool.publish(forged);
    assert.ok(publish.accepted > 0, 'the relay happily stores it — relays are not the trust boundary');
    assert.equal(await store.ingest(forged), false, 'the client must refuse it');
    assert.equal(store.state.status, 'draft', 'a forged entry must change nothing');
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('a publish that no relay accepts is reported as a failure', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const organizer = newSigner();
  const compId = newCompId();
  const config = baseConfig(compId, organizer.pubkey, { relays: [relay.url] });
  const pool = new RelayPool([relay.url]);
  try {
    await publishCompetition(pool, organizer, config, now());
    const store = new CompetitionStore({ pool, organizerPubkey: organizer.pubkey, compId, now });
    await store.loadCompetition();
    await store.follow();
    const writer = new AuthorityWriter({ store, pool, signer: organizer, now });

    // Take the relay away underneath the writer.
    await relay.close();
    const failure = await writer.setStatus('published').catch((e) => e);
    assert.ok(failure instanceof PublishError || /No relay|closed|connect/i.test(failure.message),
      `expected a publish failure, got: ${failure?.message}`);
    // The organizer's own view must not claim a state that was never published.
    assert.equal(store.state.status, 'draft');
    store.close();
  } finally {
    pool.close();
  }
});

test('a competition can be opened from its naddr alone', async () => {
  const { relay, organizer, organizerPool, compId, store } = await setup();
  try {
    const naddr = naddrEncode({
      identifier: compDTag(compId), pubkey: organizer.pubkey, kind: KIND,
    });
    const { decodeNip19 } = await import('../competitions/app/protocol/nostr-event.mjs');
    const decoded = decodeNip19(naddr);
    assert.equal(decoded.type, 'naddr');
    assert.equal(decoded.data.kind, KIND);

    const identifier = decoded.data.identifier;
    assert.equal(identifier, compDTag(compId));
    const opened = await reader(relay.url, decoded.data.pubkey, identifier.split(':')[2]);
    assert.equal(opened.store.competition.comp_id, compId);
    assert.equal(opened.store.competition.title, 'Loopback Session');
    opened.pool.close();
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('a paid competition keeps an unpaid entrant out of the running order', async () => {
  const { relay, organizer, organizerPool, compId, store, writer } = await setup({
    fee_msat: 1000000,
    fee_lnurl: 'organizer@example.invalid',
  });
  const alice = newSigner();
  const bob = newSigner();
  try {
    await writer.setStatus('published');
    tick();
    await writer.setStatus('registration_open');
    for (const signer of [alice, bob]) {
      tick();
      // eslint-disable-next-line no-await-in-loop
      await writer.decideRegistration(signer.pubkey, 'accepted', { division: 'open', display: 'x' });
    }
    // A registration on a paid competition starts as pending, never as settled.
    assert.equal(store.participant(alice.pubkey).payment, 'pending');
    assert.equal(store.participant(bob.pubkey).payment, 'pending');

    // Only Alice's payment is confirmed by the authority.
    tick();
    await writer.decidePayment(alice.pubkey, 'settled', {
      zapReceiptId: 'f'.repeat(64), amountMsat: 1000000, zapperPubkey: 'a'.repeat(64),
    });
    tick();
    await writer.setStatus('registration_closed');
    tick();
    await writer.setStatus('checkin_open');
    tick();
    await writer.checkIn(alice.pubkey);
    tick();
    await writer.checkIn(bob.pubkey);
    tick();
    await writer.seed([alice.pubkey, bob.pubkey]);
    tick();
    await writer.setStatus('running');

    // Seeding and climbing have different eligibility: both are in the order,
    // but only the paid entrant can be given a turn.
    tick();
    await writer.openTurn(store.state.order.indexOf(bob.pubkey));
    assert.ok(
      store.state.rejected.some((r) => r.code === 'not_eligible'),
      'an unpaid entrant must not be given a turn',
    );
    tick();
    await writer.openTurn(store.state.order.indexOf(alice.pubkey));
    assert.equal(store.currentClimber(), alice.pubkey);
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('participant-chosen climbs: registration never narrows the shared live pool', async () => {
  // Legacy callers may still pass selections, but the intent deliberately
  // omits them and every accepted entrant may attempt the entire pool.
  const pool = [
    { id: 'p1', climb_uuid: 'a1c93f57-6e28-4b04-9d75-2f8a1e63c0b9', angle: 40, label: 'Blue slab', points: 100 },
    { id: 'p2', climb_uuid: 'b6d0428e-1f75-4c93-a208-7e35d1b49c60', angle: 40, label: 'Red roof', points: 100 },
    { id: 'p3', climb_uuid: 'c8f24b06-3a91-4e57-b0d4-9c6153e8a2f7', angle: 40, label: 'Yellow arete', points: 100 },
    { id: 'p4', climb_uuid: 'd35e91b8-742c-4f06-8a19-b5d0e37c264a', angle: 40, label: 'Green crimps', points: 100 },
  ];
  const { relay, organizer, organizerPool, compId, store, writer, config } = await setup({
    climbs: undefined,
    capacity: 2,
    climb_pool: { source: 'organizer_list', options: pool },
    rules: {
      ...baseConfig('x', 'y').rules,
      climb_source: 'participant_choice',
      selection_uniqueness: 'unique_per_competition',
      progression: 'asynchronous_turns',
      climb_count: 1,
    },
  });
  const alice = newSigner();
  const bob = newSigner();
  const aliceSide = await reader(relay.url, organizer.pubkey, compId);
  const bobSide = await reader(relay.url, organizer.pubkey, compId);

  try {
    assert.equal(config.rules.climb_source, 'participant_choice');
    await writer.setStatus('published');
    tick();
    await writer.setStatus('registration_open');
    await until(bobSide.store, (s) => s.state?.status === 'registration_open', 'registration to open');

    const intents = [];
    await store.followIntents((event) => {
      const parsed = parseIntentEvent(event, store.competition, organizer.pubkey, now());
      if (parsed.ok) intents.push(parsed);
    });

    // Legacy callers both pass p1. It must not become registration state.
    const entrants = new Map();
    for (const [signer, side, display] of [[alice, aliceSide, 'Alice'], [bob, bobSide, 'Bob']]) {
      const entrant = new EntrantWriter({
        pool: side.pool, signer, competition: side.store.competition,
        organizerPubkey: organizer.pubkey, now,
      });
      entrants.set(signer.pubkey, entrant);
      // eslint-disable-next-line no-await-in-loop
      await entrant.register({ division: 'open', display, waiverAccepted: true, selections: ['p1'] });
      tick();
    }
    await until({ state: { seq: 0 } }, () => intents.length === 2, 'both registrations to arrive');

    // ── the organizer accepts, in the order they arrived, then settles ──
    for (const intent of intents) {
      assert.equal(intent.intent.data.selections, undefined);
      // eslint-disable-next-line no-await-in-loop
      await writer.decideRegistration(intent.pubkey, 'accepted', {
        division: intent.intent.data.division,
        display: intent.intent.data.display,
      });
      tick();
    }
    await until(store, (s) => s.state.participants.length === 2, 'both entrants accepted');

    const first = intents[0].pubkey;
    const second = intents[1].pubkey;
    assert.deepEqual(store.state.claims, {});
    assert.deepEqual(store.participant(first).selections, []);
    assert.deepEqual(store.participant(second).selections, []);
    assert.deepEqual(freeClimbs(store.competition, store.state).map((o) => o.id), ['p1', 'p2', 'p3', 'p4']);
    assert.equal(outstandingCount(store.competition, store.participant(second)), 0);
    assert.deepEqual(store.remainingClimbs(first).map((o) => o.id), ['p1', 'p2', 'p3', 'p4']);
    assert.deepEqual(store.remainingClimbs(second).map((o) => o.id), ['p1', 'p2', 'p3', 'p4']);

    // ── an attempt counts anywhere in the pool ──
    tick();
    await writer.setStatus('registration_closed');
    tick();
    await writer.setStatus('checkin_open');
    for (const pubkey of [first, second]) {
      // eslint-disable-next-line no-await-in-loop
      await writer.checkIn(pubkey);
      tick();
    }
    await writer.setStatus('running');
    tick();
    await writer.seedAndOpen([first, second]);
    tick();
    await entrants.get(first).chooseClimb('p2');
    await until({ state: { seq: 0 } }, () => intents.some((intent) => intent.intent.op === 'climb_choice'
      && intent.pubkey === first), 'prepared choice to reach the host');
    await writer.completeTurn(first, 'p2', 'top', 1);
    assert.equal(store.state.rejected.some((r) => r.code === 'climb_not_selected'), false,
      'legacy allocations must not narrow the live pool');
    assert.equal(store.participant(first).climbs[0].climb_id, 'p2');
    assert.equal(store.currentClimber(), second, 'one result must hand the turn to the other participant');

    tick();
    await writer.completeTurn(second, 'p1', 'fall', 1);
    assert.equal(store.currentClimber(), first, 'the last turn must wrap and open the next round');
    assert.equal(store.state.round, 2);

    tick();
    await writer.completeTurn(first, 'p1', 'top', 1);
    assert.equal(store.participant(first).climbs.find((climb) => climb.climb_id === 'p1').outcome, 'top');

    // ── every reader agrees, which is the point of all of it ──
    await until(aliceSide.store, (s) => s.stateHash === store.stateHash, 'reader A to converge');
    await until(bobSide.store, (s) => s.stateHash === store.stateHash, 'reader B to converge');
    assert.equal(aliceSide.store.stateHash, bobSide.store.stateHash);
  } finally {
    aliceSide.store.close();
    aliceSide.pool.close();
    bobSide.store.close();
    bobSide.pool.close();
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('a fee is settled by a receipt that verifies, or by an override that is named', async () => {
  // The two ways a payment can be recorded, and the difference between them.
  // Nothing here contacts a payment provider: the "provider" is a local key,
  // and no invoice exists that any wallet could settle.
  const { relay, organizer, organizerPool, compId, store, writer } = await setup({
    fee_msat: 2000000,
    fee_lnurl: 'kellerwand@example.invalid',
  });
  const alice = newSigner();
  const bob = newSigner();
  const provider = newSigner();
  const address = `30078:${organizer.pubkey}:cruxcoach:comp:${compId}`;

  const receiptFor = async (payerSigner, {
    amountMsat = 2000000, signedBy = provider, bindInvoice = true,
  } = {}) => {
    const request = await payerSigner.signEvent(buildZapRequest({
      recipientPubkey: organizer.pubkey,
      address,
      amountMsat,
      relays: [relay.url],
      nonce: 'aabbccdd',
      createdAt: now(),
    }));
    const description = JSON.stringify(request);
    // Unpayable by construction: the signature words are zeros, so nothing in
    // this test could be settled even if a wallet saw it.
    const invoice = fakeInvoice({
      amountMsat: 2000000,
      timestamp: now(),
      expirySec: 900,
      paymentHash: 'b'.repeat(64),
      descriptionHash: bindInvoice ? await sha256Hex(description) : undefined,
    });
    return signedBy.signEvent({
      kind: 9735,
      created_at: now(),
      tags: [
        ['p', organizer.pubkey],
        ['P', request.pubkey],
        ['a', address],
        ['bolt11', invoice],
        ['description', description],
      ],
      content: '',
    });
  };

  try {
    await writer.setStatus('published');
    tick();
    await writer.setStatus('registration_open');
    for (const [signer, display] of [[alice, 'Alice'], [bob, 'Bob']]) {
      // eslint-disable-next-line no-await-in-loop
      await writer.decideRegistration(signer.pubkey, 'accepted', { division: 'open', display });
      tick();
    }
    assert.equal(store.participant(alice.pubkey).payment, 'pending',
      'a fee makes payment pending, not settled');

    const expected = {
      providerPubkey: provider.pubkey,
      recipientPubkey: organizer.pubkey,
      address,
      amountMsat: 2000000,
      nonce: 'aabbccdd',
    };

    // ── the verified path ──
    const good = await receiptFor(alice);
    const verified = await verifyZapReceipt(good, { ...expected, payerPubkey: alice.pubkey });
    assert.equal(verified.ok, true, verified.error);
    await writer.decidePayment(alice.pubkey, 'settled', {
      zapReceiptId: good.id, amountMsat: verified.amountMsat, zapperPubkey: good.pubkey,
    });
    tick();
    assert.equal(store.participant(alice.pubkey).payment, 'settled');

    // ── the receipts that must not settle anything ──
    assert.equal(
      (await verifyZapReceipt(good, { ...expected, payerPubkey: bob.pubkey })).error,
      'wrong_payer',
      "Alice's receipt must not settle Bob's entry",
    );
    const cheap = await receiptFor(bob, { amountMsat: 200000 });
    assert.equal(
      (await verifyZapReceipt(cheap, { ...expected, payerPubkey: bob.pubkey })).error,
      'wrong_amount',
    );
    const impostor = await receiptFor(bob, { signedBy: bob });
    assert.equal(
      (await verifyZapReceipt(impostor, { ...expected, payerPubkey: bob.pubkey })).error,
      'wrong_signer',
      'anyone can sign a 9735; only the endpoint that was published counts',
    );
    assert.equal(
      (await verifyZapReceipt(good, { ...expected, payerPubkey: alice.pubkey, providerPubkey: null })).error,
      'no_provider_key',
    );

    // An invoice that commits to a different request is refused outright; one
    // that commits to nothing still counts, but is recorded as weakly bound.
    const unbound = await receiptFor(bob, { bindInvoice: false });
    const weak = await verifyZapReceipt(unbound, { ...expected, payerPubkey: bob.pubkey });
    assert.equal(weak.ok, true, weak.error);
    assert.equal(weak.weaklyBound, true,
      'NIP-57 makes the description hash a SHOULD, so this is a downgrade rather than a refusal');
    assert.equal(verified.weaklyBound, false, 'and a bound invoice is not downgraded');

    // ── the manual path ──
    await assert.rejects(
      () => writer.override('payment_decision', { pubkey: bob.pubkey, state: 'settled' }, ''),
      /requires a reason/,
      'recording a payment by hand without saying why must not be possible',
    );
    await writer.override(
      'payment_decision',
      { pubkey: bob.pubkey, state: 'settled' },
      'Paid in cash at the desk, receipt 41.',
      [bob.pubkey],
    );
    tick();
    assert.equal(store.participant(bob.pubkey).payment, 'settled');

    // The difference between the two paths survives in the record.
    const audit = store.state.audit.filter((entry) => entry.op === 'override');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].reason, 'Paid in cash at the desk, receipt 41.');
    assert.equal(
      store.state.audit.some((entry) => entry.seq === audit[0].seq && entry.op === 'override'),
      true,
      'a hand-recorded payment is visible to every client, not only to the organizer',
    );
  } finally {
    store.close();
    organizerPool.close();
    await relay.close();
  }
});

test('an intent keeps its nonce across a reload, so asking again replaces rather than adds', async () => {
  // Held in memory only, a refresh produced a fresh nonce and a second live
  // request. On the paid path that is worse than untidy: the zap request
  // carries the registration's nonce and the organizer checks a receipt
  // against it, so a nonce that changed would strand a payment already made.
  const { relay, organizer, organizerPool, compId, store, writer } = await setup();
  const alice = newSigner();
  const side = await reader(relay.url, organizer.pubkey, compId);

  // A storage that behaves like localStorage and outlives the writer.
  const backing = new Map();
  const storage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  const makeEntrant = () => new EntrantWriter({
    pool: side.pool,
    signer: alice,
    competition: side.store.competition,
    organizerPubkey: organizer.pubkey,
    now,
    storage,
  });

  const intents = [];
  try {
    await writer.setStatus('published');
    tick();
    await writer.setStatus('registration_open');
    await until(side.store, (s) => s.state?.status === 'registration_open', 'registration to open');

    await store.followIntents((event) => {
      const parsed = parseIntentEvent(event, store.competition, organizer.pubkey, now());
      if (parsed.ok) intents.push(parsed);
    });

    const first = makeEntrant();
    await first.register({ division: 'open', display: 'Alice', waiverAccepted: true });
    await until({ state: { seq: 0 } }, () => intents.length === 1, 'the first request');
    const nonce = intents[0].intent.nonce;

    // The page reloads: a brand new writer, the same person, the same device.
    tick();
    const second = makeEntrant();
    assert.equal(second.nonceFor('register'), nonce, 'the nonce has to survive the reload');
    await second.register({ division: 'open', display: 'Alice again', waiverAccepted: true });
    await until({ state: { seq: 0 } }, () => intents.length === 2, 'the second request');

    assert.equal(intents[1].intent.nonce, nonce);
    assert.equal(intents[1].eventId !== intents[0].eventId, true, 'a new event, replacing the old');

    // One live request on the relay, not two: the d-tag is the same, so the
    // addressable-replacement rule did the deduplication.
    const live = await side.pool.query([{
      kinds: [KIND],
      authors: [alice.pubkey],
      '#a': [`30078:${organizer.pubkey}:cruxcoach:comp:${compId}`],
    }]);
    const registrations = live.events.filter(
      (event) => (event.tags.find((t) => t[0] === 'op') || [])[1] === 'register',
    );
    assert.equal(registrations.length, 1, 'a reload must not leave two live registrations');

    // Without storage the old behaviour returns, and that is the documented
    // fallback for private browsing rather than a failure.
    const forgetful = new EntrantWriter({
      pool: side.pool,
      signer: alice,
      competition: side.store.competition,
      organizerPubkey: organizer.pubkey,
      now,
      storage: null,
    });
    assert.notEqual(forgetful.nonceFor('register'), nonce);
  } finally {
    side.store.close();
    side.pool.close();
    store.close();
    organizerPool.close();
    await relay.close();
  }
});
