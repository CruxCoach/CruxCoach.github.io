import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyEvent } from '../competitions/app/protocol/nostr-event.mjs';
import { ccjHash } from '../competitions/app/protocol/ccj.mjs';
import { parseCompetitionEvent, parseLogEvent } from '../competitions/app/protocol/competition.mjs';
import { hashableState, reduce, REJECTION_CODES } from '../competitions/app/protocol/reduce.mjs';
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

test('standings match the recorded ones', async () => {
  for (const file of streamNames) {
    const stream = readStream(file);
    const { state, competition } = await replay(stream);
    assert.deepEqual(computeStandings(state, competition), stream.expected.standings, stream.name);
  }
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
