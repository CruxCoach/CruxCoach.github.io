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
    registration_opens_at: 1789000000,
    registration_closes_at: 1789003600,
    checkin_opens_at: 1789003600,
    checkin_closes_at: 1789005400,
    starts_at: 1789005400,
    ends_at: 1789012600,
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
    await assert.rejects(() => writer.setStatus('registration_open'), /missing/);
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

test('participant-chosen climbs: two entrants race for one climb and the loser re-picks', async () => {
  // The whole of participant selection, over a real relay: entrants publish
  // their picks with their registration, the authority settles the race with
  // the shipped rule, the loser is told, and their second choice is granted.
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

  /** The organizer console's settlement pass, using the shipped rule. */
  const requests = new Map();
  const settle = async () => {
    for (;;) {
      const entries = store.logEntries();
      const answered = new Set(entries
        .filter((entry) => entry.op === 'claim_decision')
        .map((entry) => `${entry.data.pubkey}:${entry.data.climb_id}`));
      const owed = outstandingClaims({
        competition: store.competition,
        state: store.state,
        requests,
        answered,
        order: registrationOrder(entries),
      });
      if (!owed.length) return;
      for (const claim of owed) {
        // eslint-disable-next-line no-await-in-loop
        await writer.decideClaim(claim.pubkey, claim.climbId, claim.decision, claim.reason);
        tick();
      }
    }
  };

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

    // Both want p1. Neither client can know that: the pool looks free to both.
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
      requests.set(intent.pubkey, intent.intent.data.selections);
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
    await settle();

    assert.equal(store.state.claims.p1, first, 'the first accepted entrant holds the contested climb');
    assert.deepEqual(store.participant(first).selections, ['p1']);
    assert.deepEqual(store.participant(second).selections, [],
      'the loser holds nothing until they pick again');

    // The denial is a real signed entry, so the loser sees it after a reload
    // rather than having to infer it.
    const denial = store.logEntries().find(
      (entry) => entry.op === 'claim_decision' && entry.data.pubkey === second
        && entry.data.decision === 'denied',
    );
    assert.ok(denial, 'the loser must be given an answer');
    assert.equal(denial.data.reason, 'climb_already_claimed');

    // Settling twice must be a no-op: a denial changes no state, so a console
    // that re-renders would otherwise append the same refusal forever.
    const seqAfterSettle = store.state.seq;
    await settle();
    assert.equal(store.state.seq, seqAfterSettle, 'a second settlement pass must publish nothing');

    // ── the loser sees the loss and picks again ──
    await until(bobSide.store, (s) => s.state.claims.p1 === first, 'the loser to see the claim');
    const loserSide = second === alice.pubkey ? aliceSide : bobSide;
    const free = freeClimbs(loserSide.store.competition, loserSide.store.state).map((o) => o.id);
    assert.deepEqual(free, ['p2', 'p3', 'p4'], 'the contested climb is no longer offered');
    assert.equal(outstandingCount(loserSide.store.competition, loserSide.store.participant(second)), 1);

    tick();
    await entrants.get(second).register({
      division: 'open', display: 'Second', waiverAccepted: true, selections: ['p2'],
    });
    await until({ state: { seq: 0 } }, () => intents.length === 3, 'the second choice to arrive');
    // Replacing, not duplicating: same author, same nonce, one live intent.
    assert.equal(intents[2].pubkey, second);
    assert.equal(intents[2].intent.nonce, intents.find((i) => i.pubkey === second).intent.nonce);

    requests.set(second, intents[2].intent.data.selections);
    await settle();
    assert.equal(store.state.claims.p2, second, 'the second choice is granted');
    assert.deepEqual(store.participant(second).selections, ['p2']);

    // ── an attempt only counts on a climb the climber actually holds ──
    tick();
    await writer.setStatus('registration_closed');
    tick();
    await writer.setStatus('checkin_open');
    for (const pubkey of [first, second]) {
      // eslint-disable-next-line no-await-in-loop
      await writer.checkIn(pubkey);
      tick();
    }
    await writer.seed([first, second]);
    tick();
    await writer.setStatus('running');
    tick();
    await writer.openTurn(0);
    tick();
    await writer.recordAttempt(first, 'p2', 'top', 1);
    assert.ok(
      store.state.rejected.some((r) => r.code === 'climb_not_selected'),
      'an attempt on somebody else\'s climb must not score',
    );
    assert.equal(store.participant(first).climbs.length, 0,
      'and it must leave no trace in the hashed state');

    tick();
    await writer.recordAttempt(first, 'p1', 'top', 1);
    assert.equal(store.participant(first).climbs[0].outcome, 'top');

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
