/**
 * Presentation policy shared by the participant and projection screens.
 *
 * This module is deliberately DOM-free. It derives labels and bounded previews
 * from reduced protocol state; it never invents a second, local competition
 * state. Keeping the policy here also makes the state matrix testable without a
 * browser or relay.
 */

const TERMINAL = new Set(['finished', 'cancelled']);

export function queuePreview(state, participants, limit = 7) {
  if (!state || !Array.isArray(state.order)) return { entries: [], hidden: 0 };
  const byKey = new Map((participants || []).map((participant) => [participant.pubkey, participant]));
  const start = Math.max(0, state.cursor < 0 ? 0 : state.cursor);
  // Keep the whole rotation visible. Entries before the cursor have already
  // climbed in this round; appending them (and labelling them) is more truthful
  // than making them disappear until the organizer starts the next round.
  const remaining = state.cursor < 0
    ? state.order.map((pubkey) => ({ pubkey, nextRound: false }))
    : state.order.slice(start).map((pubkey) => ({ pubkey, nextRound: false }))
      .concat(state.order.slice(0, start).map((pubkey) => ({ pubkey, nextRound: true })));
  const entries = remaining.slice(0, limit).map(({ pubkey, nextRound }, offset) => ({
    pubkey,
    participant: byKey.get(pubkey) || null,
    absoluteIndex: state.order.indexOf(pubkey),
    queuePosition: offset,
    current: state.cursor >= 0 && start + offset === state.cursor,
    next: state.cursor >= 0 && start + offset === state.cursor + 1,
    nextRound,
  }));
  return { entries, hidden: Math.max(0, remaining.length - entries.length) };
}

export function rotationPreview(competition, state, participant, limit = 5) {
  if (!competition || !state) return { entries: [], hidden: 0 };
  const source = competition.rules?.climb_source === 'participant_choice'
    ? (competition.climb_pool?.options || [])
    : (competition.climbs || []);
  if (!source.length) return { entries: [], hidden: 0 };

  const completed = new Set((participant?.climbs || [])
    .filter((climb) => climb.outcome === 'top' || climb.outcome === 'dnf')
    .map((climb) => climb.climb_id));
  let ordered;
  if (competition.rules?.climb_source === 'organizer_set'
    && competition.rules?.progression !== 'asynchronous_turns') {
    const current = source.findIndex((climb) => climb.id === state.current_climb_id);
    const pivot = current < 0 ? 0 : current;
    ordered = source.slice(pivot).concat(source.slice(0, pivot));
  } else {
    ordered = source.filter((climb) => !completed.has(climb.id));
  }
  const synchronous = competition.rules?.climb_source === 'organizer_set'
    && competition.rules?.progression !== 'asynchronous_turns';
  const entries = ordered.slice(0, limit).map((climb, index) => ({
    ...climb,
    current: synchronous && climb.id === state.current_climb_id,
    next: index === (synchronous ? 1 : 0),
    completed: completed.has(climb.id),
  }));
  return { entries, hidden: Math.max(0, ordered.length - entries.length) };
}

/** One truthful climb resolver shared by host, participant, and projector. */
export function activeParticipantClimb(
  competition, state, participant, choiceClimbId, remainingClimbs = [],
) {
  if (!competition || !state) return null;
  if (competition.rules?.climb_source === 'organizer_set') {
    return (competition.climbs || []).find((climb) => climb.id === state.current_climb_id) || null;
  }
  if (!participant || !choiceClimbId) return null;
  // `remainingClimbs` excludes topped/dnf and attempts-exhausted choices.
  return remainingClimbs.find((climb) => climb.id === choiceClimbId) || null;
}

export function personalCue(state, pubkey, running = state?.status === 'running') {
  if (!state || !pubkey) return { kind: 'spectator', ahead: null, index: -1 };
  const index = state.order.indexOf(pubkey);
  if (TERMINAL.has(state.status)) return { kind: state.status, ahead: null, index };
  if (state.status === 'paused') return { kind: 'paused', ahead: null, index };
  if (!running) return { kind: 'waiting', ahead: null, index };
  if (index < 0) return { kind: 'not_queued', ahead: null, index };
  if (state.cursor === index) return { kind: 'current', ahead: 0, index };
  const cursor = state.cursor < 0 ? 0 : state.cursor;
  if (state.cursor >= 0 && index < cursor) {
    return { kind: 'next_round', ahead: state.order.length - cursor + index, index };
  }
  const ahead = index - cursor;
  return { kind: ahead === 1 ? 'next' : 'queued', ahead, index };
}

/**
 * A cautious turn estimate. It is deliberately unavailable across a round
 * boundary: the protocol has no deadline for when an organizer opens a new
 * round, so presenting one there would be invented precision.
 */
export function turnEstimate(state, competition, pubkey, nowSeconds, running = state?.status === 'running') {
  if (!state || !competition || !pubkey || !running || state.cursor < 0
    || state.turn_deadline_at <= nowSeconds) return null;
  const index = state.order.indexOf(pubkey);
  if (index <= state.cursor) return null;
  const ahead = index - state.cursor;
  const currentLeft = state.turn_deadline_at - nowSeconds;
  const turnSeconds = competition.rules?.turn_deadline_sec || 0;
  if (turnSeconds <= 0) return null;
  return { seconds: currentLeft + Math.max(0, ahead - 1) * turnSeconds, ahead };
}

export function deferAvailability(state, competition, participant, pubkey) {
  if (!state || !competition || !participant) return { allowed: false, reason: 'not_entered' };
  if (state.status === 'paused') return { allowed: false, reason: 'paused' };
  if (state.status !== 'running') return { allowed: false, reason: 'phase' };
  if (state.order[state.cursor] !== pubkey) return { allowed: false, reason: 'not_your_turn' };
  const left = Math.max(0, competition.rules.defer_budget_per_round - participant.defers_used_this_round);
  if (left === 0) return { allowed: false, reason: 'budget' };
  if (participant.consecutive_defers >= competition.rules.max_consecutive_defers) {
    return { allowed: false, reason: 'consecutive' };
  }
  return { allowed: true, reason: null, left };
}

/** A retained state is called stale only after all relays are gone. */
export function syncHealth(snapshot, nowSeconds, staleAfterSeconds = 60) {
  const connected = snapshot?.connectedRelays ?? 0;
  const syncedAt = snapshot?.lastSyncedAt ?? 0;
  const age = syncedAt > 0 ? Math.max(0, nowSeconds - syncedAt) : null;
  if (connected > 0) return { kind: 'live', age, connected };
  if (snapshot?.state && age !== null && age >= staleAfterSeconds) return { kind: 'stale', age, connected: 0 };
  if (snapshot?.state) return { kind: 'offline', age, connected: 0 };
  return { kind: 'connecting', age: null, connected: 0 };
}

export function tiedAt(standings, index) {
  const row = standings[index];
  if (!row || !row.rank) return false;
  return standings.some((other, otherIndex) => otherIndex !== index && other.rank === row.rank);
}
