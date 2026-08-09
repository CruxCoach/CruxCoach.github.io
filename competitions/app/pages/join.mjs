/**
 * The participant screen — the iOS and non-app route into a competition.
 *
 * It answers, in this order and without being asked twice: what is happening
 * right now, what do I have to do, and where do I stand. Everything else is
 * below the fold.
 */
import {
  bootstrap, byId, devRelayBanner, el, integrityNotices, joinLink,
  openCompetition, parseCompetitionRef, replace, resolveRelays,
} from './common.mjs';
import { SignIn } from '../ui/shell.mjs';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { EntrantWriter } from '../authority.mjs';
import {
  announce, displayName, formatDateTime, formatSats, formatSeconds, shortKey,
} from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs';

const { t, language } = bootstrap();

let store = null;
let pool = null;
let entrant = null;
let signer = null;
let ref = null;
let lastTurnAnnouncement = null;
let ticker = null;

const view = byId('view');
const statusNode = byId('load-status');
const signInMount = byId('signin');

// The profile gate needs relays before a competition is open, so it gets its
// own pool. Writes stay gated on it: `onChange` only fires with a signer once a
// kind-0 profile exists that a relay accepted.
const profilePool = new RelayPool(resolveRelays());

const signIn = new SignIn({
  t,
  mount: signInMount,
  gateMount: byId('profile'),
  pool: profilePool,
  onChange: (next) => {
    signer = next;
    entrant = signer && store
      ? new EntrantWriter({
        pool, signer, competition: store.competition, organizerPubkey: store.organizerPubkey,
      })
      : null;
    render();
  },
});

// ── opening a competition ──

function openForm() {
  const input = el('input', {
    attrs: {
      type: 'text', id: 'comp-ref', autocomplete: 'off', spellcheck: 'false',
      placeholder: t('comp.open.placeholder'),
    },
  });
  const error = el('p', { className: 'small', attrs: { role: 'alert' } });
  return el('div', { className: 'card' }, [
    el('h2', { text: t('comp.open') }),
    el('p', { className: 'small', text: t('comp.open.hint') }),
    el('label', { attrs: { for: 'comp-ref' }, text: t('comp.open') }, [input]),
    error,
    el('button', {
      className: 'primary',
      text: t('comp.open'),
      on: {
        click: () => {
          const parsed = parseCompetitionRef(input.value);
          if (!parsed.ok) { error.textContent = t('comp.invalid'); return; }
          location.hash = parsed.naddr;
          start();
        },
      },
    }),
  ]);
}

// ── rendering ──

function me() {
  return signer ? store?.participant(signer.pubkey) : null;
}

function header(snapshot) {
  const competition = snapshot.competition;
  return el('section', { className: 'card' }, [
    el('h1', { text: competition.title }),
    el('p', { className: 'lead', text: competition.summary }),
    el('div', { className: 'row' }, [
      el('span', { className: 'badge', text: t(`status.${snapshot.state.status}`) }),
      competition.venue?.name && el('span', { className: 'badge', text: competition.venue.name }),
      competition.fee_msat > 0
        ? el('span', { className: 'badge', text: formatSats(competition.fee_msat) })
        : el('span', { className: 'badge ok', text: t('pay.not_required') }),
    ]),
    el('dl', { className: 'key-value' }, [
      el('dt', { text: t('org.when') }),
      el('dd', { text: formatDateTime(competition.starts_at, language, competition.timezone) }),
      el('dt', { text: t('org.format') }),
      el('dd', {
        text: `${competition.rules.climb_count} × ${competition.rules.attempts_per_climb}`,
      }),
    ]),
    competition.description && el('p', { text: competition.description }),
  ]);
}

function registrationPanel(snapshot) {
  const competition = snapshot.competition;
  const mine = me();

  if (!signer) {
    return el('section', { className: 'card raised' }, [
      el('h2', { text: t('action.register') }),
      el('p', { text: t('signin.intro') }),
    ]);
  }

  if (mine) {
    const rows = [
      el('h2', { text: t('action.register') }),
      el('div', { className: 'row' }, [
        el('span', { className: 'badge', text: t(`reg.${mine.registration}`) }),
        el('span', { className: 'badge', text: t(`checkin.${mine.checkin}`) }),
        competition.fee_msat > 0 && el('span', {
          className: mine.payment === 'settled' ? 'badge ok' : 'badge warn',
          text: t(`pay.${mine.payment}`),
        }),
      ]),
    ];
    if (mine.registration === 'waitlisted' && mine.waitlist_position) {
      rows.push(el('p', { className: 'small', text: `#${mine.waitlist_position}` }));
    }
    if (competition.fee_msat > 0 && mine.payment === 'pending' && competition.fee_lnurl) {
      rows.push(el('div', { className: 'notice warn' }, [
        el('p', { text: t('pay.pending') }),
        el('p', { className: 'mono selectable', text: competition.fee_lnurl }),
      ]));
    }
    if (['pending', 'accepted', 'waitlisted'].includes(mine.registration)
      && !['finished', 'cancelled'].includes(snapshot.state.status)) {
      rows.push(el('button', {
        text: t('action.withdraw'),
        on: { click: () => guard(() => entrant.withdraw()) },
      }));
    }
    return el('section', { className: 'card raised' }, rows);
  }

  if (snapshot.state.status !== 'registration_open') {
    return el('section', { className: 'card raised' }, [
      el('h2', { text: t('action.register') }),
      el('p', { text: t('reg.closed') }),
    ]);
  }

  const accepted = snapshot.state.participants.filter((p) => p.registration === 'accepted').length;
  if (competition.capacity > 0 && accepted >= competition.capacity && !competition.waitlist_enabled) {
    return el('section', { className: 'card raised' }, [
      el('h2', { text: t('action.register') }),
      el('p', { text: t('reg.full') }),
    ]);
  }

  // Pre-filled from the profile the gate already required, so nobody types
  // their name twice — but still editable, because a pseudonym for one
  // competition is a legitimate thing to want.
  const display = el('input', {
    attrs: {
      type: 'text', id: 'display', maxlength: '48', autocomplete: 'nickname',
      value: signIn.displayName || '',
    },
  });
  const division = el('select', { attrs: { id: 'division' } },
    competition.divisions.map((d) => el('option', { attrs: { value: d.id }, text: d.label })));
  const waiver = el('input', { attrs: { type: 'checkbox', id: 'waiver' } });
  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });

  const rows = [
    el('h2', { text: t('action.register') }),
    el('label', { attrs: { for: 'display' } }, [
      el('span', { text: t('reg.display') }),
      el('span', { className: 'hint', text: t('reg.display.hint') }),
      display,
    ]),
  ];
  if (competition.divisions.length > 1) {
    rows.push(el('label', { attrs: { for: 'division' }, text: t('reg.division') }, [division]));
  }
  if (competition.eligibility) rows.push(el('p', { className: 'small', text: competition.eligibility }));
  if (competition.waiver_required) {
    rows.push(
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('reg.waiver') }),
        el('p', { text: competition.waiver }),
      ]),
      el('label', { className: 'inline', attrs: { for: 'waiver' } }, [
        waiver, el('span', { text: t('reg.waiver') }),
      ]),
    );
  }
  rows.push(feedback, el('button', {
    className: 'primary',
    text: t('action.register'),
    on: {
      click: () => guard(async () => {
        await entrant.register({
          division: competition.divisions.length > 1 ? division.value : competition.divisions[0].id,
          display: display.value.trim() || shortKey(signer.pubkey),
          waiverAccepted: !competition.waiver_required || waiver.checked,
        });
        feedback.textContent = t('reg.sent');
        announce(t('reg.sent'));
      }, feedback),
    },
  }));
  return el('section', { className: 'card raised' }, rows);
}

function livePanel(snapshot) {
  const state = snapshot.state;
  if (!['running', 'paused', 'finished'].includes(state.status)) {
    return el('section', { className: 'card' }, [
      el('h2', { text: t('live.current') }),
      el('p', { text: t('live.waiting') }),
    ]);
  }

  const current = store.currentClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const mine = me();
  const isMyTurn = Boolean(mine && current === mine.pubkey);
  const rows = [el('h2', { text: t('live.current') })];

  if (isMyTurn) {
    rows.push(el('div', { className: 'turn-banner', attrs: { role: 'status' } }, [
      el('div', { text: t('live.your_turn') }),
      el('div', { className: 'small', text: t('live.your_turn.hint') }),
    ]));
  }

  rows.push(el('dl', { className: 'key-value' }, [
    el('dt', { text: t('live.current') }),
    el('dd', { text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
    el('dt', { text: t('org.next_climb') }),
    el('dd', { text: climbLabel(snapshot, state.current_climb_id) }),
    el('dt', { text: t('live.deadline') }),
    el('dd', { className: 'mono', attrs: { id: 'deadline' }, text: formatSeconds(store.secondsToDeadline()) }),
  ]));

  if (mine) {
    const before = store.climbersBefore(mine.pubkey);
    rows.push(el('dl', { className: 'key-value' }, [
      el('dt', { text: t('live.before_you') }),
      el('dd', { text: before === null ? '—' : String(before) }),
      el('dt', { text: t('live.attempts_left') }),
      el('dd', { text: String(store.attemptsLeft(mine.pubkey, state.current_climb_id)) }),
      el('dt', { text: t('live.defers_left') }),
      el('dd', { text: String(store.defersLeft(mine.pubkey)) }),
    ]));

    // The defer control EXISTS only when it can be used. A disabled button
    // that never explains itself is a worse answer than a sentence.
    if (store.canDefer(mine.pubkey)) {
      rows.push(
        el('p', { className: 'small', text: t('live.defer.hint', { n: snapshot.competition.rules.defer_slots }) }),
        el('button', {
          text: t('live.defer'),
          on: {
            click: () => guard(() => entrant.requestDefer(state.current_climb_id, state.turn_deadline_at)),
          },
        }),
      );
    } else if (isMyTurn && store.defersLeft(mine.pubkey) === 0) {
      rows.push(el('p', { className: 'small', text: t('live.defer.none') }));
    }

    if (mine.climbs.length) {
      rows.push(el('h3', { text: t('table.attempts') }), el('ul', { className: 'plain' },
        mine.climbs.map((climb) => el('li', {
          text: `${climbLabel(snapshot, climb.climb_id)} — ${climb.outcome} (${climb.attempts_used})`,
        }))));
    }
  }

  return el('section', { className: 'card' }, rows);
}

function climbLabel(snapshot, climbId) {
  if (!climbId) return '—';
  const climb = (snapshot.competition.climbs || []).find((c) => c.id === climbId);
  return climb?.label || climbId;
}

function leaderboard(snapshot) {
  if (!snapshot.standings.length) return null;
  const mine = me();
  return el('section', { className: 'card' }, [
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
        el('tbody', {}, snapshot.standings.map((row) => el('tr', {
          className: mine && row.pubkey === mine.pubkey ? 'me' : '',
        }, [
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

function announcements(snapshot) {
  if (!snapshot.state.announcements.length) return null;
  return el('section', { className: 'card' }, [
    el('h2', { text: t('live.announcements') }),
    el('ul', { className: 'plain' }, [...snapshot.state.announcements].reverse()
      .map((a) => el('li', { text: a.text }))),
  ]);
}

function rejections(snapshot) {
  if (!snapshot.state.rejected.length) return null;
  return el('details', { className: 'disclosure' }, [
    el('summary', { text: `${snapshot.state.rejected.length}` }),
    el('ul', { className: 'plain' }, snapshot.state.rejected.map(
      (r) => el('li', { className: 'small', text: describeRejection(t, r) }),
    )),
  ]);
}

function render() {
  if (!store) { replace(view, openForm()); return; }
  const snapshot = store.snapshot();
  if (!snapshot.state) return;

  replace(view,
    devRelayBanner(store, t),
    ...integrityNotices(snapshot, t),
    header(snapshot),
    registrationPanel(snapshot),
    livePanel(snapshot),
    leaderboard(snapshot),
    announcements(snapshot),
    rejections(snapshot),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.share') }),
      el('p', { className: 'mono selectable', text: joinLink(ref.naddr) }),
    ]));

  // Announce a turn change once, not on every re-render.
  const mine = me();
  if (mine && store.currentClimber() === mine.pubkey && lastTurnAnnouncement !== snapshot.state.seq) {
    lastTurnAnnouncement = snapshot.state.seq;
    announce(t('live.your_turn'), { assertive: true });
  }
}

/** Run a writer action, showing the outcome instead of swallowing it. */
async function guard(work, feedback) {
  try {
    await work();
  } catch (err) {
    const message = err.message || t('error.generic');
    if (feedback) feedback.textContent = message;
    announce(message, { assertive: true });
  }
}

async function start() {
  const hash = location.hash.replace(/^#/, '');
  const parsed = parseCompetitionRef(hash || location.pathname);
  if (!parsed.ok) { replace(view, openForm()); return; }
  ref = parsed;

  if (pool) { store?.close(); pool.close(); }
  const opened = await openCompetition({
    organizerPubkey: parsed.organizerPubkey, compId: parsed.compId, t, statusNode,
  });
  if (!opened) return;
  ({ store, pool } = opened);
  store.onChange(render);
  if (signer) {
    entrant = new EntrantWriter({
      pool, signer, competition: store.competition, organizerPubkey: store.organizerPubkey,
    });
  }
  render();

  // The turn countdown is the one thing that has to move without an event.
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const node = byId('deadline');
    if (node && store) node.textContent = formatSeconds(store.secondsToDeadline());
  }, 1000);
}

window.addEventListener('hashchange', start);
await signIn.restore();
await start();
