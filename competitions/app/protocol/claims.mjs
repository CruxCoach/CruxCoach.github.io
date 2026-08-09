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

  const get = requests instanceof Map
    ? (pubkey) => requests.get(pubkey)
    : (pubkey) => requests[pubkey];
  const optionIds = new Set((competition.climb_pool?.options || []).map((option) => option.id));
  // A working copy: two grants in the same pass must not both take one climb.
  const held = { ...state.claims };
  const owed = [];

  // `state.participants` is sorted by pubkey so that two clients hash the same
  // state — which makes it exactly the wrong order to decide a race in, because
  // "lowest pubkey wins" is arbitrary and anyone can grind a key until theirs
  // is low. Registration order is the fair rule and is equally deterministic:
  // it comes from the seq of the decision that accepted them.
  const byPubkey = new Map(state.participants.map((p) => [p.pubkey, p]));
  const ordered = [
    ...order.map((pubkey) => byPubkey.get(pubkey)).filter(Boolean),
    ...state.participants.filter((p) => !order.includes(p.pubkey)),
  ];

  for (const participant of ordered) {
    // Only an accepted entrant can hold a climb. The reducer refuses a claim
    // for someone who is not a participant yet, and a waitlisted entrant
    // holding a climb they may never use would starve the people who are in.
    if (participant.registration !== 'accepted') continue;
    const requested = get(participant.pubkey);
    if (!Array.isArray(requested)) continue;

    let granted = participant.selections.length;
    for (const climbId of [...new Set(requested)].sort()) {
      if (!optionIds.has(climbId)) continue;
      if (participant.selections.includes(climbId)) continue;
      if (answered.has(`${participant.pubkey}:${climbId}`)) continue;

      const holder = held[climbId];
      if (holder !== undefined && holder !== participant.pubkey) {
        owed.push({
          pubkey: participant.pubkey, climbId, decision: 'denied', reason: 'climb_already_claimed',
        });
      } else if (granted >= rules.climb_count) {
        // Asking for more than the competition uses is not an error worth
        // refusing the entry over, but the surplus does not get held.
        owed.push({
          pubkey: participant.pubkey, climbId, decision: 'denied', reason: 'selection_limit',
        });
      } else {
        held[climbId] = participant.pubkey;
        granted += 1;
        owed.push({ pubkey: participant.pubkey, climbId, decision: 'granted' });
      }
    }
  }
  return owed;
}

/** Pool climbs nobody holds yet — what a participant may still pick. */
export function freeClimbs(competition, state) {
  const options = competition.climb_pool?.options || [];
  if (competition.rules.selection_uniqueness !== 'unique_per_competition') return options;
  return options.filter((option) => state.claims[option.id] === undefined);
}

/** How many more climbs this participant still needs. */
export function outstandingCount(competition, participant) {
  return Math.max(0, competition.rules.climb_count - (participant?.selections.length || 0));
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
