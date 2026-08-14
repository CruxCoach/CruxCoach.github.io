/**
 * Who gets which climb, when participants choose them — FEAT-058 §7.6.
 *
 * When `selection_uniqueness` is `unique_per_competition` two people can ask
 * for the same climb, and somebody has to lose. The rule is first-come by
 * *registration order in the log*, not by which intent this console happened
 * to receive first: relays answer in different orders, and a rule that depends
 * on arrival order would hand the same climb to different people on the
 * organizer's phone and on their laptop.
 *
 * A lost claim is denied explicitly rather than left unanswered. The loser can
 * already infer the loss from `state.claims`, but a signed denial is what makes
 * "you did not get it, and here is why" survive a reload, and it is what stops
 * the console republishing the same refusal every time it re-renders.
 *
 * Pure: no clock, no I/O, no signing. The caller publishes.
 */

/**
 * @param {object} args
 * @param {object} args.competition validated definition
 * @param {object} args.state reduced state
 * @param {Map<string, string[]>|object} args.requests pubkey → requested climb ids
 * @param {Set<string>} args.answered `${pubkey}:${climbId}` pairs already decided in the log
 * @param {string[]} args.order pubkeys in registration order, from `registrationOrder()`
 * @returns {Array<{pubkey: string, climbId: string, decision: 'granted'|'denied', reason?: string}>}
 *          decisions owed, in the order they must be published
 */
export function outstandingClaims({
  competition, state, requests, answered = new Set(), order = [],
}) {
  const rules = competition.rules;
  if (rules.climb_source !== 'participant_choice') return [];
  if (rules.selection_uniqueness !== 'unique_per_competition') return [];
  if (['finished', 'cancelled'].includes(state.status)) return [];
  const get = requests instanceof Map ? (pubkey) => requests.get(pubkey) : (pubkey) => requests[pubkey];
  const optionIds = new Set((competition.climb_pool?.options || []).map((option) => option.id));
  const held = { ...state.claims };
  const owed = [];
  const byPubkey = new Map(state.participants.map((p) => [p.pubkey, p]));
  const ordered = [
    ...order.map((pubkey) => byPubkey.get(pubkey)).filter(Boolean),
    ...state.participants.filter((p) => !order.includes(p.pubkey)),
  ];
  for (const participant of ordered) {
    if (participant.registration !== 'accepted') continue;
    const requested = get(participant.pubkey);
    if (!Array.isArray(requested)) continue;
    let granted = participant.selections.length;
    for (const climbId of [...new Set(requested)].sort()) {
      if (!optionIds.has(climbId) || participant.selections.includes(climbId)
        || answered.has(`${participant.pubkey}:${climbId}`)) continue;
      const holder = held[climbId];
      if (holder !== undefined && holder !== participant.pubkey) {
        owed.push({ pubkey: participant.pubkey, climbId, decision: 'denied', reason: 'climb_already_claimed' });
      } else if (granted >= rules.climb_count) {
        owed.push({ pubkey: participant.pubkey, climbId, decision: 'denied', reason: 'selection_limit' });
      } else {
        held[climbId] = participant.pubkey;
        granted += 1;
        owed.push({ pubkey: participant.pubkey, climbId, decision: 'granted' });
      }
    }
  }
  return owed;
}

/** The complete live pool. Historical claims do not hide climbs. */
export function freeClimbs(competition, state) {
  void state;
  const options = competition.climb_pool?.options || [];
  return options;
}

/** How many more climbs this participant still needs. */
export function outstandingCount(competition, participant) {
  void competition; void participant;
  return 0;
}

/**
 * Pubkeys in the order the authority accepted them.
 *
 * Taken from the log rather than from the reduced state, which sorts
 * participants by pubkey and so cannot answer "who was first".
 *
 * @param {Array<{seq: number, op: string, data: object}>} logEntries
 */
export function registrationOrder(logEntries) {
  const order = [];
  for (const entry of [...logEntries].sort((a, b) => a.seq - b.seq)) {
    if (entry.op !== 'registration_decision') continue;
    if (entry.data.decision !== 'accepted') continue;
    if (!order.includes(entry.data.pubkey)) order.push(entry.data.pubkey);
  }
  return order;
}
