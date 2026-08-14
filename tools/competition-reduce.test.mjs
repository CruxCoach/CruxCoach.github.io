import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyEvent } from '../competitions/app/protocol/nostr-event.mjs';
import { ccjHash } from '../competitions/app/protocol/ccj.mjs';
import { parseCompetitionEvent, parseLogEvent } from '../competitions/app/protocol/competition.mjs';
import { applyEntry, hashableState, reduce, REJECTION_CODES } from '../competitions/app/protocol/reduce.mjs';
import { computeStandings } from '../competitions/app/protocol/scoring.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '../competitions/fixtures');
const streamsDir = path.join(fixtures, 'streams');
const streamNames = fs.readdirSync(streamsDir).filter((f) => f.endsWith('.json')).sort();

const readStream = (file) => JSON.parse(fs.readFileSync(path.join(streamsDir, file), 'utf8'));

const NOW = 1789020000;

/** Parse a stream the way a client would, verifying every signature first. */
async function replay(stream, { shuffle = false, duplicate = false } = {}) {
  assert.equal(await verifyEvent(stream.competition_event), true, 'competition event must verify');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  assert.equal(parsed.ok, true, parsed.error);

  let events = [...stream.log_events];
  if (shuffle) {
    // A fixed reversal, not a random shuffle: a test that fails one run in ten
    // is worse than no test.
    events = events.reverse();
  }
  if (duplicate) events = [...events, ...events];

  const entries = [];
  for (const event of events) {
    assert.equal(await verifyEvent(event), true, 'log event must verify');
    const result = parseLogEvent(event, parsed.competition, parsed.organizerPubkey, NOW);
    assert.equal(result.ok, true, result.error);
    entries.push(result);
  }
  return {
    competition: parsed.competition,
    ...reduce({
      competition: parsed.competition,
      competitionEventId: stream.competition_event.id,
      entries,
    }),
  };
}

test('every fixture stream reduces to its recorded state hash', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const { state, chainBreakAt } = await replay(stream);
    assert.deepEqual(hashableState(state), stream.expected.state, `${stream.name}: state`);
    assert.equal(await ccjHash(hashableState(state)), stream.expected.state_hash, `${stream.name}: hash`);
    assert.equal(chainBreakAt, stream.expected.chain_break_at, `${stream.name}: chain break`);
  }
});

test('reduction does not depend on the order events arrive in', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const forwards = await replay(stream);
    const backwards = await replay(stream, { shuffle: true });
    assert.equal(
      await ccjHash(hashableState(backwards.state)),
      stream.expected.state_hash,
      `${stream.name}: reversed delivery must reduce identically`,
    );
    assert.deepEqual(hashableState(backwards.state), hashableState(forwards.state));
  }
});

test('duplicate delivery of every event changes nothing', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const once = await replay(stream);
    const twice = await replay(stream, { duplicate: true });
    assert.deepEqual(hashableState(twice.state), hashableState(once.state), `${stream.name}: idempotency`);
  }
});

test('the accepted finish time drives prize deadlines without changing legacy state hashes', async () => {
  const stream = readStream('happy-sync.json');
  const finished = stream.log_events.find((event) => {
    const body = JSON.parse(event.content);
    return body.op === 'lifecycle' && body.data?.status === 'finished';
  });
  assert.ok(finished, 'fixture needs a terminal finish entry');
  const { state } = await replay(stream);
  assert.equal(state.results_at, JSON.parse(finished.content).at);
  assert.equal('results_at' in hashableState(state), false);
  assert.equal(await ccjHash(hashableState(state)), stream.expected.state_hash);
});

test('config updates keep the definition as root and derive one audited effective config', () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  assert.equal(parsed.ok, true, parsed.error);
  const eventId = 'ed'.repeat(32);
  const { state } = reduce({
    competition: parsed.competition,
    competitionEventId: stream.competition_event.id,
    entries: [{ eventId, createdAt: NOW, entry: {
      seq: 1, prev: stream.competition_event.id, epoch: 1, at: NOW,
      op: 'config_update', actor: 'authority', reason: 'Correct the displayed title',
      data: { revision: 2, impact: 'safe', patch: { title: 'Corrected title' } },
    } }],
  });
  assert.equal(state.head, eventId);
  assert.equal(state.effective_config.title, 'Corrected title');
  assert.equal(state.effective_config.comp_id, parsed.competition.comp_id);
  assert.equal(state.config_revision, 2);
  assert.deepEqual(state.audit.at(-1), {
    seq: 1, op: 'config_update', reason: 'Correct the displayed title', at: NOW,
    revision: 2, impact: 'safe',
  });
});

test('config updates cannot remove a climb already referenced by the log', () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  const state = {
    ...reduce({ competition: parsed.competition, competitionEventId: stream.competition_event.id, entries: [] }).state,
    current_climb_id: parsed.competition.climbs[0].id,
  };
  const entry = {
    seq: 1, prev: stream.competition_event.id, epoch: 1, at: NOW,
    op: 'config_update', actor: 'authority', reason: 'Replace pool',
    data: {
      revision: 2, impact: 'scoring',
      patch: { climbs: parsed.competition.climbs.map((climb, index) =>
        (index === 0 ? { ...climb, id: 'replacement' } : climb)) },
    },
  };
  const { state: reduced } = reduce({
    competition: parsed.competition, competitionEventId: stream.competition_event.id,
    entries: [{ eventId: 'ee'.repeat(32), createdAt: NOW, entry }],
    snapshot: { state, head: stream.competition_event.id, seq: 0 },
  });
  assert.equal(reduced.config_revision, 1);
  assert.equal(reduced.rejected.at(-1).code, 'config_referenced_climb');
});

test('standings match the recorded ones', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const { state, competition } = await replay(stream);
    assert.deepEqual(
      computeStandings(state, state.effective_config || competition),
      stream.expected.standings,
      stream.name,
    );
  }
});

test('the shared authority stream pins every additive operation and config rejection', async () => {
  const stream = readStream('authority-operations.json');
  const { state } = await replay(stream);
  const operations = stream.log_events.map((event) => JSON.parse(event.content).op);

  for (const operation of ['complete_turn', 'retire', 'config_update']) {
    assert.ok(operations.includes(operation), `${operation} must be present as signed input`);
  }
  for (const action of ['seed_open', 'skip_turn']) {
    assert.ok(stream.log_events.some((event) => {
      const payload = JSON.parse(event.content);
      return payload.op === 'queue' && payload.data.action === action;
    }), `${action} must be present as signed input`);
  }

  assert.equal(state.effective_config.rules.scoring, 'points_sum');
  assert.equal(state.config_revision, 4);
  const alice = state.participants.find((participant) => participant.display === 'alice');
  const bob = state.participants.find((participant) => participant.display === 'bob');
  assert.equal(alice.result, 'finished', 'retirement keeps the participant ranked');
  assert.equal(alice.climbs[0].outcome, 'top', 'retirement keeps recorded results');
  assert.deepEqual(bob.climbs, [], 'skipping Bob consumes no attempt');

  const configRejections = new Set(state.rejected.map((rejection) => rejection.code));
  for (const code of REJECTION_CODES.filter((candidate) => candidate.startsWith('config_'))) {
    assert.ok(configRejections.has(code), `${code} needs shared signed coverage`);
  }
});

test('Zone Top and Flash points stack exactly once per climb', () => {
  const competition = {
    rules: {
      climb_source: 'organizer_set', climb_count: 3, scoring: 'achievement_points',
      score_points: { zone: 10, top: 15, flash: 5 }, tiebreaks: ['fewest_attempts'],
    },
    climbs: [
      { id: 'zone', points: 0 }, { id: 'top', points: 0 }, { id: 'flash', points: 0 },
    ],
  };
  const state = {
    order: ['p'],
    participants: [{
      pubkey: 'p', display: 'Pat', division: 'open', result: 'active',
      registration: 'accepted', checkin: 'checked_in', selections: [],
      climbs: [
        { climb_id: 'zone', attempts_used: 1, outcome: 'zone', at: 1 },
        { climb_id: 'top', attempts_used: 2, outcome: 'top', at: 2 },
        { climb_id: 'flash', attempts_used: 1, outcome: 'top', at: 3 },
      ],
    }],
  };
  const [standing] = computeStandings(state, competition);
  assert.equal(standing.points, 10 + 25 + 30);
  assert.equal(standing.tops, 2);
  assert.equal(standing.zones, 3);
});

function bestNState(results) {
  return {
    order: ['p'],
    participants: [{
      pubkey: 'p', display: 'Pat', division: 'open', result: 'active',
      registration: 'accepted', checkin: 'checked_in', selections: [], climbs: results,
    }],
  };
}

test('best N deterministically selects whole per-climb results for every scoring family', () => {
  const results = [
    { climb_id: 'a', attempts_used: 3, outcome: 'top', at: 30 },
    { climb_id: 'b', attempts_used: 1, outcome: 'top', at: 10 },
    { climb_id: 'c', attempts_used: 2, outcome: 'top', at: 20 },
    { climb_id: 'd', attempts_used: 1, outcome: 'zone', at: 5 },
    { climb_id: 'e', attempts_used: 1, outcome: 'fall', at: 4 },
  ];
  const climbs = [
    { id: 'a', points: 500 }, { id: 'b', points: 100 }, { id: 'c', points: 300 },
    { id: 'd', points: 900 }, { id: 'e', points: 1000 },
  ];
  const common = {
    climb_source: 'organizer_set', climb_count: 2, counted_climb_count: 2,
    tiebreaks: ['fewest_attempts', 'most_zones'],
  };

  const tops = computeStandings(bestNState(results), {
    climbs, rules: { ...common, scoring: 'tops_then_attempts' },
  })[0];
  assert.deepEqual(
    { tops: tops.tops, zones: tops.zones, attempts: tops.attempts, total: tops.total_attempts },
    { tops: 2, zones: 2, attempts: 3, total: 3 },
    'best tops are selected before attempts aggregate; discarded attempts cannot leak into a tiebreak',
  );

  const achievement = computeStandings(bestNState(results), {
    climbs, rules: {
      ...common, scoring: 'achievement_points', score_points: { zone: 10, top: 15, flash: 5 },
    },
  })[0];
  assert.equal(achievement.points, 55, 'flash (30) plus best remaining top (25) count');

  for (const scoring of ['points_sum', 'hardest_n']) {
    const points = computeStandings(bestNState(results), { climbs, rules: { ...common, scoring } })[0];
    assert.equal(points.points, 800, `${scoring} counts the two highest topped contributions`);
  }

  const livePool = computeStandings(bestNState(results), {
    climb_pool: { options: climbs },
    rules: {
      ...common, climb_source: 'participant_choice', climb_count: 5,
      counted_climb_count: 2, selection_uniqueness: 'none', scoring: 'points_sum',
    },
  })[0];
  assert.equal(livePool.points, 800,
    'an entrant may try more than N pool climbs without preselecting any; only the best N score');
});

test('legacy unique selections neither gate an empty participant nor narrow Best-N scoring', () => {
  const competition = {
    starts_at: 1, ends_at: 999, climbs: [],
    climb_pool: { options: [{ id: 'a', points: 0 }, { id: 'b', points: 0 }, { id: 'c', points: 0 }] },
    rules: {
      climb_source: 'participant_choice', selection_uniqueness: 'unique_per_competition',
      climb_count: 2, counted_climb_count: 2, attempts_per_climb: 5,
      scoring: 'tops_then_attempts', tiebreaks: ['fewest_attempts'],
    },
  };
  const baseParticipant = {
    pubkey: 'p', display: 'Pat', division: 'open', registration: 'accepted',
    checkin: 'checked_in', result: 'active', selections: [], climbs: [], last_attempt_at: 0,
  };
  const state = {
    epoch: 1, status: 'running', participants: [baseParticipant], rejected: [],
  };
  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'attempt_result',
    data: { pubkey: 'p', climb_id: 'b', outcome: 'top', attempt_no: 1 },
  }, competition);
  assert.equal(state.rejected.length, 0, 'empty legacy selections must not make the pool unplayable');

  const scoringState = bestNState([
    { climb_id: 'a', attempts_used: 1, outcome: 'fall', at: 1 },
    { climb_id: 'b', attempts_used: 2, outcome: 'top', at: 2 },
    { climb_id: 'c', attempts_used: 1, outcome: 'top', at: 3 },
  ]);
  scoringState.participants[0].selections = ['a'];
  const standing = computeStandings(scoringState, competition)[0];
  assert.deepEqual({ tops: standing.tops, attempts: standing.attempts }, { tops: 2, attempts: 3 });
});

test('complete_turn records one attempt and atomically rotates and wraps the queue', () => {
  const participant = (pubkey) => ({
    pubkey, display: pubkey, division: 'open', registration: 'accepted', payment: 'not_required',
    checkin: 'checked_in', result: 'active', selections: [], climbs: [], last_attempt_at: 0,
    defers_used_this_round: 1, consecutive_defers: 0,
  });
  const competition = {
    starts_at: 1, ends_at: 999, fee_msat: 0, climbs: [],
    climb_pool: { options: [{ id: 'a', points: 0 }, { id: 'b', points: 0 }] },
    rules: {
      climb_source: 'participant_choice', attempts_per_climb: 3, min_rest_sec: 0,
      turn_deadline_sec: 90,
    },
  };
  const state = {
    epoch: 1, status: 'running', participants: [participant('p1'), participant('p2')],
    order: ['p1', 'p2'], cursor: 0, round: 1, turn_opened_at: 5, turn_deadline_at: 95,
    rejected: [],
  };

  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'complete_turn',
    data: { pubkey: 'p1', climb_id: 'a', outcome: 'fall', attempt_no: 1 },
  }, competition);
  assert.equal(state.participants[0].climbs[0].attempts_used, 1);
  assert.deepEqual({ cursor: state.cursor, round: state.round, deadline: state.turn_deadline_at },
    { cursor: 1, round: 1, deadline: 100 });

  applyEntry(state, {
    seq: 2, epoch: 1, at: 20, op: 'complete_turn',
    data: { pubkey: 'p2', climb_id: 'b', outcome: 'zone', attempt_no: 1 },
  }, competition);
  assert.deepEqual({ cursor: state.cursor, round: state.round, deadline: state.turn_deadline_at },
    { cursor: 0, round: 2, deadline: 110 });
  assert.deepEqual(state.participants.map((p) => p.defers_used_this_round), [0, 0]);
  assert.equal(state.rejected.length, 0);
});

test('seed_open deterministically installs the queue and opens its first turn', () => {
  const participant = (pubkey) => ({
    pubkey, registration: 'accepted', payment: 'not_required', checkin: 'checked_in',
    result: 'active', last_attempt_at: 0,
  });
  const competition = {
    starts_at: 1, ends_at: 999, fee_msat: 0, climbs: [{ id: 'a' }],
    rules: { climb_source: 'organizer_set', min_rest_sec: 0, turn_deadline_sec: 75 },
  };
  const state = {
    epoch: 1, status: 'running', round: 0, current_climb_id: '', order: [], cursor: -1,
    turn_opened_at: 0, turn_deadline_at: 0, rejected: [],
    participants: [participant('p1'), participant('p2')],
  };
  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'queue',
    data: { action: 'seed_open', order: ['p2', 'p1'] },
  }, competition);
  assert.deepEqual({ order: state.order, cursor: state.cursor, round: state.round, deadline: state.turn_deadline_at }, {
    order: ['p2', 'p1'], cursor: 0, round: 1, deadline: 85,
  });
  assert.equal(state.current_climb_id, 'a');
  assert.equal(state.rejected.length, 0);
});

test('complete_turn rejects a result for anyone except the open climber', () => {
  const competition = {
    starts_at: 1, ends_at: 999, fee_msat: 0, climbs: [{ id: 'a' }],
    rules: { climb_source: 'organizer_set', attempts_per_climb: 3, min_rest_sec: 0, turn_deadline_sec: 60 },
  };
  const state = {
    epoch: 1, status: 'running', order: ['p1'], cursor: 0, round: 1,
    turn_opened_at: 5, turn_deadline_at: 65, rejected: [], participants: [],
  };
  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'complete_turn',
    data: { pubkey: 'p2', climb_id: 'a', outcome: 'fall', attempt_no: 1 },
  }, competition);
  assert.equal(state.rejected.at(-1).code, 'not_current_turn');
  assert.equal(state.cursor, 0);
});

test('skip_turn preserves attempts and atomically opens the next participant', () => {
  const participant = (pubkey) => ({
    pubkey, registration: 'accepted', payment: 'not_required', checkin: 'checked_in',
    result: 'active', last_attempt_at: 0, climbs: [], defers_used_this_round: 1, consecutive_defers: 1,
  });
  const competition = {
    starts_at: 1, ends_at: 999, fee_msat: 0,
    rules: { min_rest_sec: 0, turn_deadline_sec: 60 },
  };
  const state = {
    epoch: 1, status: 'running', order: ['p1', 'p2'], cursor: 0, round: 1,
    turn_opened_at: 5, turn_deadline_at: 65, rejected: [],
    participants: [participant('p1'), participant('p2')],
  };
  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'queue', data: { action: 'skip_turn' },
  }, competition);
  assert.deepEqual({ cursor: state.cursor, round: state.round, opened: state.turn_opened_at, deadline: state.turn_deadline_at },
    { cursor: 1, round: 1, opened: 10, deadline: 70 });
  assert.deepEqual(state.participants.map((p) => p.climbs), [[], []]);

  applyEntry(state, {
    seq: 2, epoch: 1, at: 20, op: 'queue', data: { action: 'skip_turn' },
  }, competition);
  assert.deepEqual({ cursor: state.cursor, round: state.round, opened: state.turn_opened_at, deadline: state.turn_deadline_at },
    { cursor: 0, round: 2, opened: 20, deadline: 80 });
  assert.deepEqual(state.participants.map((p) => p.defers_used_this_round), [0, 0]);
});

test('retire preserves results and advances without leaving a dead queue slot', () => {
  const participant = (pubkey) => ({
    pubkey, registration: 'accepted', payment: 'not_required', checkin: 'checked_in',
    result: 'active', last_attempt_at: 0, climbs: [{ climb_id: 'a', attempts_used: 1, outcome: 'top', at: 5 }],
    defers_used_this_round: 0, consecutive_defers: 0,
  });
  const competition = {
    starts_at: 1, ends_at: 999, fee_msat: 0,
    rules: { min_rest_sec: 0, turn_deadline_sec: 60 },
  };
  const state = {
    epoch: 1, status: 'running', order: ['p1', 'p2', 'p3'], cursor: 1, round: 1,
    turn_opened_at: 5, turn_deadline_at: 65, rejected: [], audit: [],
    participants: [participant('p1'), participant('p2'), participant('p3')],
  };
  applyEntry(state, {
    seq: 1, epoch: 1, at: 10, op: 'retire', reason: 'left early', data: { pubkey: 'p2' },
  }, competition);
  assert.equal(state.participants[1].result, 'finished');
  assert.equal(state.participants[1].climbs[0].outcome, 'top');
  assert.deepEqual(state.order, ['p1', 'p3']);
  assert.deepEqual({ cursor: state.cursor, opened: state.turn_opened_at, deadline: state.turn_deadline_at },
    { cursor: 1, opened: 10, deadline: 70 });
  assert.equal(state.rejected.length, 0);
});

test('counted N equal to available M is byte-for-byte standings compatible', () => {
  const results = [
    { climb_id: 'a', attempts_used: 2, outcome: 'top', at: 2 },
    { climb_id: 'b', attempts_used: 1, outcome: 'zone', at: 1 },
  ];
  const climbs = [{ id: 'a', points: 100 }, { id: 'b', points: 200 }];
  const rules = {
    climb_source: 'organizer_set', climb_count: 2, scoring: 'tops_then_attempts',
    tiebreaks: ['fewest_attempts', 'most_zones'],
  };
  const legacy = computeStandings(bestNState(results), { climbs, rules });
  const explicit = computeStandings(bestNState(results), {
    climbs, rules: { ...rules, counted_climb_count: 2 },
  });
  assert.deepEqual(explicit, legacy);
});

// ── the specific behaviours the streams exist to pin ──

test('a withheld entry stops reduction at the gap instead of skipping ahead', async () => {
  const stream = readStream('chain-break.json');
  const { state, chainBreakAt } = await replay(stream);
  assert.equal(chainBreakAt, 3);
  assert.equal(state.chain_complete, false);
  assert.equal(state.seq, 2, 'nothing past the gap may be applied');
  // Entry 3 (withheld) accepted the first climber and entry 4 accepted the
  // second. Skipping the gap would have shown a field with the second climber
  // and not the first — a participant list that never existed.
  assert.equal(state.participants.length, 0);
});

test('supplying the withheld entry completes the chain', async () => {
  const stream = readStream('chain-break.json');
  const complete = { ...stream, log_events: [...stream.log_events, stream.withheld_event] };
  const { state, chainBreakAt } = await replay(complete);
  assert.equal(chainBreakAt, null);
  assert.equal(state.chain_complete, true);
  assert.equal(state.seq, 4);
  assert.equal(state.participants.length, 2);
});

test('a fork is detected, and every client picks the same branch', async () => {
  const stream = readStream('fork-and-correction.json');
  const forwards = await replay(stream);
  const backwards = await replay(stream, { shuffle: true });
  assert.equal(forwards.state.fork_detected, true);
  assert.equal(backwards.state.fork_detected, true);
  assert.equal(forwards.state.head, backwards.state.head, 'both orders must land on the same branch');
});

test('a correction supersedes an earlier decision and stays in the audit trail', async () => {
  const stream = readStream('fork-and-correction.json');
  const { state } = await replay(stream);
  const corrections = state.audit.filter((a) => a.op === 'correction');
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].supersedes_seq, 4);
  assert.ok(corrections[0].reason.length > 0, 'a correction must carry its reason');
  const carla = state.participants.find((p) => p.display === 'carla');
  assert.equal(carla.registration, 'waitlisted', 'the correction must have taken effect');
});

test('an override applies its wrapped operation and is always audited', async () => {
  const stream = readStream('fork-and-correction.json');
  const { state } = await replay(stream);
  const overrides = state.audit.filter((a) => a.op === 'override');
  assert.equal(overrides.length, 1);
  assert.ok(overrides[0].reason.length > 0);
  const dan = state.participants.find((p) => p.display === 'dan');
  assert.equal(dan.registration, 'accepted');
});

test('a second claim on an already-claimed climb is rejected by the reducer', async () => {
  const stream = readStream('paid-unique-async.json');
  const { state } = await replay(stream);
  assert.ok(state.rejected.some((r) => r.code === 'climb_already_claimed'));
  const climbOwners = Object.values(state.claims);
  assert.equal(new Set(climbOwners).size, climbOwners.length, 'no climb may have two owners');
  const bob = state.participants.find((p) => p.display === 'bob');
  assert.deepEqual(bob.selections, ['c2'], 'the loser of the race keeps only their granted climb');
});

test('an unpaid entrant is not eligible to climb', async () => {
  const stream = readStream('paid-unique-async.json');
  const { state } = await replay(stream);
  const bob = state.participants.find((p) => p.display === 'bob');
  assert.equal(bob.payment, 'expired');
  assert.equal(state.order.includes(bob.pubkey), false);
});

test('the authority can honour a withdrawal after registration has closed', async () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  assert.equal(parsed.ok, true, parsed.error);
  const pubkey = 'ab'.repeat(32);
  const ids = Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(64));
  const operations = [
    ['lifecycle', { status: 'published', at: NOW - 100 }],
    ['lifecycle', { status: 'registration_open', at: NOW - 90 }],
    ['registration_decision', { pubkey, decision: 'accepted', division: 'open', display: 'Late leaver' }],
    ['lifecycle', { status: 'registration_closed', at: NOW - 80 }],
    ['lifecycle', { status: 'checkin_open', at: NOW - 70 }],
    ['lifecycle', { status: 'running', at: NOW - 60 }],
    ['registration_decision', { pubkey, decision: 'withdrawn' }],
  ];
  const entries = operations.map(([op, data], index) => ({
    eventId: ids[index], createdAt: NOW - 100 + index,
    entry: {
      v: 1, type: 'log', comp_id: parsed.competition.comp_id,
      seq: index + 1, prev: index === 0 ? stream.competition_event.id : ids[index - 1],
      epoch: 1, at: NOW - 100 + index, actor: 'authority', op, data,
    },
  }));
  const { state } = reduce({
    competition: parsed.competition,
    competitionEventId: stream.competition_event.id,
    entries,
  });
  assert.equal(state.status, 'running');
  assert.equal(state.participants.find((p) => p.pubkey === pubkey)?.registration, 'withdrawn');
  assert.equal(state.rejected.some((r) => r.seq === 7), false);
});

test('a granted deferral moves back exactly defer_slots and buys no attempts', async () => {
  const stream = readStream('defer-and-timeout.json');
  const { state, competition } = await replay(stream);
  const deferrer = state.participants.find((p) => p.defers_used_this_round > 0);
  assert.ok(deferrer, 'the stream must contain a deferral');
  assert.equal(deferrer.defers_used_this_round, 1);
  const climb = deferrer.climbs.find((c) => c.climb_id === 'c1');
  assert.ok(climb.attempts_used <= competition.rules.attempts_per_climb,
    'deferring must not raise the attempt allowance');
});

test('a second consecutive deferral is refused, with a stable code', async () => {
  const stream = readStream('defer-and-timeout.json');
  const { state } = await replay(stream);
  const refusals = state.rejected.filter((r) => r.op === 'defer_decision');
  assert.equal(refusals.length, 1);
  assert.ok(['defer_budget_exhausted', 'defer_consecutive_limit'].includes(refusals[0].code));
});

test('an expired turn consumes an attempt', async () => {
  const stream = readStream('defer-and-timeout.json');
  const { state } = await replay(stream);
  const timedOut = state.participants.find(
    (p) => p.climbs.some((c) => c.attempts_used === 1 && c.outcome === 'attempted'),
  );
  assert.ok(timedOut, 'someone must have been timed out');
  assert.equal(timedOut.climbs[0].attempts_used, 1, 'a timeout costs exactly one attempt');
});

test('the running order never grows past the eligible field', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const { state } = await replay(stream);
    const eligible = state.participants
      .filter((p) => p.registration === 'accepted' && p.checkin === 'checked_in')
      .map((p) => p.pubkey);
    for (const pubkey of state.order) {
      assert.ok(eligible.includes(pubkey), `${stream.name}: ${pubkey.slice(0, 8)} is in the order but not eligible`);
    }
    assert.equal(new Set(state.order).size, state.order.length, `${stream.name}: duplicate in the order`);
  }
});

test('every rejection code used by a fixture is in the closed set', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const { state } = await replay(stream);
    for (const rejection of state.rejected) {
      assert.ok(REJECTION_CODES.includes(rejection.code), `unknown code ${rejection.code}`);
    }
  }
});

test('a log entry signed by someone other than the authority is refused', async () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  const impostor = { ...stream.log_events[0], pubkey: 'a'.repeat(64) };
  const result = parseLogEvent(impostor, parsed.competition, parsed.organizerPubkey, NOW);
  assert.equal(result.ok, false);
  assert.match(result.error, /authority/);
});

test('a log entry pointing at another competition is refused', async () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  const original = stream.log_events[0];
  const rerouted = {
    ...original,
    tags: original.tags.map((t) => (t[0] === 'a' ? ['a', '30078:' + 'b'.repeat(64) + ':cruxcoach:comp:0000000000000000'] : t)),
  };
  const result = parseLogEvent(rerouted, parsed.competition, parsed.organizerPubkey, NOW);
  assert.equal(result.ok, false);
  assert.match(result.error, /a-tag/);
});

test('a correction without a reason is refused at the parser', async () => {
  const stream = readStream('fork-and-correction.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  const correction = stream.log_events.find((e) => e.tags.some((t) => t[0] === 'op' && t[1] === 'correction'));
  const payload = JSON.parse(correction.content);
  delete payload.reason;
  const stripped = { ...correction, content: JSON.stringify(payload) };
  const result = parseLogEvent(stripped, parsed.competition, parsed.organizerPubkey, NOW);
  assert.equal(result.ok, false);
  assert.match(result.error, /mandatory reason/);
});

test('an unknown operation stops the client instead of being ignored', async () => {
  const stream = readStream('happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, NOW);
  const original = stream.log_events[0];
  const payload = { ...JSON.parse(original.content), op: 'teleport' };
  const future = { ...original, content: JSON.stringify(payload) };
  const result = parseLogEvent(future, parsed.competition, parsed.organizerPubkey, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.needsUpgrade, true, 'the user must be told to update, not shown a partial leaderboard');
});

test('every rejection code in the closed set is exercised by a fixture', async () => {
  const seen = new Set();
  for (const file of streamNames) {
    const { state } = await replay(readStream(file));
    for (const rejection of state.rejected) seen.add(rejection.code);
  }
  const uncovered = REJECTION_CODES.filter((code) => !seen.has(code));
  // A rejection code with no fixture is a rule the Android client could
  // implement differently without any test noticing.
  assert.deepEqual(uncovered, [], 'these rejection codes have no fixture exercising them');
});
