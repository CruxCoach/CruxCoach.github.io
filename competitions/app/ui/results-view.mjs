import { displayName, el, shortKey } from './dom.mjs';
import { usesPointLeaderboard } from './scoring-copy.mjs?v=20260813-1';

function participantFor(snapshot, pubkey) {
  return snapshot.state.participants.find((participant) => participant.pubkey === pubkey) || null;
}

function climbName(snapshot, climbId) {
  const climbs = [...(snapshot.competition.climbs || []),
    ...(snapshot.competition.climb_pool?.options || [])];
  return climbs.find((climb) => climb.id === climbId)?.label || climbId;
}

function metric(value, label) {
  return el('div', { className: 'result-metric' }, [
    el('strong', { text: String(value) }),
    el('span', { text: label }),
  ]);
}

function standingMetrics(row, points, t) {
  return [
    points && metric(row.points, t('table.points')),
    metric(row.tops, t('table.tops')),
    metric(row.zones, t('table.zones')),
    metric(row.attempts, t('table.attempts')),
  ];
}

function podium(snapshot, t) {
  const points = usesPointLeaderboard(snapshot.competition);
  const rows = snapshot.standings.filter((row) => row.rank > 0).slice(0, 3);
  if (!rows.length) return null;
  return el('ol', { className: 'results-podium', attrs: { 'aria-label': t('results.podium') } },
    rows.map((row) => el('li', { className: `result-place result-place-${Math.min(row.rank, 3)}` }, [
      el('span', { className: 'result-medal', text: row.rank === 1 ? '1' : String(row.rank) }),
      el('div', { className: 'result-podium-copy' }, [
        el('strong', { text: row.display || shortKey(row.pubkey) }),
        el('span', { text: points
          ? t('results.podium.points', { points: row.points, tops: row.tops })
          : t('results.podium.tops', { tops: row.tops, attempts: row.attempts }) }),
      ]),
    ])));
}

function finalTable(snapshot, t, currentPubkey) {
  const points = usesPointLeaderboard(snapshot.competition);
  return el('section', { className: 'card results-ranking' }, [
    el('div', { className: 'section-heading' }, [
      el('h2', { text: t('live.final_ranking') }),
      el('span', { className: 'badge ok', text: t('results.verified') }),
    ]),
    snapshot.state.audit.some((entry) => entry.supersedes_results === true)
      && el('p', { className: 'notice warn', attrs: { role: 'status' }, text: t('results.amended') }),
    el('div', { className: 'table-scroll' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { className: 'num', text: t('table.rank') }),
          el('th', { text: t('table.climber') }),
          points && el('th', { className: 'num', text: t('table.points') }),
          el('th', { className: 'num', text: t('table.tops') }),
          el('th', { className: 'num', text: t('table.zones') }),
          el('th', { className: 'num', text: t('table.attempts') }),
        ])]),
        el('tbody', {}, snapshot.standings.map((row) => el('tr', {
          className: row.pubkey === currentPubkey ? 'me' : '',
        }, [
          el('td', { className: 'num result-rank', text: row.rank || '—' }),
          el('td', {}, [
            el('strong', { text: row.display || shortKey(row.pubkey) }),
            row.pubkey === currentPubkey && el('span', { className: 'result-you', text: t('results.you') }),
          ]),
          points && el('td', { className: 'num', text: String(row.points) }),
          el('td', { className: 'num', text: String(row.tops) }),
          el('td', { className: 'num', text: String(row.zones) }),
          el('td', { className: 'num', text: String(row.attempts) }),
        ]))),
      ]),
    ]),
  ]);
}

function breakdown(snapshot, t, pubkeys) {
  const entries = pubkeys.map((pubkey) => {
    const participant = participantFor(snapshot, pubkey);
    if (!participant) return null;
    return el('details', { className: 'result-breakdown-person' }, [
      el('summary', {}, [
        el('strong', { text: displayName(participant) }),
        el('span', { text: t('results.climb_count', { count: participant.climbs.length }) }),
      ]),
      participant.climbs.length
        ? el('ul', { className: 'result-climbs' }, participant.climbs.map((climb) => el('li', {}, [
          el('strong', { text: climbName(snapshot, climb.climb_id) }),
          el('span', { text: t('results.climb_result', {
            outcome: t(`org.${climb.outcome}`), attempts: climb.attempts_used,
          }) }),
        ])))
        : el('p', { className: 'small', text: t('results.no_attempts') }),
    ]);
  }).filter(Boolean);
  if (!entries.length) return null;
  return el('section', { className: 'card results-breakdown' }, [
    el('h2', { text: t(pubkeys.length === 1 ? 'results.your_climbs' : 'results.breakdown') }),
    ...entries,
  ]);
}

/** Shared final-results hierarchy for projection, participant and host screens. */
export function resultsView(snapshot, t, { currentPubkey = null, mode = 'public' } = {}) {
  const points = usesPointLeaderboard(snapshot.competition);
  const winners = snapshot.standings.filter((row) => row.rank === 1);
  const winnerNames = winners.map((row) => row.display || shortKey(row.pubkey)).join(' · ');
  const mine = currentPubkey
    ? snapshot.standings.find((row) => row.pubkey === currentPubkey) : null;
  const hero = el('section', { className: 'results-hero' }, [
    el('p', { className: 'eyebrow', text: t('results.final') }),
    el('h2', { text: winners.length ? winnerNames : t('results.no_scored') }),
    el('p', { className: 'results-hero-copy', text: winners.length === 1
      ? t('results.winner') : winners.length > 1 ? t('results.winners') : t('results.no_scored_hint') }),
    podium(snapshot, t),
  ]);
  const personal = mine ? el('section', { className: 'card result-personal' }, [
    el('div', { className: 'result-personal-rank' }, [
      el('span', { text: t('results.your_result') }),
      el('strong', { text: mine.rank ? `#${mine.rank}` : '—' }),
    ]),
    el('div', { className: 'result-metrics' }, standingMetrics(mine, points, t)),
  ]) : null;
  const detailPubkeys = mode === 'host'
    ? snapshot.standings.map((row) => row.pubkey)
    : mode === 'participant' && currentPubkey ? [currentPubkey] : [];
  return [hero, personal, finalTable(snapshot, t, currentPubkey), breakdown(snapshot, t, detailPubkeys)];
}
