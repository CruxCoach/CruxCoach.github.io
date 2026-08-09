/**
 * Deterministic state reduction — FEAT-058 §7.
 *
 * Hard rules this file exists to enforce:
 *   - synchronous and pure: no clock, no crypto, no I/O, no Math.random
 *   - every collection has a specified order, so two clients agree byte-for-byte
 *   - a rejected entry is *recorded*, not swallowed — rejections are part of the
 *     hashed state, so two clients that disagree about what is legal fail the
 *     conformance test instead of quietly diverging at an event
 *
 * The Kotlin port is `shared/.../domain/competition/CompetitionReducer.kt` and
 * is pinned to the same fixture streams.
 */
import { LEGAL_TRANSITIONS, QUEUE_ACTIONS, ATTEMPT_OUTCOMES, PAYMENT_STATES, SCHEMA } from './competition.mjs';

/** Build the zero state for a validated competition definition. */
export function initialState(competition, competitionEventId) {
  return {
    comp_id: competition.comp_id,
    schema: SCHEMA,
    authority: competition.authority,
    epoch: competition.authority_epoch,
    seq: 0,
    head: competitionEventId,
    status: competition.status,
    paused: false,
    config_revision: competition.revision ?? 1,
    round: 0,
    current_climb_id: '',
    cursor: -1,
    turn_opened_at: 0,
    turn_deadline_at: 0,
    participants: [],
    order: [],
    claims: {},
    announcements: [],
    audit: [],
    rejected: [],
    fork_detected: false,
    chain_complete: true,
    from_snapshot: false,
  };
}

// ── participant helpers ──

function findParticipant(state, pubkey) {
  return state.participants.find((p) => p.pubkey === pubkey);
}

function upsertParticipant(state, pubkey) {
  let participant = findParticipant(state, pubkey);
  if (participant) return participant;
  participant = {
    pubkey,
    display: '',
    division: '',
    registration: 'pending',
    waitlist_position: 0,
    payment: 'not_required',
    checkin: 'none',
    selections: [],
    defers_used_this_round: 0,
    consecutive_defers: 0,
    result: 'active',
    climbs: [],
    last_attempt_at: 0,
  };
  state.participants.push(participant);
  // Ascending by pubkey — never arrival order, which differs per client.
  state.participants.sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
  return findParticipant(state, pubkey);
}

function climbRecord(participant, climbId) {
  let record = participant.climbs.find((c) => c.climb_id === climbId);
  if (record) return record;
  record = { climb_id: climbId, attempts_used: 0, outcome: 'none', at: 0 };
  participant.climbs.push(record);
  participant.climbs.sort((a, b) => (a.climb_id < b.climb_id ? -1 : a.climb_id > b.climb_id ? 1 : 0));
  return participant.climbs.find((c) => c.climb_id === climbId);
}

/**
 * Rejection codes are a CLOSED set and are part of the hashed state, so two
 * clients that disagree about what is legal fail the conformance test instead
 * of diverging quietly at some later event. They are codes rather than
 * sentences because the sentence has to be translatable and the hash must not
 * be.
 */
export const REJECTION_CODES = [
  'already_topped', 'attempt_out_of_order', 'capacity_full', 'climb_already_claimed',
  'correction_missing_replacement', 'defer_budget_exhausted', 'defer_consecutive_limit',
  'duplicate_in_order', 'empty_announcement', 'epoch_mismatch', 'illegal_transition',
  'incomplete_seed_order', 'index_out_of_range', 'ineligible_in_order', 'no_attempts_left',
  'no_fee', 'no_order', 'no_such_participant', 'not_accepted_registration', 'not_eligible',
  'not_in_order', 'participant_inactive', 'unknown_checkin_state', 'unknown_climb',
  'unknown_decision', 'unknown_division', 'unknown_op', 'unknown_outcome',
  'unknown_payment_state', 'unknown_queue_action', 'uniqueness_not_enforced', 'wrong_status',
];

function reject(state, entry, code) {
  state.rejected.push({ seq: entry.seq, op: entry.op, code });
  return state;
}

/** Which lifecycle states accept which classes of entry (§10.2). */
const ACCEPTS = {
  registration: new Set(['registration_open']),
  checkin: new Set(['checkin_open', 'running']),
  queue: new Set(['checkin_open', 'running']),
  attempt: new Set(['running']),
};

// ── operations ──

function applyLifecycle(state, entry, competition) {
  const next = entry.data.status;
  const legal = LEGAL_TRANSITIONS[state.status] || [];
  if (!legal.includes(next)) {
    return reject(state, entry, 'illegal_transition');
  }
  state.status = next;
  state.paused = next === 'paused';
  if (next === 'running' && state.round === 0) {
    state.round = 1;
    if (competition.rules.climb_source === 'organizer_set' && competition.climbs?.length) {
      state.current_climb_id = competition.climbs[0].id;
    }
  }
  if (next === 'cancelled' || next === 'finished') {
    state.cursor = -1;
    state.turn_deadline_at = 0;
  }
  return state;
}

function applyRegistrationDecision(state, entry, competition) {
  if (!ACCEPTS.registration.has(state.status)) {
    return reject(state, entry, 'wrong_status');
  }
  const { pubkey, decision, division, display, waitlist_position: waitlist } = entry.data;
  if (!['accepted', 'waitlisted', 'rejected'].includes(decision)) {
    return reject(state, entry, 'unknown_decision');
  }
  if (decision === 'accepted' && competition.capacity > 0) {
    const alreadyAccepted = state.participants.filter(
      (p) => p.registration === 'accepted' && p.pubkey !== pubkey,
    ).length;
    if (alreadyAccepted >= competition.capacity) {
      // The reducer refuses rather than trusting the authority to have counted.
      // A capacity that only the organizer's client enforces is not a capacity.
      return reject(state, entry, 'capacity_full');
    }
  }
  if (division !== undefined && !competition.divisions.some((d) => d.id === division)) {
    return reject(state, entry, 'unknown_division');
  }
  const participant = upsertParticipant(state, pubkey);
  participant.registration = decision;
  if (division !== undefined) participant.division = division;
  if (display !== undefined) participant.display = display;
  participant.waitlist_position = decision === 'waitlisted' && Number.isInteger(waitlist) ? waitlist : 0;
  if (decision === 'accepted' && competition.fee_msat > 0 && participant.payment === 'not_required') {
    participant.payment = 'pending';
  }
  return state;
}

function applyPaymentDecision(state, entry, competition) {
  const { pubkey, state: paymentState } = entry.data;
  if (!PAYMENT_STATES.includes(paymentState) || paymentState === 'not_required') {
    return reject(state, entry, 'unknown_payment_state');
  }
  if (competition.fee_msat === 0) {
    return reject(state, entry, 'no_fee');
  }
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  participant.payment = paymentState;
  return state;
}

function applyClaimDecision(state, entry, competition) {
  const { pubkey, climb_id: climbId, decision } = entry.data;
  if (competition.rules.selection_uniqueness !== 'unique_per_competition') {
    return reject(state, entry, 'uniqueness_not_enforced');
  }
  if (!['granted', 'denied'].includes(decision)) {
    return reject(state, entry, 'unknown_decision');
  }
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (decision === 'denied') return state;
  const holder = state.claims[climbId];
  if (holder !== undefined && holder !== pubkey) {
    // Enforced here, not merely by the authority behaving. A double grant is
    // visible to every client the same way, which is what makes it correctable.
    return reject(state, entry, 'climb_already_claimed');
  }
  state.claims[climbId] = pubkey;
  if (!participant.selections.includes(climbId)) {
    participant.selections.push(climbId);
    participant.selections.sort();
  }
  return state;
}

function applyCheckin(state, entry) {
  if (!ACCEPTS.checkin.has(state.status)) {
    return reject(state, entry, 'wrong_status');
  }
  const { pubkey, state: checkinState } = entry.data;
  if (!['checked_in', 'no_show'].includes(checkinState)) {
    return reject(state, entry, 'unknown_checkin_state');
  }
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (participant.registration !== 'accepted') {
    return reject(state, entry, 'not_accepted_registration');
  }
  participant.checkin = checkinState;
  if (checkinState === 'no_show') participant.result = 'dns';
  return state;
}

function isEligible(state, competition, pubkey, atSeconds) {
  const participant = findParticipant(state, pubkey);
  if (!participant) return false;
  if (participant.registration !== 'accepted') return false;
  if (participant.checkin !== 'checked_in') return false;
  if (participant.result !== 'active') return false;
  if (competition.fee_msat > 0 && participant.payment !== 'settled') return false;
  const rest = competition.rules.min_rest_sec || 0;
  if (rest > 0 && participant.last_attempt_at > 0 && atSeconds - participant.last_attempt_at < rest) {
    return false;
  }
  return true;
}

function applyQueue(state, entry, competition) {
  if (!ACCEPTS.queue.has(state.status)) {
    return reject(state, entry, 'wrong_status');
  }
  const action = entry.data.action;
  if (!QUEUE_ACTIONS.includes(action)) return reject(state, entry, 'unknown_queue_action');

  if (action === 'seed' || action === 'reorder') {
    const order = entry.data.order;
    if (!Array.isArray(order)) return reject(state, entry, 'no_order');
    const eligible = state.participants
      .filter((p) => p.registration === 'accepted' && p.checkin === 'checked_in' && p.result === 'active')
      .map((p) => p.pubkey);
    const asSet = new Set(order);
    if (asSet.size !== order.length) return reject(state, entry, 'duplicate_in_order');
    if (order.some((p) => !eligible.includes(p))) {
      return reject(state, entry, 'ineligible_in_order');
    }
    if (action === 'seed' && order.length !== eligible.length) {
      return reject(state, entry, 'incomplete_seed_order');
    }
    state.order = [...order];
    state.cursor = -1;
    return state;
  }

  if (action === 'open_turn') {
    const index = entry.data.index;
    if (!Number.isInteger(index) || index < 0 || index >= state.order.length) {
      return reject(state, entry, 'index_out_of_range');
    }
    if (!isEligible(state, competition, state.order[index], entry.at)) {
      return reject(state, entry, 'not_eligible');
    }
    state.cursor = index;
    state.turn_opened_at = entry.at;
    state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
    return state;
  }

  if (action === 'close_turn') {
    state.cursor = -1;
    state.turn_deadline_at = 0;
    return state;
  }

  if (action === 'advance') {
    const next = nextEligibleIndex(state, competition, state.cursor, entry.at);
    if (next === -1) {
      state.cursor = -1;
      state.turn_deadline_at = 0;
      return state;
    }
    state.cursor = next;
    state.turn_opened_at = entry.at;
    state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
    return state;
  }

  if (action === 'next_climb') {
    const climbId = entry.data.climb_id;
    if (competition.rules.climb_source === 'organizer_set'
      && !competition.climbs.some((c) => c.id === climbId)) {
      return reject(state, entry, 'unknown_climb');
    }
    state.current_climb_id = climbId;
    state.cursor = -1;
    state.turn_deadline_at = 0;
    return state;
  }

  // next_round
  state.round += 1;
  state.cursor = -1;
  state.turn_deadline_at = 0;
  for (const participant of state.participants) {
    participant.defers_used_this_round = 0;
    participant.consecutive_defers = 0;
  }
  return state;
}

function nextEligibleIndex(state, competition, from, atSeconds) {
  for (let i = from + 1; i < state.order.length; i++) {
    if (isEligible(state, competition, state.order[i], atSeconds)) return i;
  }
  return -1;
}

function applyDeferDecision(state, entry, competition) {
  const { pubkey, decision } = entry.data;
  if (!['granted', 'denied'].includes(decision)) {
    return reject(state, entry, 'unknown_decision');
  }
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (decision === 'denied') return state;

  const rules = competition.rules;
  if (participant.defers_used_this_round >= rules.defer_budget_per_round) {
    return reject(state, entry, 'defer_budget_exhausted');
  }
  if (participant.consecutive_defers >= rules.max_consecutive_defers) {
    return reject(state, entry, 'defer_consecutive_limit');
  }
  const current = state.order.indexOf(pubkey);
  if (current === -1) return reject(state, entry, 'not_in_order');

  // Move back by exactly defer_slots, never to the end of the round. §9.3.
  const target = Math.min(current + rules.defer_slots, state.order.length - 1);
  const order = [...state.order];
  order.splice(current, 1);
  order.splice(target, 0, pubkey);
  state.order = order;
  participant.defers_used_this_round += 1;
  participant.consecutive_defers += 1;
  // The deferring climber has left the open slot; whoever moved up takes it.
  state.cursor = -1;
  state.turn_deadline_at = 0;
  return state;
}

function applyAttemptResult(state, entry, competition) {
  if (!ACCEPTS.attempt.has(state.status)) {
    return reject(state, entry, 'wrong_status');
  }
  const { pubkey, climb_id: climbId, outcome, attempt_no: attemptNo } = entry.data;
  if (!ATTEMPT_OUTCOMES.includes(outcome)) return reject(state, entry, 'unknown_outcome');
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (participant.result !== 'active') return reject(state, entry, 'participant_inactive');

  const record = climbRecord(participant, climbId);
  if (record.outcome === 'top') return reject(state, entry, 'already_topped');
  if (!Number.isInteger(attemptNo) || attemptNo !== record.attempts_used + 1) {
    return reject(state, entry, 'attempt_out_of_order');
  }
  if (record.attempts_used >= competition.rules.attempts_per_climb) {
    return reject(state, entry, 'no_attempts_left');
  }

  record.attempts_used += 1;
  record.at = entry.at;
  participant.last_attempt_at = entry.at;
  // A pass or a timeout consumes an attempt (§9.3) but is not a zone.
  if (outcome === 'top') record.outcome = 'top';
  else if (outcome === 'zone' && record.outcome !== 'top') record.outcome = 'zone';
  else if (record.outcome === 'none') record.outcome = 'attempted';

  if (record.outcome !== 'top' && record.attempts_used >= competition.rules.attempts_per_climb) {
    record.outcome = record.outcome === 'zone' ? 'zone' : 'dnf';
  }
  // Completing an attempt breaks a deferral streak; the budget itself stands.
  participant.consecutive_defers = 0;
  return state;
}

function applyDisqualify(state, entry) {
  const participant = findParticipant(state, entry.data.pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  participant.result = 'disqualified';
  state.order = state.order.filter((p) => p !== entry.data.pubkey);
  if (state.cursor >= state.order.length) {
    state.cursor = -1;
    state.turn_deadline_at = 0;
  }
  return state;
}

function applyAnnouncement(state, entry) {
  const text = entry.data.text;
  if (typeof text !== 'string' || !text) return reject(state, entry, 'empty_announcement');
  state.announcements.push({ seq: entry.seq, text, at: entry.at });
  return state;
}

const HANDLERS = {
  lifecycle: applyLifecycle,
  registration_decision: applyRegistrationDecision,
  payment_decision: applyPaymentDecision,
  claim_decision: applyClaimDecision,
  checkin: applyCheckin,
  queue: applyQueue,
  defer_decision: applyDeferDecision,
  attempt_result: applyAttemptResult,
  disqualify: applyDisqualify,
  announcement: applyAnnouncement,
};

/**
 * Apply one already-validated, already-chained log entry.
 * Returns the same mutated state object — the caller owns a private copy.
 */
export function applyEntry(state, entry, competition) {
  if (entry.epoch !== state.epoch) {
    return reject(state, entry, 'epoch_mismatch');
  }

  if (entry.op === 'override') {
    // Same effect as the wrapped op, but always visible in the audit trail.
    state.audit.push({ seq: entry.seq, op: 'override', reason: entry.reason, at: entry.at });
    const wrapped = { ...entry, op: entry.data.op, data: entry.data.data };
    const handler = HANDLERS[wrapped.op];
    if (!handler) return reject(state, entry, 'unknown_op');
    return handler(state, wrapped, competition);
  }

  if (entry.op === 'correction') {
    state.audit.push({
      seq: entry.seq, op: 'correction', reason: entry.reason, at: entry.at,
      supersedes_seq: entry.data.supersedes_seq,
    });
    const replacement = entry.data.replacement;
    if (!replacement || typeof replacement !== 'object') {
      return reject(state, entry, 'correction_missing_replacement');
    }
    const wrapped = { ...entry, op: replacement.op, data: replacement.data };
    const handler = HANDLERS[wrapped.op];
    if (!handler) return reject(state, entry, 'unknown_op');
    return handler(state, wrapped, competition);
  }

  const handler = HANDLERS[entry.op];
  if (!handler) return reject(state, entry, 'unknown_op');
  return handler(state, entry, competition);
}

/**
 * Walk the `seq`/`prev` chain and reduce.
 *
 * @param {object} args
 * @param {object} args.competition   validated competition config
 * @param {string} args.competitionEventId  id of the definition event (chain root)
 * @param {Array<{entry: object, eventId: string, createdAt: number}>} args.entries
 *        already parsed + author-checked log entries, in any order
 * @param {object} [args.snapshot]    optional trusted starting point
 * @returns {{ state: object, chainBreakAt: number|null }}
 */
export function reduce({ competition, competitionEventId, entries, snapshot }) {
  const state = snapshot
    ? { ...structuredClone(snapshot.state), from_snapshot: true }
    : initialState(competition, competitionEventId);

  const bySeq = new Map();
  for (const item of entries) {
    if (!bySeq.has(item.entry.seq)) bySeq.set(item.entry.seq, []);
    const bucket = bySeq.get(item.entry.seq);
    // Duplicate deliveries of the same event collapse; the relay pool already
    // dedupes, but two relays racing the same event must not create a fork.
    if (!bucket.some((existing) => existing.eventId === item.eventId)) bucket.push(item);
  }

  let expectedPrev = snapshot ? snapshot.head : competitionEventId;
  let seq = snapshot ? snapshot.seq + 1 : 1;
  let chainBreakAt = null;

  for (;;) {
    const bucket = bySeq.get(seq);
    if (!bucket || bucket.length === 0) break;
    const linked = bucket.filter((item) => item.entry.prev === expectedPrev);
    if (linked.length === 0) {
      chainBreakAt = seq;
      break;
    }
    let chosen = linked[0];
    if (linked.length > 1) {
      state.fork_detected = true;
      // Lower created_at wins; ties broken by lexicographically lower event id.
      // Which branch is "right" is unknowable — that every client picks the
      // same one is not.
      chosen = [...linked].sort((a, b) =>
        a.createdAt - b.createdAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))[0];
    }
    applyEntry(state, chosen.entry, competition);
    state.seq = chosen.entry.seq;
    state.head = chosen.eventId;
    expectedPrev = chosen.eventId;
    seq += 1;
  }

  // A gap is not a licence to skip ahead: the missing entry may be the
  // disqualification that changes everything after it. "We have reached the
  // end" and "there is a hole and more entries behind it" look identical at
  // the stopping point and must not be conflated — the first is a competition
  // in progress, the second is a competition we cannot honestly display.
  if (chainBreakAt === null && [...bySeq.keys()].some((k) => k > state.seq)) {
    chainBreakAt = seq;
  }
  state.chain_complete = chainBreakAt === null;
  return { state, chainBreakAt };
}

/**
 * The state as it is hashed and compared across clients. Fields that are
 * genuinely local (did *this* client start from a snapshot?) are excluded, so
 * a snapshot-started client and a full-replay client can still agree.
 */
export function hashableState(state) {
  const { from_snapshot: _ignored, ...rest } = state;
  return rest;
}
