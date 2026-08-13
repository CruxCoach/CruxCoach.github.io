/**
 * Standings — FEAT-058 §6.4, §16.
 *
 * Derived, never stored: standings are a pure function of the reduced state and
 * the competition rules, so they cannot drift from the log. Like the reducer,
 * this is synchronous, pure, and totally ordered — two clients must agree on
 * the ranking, including on how ties are laid out.
 */

/** Climbs that count for a participant: their granted selections, or all of them. */
function scoredClimbs(participant, competition) {
  if (competition.rules.climb_source === 'participant_choice' && participant.selections.length) {
    return participant.climbs.filter((c) => participant.selections.includes(c.climb_id));
  }
  return participant.climbs;
}

function pointsFor(climbId, competition) {
  // Either source: a participant-chosen climb lives in the pool, not in
  // `climbs`, and looking only at `climbs` scored every one of them zero.
  const climb = (competition.climbs || []).find((c) => c.id === climbId)
    || (competition.climb_pool?.options || []).find((c) => c.id === climbId);
  return Number.isInteger(climb?.points) ? climb.points : 0;
}

/**
 * How many per-climb results contribute to the standing. Older v1 events did
 * not carry this additive field, so their historical all-results behaviour is
 * exactly `climb_count`.
 */
export function countedClimbCount(competition) {
  const available = competition?.rules?.climb_count;
  const explicit = competition?.rules?.counted_climb_count;
  return Number.isInteger(explicit) && explicit >= 1 && explicit <= available ? explicit : available;
}

function contribution(climb, competition) {
  const top = climb.outcome === 'top' ? 1 : 0;
  const zone = top || climb.outcome === 'zone' ? 1 : 0;
  const topAttempts = top ? climb.attempts_used : 0;
  const zoneAttempts = zone ? climb.attempts_used : 0;
  const achievement = competition.rules.score_points || { zone: 0, top: 0, flash: 0 };
  const points = top
    ? (competition.rules.scoring === 'achievement_points'
      ? achievement.zone + achievement.top + (climb.attempts_used === 1 ? achievement.flash : 0)
      : pointsFor(climb.climb_id, competition))
    : (climb.outcome === 'zone' && competition.rules.scoring === 'achievement_points' ? achievement.zone : 0);
  return {
    climb,
    top,
    zone,
    topAttempts,
    zoneAttempts,
    points,
  };
}

/** Best-result selection is itself deterministic, before the chosen rows aggregate. */
function bestContributions(participant, competition) {
  const pointScoring = competition.rules.scoring !== 'tops_then_attempts';
  return scoredClimbs(participant, competition)
    .map((climb) => contribution(climb, competition))
    .sort((a, b) => {
      if (pointScoring && a.points !== b.points) return b.points - a.points;
      if (a.top !== b.top) return b.top - a.top;
      if (a.topAttempts !== b.topAttempts) return a.topAttempts - b.topAttempts;
      if (a.zone !== b.zone) return b.zone - a.zone;
      if (a.zoneAttempts !== b.zoneAttempts) return a.zoneAttempts - b.zoneAttempts;
      if (a.climb.at !== b.climb.at) return a.climb.at - b.climb.at;
      return String(a.climb.climb_id).localeCompare(String(b.climb.climb_id));
    })
    .slice(0, countedClimbCount(competition));
}

/**
 * Competition-style tally.
 *
 * `attempts` counts only the attempts spent on climbs that were TOPPED — the
 * standard "attempts to top" metric. Counting every attempt instead would rank
 * a climber who never left the ground above one who tried three times and fell,
 * which is the wrong way round and was exactly what the first version of this
 * file did. `total_attempts` keeps the raw number for display.
 */
function tally(participant, competition) {
  const contributions = bestContributions(participant, competition);
  let tops = 0;
  let zones = 0;
  let attempts = 0;
  let zoneAttempts = 0;
  let totalAttempts = 0;
  let points = 0;
  let finishedAt = 0;
  for (const result of contributions) {
    const { climb } = result;
    totalAttempts += climb.attempts_used;
    if (result.top) {
      tops += 1;
      zones += 1; // a top implies its zone
      attempts += climb.attempts_used;
      zoneAttempts += climb.attempts_used;
      points += result.points;
      if (climb.at > finishedAt) finishedAt = climb.at;
    } else if (result.zone) {
      zones += 1;
      zoneAttempts += climb.attempts_used;
      points += result.points;
    }
  }
  return {
    tops, zones, attempts, points,
    zone_attempts: zoneAttempts,
    total_attempts: totalAttempts,
    finished_at: finishedAt,
  };
}

/**
 * Comparators, applied in order. Each returns a negative number when `a` should
 * rank ahead of `b`. `seed_order` is the only one that can depend on something
 * outside the tally, so it takes the seeded running order.
 */
function comparators(competition, seedOrder) {
  // The IFSC boulder ordering: tops, then attempts to top, then zones, then
  // attempts to zone. Point formats replace only the first key.
  const primary = competition.rules.scoring === 'tops_then_attempts'
    ? (a, b) => b.tops - a.tops || a.attempts - b.attempts
      || b.zones - a.zones || a.zone_attempts - b.zone_attempts
    : (a, b) => b.points - a.points;

  const byName = {
    fewest_attempts: (a, b) => a.attempts - b.attempts,
    most_zones: (a, b) => b.zones - a.zones,
    fewest_zone_attempts: (a, b) => a.zone_attempts - b.zone_attempts,
    // A climber who finished earlier ranks ahead; someone who never finished
    // (0) must sort last, not first.
    earliest_finish: (a, b) => {
      const left = a.finished_at || Number.MAX_SAFE_INTEGER;
      const right = b.finished_at || Number.MAX_SAFE_INTEGER;
      return left - right;
    },
    seed_order: (a, b) => {
      const left = seedOrder.indexOf(a.pubkey);
      const right = seedOrder.indexOf(b.pubkey);
      return (left === -1 ? Number.MAX_SAFE_INTEGER : left) - (right === -1 ? Number.MAX_SAFE_INTEGER : right);
    },
  };
  return [primary, ...competition.rules.tiebreaks.map((t) => byName[t]).filter(Boolean)];
}

/** True when two entries are equal on every ranking comparator (a genuine tie). */
function tied(a, b, chain) {
  return chain.every((compare) => compare(a, b) === 0);
}

/**
 * @returns {Array<object>} one row per ranked participant, ordered by division
 *   (ascending id) then rank. Ties share a rank and the next rank skips, the
 *   way a results sheet reads: 1, 1, 3.
 */
export function computeStandings(state, competition) {
  const chain = comparators(competition, state.order);
  const rows = state.participants
    .filter((p) => p.registration === 'accepted' && p.checkin === 'checked_in')
    .map((p) => ({
      pubkey: p.pubkey,
      display: p.display,
      division: p.division,
      result: p.result,
      ...tally(p, competition),
    }));

  const divisions = [...new Set(rows.map((r) => r.division))].sort();
  const out = [];
  for (const division of divisions) {
    const group = rows.filter((r) => r.division === division);
    // Disqualified and no-show climbers are listed, but never above someone who
    // climbed — they carry no rank at all.
    const ranked = group.filter((r) => r.result === 'active' || r.result === 'finished');
    const unranked = group.filter((r) => !(r.result === 'active' || r.result === 'finished'));

    ranked.sort((a, b) => {
      for (const compare of chain) {
        const verdict = compare(a, b);
        if (verdict !== 0) return verdict;
      }
      // Total order guarantee: without this, two genuinely tied climbers could
      // come out in different positions on two clients.
      return a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0;
    });

    let rank = 0;
    ranked.forEach((row, index) => {
      if (index === 0 || !tied(row, ranked[index - 1], chain)) rank = index + 1;
      out.push({ ...row, rank });
    });
    unranked
      .sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0))
      .forEach((row) => out.push({ ...row, rank: 0 }));
  }
  return out;
}
