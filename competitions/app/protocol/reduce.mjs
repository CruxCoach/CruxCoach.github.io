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
import {
  LEGAL_TRANSITIONS, QUEUE_ACTIONS, ATTEMPT_OUTCOMES, PAYMENT_STATES, PRIZE_STATES, SCHEMA,
  checkinWindowOpen, competitionRunning, configPatchImpact, registrationWindowOpen,
  validateCompetitionConfig,
} from './competition.mjs';

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
    /**
     * prize_id -> { pubkey, state }.
     *
     * The *status* of a prize and nothing else. The claim, the payout
     * destination and any contact detail travel NIP-44 encrypted between the
     * winner and the organizer and never reach this object — a public log
     * carrying a Lightning address would publish the one thing a winner has
     * most reason to keep to themselves.
     */
    prizes: {},
    announcements: [],
    audit: [],
    rejected: [],
    fork_detected: false,
    chain_complete: true,
    // Derived from the accepted finish entry for local claim deadlines. It is
    // excluded from the state hash to preserve every existing signed stream.
    results_at: 0,
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
  'correction_bad_target', 'correction_invalid_replacement', 'correction_missing_replacement',
  'defer_budget_exhausted', 'defer_consecutive_limit',
  'duplicate_in_order', 'empty_announcement', 'epoch_mismatch', 'illegal_transition',
  'incomplete_seed_order', 'index_out_of_range', 'ineligible_in_order', 'no_attempts_left',
  'no_fee', 'no_order', 'no_such_participant', 'not_accepted_registration', 'not_eligible',
  'no_open_turn', 'not_current_turn', 'not_in_order', 'participant_inactive', 'unknown_checkin_state', 'unknown_climb',
  'unknown_decision', 'unknown_division', 'unknown_op', 'unknown_outcome',
  'unknown_payment_state', 'unknown_prize', 'unknown_prize_state', 'unknown_queue_action',
  'uniqueness_not_enforced', 'prize_already_awarded', 'results_not_final', 'wrong_status',
  'config_bad_revision', 'config_empty_patch', 'config_immutable_field',
  'config_impact_mismatch', 'config_invalid', 'config_referenced_climb',
  'config_referenced_division',
];

function reject(state, entry, code) {
  state.rejected.push({ seq: entry.seq, op: entry.op, code });
  return state;
}

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
    if (next === 'finished') state.results_at = entry.at;
  }
  return state;
}

function applyRegistrationDecision(state, entry, competition) {
  const { pubkey, decision, division, display, waitlist_position: waitlist } = entry.data;
  // `withdrawn` is an authority decision, just like acceptance. The entrant's
  // `withdraw` intent alone is never state; the organizer must acknowledge it
  // in the append-only record so every client agrees that the place is free.
  if (!['accepted', 'waitlisted', 'rejected', 'withdrawn'].includes(decision)) {
    return reject(state, entry, 'unknown_decision');
  }
  // New admission decisions only belong to the registration window. A
  // withdrawal is different: the protocol promises to honour it until the
  // competition is over, including during check-in and a running round.
  if (decision === 'withdrawn') {
    if (['finished', 'cancelled'].includes(state.status)) return reject(state, entry, 'wrong_status');
  } else if (!registrationWindowOpen(competition, state.status, entry.at)) {
    return reject(state, entry, 'wrong_status');
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

/**
 * A prize's public status — FEAT-058 §11.7.
 *
 * What this refuses is the thing an organizer cannot undo: two people being
 * told the same prize is theirs. The reducer holds a prize to one winner, so a
 * double award is a protocol error every client sees the same way rather than a
 * mistake discovered when the second person asks where their money is.
 */
function applyPrizeDecision(state, entry, competition) {
  const { prize_id: prizeId, pubkey, state: prizeState } = entry.data;

  const prize = (competition.prizes || []).find((p) => p.id === prizeId);
  if (!prize) return reject(state, entry, 'unknown_prize');
  if (!PRIZE_STATES.includes(prizeState)) return reject(state, entry, 'unknown_prize_state');

  // Nothing about a prize is decidable before the results are. A claim against
  // provisional standings is a claim against a number that can still move.
  if (state.status !== 'finished') return reject(state, entry, 'results_not_final');

  const held = state.prizes[prizeId];
  const awarded = held && ['approved', 'paid'].includes(held.state);

  // `expired` is the one state about the prize rather than about a person.
  if (prizeState === 'expired') {
    if (awarded) return reject(state, entry, 'prize_already_awarded');
    state.prizes[prizeId] = { pubkey: '', state: 'expired' };
    return state;
  }

  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');

  if (awarded && held.pubkey !== pubkey) {
    // Somebody already has it. Refusing the second award is the entire point.
    return reject(state, entry, 'prize_already_awarded');
  }

  state.prizes[prizeId] = { pubkey, state: prizeState };
  return state;
}

function applyCheckin(state, entry, competition) {
  const { pubkey, state: checkinState } = entry.data;
  if (!['checked_in', 'no_show'].includes(checkinState)) {
    return reject(state, entry, 'unknown_checkin_state');
  }
  if (checkinState === 'checked_in'
    && !checkinWindowOpen(competition, state.status, entry.at)) {
    return reject(state, entry, 'wrong_status');
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
  const action = entry.data.action;
  if (!competitionRunning(competition, state.status, entry.at)
    && !checkinWindowOpen(competition, state.status, entry.at)) {
    return reject(state, entry, 'wrong_status');
  }
  if (!QUEUE_ACTIONS.includes(action)) return reject(state, entry, 'unknown_queue_action');

  if (state.round === 0) {
    state.round = 1;
    if (competition.rules.climb_source === 'organizer_set' && competition.climbs?.length) {
      state.current_climb_id = competition.climbs[0].id;
    }
  }

  if (action === 'seed' || action === 'seed_open' || action === 'reorder') {
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
    if ((action === 'seed' || action === 'seed_open') && order.length !== eligible.length) {
      return reject(state, entry, 'incomplete_seed_order');
    }
    state.order = [...order];
    state.cursor = -1;
    if (action === 'seed_open') {
      const first = nextEligibleIndex(state, competition, -1, entry.at);
      if (first !== -1) {
        state.cursor = first;
        state.turn_opened_at = entry.at;
        state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
      } else {
        state.turn_opened_at = 0;
        state.turn_deadline_at = 0;
      }
    }
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

  if (action === 'skip_turn') {
    if (state.cursor < 0 || state.cursor >= state.order.length || state.turn_opened_at <= 0) {
      return reject(state, entry, 'no_open_turn');
    }
    let next = nextEligibleIndex(state, competition, state.cursor, entry.at);
    if (next === -1) {
      state.round += 1;
      for (const participant of state.participants) {
        participant.defers_used_this_round = 0;
        participant.consecutive_defers = 0;
      }
      next = nextEligibleIndex(state, competition, -1, entry.at);
    }
    if (next === -1) {
      state.cursor = -1;
      state.turn_opened_at = 0;
      state.turn_deadline_at = 0;
    } else {
      state.cursor = next;
      state.turn_opened_at = entry.at;
      state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
    }
    return state;
  }

  if (action === 'next_climb') {
    const climbId = entry.data.climb_id;
    const pool = competition.rules.climb_source === 'participant_choice'
      ? (competition.climb_pool?.options || []) : (competition.climbs || []);
    if (!pool.some((c) => c.id === climbId)) {
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
  if (!competitionRunning(competition, state.status, entry.at)) {
    return reject(state, entry, 'wrong_status');
  }
  const { pubkey, climb_id: climbId, outcome, attempt_no: attemptNo } = entry.data;
  if (!ATTEMPT_OUTCOMES.includes(outcome)) return reject(state, entry, 'unknown_outcome');
  const participant = findParticipant(state, pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (participant.result !== 'active') return reject(state, entry, 'participant_inactive');

  // The climb has to be one this competition actually runs. Without this an
  // attempt on any string at all would score: under `organizer_set` a climb
  // that is not in the competition, and under `participant_choice` a climb
  // Legacy claims/selections remain in state for hash and audit compatibility,
  // but never gate live access: every participant may attempt the whole pool.
  const pool = competition.rules.climb_source === 'participant_choice'
    ? (competition.climb_pool?.options || []) : (competition.climbs || []);
  if (!pool.some((c) => c.id === climbId)) {
    return reject(state, entry, 'unknown_climb');
  }
  // Look up WITHOUT creating. Creating first would leave a phantom
  // zero-attempt record behind on every rejected entry, and that record is
  // part of the hashed state — so a rejection would silently change the state
  // two clients are supposed to agree on.
  const existing = participant.climbs.find((c) => c.climb_id === climbId)
    ?? { climb_id: climbId, attempts_used: 0, outcome: 'none', at: 0 };
  if (existing.outcome === 'top') return reject(state, entry, 'already_topped');
  if (!Number.isInteger(attemptNo) || attemptNo !== existing.attempts_used + 1) {
    return reject(state, entry, 'attempt_out_of_order');
  }
  if (existing.attempts_used >= competition.rules.attempts_per_climb) {
    return reject(state, entry, 'no_attempts_left');
  }

  const record = climbRecord(participant, climbId);
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

/**
 * Record exactly one attempt for the open climber and hand over the wall in
 * the same signed log entry. This prevents a successful result followed by a
 * failed/racing queue update from leaving every client on a different turn.
 * Legacy `attempt_result` remains replayable, but new hosts use this operation.
 */
function applyCompleteTurn(state, entry, competition) {
  if (state.cursor < 0 || state.cursor >= state.order.length || state.turn_opened_at <= 0) {
    return reject(state, entry, 'no_open_turn');
  }
  if (entry.data.pubkey !== state.order[state.cursor]) {
    return reject(state, entry, 'not_current_turn');
  }

  const rejectedBefore = state.rejected.length;
  applyAttemptResult(state, entry, competition);
  if (state.rejected.length !== rejectedBefore) return state;

  let next = nextEligibleIndex(state, competition, state.cursor, entry.at);
  if (next === -1) {
    state.round += 1;
    state.cursor = -1;
    state.turn_deadline_at = 0;
    for (const participant of state.participants) {
      participant.defers_used_this_round = 0;
      participant.consecutive_defers = 0;
    }
    next = nextEligibleIndex(state, competition, -1, entry.at);
  }

  if (next !== -1) {
    state.cursor = next;
    state.turn_opened_at = entry.at;
    state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
  } else {
    state.cursor = -1;
    state.turn_opened_at = 0;
    state.turn_deadline_at = 0;
  }
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

function applyRetire(state, entry, competition) {
  const participant = findParticipant(state, entry.data.pubkey);
  if (!participant) return reject(state, entry, 'no_such_participant');
  if (participant.result !== 'active') return reject(state, entry, 'participant_inactive');

  const removedIndex = state.order.indexOf(participant.pubkey);
  const wasCurrent = removedIndex !== -1 && removedIndex === state.cursor;
  participant.result = 'finished';
  if (removedIndex !== -1) state.order.splice(removedIndex, 1);

  if (removedIndex !== -1 && removedIndex < state.cursor) state.cursor -= 1;
  if (wasCurrent) {
    let next = removedIndex < state.order.length
      && isEligible(state, competition, state.order[removedIndex], entry.at) ? removedIndex : -1;
    if (next === -1) next = nextEligibleIndex(state, competition, removedIndex - 1, entry.at);
    if (next === -1) {
      state.round += 1;
      for (const candidate of state.participants) {
        candidate.defers_used_this_round = 0;
        candidate.consecutive_defers = 0;
      }
      next = nextEligibleIndex(state, competition, -1, entry.at);
    }
    if (next === -1) {
      state.cursor = -1;
      state.turn_opened_at = 0;
      state.turn_deadline_at = 0;
    } else {
      state.cursor = next;
      state.turn_opened_at = entry.at;
      state.turn_deadline_at = entry.at + competition.rules.turn_deadline_sec;
    }
  } else if (state.cursor >= state.order.length) {
    state.cursor = -1;
    state.turn_opened_at = 0;
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

function mergePatch(target, patch) {
  const result = structuredClone(target);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergePatch(result[key], value);
    } else result[key] = structuredClone(value);
  }
  return result;
}

/** Apply RFC-7396-style merge patches while preserving historical references. */
function applyConfigUpdate(state, entry, competition) {
  const { revision, patch, impact } = entry.data;
  if (!Number.isInteger(revision) || revision !== state.config_revision + 1) {
    return reject(state, entry, 'config_bad_revision');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return reject(state, entry, 'config_empty_patch');
  }
  const derivedImpact = configPatchImpact(patch);
  if (!derivedImpact) return reject(state, entry, 'config_immutable_field');
  if (impact !== derivedImpact) return reject(state, entry, 'config_impact_mismatch');

  const next = mergePatch(competition, patch);
  next.revision = revision;
  const validation = validateCompetitionConfig(next);
  if (!validation.ok) return reject(state, entry, 'config_invalid');

  const referencedClimbs = new Set([
    state.current_climb_id,
    ...Object.keys(state.claims),
    ...state.participants.flatMap((p) => [
      ...p.selections,
      ...p.climbs.map((climb) => climb.climb_id),
    ]),
  ].filter(Boolean));
  const nextClimbs = new Set([
    ...(next.climbs || []).map((climb) => climb.id),
    ...(next.climb_pool?.options || []).map((climb) => climb.id),
  ]);
  if ([...referencedClimbs].some((id) => !nextClimbs.has(id))) {
    return reject(state, entry, 'config_referenced_climb');
  }
  const climbById = (config) => new Map([
    ...(config.climbs || []), ...(config.climb_pool?.options || []),
  ].map((climb) => [climb.id, climb]));
  const beforeById = climbById(competition);
  const afterById = climbById(next);
  if ([...referencedClimbs].some((id) => {
    const before = beforeById.get(id);
    const after = afterById.get(id);
    return before && after && (before.climb_uuid !== after.climb_uuid
      || before.angle !== after.angle || before.board_cell_id !== after.board_cell_id);
  })) return reject(state, entry, 'config_referenced_climb');
  const nextDivisions = new Set((next.divisions || []).map((division) => division.id));
  if (state.participants.some((p) => p.division && !nextDivisions.has(p.division))) {
    return reject(state, entry, 'config_referenced_division');
  }

  state.effective_config = next;
  state.config_revision = revision;
  state.audit.push({
    seq: entry.seq, op: 'config_update', reason: entry.reason, at: entry.at,
    revision, impact,
  });
  return state;
}

const HANDLERS = {
  lifecycle: applyLifecycle,
  registration_decision: applyRegistrationDecision,
  payment_decision: applyPaymentDecision,
  claim_decision: applyClaimDecision,
  prize_decision: applyPrizeDecision,
  checkin: applyCheckin,
  queue: applyQueue,
  defer_decision: applyDeferDecision,
  attempt_result: applyAttemptResult,
  complete_turn: applyCompleteTurn,
  disqualify: applyDisqualify,
  retire: applyRetire,
  announcement: applyAnnouncement,
  config_update: applyConfigUpdate,
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
    if (!entry.data.replacement || typeof entry.data.replacement !== 'object') {
      return reject(state, entry, 'correction_missing_replacement');
    }
    // A lone state has no earlier entry to replace. Full-history `reduce()`
    // handles corrections; applying the body here at its later seq would be a
    // different and unsafe operation.
    return reject(state, entry, 'correction_bad_target');
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
 * @returns {{ state: object, chainBreakAt: number|null, chosenEntries: object[] }}
 */
export function reduce({ competition, competitionEventId, entries, snapshot }) {
  const baseState = snapshot
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
  let forkDetected = baseState.fork_detected;
  const chosenChain = [];

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
      forkDetected = true;
      // Lower created_at wins; ties broken by lexicographically lower event id.
      // Which branch is "right" is unknowable — that every client picks the
      // same one is not.
      chosen = [...linked].sort((a, b) =>
        a.createdAt - b.createdAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))[0];
    }
    chosenChain.push(chosen);
    expectedPrev = chosen.eventId;
    seq += 1;
  }

  /*
   * A correction replaces an earlier effect at the point where that effect
   * originally occurred. Applying its body at the correction's later seq is
   * observably wrong for attempts: attempt_no 1 is no longer the next attempt,
   * and a correction after finish fails the running-window check. Plan all
   * corrections in the chosen prefix first, then replay that prefix once with
   * the replacements in their original context. The signed chain metadata and
   * correction audit entry still retain their real, later sequence numbers.
   */
  const corrections = new Map();
  const replacements = new Map();
  const available = new Map(chosenChain.map((item) => [item.entry.seq, item]));
  for (const item of chosenChain) {
    const entry = item.entry;
    if (entry.op !== 'correction') continue;
    const target = entry.data.supersedes_seq;
    const replacement = entry.data.replacement;
    let error = null;
    if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)
      || !replacement.data || typeof replacement.data !== 'object' || Array.isArray(replacement.data)) {
      error = 'correction_missing_replacement';
    } else if (!Number.isInteger(target) || target < 1 || target >= entry.seq) {
      error = 'correction_bad_target';
    } else if (snapshot && target <= snapshot.seq) {
      error = 'correction_bad_target';
    } else if (!available.has(target) || available.get(target).entry.op === 'correction') {
      error = 'correction_bad_target';
    } else if (!HANDLERS[replacement.op]) {
      error = 'unknown_op';
    }
    const plan = { target, replacement, error };
    corrections.set(entry.seq, plan);
    if (!error) {
      if (!replacements.has(target)) replacements.set(target, []);
      replacements.get(target).push(plan);
    }
  }

  let state = baseState;
  state.fork_detected = forkDetected;
  for (const item of chosenChain) {
    const entry = item.entry;
    if (entry.op === 'correction') {
      const plan = corrections.get(entry.seq);
      const audit = {
        seq: entry.seq, op: 'correction', reason: entry.reason, at: entry.at,
        supersedes_seq: entry.data.supersedes_seq,
      };
      if (!plan.error && state.status === 'finished') audit.supersedes_results = true;
      state.audit.push(audit);
      if (plan.error) reject(state, entry, plan.error);
    } else {
      const plans = replacements.get(entry.seq);
      if (!plans) {
        applyEntry(state, entry, state.effective_config || competition);
      } else {
        const before = structuredClone(state);
        let latestValid = null;
        for (const plan of plans) {
          const candidate = structuredClone(before);
          const rejectedBefore = candidate.rejected.length;
          applyEntry(candidate, { ...entry, op: plan.replacement.op, data: plan.replacement.data },
            candidate.effective_config || competition);
          if (candidate.rejected.length !== rejectedBefore) {
            plan.error = 'correction_invalid_replacement';
          } else {
            latestValid = candidate;
          }
        }
        // Every candidate replaces the same original operation. The latest
        // valid amendment wins; an invalid later amendment cannot erase it.
        if (latestValid) state = latestValid;
        else applyEntry(state, entry, state.effective_config || competition);
      }
    }
    state.seq = entry.seq;
    state.head = item.eventId;
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
  return { state, chainBreakAt, chosenEntries: chosenChain.map((item) => item.entry) };
}

/**
 * The state as it is hashed and compared across clients. Fields that are
 * genuinely local (did *this* client start from a snapshot?) are excluded, so
 * a snapshot-started client and a full-replay client can still agree.
 */
export function hashableState(state) {
  const { from_snapshot: _ignored, results_at: _derived, ...rest } = state;
  return rest;
}
