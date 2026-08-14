/**
 * Read-only host projection. It owns no signer and writes no events.
 * Everything on screen is derived from the same reduced log as the entrant
 * and organizer views; transport freshness is shown separately from that
 * event truth.
 */
import {
  bootstrap, byId, devRelayBanner, el, integrityGuard, integrityNotices, joinLink,
  openCompetition, openCompetitionForm, parseCompetitionRef, replace,
} from './common.mjs?v=20260814-11';
import { displayName, formatDateTime, formatSeconds, qrSvg, shortKey } from '../ui/dom.mjs';
import { competitionRunning, parseIntentEvent } from '../protocol/competition.mjs?v=20260814-6';
import { scoringExplanation, usesPointLeaderboard } from '../ui/scoring-copy.mjs?v=20260813-1';
import { queuePreview, rotationPreview, syncHealth, tiedAt } from '../ui/live-view.mjs?v=20260814-2';

const { t, language } = bootstrap();

let store = null;
let ref = null;
let ticker = null;
let previousRanks = new Map();
let lastHealthKind = '';
let lastEffectiveStatus = '';
const choices = new Map();

const view = byId('view');
const statusNode = byId('load-status');

function effectiveStatus(snapshot, now = Math.floor(Date.now() / 1000)) {
  return competitionRunning(snapshot.competition, snapshot.state.status, now)
    ? 'running' : snapshot.state.status;
}

function climbLabel(snapshot, climbId) {
  if (!climbId) return '—';
  const climb = (snapshot.competition.climbs || []).find((item) => item.id === climbId)
    || (snapshot.competition.climb_pool?.options || []).find((item) => item.id === climbId);
  return climb?.label || climbId;
}

/** Latest relay-visible choice, provided it is still legal for this entrant. */
function chosenClimb(snapshot, pubkey) {
  if (!pubkey || snapshot.competition.rules.climb_source !== 'participant_choice') return null;
  const intent = choices.get(pubkey);
  const climbId = intent?.intent.data?.climb_id;
  if (!climbId) return null;
  return store.remainingClimbs(pubkey).find((climb) => climb.id === climbId) || null;
}

function boardLabel(competition) {
  const board = competition.board || {};
  return [board.model, board.size, Number.isInteger(board.angle) ? `${board.angle}°` : '']
    .filter(Boolean).join(' · ');
}

function projectionToolbar() {
  const controls = [];
  if (document.documentElement?.requestFullscreen) {
    controls.push(el('button', {
      className: 'projection-fullscreen', text: t('live.fullscreen'),
      on: { click: () => document.documentElement.requestFullscreen().catch(() => {}) },
    }));
  }
  return controls.length ? el('div', { className: 'projection-toolbar' }, controls) : null;
}

function syncNotice(snapshot) {
  const health = syncHealth(snapshot, Math.floor(Date.now() / 1000));
  lastHealthKind = health.kind;
  if (health.kind === 'live') {
    return el('span', { className: 'sync-state ok', attrs: { id: 'projection-sync' }, text: t('live.synced', { n: health.connected }) });
  }
  if (health.kind === 'connecting') {
    return el('div', { className: 'notice warn', attrs: { id: 'projection-sync', role: 'status' } }, [
      el('p', { text: t('live.connecting') }),
    ]);
  }
  const key = health.kind === 'stale' ? 'live.stale' : 'live.offline';
  return el('div', { className: 'notice warn projection-sync-warning', attrs: { id: 'projection-sync', role: 'status' } }, [
    el('strong', { text: t(key) }),
    el('span', { text: health.age === null ? '' : ` ${t('live.last_update', { n: health.age })}` }),
  ]);
}

function projectionHeader(snapshot) {
  const competition = snapshot.competition;
  const status = effectiveStatus(snapshot);
  return el('header', { className: 'projection-heading' }, [
    el('div', {}, [
      el('p', { className: 'eyebrow', text: t('live.event_now') }),
      el('h1', { text: competition.title }),
    ]),
    el('div', { className: 'projection-meta' }, [
      el('span', { className: `phase-badge phase-${status}`, text: t(`status.${status}`) }),
      boardLabel(competition) && el('span', { className: 'badge', text: boardLabel(competition) }),
      competition.venue?.name && el('span', { className: 'badge', text: competition.venue.name }),
      syncNotice(snapshot),
    ]),
  ]);
}

/** Before the start: enough context to join, without pretending it is live. */
function preStart(snapshot) {
  const competition = snapshot.competition;
  const link = joinLink(ref.naddr);
  const qr = qrSvg(link, { size: 260, title: t('org.share') });
  const accepted = snapshot.state.participants.filter((p) => p.registration === 'accepted').length;
  return [
    projectionHeader(snapshot),
    el('section', { className: 'projection-lobby' }, [
      el('div', {}, [
        el('p', { className: 'projection-kicker', text: t('live.starts') }),
        el('p', { className: 'projection-start-time', text: formatDateTime(competition.starts_at, language, competition.timezone) }),
        competition.summary && el('p', { className: 'lead', text: competition.summary }),
        el('p', { className: 'projection-count', text: t('live.registered', { count: accepted, capacity: competition.capacity || '∞' }) }),
        el('p', { className: 'mono selectable projection-link', text: link }),
      ]),
      qr ? el('div', { className: 'qr projection-qr' }, [qr]) : null,
    ]),
    el('aside', { className: 'projection-scoring' }, [
      el('strong', { text: t('scoring.info.title') }),
      el('span', { text: scoringExplanation(t, competition) }),
    ]),
  ];
}

function queuePanel(snapshot, current) {
  const preview = queuePreview(snapshot.state, snapshot.state.participants, 7);
  return el('section', { className: 'projection-panel projection-queue' }, [
    el('div', { className: 'section-heading' }, [
      el('h2', { text: t('live.climber_queue') }),
      el('span', { className: 'queue-count', text: String(snapshot.state.order.length) }),
    ]),
    preview.entries.length
      ? el('ol', { className: 'projection-list' }, preview.entries.map((entry) => el('li', {
        className: [entry.current ? 'is-current' : '', entry.next ? 'is-next' : '', entry.nextRound ? 'is-next-round' : ''].filter(Boolean).join(' '),
      }, [
        el('span', { className: 'queue-number', text: entry.current ? t('live.now_short') : entry.nextRound ? t('live.next_round_short') : String(entry.queuePosition + 1) }),
        el('strong', { text: entry.participant ? displayName(entry.participant) : shortKey(entry.pubkey) }),
        entry.pubkey === current && el('span', { className: 'visually-hidden', text: t('live.current') }),
      ])))
      : el('p', { className: 'empty-state', text: t('live.queue_empty') }),
    preview.hidden > 0 && el('p', { className: 'more-count', text: t('live.more', { n: preview.hidden }) }),
  ]);
}

function rotationPanel(snapshot, currentParticipant) {
  const preview = rotationPreview(snapshot.competition, snapshot.state, currentParticipant, 5);
  return el('section', { className: 'projection-panel projection-rotation' }, [
    el('h2', { text: t('live.rotation') }),
    preview.entries.length
      ? el('ol', { className: 'projection-list rotation-list' }, preview.entries.map((climb, index) => el('li', {
        className: climb.current ? 'is-current' : climb.next ? 'is-next' : '',
      }, [
        el('span', { className: 'queue-number', text: climb.current ? t('live.now_short') : String(index + 1) }),
        el('strong', { text: climb.label || climb.id }),
        Number.isInteger(climb.angle) && el('span', { className: 'rotation-angle', text: `${climb.angle}°` }),
      ])))
      : el('p', { className: 'empty-state', text: t('live.rotation_empty') }),
    preview.hidden > 0 && el('p', { className: 'more-count', text: t('live.more', { n: preview.hidden }) }),
  ]);
}

/** While it runs: wall first, then queues, then ranking. */
function running(snapshot) {
  const state = snapshot.state;
  const current = store.currentClimber();
  const next = store.nextClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const nextParticipant = next ? store.participant(next) : null;
  const paused = state.status === 'paused';
  const terminal = state.status === 'finished';
  const currentChoice = chosenClimb(snapshot, current);
  const nextChoice = chosenClimb(snapshot, next);

  return [
    projectionHeader(snapshot),
    state.announcements.length ? el('aside', { className: 'projection-announcement', attrs: { role: 'status' } }, [
      el('span', { className: 'announcement-label', text: t('live.announcement') }),
      el('strong', { text: state.announcements.at(-1).text }),
    ]) : null,
    el('section', { className: `projection-hero ${paused ? 'is-paused' : ''} ${terminal ? 'is-finished' : ''}` }, [
      el('div', { className: 'projection-current' }, [
        el('p', { className: 'projection-kicker', text: terminal ? t('live.final') : paused ? t('live.paused') : t('live.current') }),
        el('p', { className: 'now', text: terminal ? t('live.finished') : currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
        !terminal && el('p', { className: 'current-climb', text: currentChoice?.label
          || climbLabel(snapshot, state.current_climb_id) }),
        !terminal && el('div', { className: 'turn-facts' }, [
          el('span', { text: t('live.round_value', { n: state.round }) }),
          !terminal && el('span', { className: 'countdown', attrs: { id: 'deadline' }, text: paused ? t('live.paused') : formatSeconds(store.secondsToDeadline()) }),
        ]),
      ]),
      el('div', { className: 'projection-next' }, [
        el('p', { className: 'projection-kicker', text: t('live.next') }),
        el('p', { className: 'next-name', text: terminal ? '—' : nextParticipant ? displayName(nextParticipant) : t('live.queue_empty') }),
        el('p', { className: 'next-climb', text: nextChoice?.label
          || rotationPreview(snapshot.competition, state, nextParticipant, 2).entries[0]?.label
          || climbLabel(snapshot, state.current_climb_id) }),
      ]),
    ]),
    !terminal && el('div', { className: 'projection-middle' }, [
      queuePanel(snapshot, current),
      rotationPanel(snapshot, currentParticipant),
    ]),
    leaderboard(snapshot, current),
  ];
}

function cancelled(snapshot) {
  return [
    projectionHeader(snapshot),
    el('section', { className: 'projection-terminal' }, [
      el('p', { className: 'projection-kicker', text: t('status.cancelled') }),
      el('h2', { text: t('live.cancelled') }),
      snapshot.competition.summary && el('p', { className: 'lead', text: snapshot.competition.summary }),
    ]),
  ];
}

function leaderboard(snapshot, current) {
  if (!snapshot.standings.length || !snapshot.state.chain_complete || snapshot.state.fork_detected) return null;
  const points = usesPointLeaderboard(snapshot.competition);
  const nextRanks = new Map(snapshot.standings.map((row) => [row.pubkey, row.rank]));
  const rows = snapshot.standings.slice(0, 12).map((row, index) => {
    const oldRank = previousRanks.get(row.pubkey);
    const movement = oldRank && row.rank && oldRank !== row.rank ? oldRank - row.rank : 0;
    return el('tr', {
      className: [row.pubkey === current ? 'active-climber' : '', movement > 0 ? 'rank-up' : '', movement < 0 ? 'rank-down' : '']
        .filter(Boolean).join(' '),
    }, [
      el('td', { className: 'num rank-cell' }, [
        el('strong', { text: row.rank || '—' }),
        tiedAt(snapshot.standings, index) && el('span', { className: 'tie-label', text: t('live.tie') }),
        movement !== 0 && el('span', {
          className: 'rank-movement',
          attrs: { 'aria-label': movement > 0 ? t('live.rank_up') : t('live.rank_down') },
          text: movement > 0 ? `↑${movement}` : `↓${Math.abs(movement)}`,
        }),
      ]),
      el('td', { text: row.display || shortKey(row.pubkey) }),
      points && el('td', { className: 'num', text: String(row.points) }),
      el('td', { className: 'num', text: String(row.tops) }),
      el('td', { className: 'num', text: String(row.zones) }),
      el('td', { className: 'num', text: String(row.attempts) }),
    ]);
  });
  previousRanks = nextRanks;
  return el('section', { className: 'projection-panel projection-ranking' }, [
    el('h2', { text: snapshot.state.status === 'finished' ? t('live.final_ranking') : t('live.leaderboard') }),
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
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

function render() {
  const snapshot = store.snapshot();
  if (!snapshot.state) return;
  const blocked = integrityGuard(snapshot, t);
  if (blocked) {
    replace(view, projectionToolbar(), devRelayBanner(store, t),
      ...integrityNotices(snapshot, t), blocked);
    return;
  }
  const status = effectiveStatus(snapshot);
  lastEffectiveStatus = status;
  const body = status === 'cancelled'
    ? cancelled(snapshot)
    : ['running', 'paused', 'finished'].includes(status)
      ? running(snapshot)
      : preStart(snapshot);
  replace(view, projectionToolbar(), devRelayBanner(store, t), ...integrityNotices(snapshot, t), ...body);
}

async function start() {
  const hash = location.hash.replace(/^#/, '');
  const parsed = parseCompetitionRef(hash);
  if (!parsed.ok) {
    replace(view, el('div', { className: 'card' }, [
      el('h1', { text: t('nav.projector') }),
      el('p', { text: t('live.open_hint') }),
    ]), openCompetitionForm(t, start));
    return;
  }
  ref = parsed;
  const opened = await openCompetition({
    organizerPubkey: parsed.organizerPubkey, compId: parsed.compId, t, statusNode,
  });
  if (!opened) return;
  store = opened.store;
  store.onChange(render);
  choices.clear();
  await store.followIntents((event) => {
    const parsedIntent = parseIntentEvent(event, store.competition, store.organizerPubkey,
      Math.floor(Date.now() / 1000));
    if (!parsedIntent.ok || parsedIntent.intent.op !== 'climb_choice') return;
    const known = choices.get(parsedIntent.pubkey);
    if (!known || parsedIntent.createdAt > known.createdAt
      || (parsedIntent.createdAt === known.createdAt && parsedIntent.eventId > known.eventId)) {
      choices.set(parsedIntent.pubkey, parsedIntent);
      render();
    }
  });
  render();

  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const snapshot = store?.snapshot();
    const status = snapshot?.state ? effectiveStatus(snapshot) : '';
    if (status && status !== lastEffectiveStatus) {
      render();
      return;
    }
    const node = byId('deadline');
    if (node && store && status === 'running') {
      node.textContent = formatSeconds(store.secondsToDeadline());
    }
    const health = snapshot ? syncHealth(snapshot, Math.floor(Date.now() / 1000)) : null;
    if (health && health.kind !== lastHealthKind) render();
  }, 1000);
}

window.addEventListener('hashchange', () => location.reload());
await start();
