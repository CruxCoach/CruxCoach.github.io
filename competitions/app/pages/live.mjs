/**
 * The live screen — a projector or a spare tablet by the entrance.
 *
 * Read-only by construction: it holds no signing key and has no control that
 * writes. That is what makes it safe to leave running on a screen anyone can
 * reach, and safe to share as a link.
 *
 * Everything is sized for reading at distance, and it survives a refresh
 * because there is no state here to lose — it is all in the log.
 */
import {
  bootstrap, byId, devRelayBanner, el, integrityNotices, joinLink,
  openCompetition, openCompetitionForm, parseCompetitionRef, replace,
} from './common.mjs';
import { displayName, formatDateTime, formatSeconds, qrSvg, shortKey } from '../ui/dom.mjs';

const { t, language } = bootstrap();

let store = null;
let ref = null;
let ticker = null;

const view = byId('view');
const statusNode = byId('load-status');

function climbLabel(snapshot, climbId) {
  if (!climbId) return '—';
  const climb = (snapshot.competition.climbs || []).find((c) => c.id === climbId);
  return climb?.label || climbId;
}

/** Before the start: what it is, when, and how to join. */
function preStart(snapshot) {
  const competition = snapshot.competition;
  const link = joinLink(ref.naddr);
  const qr = qrSvg(link, { size: 260, title: t('org.share') });
  return [
    el('h1', { text: competition.title }),
    el('p', { className: 'lead', text: competition.summary }),
    el('div', { className: 'row' }, [
      el('span', { className: 'badge', text: t(`status.${snapshot.state.status}`) }),
      el('span', { className: 'badge', text: formatDateTime(competition.starts_at, language, competition.timezone) }),
      competition.venue?.name && el('span', { className: 'badge', text: competition.venue.name }),
    ]),
    el('div', { className: 'grid two' }, [
      el('div', {}, [
        el('h2', { text: t('nav.participant') }),
        competition.spectator_info && el('p', { text: competition.spectator_info }),
        competition.participant_instructions && el('p', { text: competition.participant_instructions }),
        el('p', { className: 'mono selectable', text: link }),
      ]),
      el('div', {}, [
        // A QR that would have to truncate returns null, and the link above is
        // then the only thing shown — a code that scans to half a URL is worse
        // than none.
        qr ? el('div', { className: 'qr' }, [qr]) : el('p', { className: 'small', text: link }),
      ]),
    ]),
    el('p', {
      text: `${snapshot.state.participants.filter((p) => p.registration === 'accepted').length} / ${competition.capacity || '∞'}`,
    }),
  ];
}

/** While it runs: who is on the wall, who is next, and where everyone stands. */
function running(snapshot) {
  const state = snapshot.state;
  const current = store.currentClimber();
  const next = store.nextClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const nextParticipant = next ? store.participant(next) : null;

  const queue = state.order
    .slice(Math.max(0, state.cursor < 0 ? 0 : state.cursor), (state.cursor < 0 ? 0 : state.cursor) + 6)
    .map((pubkey) => store.participant(pubkey))
    .filter(Boolean);

  return [
    el('div', { className: 'row between' }, [
      el('h1', { text: snapshot.competition.title }),
      el('span', { className: 'badge', text: t(`status.${state.status}`) }),
    ]),
    el('div', { className: 'grid two' }, [
      el('div', {}, [
        el('p', { className: 'next', text: t('live.current') }),
        el('p', { className: 'now', text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
        el('p', { className: 'next', text: `${climbLabel(snapshot, state.current_climb_id)} · ${t('org.next_round')} ${state.round}` }),
        el('p', { className: 'countdown', attrs: { id: 'deadline' }, text: formatSeconds(store.secondsToDeadline()) }),
      ]),
      el('div', {}, [
        el('p', { className: 'next', text: t('live.next') }),
        el('p', { className: 'now', text: nextParticipant ? displayName(nextParticipant) : '—' }),
        el('h2', { text: t('live.queue') }),
        el('ul', { className: 'plain' }, queue.map((p, index) => el('li', {
          text: `${index + 1}. ${displayName(p)}`,
        }))),
      ]),
    ]),
    state.announcements.length ? el('div', { className: 'notice' }, [
      el('p', { text: state.announcements.at(-1).text }),
    ]) : null,
    leaderboard(snapshot),
  ];
}

function leaderboard(snapshot) {
  if (!snapshot.standings.length) return null;
  return el('section', {}, [
    el('h2', { text: t('live.leaderboard') }),
    el('div', { className: 'table-scroll' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { className: 'num', text: t('table.rank') }),
          el('th', { text: t('table.climber') }),
          el('th', { className: 'num', text: t('table.tops') }),
          el('th', { className: 'num', text: t('table.zones') }),
          el('th', { className: 'num', text: t('table.attempts') }),
        ])]),
        el('tbody', {}, snapshot.standings.slice(0, 12).map((row) => el('tr', {}, [
          el('td', { className: 'num', text: row.rank || '—' }),
          el('td', { text: row.display || shortKey(row.pubkey) }),
          el('td', { className: 'num', text: String(row.tops) }),
          el('td', { className: 'num', text: String(row.zones) }),
          el('td', { className: 'num', text: String(row.attempts) }),
        ]))),
      ]),
    ]),
  ]);
}

function render() {
  const snapshot = store.snapshot();
  if (!snapshot.state) return;
  const body = ['running', 'paused', 'finished'].includes(snapshot.state.status)
    ? running(snapshot)
    : preStart(snapshot);
  replace(view, devRelayBanner(store, t), ...integrityNotices(snapshot, t), ...body);
}

async function start() {
  const hash = location.hash.replace(/^#/, '');
  const parsed = parseCompetitionRef(hash);
  if (!parsed.ok) {
    replace(
      view,
      el('div', { className: 'card' }, [el('h1', { text: t('nav.projector') })]),
      openCompetitionForm(t, start),
    );
    return;
  }
  ref = parsed;
  const opened = await openCompetition({
    organizerPubkey: parsed.organizerPubkey, compId: parsed.compId, t, statusNode,
  });
  if (!opened) return;
  store = opened.store;
  store.onChange(render);
  render();

  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const node = byId('deadline');
    if (node && store) node.textContent = formatSeconds(store.secondsToDeadline());
  }, 1000);
}

window.addEventListener('hashchange', () => location.reload());
await start();
