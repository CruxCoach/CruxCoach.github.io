/**
 * The organizer console: create a competition, then run it.
 *
 * The create form uses progressive disclosure. Everything an organizer must
 * decide is on screen; everything with a sensible default is behind a
 * disclosure that says the defaults are already set. Showing forty fields at
 * once is how a first release becomes unusable.
 *
 * The run view exposes one obvious next action at a time, because it is used
 * standing at a wall with one hand.
 */
import {
  DISCOVERY_RELAYS, bootstrap, byId, devRelayBanner, el, integrityNotices,
  joinLink, openCompetition, parseCompetitionRef, replace, resolveRelays,
} from './common.mjs';
import { SignIn } from '../ui/shell.mjs';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { AuthorityWriter, publishCompetition } from '../authority.mjs';
import {
  newCompId, parseIntentEvent, validateCompetitionConfig,
} from '../protocol/competition.mjs';
import { naddrEncode } from '../protocol/nostr-event.mjs';
import { KIND, compDTag } from '../protocol/competition.mjs';
import { announce, displayName, formatDateTime, shortKey } from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs';

const { t, language } = bootstrap();

let signer = null;
let store = null;
let pool = null;
let writer = null;
let ref = null;
const intents = new Map();

const view = byId('view');
const statusNode = byId('load-status');

// Same gate as the participant page: a key is not an identity, and an
// organizer publishing a public competition needs a name people can look up.
const profilePool = new RelayPool(resolveRelays());

const signIn = new SignIn({
  t,
  mount: byId('signin'),
  gateMount: byId('profile'),
  pool: profilePool,
  onChange: (next) => { signer = next; render(); },
});

// ── create ──

function field(id, label, input, hint) {
  return el('label', { attrs: { for: id } }, [
    el('span', { text: label }),
    hint ? el('span', { className: 'hint', text: hint }) : null,
    input,
  ]);
}

const text = (id, value = '', attrs = {}) => el('input', { attrs: { type: 'text', id, value, ...attrs } });
const num = (id, value, attrs = {}) => el('input', { attrs: { type: 'number', id, value: String(value), ...attrs } });
const when = (id, value) => el('input', { attrs: { type: 'datetime-local', id, value } });

/** Local wall-clock string → epoch seconds. */
const toEpoch = (value) => Math.floor(new Date(value).getTime() / 1000);

function defaultWhen(offsetHours) {
  const date = new Date(Date.now() + offsetHours * 3600 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createForm() {
  const f = {
    title: text('f-title', '', { maxlength: '120', required: 'required' }),
    summary: text('f-summary', '', { maxlength: '140' }),
    description: el('textarea', { attrs: { id: 'f-description', maxlength: '4000' } }),
    organizerName: text('f-org', '', { maxlength: '80' }),
    contact: text('f-contact', '', { maxlength: '120' }),
    venue: text('f-venue', '', { maxlength: '120' }),
    address: text('f-address', '', { maxlength: '160' }),
    regOpens: when('f-reg-open', defaultWhen(1)),
    regCloses: when('f-reg-close', defaultWhen(24)),
    checkinOpens: when('f-checkin-open', defaultWhen(25)),
    checkinCloses: when('f-checkin-close', defaultWhen(26)),
    starts: when('f-start', defaultWhen(26)),
    ends: when('f-end', defaultWhen(29)),
    capacity: num('f-capacity', 20, { min: '0', max: '500' }),
    climbCount: num('f-climbs', 4, { min: '1', max: '40' }),
    attempts: num('f-attempts', 3, { min: '1', max: '20' }),
    turnDeadline: num('f-deadline', 120, { min: '30', max: '1800' }),
    deferBudget: num('f-defer-budget', 1, { min: '0', max: '5' }),
    deferSlots: num('f-defer-slots', 2, { min: '1', max: '10' }),
    minRest: num('f-rest', 0, { min: '0', max: '3600' }),
    fee: num('f-fee', 0, { min: '0' }),
    lnurl: text('f-lnurl', '', { maxlength: '120' }),
    waiver: el('textarea', { attrs: { id: 'f-waiver', maxlength: '2000' } }),
    eligibility: el('textarea', { attrs: { id: 'f-eligibility', maxlength: '2000' } }),
    instructions: el('textarea', { attrs: { id: 'f-instructions', maxlength: '2000' } }),
    spectator: el('textarea', { attrs: { id: 'f-spectator', maxlength: '2000' } }),
    refund: el('textarea', { attrs: { id: 'f-refund', maxlength: '2000' } }),
    visibility: el('select', { attrs: { id: 'f-visibility' } }, [
      el('option', { attrs: { value: 'public' }, text: 'public' }),
      el('option', { attrs: { value: 'unlisted' }, text: 'unlisted' }),
    ]),
    progression: el('select', { attrs: { id: 'f-progression' } }, [
      el('option', { attrs: { value: 'synchronous_rounds' }, text: 'synchronous rounds' }),
      el('option', { attrs: { value: 'asynchronous_turns' }, text: 'asynchronous turns' }),
    ]),
    board: text('f-board', 'kilterboard-og', { maxlength: '40' }),
    size: text('f-size', '12x12', { maxlength: '20' }),
    angle: num('f-angle', 40, { min: '0', max: '70' }),
  };
  f.waiver.value = 'I understand that climbing is dangerous and I take part at my own risk.';

  const errors = el('div', { attrs: { role: 'alert' } });

  const build = () => {
    const count = Number(f.climbCount.value);
    const climbs = Array.from({ length: count }, (_, i) => ({
      id: `c${i + 1}`,
      // Placeholder catalogue ids: the first release lets an organizer name the
      // climbs; wiring them to real board uuids is the app's job and is listed
      // in DECISIONS-TO-REVIEW.
      climb_uuid: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
      angle: Number(f.angle.value),
      label: `${t('org.next_climb')} ${i + 1}`,
      points: 100,
    }));
    const fee = Number(f.fee.value);
    const config = {
      comp_id: newCompId(),
      authority: signer.pubkey,
      authority_epoch: 1,
      title: f.title.value.trim(),
      summary: f.summary.value.trim(),
      description: f.description.value.trim(),
      organizer: { name: f.organizerName.value.trim(), contact: f.contact.value.trim() },
      visibility: f.visibility.value,
      status: 'draft',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      registration_opens_at: toEpoch(f.regOpens.value),
      registration_closes_at: toEpoch(f.regCloses.value),
      checkin_opens_at: toEpoch(f.checkinOpens.value),
      checkin_closes_at: toEpoch(f.checkinCloses.value),
      starts_at: toEpoch(f.starts.value),
      ends_at: toEpoch(f.ends.value),
      capacity: Number(f.capacity.value),
      waitlist_enabled: true,
      venue: { kind: 'physical', name: f.venue.value.trim(), address: f.address.value.trim() },
      board: {
        brand: 'kilter', model: f.board.value.trim(), layout_id: 1,
        size: f.size.value.trim(), angle: Number(f.angle.value),
      },
      divisions: [{ id: 'open', label: 'Open' }],
      eligibility: f.eligibility.value.trim(),
      waiver: f.waiver.value.trim(),
      waiver_required: Boolean(f.waiver.value.trim()),
      participant_instructions: f.instructions.value.trim(),
      spectator_info: f.spectator.value.trim(),
      refund_policy: f.refund.value.trim(),
      fee_msat: fee,
      prizes: [],
      rules: {
        climb_source: 'organizer_set',
        climb_count: count,
        selection_uniqueness: 'none',
        progression: f.progression.value,
        attempts_per_climb: Number(f.attempts.value),
        turn_deadline_sec: Number(f.turnDeadline.value),
        attempt_deadline_sec: 0,
        min_rest_sec: Number(f.minRest.value),
        defer_budget_per_round: Number(f.deferBudget.value),
        max_consecutive_defers: Math.min(1, Number(f.deferBudget.value)),
        defer_slots: Number(f.deferSlots.value),
        scoring: 'tops_then_attempts',
        tiebreaks: ['fewest_attempts', 'most_zones', 'earliest_finish', 'seed_order'],
        late_entry_allowed: false,
      },
      climbs,
      relays: resolveRelays([]).slice(0, 8),
      created_at: Math.floor(Date.now() / 1000),
      revision: 1,
    };
    if (fee > 0) config.fee_lnurl = f.lnurl.value.trim();
    return config;
  };

  return el('section', { className: 'card' }, [
    el('h2', { text: t('org.create') }),
    el('fieldset', {}, [
      el('legend', { text: t('org.basics') }),
      field('f-title', t('org.basics'), f.title),
      field('f-summary', 'Summary', f.summary),
      field('f-description', 'Description', f.description),
      field('f-org', 'Organizer', f.organizerName),
      field('f-contact', 'Contact', f.contact),
      field('f-visibility', 'Visibility', f.visibility,
        'Unlisted keeps it off relay search. It is not private: anyone with the link can read it.'),
    ]),
    el('fieldset', {}, [
      el('legend', { text: t('org.when') }),
      field('f-reg-open', 'Registration opens', f.regOpens),
      field('f-reg-close', 'Registration closes', f.regCloses),
      field('f-checkin-open', 'Check-in opens', f.checkinOpens),
      field('f-checkin-close', 'Check-in closes', f.checkinCloses),
      field('f-start', 'Starts', f.starts),
      field('f-end', 'Ends', f.ends),
    ]),
    el('fieldset', {}, [
      el('legend', { text: t('org.where') }),
      field('f-venue', 'Venue', f.venue),
      field('f-address', 'Address', f.address),
      field('f-board', 'Board model', f.board),
      field('f-size', 'Board size', f.size),
      field('f-angle', 'Angle', f.angle),
    ]),
    el('fieldset', {}, [
      el('legend', { text: t('org.format') }),
      field('f-climbs', 'Climbs', f.climbCount),
      field('f-attempts', 'Attempts per climb', f.attempts),
      field('f-capacity', 'Capacity', f.capacity, '0 means no limit.'),
      field('f-fee', 'Entry fee (msat)', f.fee, '0 for a free competition.'),
      field('f-lnurl', 'Lightning address', f.lnurl, 'Only needed when there is a fee.'),
    ]),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.advanced') }),
      el('p', { className: 'small', text: t('org.advanced.hint') }),
      field('f-progression', 'Progression', f.progression),
      field('f-deadline', 'Turn deadline (s)', f.turnDeadline),
      field('f-defer-budget', 'Deferrals per round', f.deferBudget),
      field('f-defer-slots', 'Places a deferral moves you back', f.deferSlots),
      field('f-rest', 'Minimum rest between turns (s)', f.minRest),
    ]),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.text') }),
      field('f-eligibility', 'Eligibility', f.eligibility),
      field('f-waiver', 'Terms entrants accept', f.waiver),
      field('f-instructions', 'Instructions for entrants', f.instructions),
      field('f-spectator', 'Spectator information', f.spectator),
      field('f-refund', 'Refund policy', f.refund),
    ]),
    errors,
    el('button', {
      className: 'primary',
      text: t('action.publish'),
      on: {
        click: async () => {
          replace(errors);
          let config;
          try {
            config = build();
          } catch (err) {
            replace(errors, el('div', { className: 'notice bad' }, [el('p', { text: err.message })]));
            return;
          }
          const validation = validateCompetitionConfig(config);
          if (!validation.ok) {
            replace(errors, el('div', { className: 'notice bad' }, [
              el('ul', { className: 'plain' }, validation.errors.map(
                (e) => el('li', { text: `${e.field} ${e.message}` }),
              )),
            ]));
            return;
          }
          try {
            const relayPool = new RelayPool(config.relays);
            const published = await publishCompetition(relayPool, signer, config);
            relayPool.close();
            announce(t('publish.ok', published));
            const naddr = naddrEncode({
              identifier: compDTag(config.comp_id), pubkey: signer.pubkey, kind: KIND,
            });
            location.hash = naddr;
            await start();
          } catch (err) {
            replace(errors, el('div', { className: 'notice bad' }, [
              el('p', { text: err.message || t('publish.none') }),
            ]));
          }
        },
      },
    }),
  ]);
}

// ── run ──

function lifecycleActions(snapshot) {
  const status = snapshot.state.status;
  const actions = [];
  const step = (label, next, className = '') => actions.push(el('button', {
    className, text: label, on: { click: () => act(() => writer.setStatus(next)) },
  }));

  if (status === 'draft') step(t('action.publish'), 'published', 'primary');
  if (status === 'published') step(t('org.open_registration'), 'registration_open', 'primary');
  if (status === 'registration_open') step(t('org.close_registration'), 'registration_closed', 'primary');
  if (status === 'registration_closed') step(t('org.open_checkin'), 'checkin_open', 'primary');
  if (status === 'checkin_open') step(t('org.start'), 'running', 'primary');
  if (status === 'running') { step(t('org.pause'), 'paused'); step(t('org.finish'), 'finished'); }
  if (status === 'paused') { step(t('org.resume'), 'running', 'primary'); step(t('org.finish'), 'finished'); }
  if (!['finished', 'cancelled'].includes(status)) {
    actions.push(el('button', {
      className: 'danger',
      text: t('org.cancel_comp'),
      on: {
        click: () => {
          if (!confirm(`${t('org.cancel_comp')}?`)) return;
          act(() => writer.setStatus('cancelled'));
        },
      },
    }));
  }
  return actions;
}

function entrantsPanel(snapshot) {
  const rows = [];
  for (const [, intent] of intents) {
    if (snapshot.state.participants.some((p) => p.pubkey === intent.pubkey)) continue;
    if (intent.intent.op !== 'register') continue;
    rows.push(el('li', {}, [
      el('div', { className: 'row between' }, [
        el('span', { text: intent.intent.data.display || shortKey(intent.pubkey) }),
        el('span', { className: 'row' }, [
          el('button', {
            className: 'primary',
            text: t('org.accept'),
            on: {
              click: () => act(() => writer.decideRegistration(intent.pubkey, 'accepted', {
                division: intent.intent.data.division,
                display: intent.intent.data.display,
              })),
            },
          }),
          el('button', {
            text: t('org.waitlist'),
            on: {
              click: () => act(() => writer.decideRegistration(intent.pubkey, 'waitlisted', {
                division: intent.intent.data.division,
                display: intent.intent.data.display,
                waitlistPosition: snapshot.state.participants.filter((p) => p.registration === 'waitlisted').length + 1,
              })),
            },
          }),
        ]),
      ]),
    ]));
  }

  const participants = snapshot.state.participants.map((p) => el('li', {}, [
    el('div', { className: 'row between' }, [
      el('span', {}, [
        el('span', { text: displayName(p) }),
        el('span', { className: 'badge', text: t(`reg.${p.registration}`) }),
        el('span', { className: 'badge', text: t(`checkin.${p.checkin}`) }),
        snapshot.competition.fee_msat > 0
          && el('span', { className: p.payment === 'settled' ? 'badge ok' : 'badge warn', text: t(`pay.${p.payment}`) }),
      ]),
      el('span', { className: 'row' }, [
        p.registration === 'accepted' && p.checkin !== 'checked_in'
          && ['checkin_open', 'running'].includes(snapshot.state.status)
          && el('button', {
            text: t('action.checkin'),
            on: { click: () => act(() => writer.checkIn(p.pubkey)) },
          }),
        snapshot.competition.fee_msat > 0 && p.payment === 'pending'
          && el('button', {
            text: t('pay.settled'),
            on: { click: () => act(() => writer.decidePayment(p.pubkey, 'settled')) },
          }),
      ]),
    ]),
  ]));

  return el('section', { className: 'card' }, [
    el('h2', { text: t('org.entrants') }),
    rows.length ? el('ul', { className: 'plain' }, rows) : null,
    participants.length ? el('ul', { className: 'plain' }, participants) : el('p', { text: t('org.none') }),
  ]);
}

function queuePanel(snapshot) {
  const state = snapshot.state;
  if (!['checkin_open', 'running'].includes(state.status)) return null;

  const eligible = state.participants
    .filter((p) => p.registration === 'accepted' && p.checkin === 'checked_in' && p.result === 'active')
    .map((p) => p.pubkey);
  const current = store.currentClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const rows = [el('h2', { text: t('org.run') })];

  if (state.order.length !== eligible.length || state.order.length === 0) {
    rows.push(el('button', {
      className: 'primary',
      text: t('live.queue'),
      on: {
        click: () => act(async () => {
          const order = await AuthorityWriter.defaultOrder(snapshot.competition.comp_id, eligible);
          await writer.seed(order);
        }),
      },
    }));
  }

  if (state.status === 'running' && state.order.length) {
    rows.push(el('p', {
      text: currentParticipant ? displayName(currentParticipant) : t('live.nobody'),
    }));
    if (!currentParticipant) {
      rows.push(el('button', {
        className: 'primary',
        text: t('org.next_climber'),
        on: { click: () => act(() => writer.advance()) },
      }));
    } else {
      const climbId = state.current_climb_id;
      const attemptNo = (currentParticipant.climbs.find((c) => c.climb_id === climbId)?.attempts_used || 0) + 1;
      rows.push(el('div', { className: 'row' }, ['top', 'zone', 'fall', 'timeout'].map((outcome) => el('button', {
        className: outcome === 'top' ? 'primary' : '',
        text: t(`org.${outcome}`),
        on: {
          click: () => act(async () => {
            await writer.recordAttempt(current, climbId, outcome, attemptNo);
            await writer.closeTurn();
          }),
        },
      }))));
      rows.push(el('button', {
        text: t('live.defer'),
        on: { click: () => act(() => writer.decideDefer(current, 'granted')) },
      }));
    }

    const climbs = snapshot.competition.climbs || [];
    rows.push(el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.next_climb') }),
      el('div', { className: 'row' }, climbs.map((climb) => el('button', {
        text: climb.label,
        attrs: { disabled: climb.id === state.current_climb_id },
        on: {
          click: () => act(async () => {
            await writer.nextClimb(climb.id);
            await writer.nextRound();
            await writer.seed(eligible);
          }),
        },
      }))),
    ]));
  }

  const announcement = el('input', { attrs: { type: 'text', id: 'announce', maxlength: '280' } });
  rows.push(el('details', { className: 'disclosure' }, [
    el('summary', { text: t('org.announce') }),
    el('label', { attrs: { for: 'announce' }, text: t('org.announce') }, [announcement]),
    el('button', {
      text: t('org.announce'),
      on: {
        click: () => act(async () => {
          if (!announcement.value.trim()) return;
          await writer.announce(announcement.value.trim());
          announcement.value = '';
        }),
      },
    }),
  ]));

  return el('section', { className: 'card' }, rows);
}

function sharePanel(snapshot) {
  const link = joinLink(ref.naddr);
  return el('section', { className: 'card' }, [
    el('h2', { text: t('org.share') }),
    el('p', { className: 'mono selectable', text: link }),
    el('div', { className: 'row' }, [
      el('button', {
        text: t('action.copy_link'),
        on: {
          click: async (event) => {
            await navigator.clipboard.writeText(link);
            event.target.textContent = t('action.copied');
          },
        },
      }),
      el('a', {
        className: 'button',
        text: t('org.projector'),
        attrs: { href: `live.html#${ref.naddr}`, target: '_blank', rel: 'noopener' },
      }),
    ]),
    snapshot.state.status === 'finished' ? el('button', {
      className: 'primary',
      text: t('live.leaderboard'),
      on: { click: () => act(() => writer.publishResults()) },
    }) : null,
  ]);
}

const feedback = el('div', { attrs: { role: 'status', 'aria-live': 'polite' } });

async function act(work) {
  replace(feedback);
  try {
    await work();
  } catch (err) {
    replace(feedback, el('div', { className: 'notice bad' }, [
      el('p', { text: err.message || t('error.generic') }),
    ]));
    announce(err.message || t('error.generic'), { assertive: true });
  }
}

function render() {
  if (!signer) {
    replace(view, el('div', { className: 'card' }, [
      el('h1', { text: t('nav.organizer') }),
      el('p', { text: t('signin.intro') }),
    ]));
    return;
  }
  if (!store) { replace(view, createForm()); return; }

  const snapshot = store.snapshot();
  if (!snapshot.state) return;
  const isAuthority = signer.pubkey === snapshot.competition.authority;

  replace(view,
    devRelayBanner(store, t),
    ...integrityNotices(snapshot, t),
    el('section', { className: 'card' }, [
      el('h1', { text: snapshot.competition.title }),
      el('div', { className: 'row' }, [
        el('span', { className: 'badge', text: t(`status.${snapshot.state.status}`) }),
        el('span', { className: 'badge', text: formatDateTime(snapshot.competition.starts_at, language, snapshot.competition.timezone) }),
      ]),
      isAuthority ? el('div', { className: 'row' }, lifecycleActions(snapshot))
        : el('div', { className: 'notice warn' }, [el('p', { text: t('signin.as') })]),
    ]),
    feedback,
    isAuthority ? entrantsPanel(snapshot) : null,
    isAuthority ? queuePanel(snapshot) : null,
    sharePanel(snapshot),
    snapshot.state.rejected.length ? el('details', { className: 'disclosure' }, [
      el('summary', { text: String(snapshot.state.rejected.length) }),
      el('ul', { className: 'plain' }, snapshot.state.rejected.map(
        (r) => el('li', { className: 'small', text: describeRejection(t, r) }),
      )),
    ]) : null);
}

async function start() {
  const hash = location.hash.replace(/^#/, '');
  const parsed = parseCompetitionRef(hash);
  if (!parsed.ok) { store = null; render(); return; }
  ref = parsed;

  if (pool) { store?.close(); pool.close(); }
  const opened = await openCompetition({
    organizerPubkey: parsed.organizerPubkey, compId: parsed.compId, t, statusNode,
  });
  if (!opened) return;
  ({ store, pool } = opened);
  store.onChange(render);
  if (signer && signer.pubkey === store.competition.authority) {
    writer = new AuthorityWriter({ store, pool, signer });
    await store.followIntents((event) => {
      const parsedIntent = parseIntentEvent(event, store.competition, store.organizerPubkey,
        Math.floor(Date.now() / 1000));
      if (!parsedIntent.ok) return;
      intents.set(`${parsedIntent.pubkey}:${parsedIntent.intent.op}`, parsedIntent);
      render();
    });
  }
  render();
}

window.addEventListener('hashchange', start);
await signIn.restore();
await start();

export { DISCOVERY_RELAYS };
