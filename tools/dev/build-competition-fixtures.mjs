#!/usr/bin/env node
/**
 * Generate the canonical cross-client fixture set for FEAT-058.
 *
 * The output is the shared contract between this repository and the Android
 * app: both replay the same signed event streams and must arrive at the same
 * `state_hash`. If the two ever disagree, one of them is wrong and the test
 * says which stream exposed it.
 *
 *   node tools/dev/build-competition-fixtures.mjs            # write + report
 *   node tools/dev/build-competition-fixtures.mjs --check    # fail if stale
 *
 * Determinism is not incidental. Every key is derived from a fixed label, every
 * timestamp is a literal, and Schnorr signing is given an all-zero auxiliary
 * random value, so re-running this produces byte-identical files and a rebuild
 * never shows up as a spurious diff.
 *
 * THE KEYS BELOW ARE TEST KEYS. They are derived from public strings in this
 * file, they are in a public repository, and anything signed with them is
 * worthless. Never use them for anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schnorr } from '../../assets/vendor/nostr-crypto/secp256k1/secp256k1.js';
import {
  bytesToHex, hexToBytes, eventId, getPublicKey, naddrEncode, serializeEvent,
} from '../../competitions/app/protocol/nostr-event.mjs';
import { ccj, ccjHash, sha256Hex } from '../../competitions/app/protocol/ccj.mjs';
import {
  buildCompetitionEvent, buildIntentEvent, buildLogEvent, buildResultsEvent,
  buildSnapshotEvent, compDTag, competitionAddress, intentDTag, logDTag,
  parseDTag, parseCompetitionEvent, parseLogEvent, KIND,
} from '../../competitions/app/protocol/competition.mjs';
import { hashableState, reduce } from '../../competitions/app/protocol/reduce.mjs';
import { isAllowedRelayUrl, isLoopbackRelay } from '../../competitions/app/protocol/relay-url.mjs';
import { computeStandings } from '../../competitions/app/protocol/scoring.mjs';
import { fakeInvoice } from './fake-invoice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outDir = path.join(repoRoot, 'competitions/fixtures');

const ZERO_AUX = new Uint8Array(32);
const encoder = new TextEncoder();

/** Deterministic test key from a fixed label. Public by design. */
async function testKey(label) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`cruxcoach-competition-fixture/v1/${label}`),
  );
  const sk = new Uint8Array(digest);
  return { label, sk, pk: getPublicKey(sk) };
}

async function sign(draft, key) {
  const event = {
    pubkey: key.pk,
    created_at: draft.created_at,
    kind: draft.kind,
    tags: draft.tags,
    content: draft.content,
  };
  event.id = await eventId(event);
  event.sig = bytesToHex(await schnorr.signAsync(hexToBytes(event.id), key.sk, ZERO_AUX));
  return event;
}

// ── the scenario builder ──

class Log {
  constructor(compId, organizerPubkey, authorityKey, rootId, epoch = 1) {
    this.compId = compId;
    this.organizerPubkey = organizerPubkey;
    this.key = authorityKey;
    this.prev = rootId;
    this.seq = 0;
    this.epoch = epoch;
    this.events = [];
  }

  async add(op, data, at, extra = {}) {
    this.seq += 1;
    const draft = buildLogEvent({
      compId: this.compId,
      organizerPubkey: this.organizerPubkey,
      seq: this.seq,
      prev: this.prev,
      epoch: this.epoch,
      op,
      data,
      at,
      ...extra,
    });
    const event = await sign(draft, this.key);
    this.events.push(event);
    this.prev = event.id;
    return event;
  }

  /** Sign a competing entry at the CURRENT seq without advancing the chain. */
  async fork(op, data, at, extra = {}) {
    const draft = buildLogEvent({
      compId: this.compId,
      organizerPubkey: this.organizerPubkey,
      seq: this.seq,
      prev: this.events.at(-1) ? this.events.at(-1).tags.find((t) => t[0] === 'prev')[1] : this.prev,
      epoch: this.epoch,
      op,
      data,
      at,
      ...extra,
    });
    const event = await sign(draft, this.key);
    this.events.push(event);
    return event;
  }
}

function baseConfig({ compId, authority, overrides = {} }) {
  return {
    comp_id: compId,
    authority,
    authority_epoch: 1,
    title: 'Kellerwand Winter Session',
    summary: 'Five problems, three attempts each, one evening.',
    description: 'A friendly in-house session on the Kilter board at 40 degrees.',
    organizer: { name: 'Kellerwand Bouldern', contact: 'kellerwand@example.org' },
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
    venue: { kind: 'physical', name: 'Kellerwand Bouldern', address: 'Beispielweg 3, Berlin' },
    board: { brand: 'kilter', model: 'kilterboard-og', layout_id: 1, size: '12x12', angle: 40 },
    divisions: [{ id: 'open', label: 'Open' }],
    eligibility: 'Open to everyone who has climbed here before.',
    waiver: 'I understand that climbing is dangerous and I climb at my own risk.',
    waiver_required: true,
    participant_instructions: 'Arrive twenty minutes early and warm up on the slab.',
    spectator_info: 'Free entry. The live screen is by the entrance.',
    refund_policy: 'Full refund until 24 hours before the start.',
    fee_msat: 0,
    prizes: [{ rank: 1, kind: 'non_cash', label: 'Chalk bag' }],
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
      { id: 'c1', climb_uuid: '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061', angle: 40, label: 'Qualifier 1', points: 100 },
      { id: 'c2', climb_uuid: '7b2e9d15-4c8a-4f36-8d52-1e9a3b7c4d08', angle: 40, label: 'Qualifier 2', points: 150 },
    ],
    relays: ['wss://relay.example.invalid'],
    created_at: 1788900000,
    revision: 1,
    ...overrides,
  };
}

async function finish(name, description, competitionEvent, log, extras = {}) {
  const parsed = parseCompetitionEvent(competitionEvent, 1789020000);
  if (!parsed.ok) throw new Error(`${name}: own competition event failed to parse: ${parsed.error}`);

  const entries = [];
  for (const event of log.events) {
    const result = parseLogEvent(event, parsed.competition, parsed.organizerPubkey, 1789020000);
    if (!result.ok) throw new Error(`${name}: own log entry failed to parse: ${result.error}`);
    entries.push(result);
  }

  const { state, chainBreakAt } = reduce({
    competition: parsed.competition,
    competitionEventId: competitionEvent.id,
    entries,
  });
  const stateHash = await ccjHash(hashableState(state));
  const standings = computeStandings(state, parsed.competition);

  return {
    name,
    description,
    schema: 'cruxcoach-competition/1',
    competition_event: competitionEvent,
    log_events: log.events,
    expected: {
      chain_break_at: chainBreakAt,
      state_hash: stateHash,
      state: hashableState(state),
      standings,
    },
    ...extras,
  };
}

// ── streams ──

async function streamHappySync(keys) {
  const compId = '9f2c41ab77e05d13';
  const config = baseConfig({ compId, authority: keys.organizer.pk });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  const climbers = [keys.alice, keys.bob, keys.carla];
  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  for (const [i, climber] of climbers.entries()) {
    await log.add('registration_decision', {
      pubkey: climber.pk, decision: 'accepted', division: 'open', display: climber.label,
    }, 1789000100 + i, { subjects: [climber.pk] });
  }
  await log.add('lifecycle', { status: 'registration_closed', at: 1789003600 }, 1789003600);
  await log.add('lifecycle', { status: 'checkin_open', at: 1789003700 }, 1789003700);
  for (const [i, climber] of climbers.entries()) {
    await log.add('checkin', { pubkey: climber.pk, state: 'checked_in' }, 1789003800 + i, { subjects: [climber.pk] });
  }

  // Seeded order is data in the log (§9.1); computed here with the documented
  // default rule so the fixture also pins that rule.
  const seeded = await seedOrder(compId, climbers.map((c) => c.pk));
  await log.add('queue', { action: 'seed', order: seeded }, 1789005300);
  await log.add('lifecycle', { status: 'running', at: 1789005400 }, 1789005400);
  await log.add('announcement', { text: 'Climb 1 is open. Three attempts each.' }, 1789005410);

  let clock = 1789005500;
  const outcomes = {
    c1: { [keys.alice.pk]: ['top'], [keys.bob.pk]: ['fall', 'top'], [keys.carla.pk]: ['fall', 'fall', 'fall'] },
    c2: { [keys.alice.pk]: ['fall', 'zone'], [keys.bob.pk]: ['top'], [keys.carla.pk]: ['fall', 'top'] },
  };
  for (const climbId of ['c1', 'c2']) {
    if (climbId !== 'c1') {
      await log.add('queue', { action: 'next_climb', climb_id: climbId }, (clock += 30));
      await log.add('queue', { action: 'next_round' }, (clock += 5));
      await log.add('queue', { action: 'seed', order: seeded }, (clock += 5));
    }
    for (const [index, pubkey] of seeded.entries()) {
      await log.add('queue', { action: 'open_turn', index }, (clock += 20));
      const attempts = outcomes[climbId][pubkey];
      for (const [n, outcome] of attempts.entries()) {
        await log.add('attempt_result', {
          pubkey, climb_id: climbId, outcome, attempt_no: n + 1,
        }, (clock += 25), { subjects: [pubkey] });
      }
      await log.add('queue', { action: 'close_turn' }, (clock += 5));
    }
  }
  await log.add('lifecycle', { status: 'finished', at: (clock += 60) }, clock);

  return finish(
    'happy-sync',
    'Organizer-set climbs, synchronous rounds, no fee, three climbers, clean run to finish.',
    competitionEvent,
    log,
  );
}

async function streamDeferAndTimeout(keys) {
  const compId = 'a1b2c3d4e5f60718';
  const config = baseConfig({
    compId,
    authority: keys.organizer.pk,
    overrides: { title: 'Defer rule exercise' },
  });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);
  const climbers = [keys.alice, keys.bob, keys.carla, keys.dan];

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  for (const [i, climber] of climbers.entries()) {
    await log.add('registration_decision', {
      pubkey: climber.pk, decision: 'accepted', division: 'open', display: climber.label,
    }, 1789000100 + i, { subjects: [climber.pk] });
  }
  await log.add('lifecycle', { status: 'registration_closed', at: 1789003600 }, 1789003600);
  await log.add('lifecycle', { status: 'checkin_open', at: 1789003700 }, 1789003700);
  for (const [i, climber] of climbers.entries()) {
    await log.add('checkin', { pubkey: climber.pk, state: 'checked_in' }, 1789003800 + i, { subjects: [climber.pk] });
  }
  const seeded = await seedOrder(compId, climbers.map((c) => c.pk));
  await log.add('queue', { action: 'seed', order: seeded }, 1789005300);
  await log.add('lifecycle', { status: 'running', at: 1789005400 }, 1789005400);

  const first = seeded[0];
  let clock = 1789005500;
  await log.add('queue', { action: 'open_turn', index: 0 }, clock);
  // Granted defer: moves back exactly defer_slots, never to the end.
  await log.add('defer_decision', { pubkey: first, decision: 'granted' }, (clock += 10), { subjects: [first] });
  // Second defer in succession is refused by the reducer, not merely by the UI.
  await log.add('defer_decision', { pubkey: first, decision: 'granted' }, (clock += 5), { subjects: [first] });

  const afterDefer = [...seeded];
  afterDefer.splice(0, 1);
  afterDefer.splice(Math.min(0 + 2, seeded.length - 1), 0, first);

  await log.add('queue', { action: 'open_turn', index: 0 }, (clock += 10));
  await log.add('attempt_result', {
    pubkey: afterDefer[0], climb_id: 'c1', outcome: 'top', attempt_no: 1,
  }, (clock += 20), { subjects: [afterDefer[0]] });
  await log.add('queue', { action: 'close_turn' }, (clock += 5));

  // Turn deadline expires with nothing recorded → timeout consumes an attempt.
  await log.add('queue', { action: 'open_turn', index: 1 }, (clock += 10));
  await log.add('attempt_result', {
    pubkey: afterDefer[1], climb_id: 'c1', outcome: 'timeout', attempt_no: 1,
  }, (clock += 130), { subjects: [afterDefer[1]] });
  await log.add('queue', { action: 'close_turn' }, (clock += 5));

  // The deferrer takes their moved slot and climbs normally.
  await log.add('queue', { action: 'open_turn', index: 2 }, (clock += 10));
  await log.add('attempt_result', {
    pubkey: afterDefer[2], climb_id: 'c1', outcome: 'fall', attempt_no: 1,
  }, (clock += 20), { subjects: [afterDefer[2]] });
  await log.add('attempt_result', {
    pubkey: afterDefer[2], climb_id: 'c1', outcome: 'top', attempt_no: 2,
  }, (clock += 20), { subjects: [afterDefer[2]] });
  await log.add('queue', { action: 'close_turn' }, (clock += 5));

  return finish(
    'defer-and-timeout',
    'A granted deferral moves back exactly two slots; a second consecutive one is rejected; '
    + 'an expired turn is recorded as a timeout that consumes an attempt.',
    competitionEvent,
    log,
  );
}

async function streamPaidUniqueAsync(keys) {
  const compId = 'bb00cc11dd22ee33';
  const config = baseConfig({
    compId,
    authority: keys.organizer.pk,
    overrides: {
      title: 'Pick-your-own, paid entry',
      fee_msat: 2000000,
      fee_lnurl: 'kellerwand@example.invalid',
      climbs: undefined,
      // A real pool of real climbs. Entrants pick from these, and with
      // `unique_per_competition` there have to be enough for everyone to get a
      // full set — see the validation in competition.mjs.
      climb_pool: {
        source: 'organizer_list',
        options: [
          { id: 'c1', climb_uuid: '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061', angle: 40, label: 'Blue slab', points: 100 },
          { id: 'c2', climb_uuid: '7b2e9d15-4c8a-4f36-8d52-1e9a3b7c4d08', angle: 40, label: 'Red roof', points: 150 },
          { id: 'c3', climb_uuid: 'c41d7a90-2f63-4b85-9e17-6a0d8c3f2b54', angle: 40, label: 'Yellow arete', points: 120 },
          { id: 'c4', climb_uuid: '9e05b3c7-8a14-4d62-b73f-5c1e920a7d86', angle: 40, label: 'Green crimps', points: 130 },
        ],
      },
      capacity: 2,
      rules: {
        ...baseConfig({ compId, authority: keys.organizer.pk }).rules,
        climb_source: 'participant_choice',
        selection_uniqueness: 'unique_per_competition',
        progression: 'asynchronous_turns',
        scoring: 'tops_then_attempts',
        climb_count: 1,
      },
    },
  });
  delete config.climbs;
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  for (const climber of [keys.alice, keys.bob]) {
    await log.add('registration_decision', {
      pubkey: climber.pk, decision: 'accepted', division: 'open', display: climber.label,
    }, 1789000100, { subjects: [climber.pk] });
  }
  // Alice claims c1 first; Bob's claim for the same climb must be refused by
  // every client's reducer, not merely by the organizer remembering.
  await log.add('claim_decision', { pubkey: keys.alice.pk, climb_id: 'c1', decision: 'granted' }, 1789000200);
  await log.add('claim_decision', { pubkey: keys.bob.pk, climb_id: 'c1', decision: 'granted' }, 1789000210);
  await log.add('claim_decision', { pubkey: keys.bob.pk, climb_id: 'c2', decision: 'granted' }, 1789000220);

  // Payment: settled for Alice, expired for Bob — an unpaid climber is not eligible.
  await log.add('payment_decision', {
    pubkey: keys.alice.pk, state: 'settled', zap_receipt_id: 'f'.repeat(64), amount_msat: 2000000,
  }, 1789000300, { subjects: [keys.alice.pk] });
  await log.add('payment_decision', { pubkey: keys.bob.pk, state: 'expired' }, 1789000310, { subjects: [keys.bob.pk] });

  await log.add('lifecycle', { status: 'registration_closed', at: 1789003600 }, 1789003600);
  await log.add('lifecycle', { status: 'checkin_open', at: 1789003700 }, 1789003700);
  await log.add('checkin', { pubkey: keys.alice.pk, state: 'checked_in' }, 1789003800, { subjects: [keys.alice.pk] });
  await log.add('checkin', { pubkey: keys.bob.pk, state: 'no_show' }, 1789003810, { subjects: [keys.bob.pk] });
  await log.add('queue', { action: 'seed', order: [keys.alice.pk] }, 1789005300);
  await log.add('lifecycle', { status: 'running', at: 1789005400 }, 1789005400);
  await log.add('queue', { action: 'open_turn', index: 0 }, 1789005500);
  // climb_not_selected — c3 is in the pool but Alice never claimed it. Under
  // participant choice an attempt only counts on a climb the climber holds,
  // otherwise unique claims would decide nothing.
  await log.add('attempt_result', {
    pubkey: keys.alice.pk, climb_id: 'c3', outcome: 'top', attempt_no: 1,
  }, 1789005510, { subjects: [keys.alice.pk] });
  await log.add('attempt_result', {
    pubkey: keys.alice.pk, climb_id: 'c1', outcome: 'top', attempt_no: 1,
  }, 1789005520, { subjects: [keys.alice.pk] });
  await log.add('lifecycle', { status: 'finished', at: 1789005600 }, 1789005600);

  return finish(
    'paid-unique-async',
    'Participant-chosen climbs with enforced uniqueness, a paid entry where one payment expires, '
    + 'and a no-show. The duplicate climb claim and an attempt on an unclaimed climb are both '
    + 'rejected by the reducer.',
    competitionEvent,
    log,
  );
}

async function streamForkAndCorrection(keys) {
  const compId = 'cc44dd55ee66ff77';
  const config = baseConfig({ compId, authority: keys.organizer.pk, overrides: { title: 'Fork and correction' } });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  await log.add('registration_decision', {
    pubkey: keys.alice.pk, decision: 'accepted', division: 'open', display: 'alice',
  }, 1789000100, { subjects: [keys.alice.pk] });

  // A second entry signed at the same seq with the same prev — the authority
  // signed twice (two devices, or a stolen key). Both are published.
  await log.fork('registration_decision', {
    pubkey: keys.bob.pk, decision: 'accepted', division: 'open', display: 'bob',
  }, 1789000105, { subjects: [keys.bob.pk] });

  await log.add('registration_decision', {
    pubkey: keys.carla.pk, decision: 'accepted', division: 'open', display: 'carla',
  }, 1789000200, { subjects: [keys.carla.pk] });

  // An override and a correction, both carrying their mandatory reason.
  await log.add('override', {
    op: 'registration_decision',
    data: { pubkey: keys.dan.pk, decision: 'accepted', division: 'open', display: 'dan' },
  }, 1789000300, { reason: 'Entered on paper at the desk; phone had no signal.', actor: 'organizer_override', subjects: [keys.dan.pk] });

  await log.add('correction', {
    supersedes_seq: 4,
    replacement: {
      op: 'registration_decision',
      data: { pubkey: keys.carla.pk, decision: 'waitlisted', division: 'open', display: 'carla', waitlist_position: 1 },
    },
  }, 1789000400, { reason: 'Carla was accepted in error: the open division was already full on paper.', subjects: [keys.carla.pk] });

  return finish(
    'fork-and-correction',
    'Two entries signed at the same seq (a fork), plus an override and a correction that both '
    + 'carry a mandatory reason. Every client must pick the same branch.',
    competitionEvent,
    log,
  );
}

async function streamChainBreak(keys) {
  const compId = 'dd88ee99ffaa0b1c';
  const config = baseConfig({ compId, authority: keys.organizer.pk, overrides: { title: 'Chain break' } });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  await log.add('registration_decision', {
    pubkey: keys.alice.pk, decision: 'accepted', division: 'open', display: 'alice',
  }, 1789000100, { subjects: [keys.alice.pk] });
  await log.add('registration_decision', {
    pubkey: keys.bob.pk, decision: 'accepted', division: 'open', display: 'bob',
  }, 1789000200, { subjects: [keys.bob.pk] });

  // Withhold entry 3, as a lagging or censoring relay would. Reduction must
  // stop at the gap rather than skipping to 4 — entry 3 could have been the
  // disqualification that changes everything after it.
  const withheld = log.events.splice(2, 1)[0];
  const stream = await finish(
    'chain-break',
    'Entry 3 is withheld. Reduction must stop at the gap and report it, not skip ahead.',
    competitionEvent,
    log,
  );
  stream.withheld_event = withheld;
  return stream;
}

/**
 * Every rejection path a client can reach, in one stream.
 *
 * Rejections are part of the hashed state, so "the two clients agree about
 * what is legal" only means something if the fixtures actually contain
 * illegal entries. Without this stream, a reducer that accepted everything
 * would pass every other test in the suite.
 */
async function streamRejections(keys) {
  const compId = 'ee11ff2200334455';
  const config = baseConfig({
    compId,
    authority: keys.organizer.pk,
    overrides: { title: 'Rejection paths', capacity: 2 },
  });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  // running is not reachable from published — illegal_transition.
  await log.add('lifecycle', { status: 'running', at: 1788900110 }, 1788900110);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);

  // A check-in before check-in opens — wrong_status.
  await log.add('checkin', { pubkey: keys.alice.pk, state: 'checked_in' }, 1789000010, { subjects: [keys.alice.pk] });

  await log.add('registration_decision', {
    pubkey: keys.alice.pk, decision: 'accepted', division: 'open', display: 'alice',
  }, 1789000100, { subjects: [keys.alice.pk] });
  await log.add('registration_decision', {
    pubkey: keys.bob.pk, decision: 'accepted', division: 'open', display: 'bob',
  }, 1789000110, { subjects: [keys.bob.pk] });
  // capacity is 2 — carla does not fit.
  await log.add('registration_decision', {
    pubkey: keys.carla.pk, decision: 'accepted', division: 'open', display: 'carla',
  }, 1789000120, { subjects: [keys.carla.pk] });
  // unknown_division
  await log.add('registration_decision', {
    pubkey: keys.dan.pk, decision: 'accepted', division: 'masters', display: 'dan',
  }, 1789000130, { subjects: [keys.dan.pk] });
  // unknown_decision
  await log.add('registration_decision', {
    pubkey: keys.dan.pk, decision: 'maybe', division: 'open',
  }, 1789000140, { subjects: [keys.dan.pk] });

  // no_fee — this competition is free.
  await log.add('payment_decision', { pubkey: keys.alice.pk, state: 'settled' }, 1789000150, { subjects: [keys.alice.pk] });
  // uniqueness_not_enforced — climbs are organizer-set here.
  await log.add('claim_decision', { pubkey: keys.alice.pk, climb_id: 'c1', decision: 'granted' }, 1789000160);
  // no_such_participant
  await log.add('disqualify', { pubkey: keys.zapper.pk }, 1789000170,
    { reason: 'Not entered; this must be refused rather than inventing a competitor.' });
  // empty_announcement
  await log.add('announcement', { text: '' }, 1789000180);

  await log.add('lifecycle', { status: 'registration_closed', at: 1789003600 }, 1789003600);
  await log.add('lifecycle', { status: 'checkin_open', at: 1789003700 }, 1789003700);
  await log.add('checkin', { pubkey: keys.alice.pk, state: 'checked_in' }, 1789003800, { subjects: [keys.alice.pk] });
  await log.add('checkin', { pubkey: keys.bob.pk, state: 'checked_in' }, 1789003810, { subjects: [keys.bob.pk] });
  // not_accepted_registration — carla never got in.
  await log.add('checkin', { pubkey: keys.carla.pk, state: 'checked_in' }, 1789003820, { subjects: [keys.carla.pk] });

  // incomplete_seed_order — bob is eligible and missing.
  await log.add('queue', { action: 'seed', order: [keys.alice.pk] }, 1789005200);
  // duplicate_in_order
  await log.add('queue', { action: 'seed', order: [keys.alice.pk, keys.alice.pk] }, 1789005210);
  // ineligible_in_order
  await log.add('queue', { action: 'seed', order: [keys.alice.pk, keys.carla.pk] }, 1789005220);
  const seeded = await seedOrder(compId, [keys.alice.pk, keys.bob.pk]);
  await log.add('queue', { action: 'seed', order: seeded }, 1789005300);
  // index_out_of_range
  await log.add('queue', { action: 'open_turn', index: 9 }, 1789005310);
  // unknown_queue_action
  await log.add('queue', { action: 'teleport' }, 1789005320);

  await log.add('lifecycle', { status: 'running', at: 1789005400 }, 1789005400);
  await log.add('queue', { action: 'open_turn', index: 0 }, 1789005500);

  // attempt_out_of_order on a climb with NO prior record. This is the
  // regression guard for a reducer that creates the record before validating:
  // doing so leaves a phantom zero-attempt entry in the hashed state.
  await log.add('attempt_result', {
    pubkey: seeded[0], climb_id: 'c2', outcome: 'fall', attempt_no: 3,
  }, 1789005510, { subjects: [seeded[0]] });
  // unknown_outcome
  await log.add('attempt_result', {
    pubkey: seeded[0], climb_id: 'c1', outcome: 'levitated', attempt_no: 1,
  }, 1789005520, { subjects: [seeded[0]] });

  await log.add('attempt_result', {
    pubkey: seeded[0], climb_id: 'c1', outcome: 'top', attempt_no: 1,
  }, 1789005530, { subjects: [seeded[0]] });
  // already_topped
  await log.add('attempt_result', {
    pubkey: seeded[0], climb_id: 'c1', outcome: 'fall', attempt_no: 2,
  }, 1789005540, { subjects: [seeded[0]] });

  // defer_budget_exhausted (budget is 1, and this is the second)
  await log.add('defer_decision', { pubkey: seeded[1], decision: 'granted' }, 1789005550, { subjects: [seeded[1]] });
  await log.add('defer_decision', { pubkey: seeded[1], decision: 'granted' }, 1789005560, { subjects: [seeded[1]] });

  return finish(
    'rejections',
    'One entry for every rejection path a reducer can reach. Rejections are part of the hashed '
    + 'state, so a client that quietly accepted an illegal entry must fail here.',
    competitionEvent,
    log,
  );
}

/**
 * The rejection paths the first stream cannot reach, because an earlier check
 * masks them there (a full competition rejects on capacity before it ever looks
 * at the division). Between the two, every code in the closed set that a log
 * entry can trigger is exercised.
 */
async function streamRejectionsPaid(keys) {
  const compId = 'ff2233445566778a';
  const base = baseConfig({ compId, authority: keys.organizer.pk });
  const config = baseConfig({
    compId,
    authority: keys.organizer.pk,
    overrides: {
      title: 'Rejection paths, paid',
      capacity: 0,
      fee_msat: 1000000,
      fee_lnurl: 'kellerwand@example.invalid',
      rules: {
        ...base.rules,
        attempts_per_climb: 1,
        // budget above the consecutive cap, so the consecutive rule is the one
        // that fires rather than being masked by an exhausted budget.
        defer_budget_per_round: 3,
        max_consecutive_defers: 1,
      },
    },
  });
  const competitionEvent = await sign(buildCompetitionEvent(config, 1788900000), keys.organizer);
  const log = new Log(compId, keys.organizer.pk, keys.organizer, competitionEvent.id);

  await log.add('lifecycle', { status: 'published', at: 1788900100 }, 1788900100);
  await log.add('lifecycle', { status: 'registration_open', at: 1789000000 }, 1789000000);
  // unknown_division — capacity is unlimited here, so nothing masks it.
  await log.add('registration_decision', {
    pubkey: keys.dan.pk, decision: 'accepted', division: 'masters', display: 'dan',
  }, 1789000010, { subjects: [keys.dan.pk] });
  for (const climber of [keys.alice, keys.bob, keys.carla, keys.zapper]) {
    await log.add('registration_decision', {
      pubkey: climber.pk, decision: 'accepted', division: 'open', display: climber.label,
    }, 1789000100, { subjects: [climber.pk] });
  }
  await log.add('registration_decision', {
    pubkey: keys.dan.pk, decision: 'waitlisted', division: 'open', display: 'dan', waitlist_position: 1,
  }, 1789000150, { subjects: [keys.dan.pk] });

  // unknown_payment_state
  await log.add('payment_decision', { pubkey: keys.alice.pk, state: 'maybe' }, 1789000200, { subjects: [keys.alice.pk] });
  for (const climber of [keys.alice, keys.bob, keys.carla]) {
    await log.add('payment_decision', { pubkey: climber.pk, state: 'settled' }, 1789000210, { subjects: [climber.pk] });
  }

  await log.add('lifecycle', { status: 'registration_closed', at: 1789003600 }, 1789003600);
  await log.add('lifecycle', { status: 'checkin_open', at: 1789003700 }, 1789003700);
  // unknown_checkin_state
  await log.add('checkin', { pubkey: keys.alice.pk, state: 'maybe' }, 1789003750, { subjects: [keys.alice.pk] });
  // not_accepted_registration — dan is waitlisted, not accepted.
  await log.add('checkin', { pubkey: keys.dan.pk, state: 'checked_in' }, 1789003760, { subjects: [keys.dan.pk] });
  for (const climber of [keys.alice, keys.bob, keys.carla, keys.zapper]) {
    await log.add('checkin', { pubkey: climber.pk, state: 'checked_in' }, 1789003800, { subjects: [climber.pk] });
  }

  // no_order
  await log.add('queue', { action: 'seed' }, 1789005100);
  const seeded = await seedOrder(compId, [keys.alice.pk, keys.bob.pk, keys.carla.pk, keys.zapper.pk]);
  await log.add('queue', { action: 'seed', order: seeded }, 1789005300);
  await log.add('lifecycle', { status: 'running', at: 1789005400 }, 1789005400);

  // unknown_climb
  await log.add('queue', { action: 'next_climb', climb_id: 'nope' }, 1789005410);
  // not_in_order — dan never made the running order.
  await log.add('defer_decision', { pubkey: keys.dan.pk, decision: 'granted' }, 1789005420, { subjects: [keys.dan.pk] });

  // not_eligible — this entrant is accepted and checked in, so the seed order
  // legitimately contains them, but their fee never settled. Seeding and
  // climbing have different eligibility rules, and this pins the difference.
  // It has to happen while the order is still intact: once someone is
  // disqualified the order shrinks and the same index means someone else.
  await log.add('queue', { action: 'open_turn', index: seeded.indexOf(keys.zapper.pk) }, 1789005425);

  // A granted defer, then a second in immediate succession → defer_consecutive_limit
  // (budget is 3, so the budget rule cannot be what fires).
  await log.add('defer_decision', { pubkey: seeded[0], decision: 'granted' }, 1789005430, { subjects: [seeded[0]] });
  await log.add('defer_decision', { pubkey: seeded[0], decision: 'granted' }, 1789005440, { subjects: [seeded[0]] });

  // attempts_per_climb is 1, so the second attempt has none left.
  await log.add('queue', { action: 'open_turn', index: 0 }, 1789005500);
  await log.add('attempt_result', {
    pubkey: seeded[1], climb_id: 'c1', outcome: 'fall', attempt_no: 1,
  }, 1789005510, { subjects: [seeded[1]] });
  await log.add('attempt_result', {
    pubkey: seeded[1], climb_id: 'c1', outcome: 'fall', attempt_no: 2,
  }, 1789005520, { subjects: [seeded[1]] });

  // participant_inactive — disqualified climbers record nothing further.
  await log.add('disqualify', { pubkey: seeded[2] }, 1789005530,
    { reason: 'Brushed a hold mid-attempt after a warning.', subjects: [seeded[2]] });
  await log.add('attempt_result', {
    pubkey: seeded[2], climb_id: 'c1', outcome: 'top', attempt_no: 1,
  }, 1789005540, { subjects: [seeded[2]] });

  // unknown_op, reached through an override wrapping an operation no reducer
  // has. The parser only gates the TOP-LEVEL op, so this is the reducer's job.
  await log.add('override', { op: 'teleport', data: {} }, 1789005560,
    { reason: 'Deliberately unknown, to pin what a client does with one.', actor: 'organizer_override' });
  // correction_missing_replacement
  await log.add('correction', { supersedes_seq: 2 }, 1789005570,
    { reason: 'Deliberately malformed, to pin what a client does with one.' });

  // epoch_mismatch — an entry signed under an authority epoch that was never
  // put in force by a document revision. A stale authority must not be able to
  // keep writing after a handover, which is what §5.3 exists for.
  log.epoch = 2;
  await log.add('announcement', { text: 'From an epoch that is not in force.' }, 1789005580);
  log.epoch = 1;

  return finish(
    'rejections-paid',
    'The rejection paths an earlier check masks in the first rejection stream: unknown division, '
    + 'unknown payment and check-in states, the consecutive-deferral cap, an exhausted attempt '
    + 'allowance, a disqualified climber, and a malformed override and correction.',
    competitionEvent,
    log,
  );
}

/** The organizer console's default seeding rule (§9.1). Advisory, but pinned. */
async function seedOrder(compId, pubkeys) {
  const scored = [];
  for (const pubkey of pubkeys) {
    scored.push({ pubkey, hash: await sha256Hex(`${compId}${pubkey}`) });
  }
  scored.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
    || (a.pubkey < b.pubkey ? -1 : 1));
  return scored.map((s) => s.pubkey);
}

// ── vectors ──

async function buildVectors(keys) {
  const compId = '9f2c41ab77e05d13';

  const ccjCases = [
    { name: 'key order', value: { b: 1, a: 2, c_1: 3 }, expected: '{"a":2,"b":1,"c_1":3}' },
    { name: 'nested', value: { z: { y: [1, 2], x: 'q' } }, expected: '{"z":{"x":"q","y":[1,2]}}' },
    { name: 'null and undefined are dropped', value: { a: 1, b: null, c: undefined }, expected: '{"a":1}' },
    { name: 'negative integer', value: { n: -42 }, expected: '{"n":-42}' },
    { name: 'zero', value: { n: 0 }, expected: '{"n":0}' },
    { name: 'booleans', value: { t: true, f: false }, expected: '{"f":false,"t":true}' },
    { name: 'empty containers', value: { a: [], o: {} }, expected: '{"a":[],"o":{}}' },
    { name: 'array order is preserved', value: { a: [3, 1, 2] }, expected: '{"a":[3,1,2]}' },
    { name: 'quote and backslash', value: { s: 'a"b\\c' }, expected: '{"s":"a\\"b\\\\c"}' },
    { name: 'newline tab return', value: { s: 'a\nb\tc\rd' }, expected: '{"s":"a\\nb\\tc\\rd"}' },
    { name: 'control character', value: { s: '' }, expected: '{"s":"\\u0001"}' },
    { name: 'non-ascii is literal', value: { s: 'Kellerwand — Übung' }, expected: '{"s":"Kellerwand — Übung"}' },
    { name: 'emoji outside the BMP', value: { s: '🧗' }, expected: '{"s":"🧗"}' },
  ];
  for (const testCase of ccjCases) {
    const actual = ccj(testCase.value);
    if (actual !== testCase.expected) {
      throw new Error(`CCJ vector "${testCase.name}" disagrees with its own expectation:\n  ${actual}\n  ${testCase.expected}`);
    }
    testCase.sha256 = await sha256Hex(actual);
  }

  const ccjRejects = [
    { name: 'float', value: { n: 1.5 } },
    { name: 'uppercase key', value: { A: 1 } },
    { name: 'key with a dash', value: { 'a-b': 1 } },
    { name: 'top-level null', value: null },
    { name: 'negative zero', value: { n: -0 } },
  ].map((testCase) => {
    let threw = false;
    try { ccj(testCase.value); } catch { threw = true; }
    if (!threw) throw new Error(`CCJ vector "${testCase.name}" was expected to be refused`);
    return { name: testCase.name, value_json: JSON.stringify(testCase.value ?? null) };
  });

  const dTagCases = [
    { d: compDTag(compId), expected: parseDTag(compDTag(compId)) },
    { d: logDTag(compId, 1), expected: parseDTag(logDTag(compId, 1)) },
    { d: logDTag(compId, 999999), expected: parseDTag(logDTag(compId, 999999)) },
    { d: intentDTag(compId, keys.alice.pk, '3f9a2c17'), expected: parseDTag(intentDTag(compId, keys.alice.pk, '3f9a2c17')) },
    { d: `cruxcoach:comp:${compId}:results`, expected: parseDTag(`cruxcoach:comp:${compId}:results`) },
    { d: 'cruxcoach:climb:354c9b2d:089ccfd9', expected: null },
    { d: `cruxcoach:comp:${compId}:log:1`, expected: null },
    { d: `cruxcoach:comp:${compId}:log:000000`, expected: null },
    { d: 'cruxcoach:comp:NOTHEX:log:000001', expected: null },
  ];

  const address = competitionAddress(keys.organizer.pk, compId);
  const naddr = naddrEncode({ identifier: compDTag(compId), pubkey: keys.organizer.pk, kind: KIND });

  // An event whose id and signature are known-good, plus the same event with a
  // single byte of content changed — the tamper case every consumer must reject.
  const sample = await sign({
    kind: KIND,
    created_at: 1789000000,
    tags: [['d', compDTag(compId)], ['L', 'com.cruxcoach.competition']],
    content: '{"hello":"world"}',
  }, keys.organizer);
  const tampered = { ...sample, content: '{"hello":"w0rld"}' };

  // Which relay URLs a client will talk to is a cross-client rule: if the app
  // accepts a competition the website rejects, the two disagree about which
  // competitions exist at all. Pin it like everything else.
  const relayUrlCases = [
    { url: 'wss://relay.example.invalid', allowed: true, loopback: false },
    { url: 'wss://relay2.example.invalid/path', allowed: true, loopback: false },
    { url: 'ws://127.0.0.1:7447', allowed: true, loopback: true },
    { url: 'ws://localhost:7447', allowed: true, loopback: true },
    { url: 'ws://LOCALHOST:7447', allowed: true, loopback: true },
    { url: 'ws://[::1]:7447', allowed: true, loopback: true },
    { url: 'ws://relay.example.invalid', allowed: false, loopback: false },
    { url: 'ws://127.0.0.1.evil.invalid:7447', allowed: false, loopback: false },
    { url: 'http://127.0.0.1:7447', allowed: false, loopback: false },
    { url: 'wss://', allowed: false, loopback: false },
    { url: '', allowed: false, loopback: false },
    { url: 'wss://relay.example.invalid with a space', allowed: false, loopback: false },
  ];
  for (const testCase of relayUrlCases) {
    if (isAllowedRelayUrl(testCase.url) !== testCase.allowed
      || isLoopbackRelay(testCase.url) !== testCase.loopback) {
      throw new Error(`relay-url vector disagrees with the implementation: ${JSON.stringify(testCase)}`);
    }
  }

  return {
    schema: 'cruxcoach-competition/1',
    note: 'Every key here is derived from a public label in build-competition-fixtures.mjs. They are test keys and are worthless.',
    relay_urls: relayUrlCases,
    keys: Object.fromEntries(Object.values(keys).map((k) => [k.label, { secret_hex: bytesToHex(k.sk), pubkey: k.pk }])),
    ccj: ccjCases,
    ccj_rejected: ccjRejects,
    d_tags: dTagCases,
    address: { comp_id: compId, organizer: keys.organizer.pk, address, naddr },
    event: {
      serialized: serializeEvent(sample),
      signed: sample,
      tampered_must_fail_verification: tampered,
    },
  };
}

/** Lightning fixtures — locally signed, no invoice, no sats, no network. */
async function buildZapFixtures(keys) {
  const compId = 'bb00cc11dd22ee33';
  const address = competitionAddress(keys.organizer.pk, compId);
  const zapRequest = await sign({
    kind: 9734,
    created_at: 1789000250,
    tags: [
      ['p', keys.organizer.pk],
      ['a', address],
      ['amount', '2000000'],
      ['relays', 'wss://relay.example.invalid'],
      ['cc-intent', '3f9a2c17'],
    ],
    content: 'CruxCoach competition entry',
  }, keys.alice);

  // NIP-57: the invoice commits to the zap request through its description
  // hash, which is what stops a provider swapping in a different request.
  const descriptionHash = await sha256Hex(JSON.stringify(zapRequest));
  const invoice = fakeInvoice({
    amountMsat: 2000000,
    timestamp: 1789000255,
    expirySec: 900,
    paymentHash: 'a'.repeat(64),
    descriptionHash,
  });

  const receiptTags = [
    ['p', keys.organizer.pk],
    ['P', keys.alice.pk],
    ['a', address],
    ['bolt11', invoice],
    ['description', JSON.stringify(zapRequest)],
  ];
  const receipt = await sign({
    kind: 9735, created_at: 1789000260, tags: receiptTags, content: '',
  }, keys.zapper);

  const reSign = (mutate, key = keys.zapper) => sign({
    kind: 9735,
    created_at: 1789000260,
    tags: mutate(receiptTags.map((t) => [...t])),
    content: '',
  }, key);

  const wrongSigner = await reSign((tags) => tags, keys.dan);
  const wrongCompetition = await reSign((tags) => tags.map(
    (t) => (t[0] === 'a' ? ['a', competitionAddress(keys.organizer.pk, '0000000000000000')] : t),
  ));

  // A request for a tenth of the fee, attested honestly. The provider is not
  // lying; the receipt simply does not settle THIS entry.
  const cheapRequest = await sign({
    kind: 9734,
    created_at: 1789000250,
    tags: zapRequest.tags.map((t) => (t[0] === 'amount' ? ['amount', '200000'] : t)),
    content: 'CruxCoach competition entry',
  }, keys.alice);
  const wrongAmount = await reSign((tags) => tags.map(
    (t) => (t[0] === 'description' ? ['description', JSON.stringify(cheapRequest)] : t),
  ));

  // Somebody else's payment, correctly attested, cannot settle Alice's entry.
  const othersRequest = await sign({
    kind: 9734, created_at: 1789000250, tags: zapRequest.tags, content: 'CruxCoach competition entry',
  }, keys.bob);
  const wrongPayer = await reSign((tags) => tags
    .map((t) => (t[0] === 'description' ? ['description', JSON.stringify(othersRequest)] : t))
    .map((t) => (t[0] === 'P' ? ['P', keys.bob.pk] : t)));

  // A receipt for a different registration attempt: same person, same
  // competition, but the nonce says it paid for an entry that was withdrawn.
  const otherNonceRequest = await sign({
    kind: 9734,
    created_at: 1789000250,
    tags: zapRequest.tags.map((t) => (t[0] === 'cc-intent' ? ['cc-intent', '99887766'] : t)),
    content: 'CruxCoach competition entry',
  }, keys.alice);
  const wrongRegistration = await reSign((tags) => tags.map(
    (t) => (t[0] === 'description' ? ['description', JSON.stringify(otherNonceRequest)] : t),
  ));

  // The description is a zap request whose own signature does not hold.
  const forgedRequest = { ...zapRequest, tags: zapRequest.tags.map((t) => (t[0] === 'amount' ? ['amount', '1'] : t)) };
  const forgedDescription = await reSign((tags) => tags.map(
    (t) => (t[0] === 'description' ? ['description', JSON.stringify(forgedRequest)] : t),
  ));

  return {
    note: 'Locally generated. No invoice was created, no payment was made, nothing here touches a network.',
    lnurl_response: {
      tag: 'payRequest',
      allowsNostr: true,
      nostrPubkey: keys.zapper.pk,
      callback: 'https://lnurl.example.invalid/callback',
      minSendable: 1000,
      maxSendable: 100000000,
      metadata: '[["text/plain","CruxCoach competition entry"]]',
    },
    fee_msat: 2000000,
    competition_address: address,
    intent_nonce: '3f9a2c17',
    zap_request: zapRequest,
    invoice: {
      note: 'Structurally valid, deliberately unsigned. Nothing can pay it.',
      bolt11: invoice,
      amount_msat: 2000000,
      timestamp: 1789000255,
      expiry_sec: 900,
      expires_at: 1789001155,
      payment_hash: 'a'.repeat(64),
      description_hash: descriptionHash,
    },
    valid_receipt: receipt,
    rejected: {
      signed_by_the_wrong_key: wrongSigner,
      references_another_competition: wrongCompetition,
      attests_a_smaller_amount: wrongAmount,
      attests_somebody_elses_payment: wrongPayer,
      pays_a_different_registration: wrongRegistration,
      description_signature_does_not_hold: forgedDescription,
    },
  };
}

// ── output ──

function writeJson(file, value) {
  // Two-space JSON with a trailing newline, so a human diff of a fixture is
  // readable and `git diff` does not report a no-op whitespace change.
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const check = process.argv.includes('--check');
  const labels = ['organizer', 'alice', 'bob', 'carla', 'dan', 'zapper'];
  const keys = {};
  for (const label of labels) keys[label] = await testKey(label);

  const streams = [
    await streamHappySync(keys),
    await streamDeferAndTimeout(keys),
    await streamPaidUniqueAsync(keys),
    await streamForkAndCorrection(keys),
    await streamChainBreak(keys),
    await streamRejections(keys),
    await streamRejectionsPaid(keys),
  ];
  const vectors = await buildVectors(keys);
  const zaps = await buildZapFixtures(keys);

  const files = new Map();
  for (const stream of streams) files.set(`streams/${stream.name}.json`, stream);
  files.set('vectors/protocol.json', vectors);
  files.set('vectors/zap.json', zaps);

  const manifest = { schema: 'cruxcoach-competition/1', files: {} };
  const rendered = new Map();
  for (const [name, value] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    rendered.set(name, text);
    manifest.files[name] = await sha256Hex(text);
  }
  // Not CCJ: these keys are file paths, and CCJ deliberately refuses anything
  // outside [a-z0-9_]. A sorted "path sha\n" listing is the same guarantee in a
  // form a human can reproduce with `sha256sum`.
  manifest.manifest_sha256 = await sha256Hex(
    Object.entries(manifest.files).map(([name, digest]) => `${name} ${digest}\n`).join(''),
  );

  if (check) {
    let stale = false;
    for (const [name, text] of rendered) {
      const target = path.join(outDir, name);
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      if (current !== text) { console.error(`stale: ${name}`); stale = true; }
    }
    const manifestPath = path.join(outDir, 'MANIFEST.json');
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifestText) {
      console.error('stale: MANIFEST.json');
      stale = true;
    }
    if (stale) {
      console.error('\nFixtures are out of date. Run: node tools/dev/build-competition-fixtures.mjs');
      process.exit(1);
    }
    console.log(`Competition fixtures are current (${rendered.size} files, manifest ${manifest.manifest_sha256.slice(0, 12)}…).`);
    return;
  }

  fs.mkdirSync(path.join(outDir, 'streams'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'vectors'), { recursive: true });
  for (const [name, text] of rendered) fs.writeFileSync(path.join(outDir, name), text, 'utf8');
  writeJson(path.join(outDir, 'MANIFEST.json'), manifest);

  console.log(`Wrote ${rendered.size} fixture files to competitions/fixtures/`);
  for (const stream of streams) {
    console.log(`  ${stream.name.padEnd(20)} ${stream.log_events.length} entries  state ${stream.expected.state_hash.slice(0, 16)}…`);
  }
  console.log(`  manifest ${manifest.manifest_sha256}`);
}

await main();
