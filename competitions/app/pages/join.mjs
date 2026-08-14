/**
 * The participant screen — the iOS and non-app route into a competition.
 *
 * It answers, in this order and without being asked twice: what is happening
 * right now, what do I have to do, and where do I stand. Everything else is
 * below the fold.
 */
import {
  bootstrap, byId, devRelayBanner, el, integrityGuard, integrityNotices, joinLink,
  openCompetition, openCompetitionForm, parseCompetitionRef, replace, resolveRelays,
} from './common.mjs?v=20260814-13';
import { SignIn } from '../ui/shell.mjs?v=20260814-8';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { decodeInvoice, secondsLeft, walletUri } from '../protocol/bolt11.mjs';
import {
  resolvePayEndpoint, validatePayResponse, invoiceUrl, validateInvoiceResponse,
} from '../protocol/lnurl.mjs';
import { buildZapRequest } from '../protocol/zap.mjs';
import { buildClaimBody, validateClaimInput, eligibleWinner } from '../protocol/prize.mjs';
import {
  checkinWindowOpen, competitionAddress, competitionRunning, registrationWindowOpen,
} from '../protocol/competition.mjs?v=20260814-6';
import { EntrantWriter } from '../authority.mjs?v=20260814-7';
import {
  announce, displayName, formatDateTime, formatSats, formatSeconds, shortKey,
} from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs?v=20260814-13';
import { scoringExplanation, usesPointLeaderboard } from '../ui/scoring-copy.mjs?v=20260813-1';
import { personalCue, queuePreview, rotationPreview, syncHealth, turnEstimate } from '../ui/live-view.mjs?v=20260814-2';
import { loadCatalogueClimbs } from '../data/climb-catalogue.mjs?v=20260813-2';
import {
  BOARD_TYPES, catalogueBoardKey, catalogueClimbMatches, catalogueProductSizeId,
} from '../protocol/board-catalog.mjs?v=20260813-1';
import {
  climbCard, filterCatalogue, gradeFilterOptions, saveGradeScale, storedGradeScale,
} from '../ui/climb-card.mjs?v=20260813-6';

const { t, language } = bootstrap();

let store = null;
let pool = null;
let entrant = null;
let signer = null;
let ref = null;
let lastTurnAnnouncement = null;
let lastParticipantScreen = '';
let ticker = null;
let catalogueDetails = new Map();
let catalogueState = 'idle';
let catalogueError = '';
let catalogueCompetition = '';
let lastHealthKind = '';
let preparedChoiceTrust = 'idle';
let preparedChoiceToken = 0;
const preparedClimbs = new Map();
const PARTICIPANT_DESTINATIONS = new Set(['registration', 'checkin', 'live', 'chooser', 'leaderboard']);
const PARTICIPANT_HISTORY_KEY = 'cruxcoachCompetitionParticipantDestination';
let participantDestination = '';

window.addEventListener('popstate', (event) => {
  const saved = event.state?.[PARTICIPANT_HISTORY_KEY];
  if (saved?.address === store?.address && PARTICIPANT_DESTINATIONS.has(saved.destination)) {
    participantDestination = saved.destination;
    render();
  }
});

function catalogueBoard(competition) {
  const board = competition.board;
  const type = BOARD_TYPES.find((candidate) => candidate.brand === board.brand
    && candidate.models.some((model) => model.value === board.model && model.layoutId === board.layout_id));
  const model = type?.models.find((candidate) => candidate.value === board.model
    && candidate.layoutId === board.layout_id);
  const size = model?.sizes.find((candidate) => candidate.value === board.size);
  return model && size ? {
    brand: board.brand, layoutId: board.layout_id, modelLabel: model.label,
    productSizeId: catalogueProductSizeId(size), angle: board.angle,
  } : null;
}

async function hydrateCatalogue(competition) {
  const token = `${competition.authority}:${competition.comp_id}:${competition.revision}`;
  catalogueCompetition = token;
  catalogueState = 'loading'; catalogueError = ''; catalogueDetails = new Map(); render();
  const board = catalogueBoard(competition);
  if (!board) { catalogueState = 'error'; catalogueError = t('select.catalogue.bad_board'); render(); return; }
  try {
    const loaded = await loadCatalogueClimbs(board);
    if (catalogueCompetition !== token) return;
    const { climbs, catalogue } = loaded || {};
    if (!Array.isArray(climbs) || (catalogue && catalogue.key !== catalogueBoardKey(board))
      || climbs.some((climb) => !catalogueClimbMatches(climb, board))) {
      throw new Error('catalogue_mismatch');
    }
    catalogueDetails = new Map(climbs.map((climb) => [String(climb.uuid).toLowerCase(), climb]));
    catalogueState = 'ready';
  } catch {
    if (catalogueCompetition !== token) return;
    catalogueState = 'error'; catalogueError = t('select.catalogue.error');
  }
  render();
}

const view = byId('view');
const statusNode = byId('load-status');
const REGISTRATION_DRAFT_PREFIX = 'cruxcoach:competitions:registration-draft:v1:';
const REGISTRATION_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CHECKIN_REQUEST_PREFIX = 'cruxcoach:competitions:checkin-request:v1:';

function checkinRequestKey(competition) {
  return signer ? `${CHECKIN_REQUEST_PREFIX}${signer.pubkey}:${competition.authority}:${competition.comp_id}` : '';
}

function checkinRequested(competition) {
  try { return Boolean(localStorage.getItem(checkinRequestKey(competition))); } catch { return false; }
}

function markCheckinRequested(competition) {
  try { localStorage.setItem(checkinRequestKey(competition), String(Date.now())); } catch { /* status still updates in this view */ }
}

function clearCheckinRequested(competition) {
  try { localStorage.removeItem(checkinRequestKey(competition)); } catch { /* storage may be disabled */ }
}

function catalogueFilters(onChange) {
  let gradeScale = storedGradeScale();
  const search = el('input', { attrs: { type: 'search', placeholder: t('climb.browser.search.placeholder') } });
  const minGrade = el('select');
  const maxGrade = el('select');
  const sends = el('select', {}, [
    ['0', t('climb.filter.any_sends')], ['10', '10+'], ['100', '100+'], ['1000', '1,000+'],
  ].map(([value, label]) => el('option', { attrs: { value }, text: label })));
  const sort = el('select', {}, [
    ['popular', 'climb.filter.popular'], ['quality', 'climb.filter.quality'],
    ['easiest', 'climb.filter.easiest'], ['hardest', 'climb.filter.hardest'],
  ].map(([value, key]) => el('option', { attrs: { value }, text: t(key) })));
  const scale = el('div', {
    className: 'segmented-control', attrs: { role: 'group', 'aria-label': t('climb.filter.grade_scale') },
  });
  const setSelectOptions = (node, options, previous) => {
    replace(node, el('option', { attrs: { value: '' }, text: t('climb.filter.any_grade') }),
      ...options.map(({ value, label }) => el('option', { attrs: { value }, text: label })));
    node.value = [...node.options].some((option) => option.value === previous) ? previous : '';
  };
  const renderScale = () => {
    const oldMin = minGrade.value;
    const oldMax = maxGrade.value;
    setSelectOptions(minGrade, gradeFilterOptions(gradeScale, 'min'), oldMin);
    setSelectOptions(maxGrade, gradeFilterOptions(gradeScale, 'max'), oldMax);
    replace(scale, ...[['v', t('climb.filter.grade_scale.v')], ['font', t('climb.filter.grade_scale.font')]]
      .map(([value, label]) => el('button', {
        className: gradeScale === value ? 'active' : '', text: label,
        attrs: { type: 'button', 'aria-pressed': String(gradeScale === value) },
        on: { click: () => {
          if (gradeScale === value) return;
          gradeScale = value; saveGradeScale(value); renderScale(); onChange();
        } },
      })));
  };
  renderScale();
  for (const control of [search, minGrade, maxGrade, sends]) control.addEventListener('input', onChange);
  sort.addEventListener('change', onChange);
  const reset = el('button', {
    className: 'quiet', text: t('climb.filter.reset'), attrs: { type: 'button' },
    on: { click: () => {
      search.value = ''; minGrade.value = ''; maxGrade.value = ''; sends.value = '0'; sort.value = 'popular';
      onChange();
    } },
  });
  const labelled = (label, control) => el('label', {}, [el('span', { text: label }), control]);
  return {
    node: el('div', { className: 'catalogue-filters' }, [
      el('div', { className: 'catalogue-toolbar' }, [
        el('span', { className: 'small', text: t('climb.filter.grade_scale') }), scale, reset,
      ]),
      el('div', { className: 'climb-filter-grid compact' }, [
        labelled(t('climb.browser.search'), search),
        labelled(t('climb.filter.min_grade'), minGrade),
        labelled(t('climb.filter.max_grade'), maxGrade),
        labelled(t('climb.filter.min_ascents'), sends),
        labelled(t('climb.filter.sort'), sort),
      ]),
    ]),
    values: () => ({
      query: search.value, minDifficulty: minGrade.value, maxDifficulty: maxGrade.value,
      minAscents: sends.value, sort: sort.value,
    }),
    gradeScale: () => gradeScale,
  };
}

function canPersistRegistrationDraft() {
  // A registration draft is ordinary competition input, not key material.
  // Keep it for the signed-in pubkey even when that identity is session-only,
  // so removing and later restoring the key never discards the form.
  return Boolean(signer?.pubkey);
}

function registrationDraftKey(competition) {
  return `${REGISTRATION_DRAFT_PREFIX}${signer.pubkey}:${competition.authority}:${competition.comp_id}`;
}

function readRegistrationDraft(competition) {
  if (!canPersistRegistrationDraft()) return null;
  try {
    const key = registrationDraftKey(competition);
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || saved.version !== 1 || Date.now() - saved.savedAt > REGISTRATION_DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return saved.draft;
  } catch { return null; }
}

function saveRegistrationDraft(competition, draft) {
  if (!canPersistRegistrationDraft()) return;
  try {
    localStorage.setItem(registrationDraftKey(competition), JSON.stringify({
      version: 1, savedAt: Date.now(), draft,
    }));
  } catch { /* private mode or quota: registration still works */ }
}

function clearRegistrationDraft(competition) {
  if (!signer) return;
  try { localStorage.removeItem(registrationDraftKey(competition)); } catch { /* private mode */ }
}
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
    void restorePreparedChoice();
  },
});

async function restorePreparedChoice() {
  const token = ++preparedChoiceToken;
  if (!signer || !entrant || !store
    || store.competition.rules.climb_source !== 'participant_choice') {
    preparedChoiceTrust = 'ready';
    render();
    return;
  }
  preparedChoiceTrust = 'loading';
  render();
  const pubkey = signer.pubkey;
  const competition = store.competition;
  const nonce = entrant.nonceFor('climb_choice');
  const restored = await store.loadOwnIntent(pubkey, 'climb_choice', nonce);
  if (token !== preparedChoiceToken || signer?.pubkey !== pubkey
    || store?.competition.comp_id !== competition.comp_id) return;
  const key = `${competition.comp_id}:${pubkey}`;
  if (!restored.trustworthy) {
    preparedChoiceTrust = 'untrusted';
  } else {
    const climbId = restored.intent?.intent.data?.climb_id;
    if (climbId) preparedClimbs.set(key, climbId); else preparedClimbs.delete(key);
    preparedChoiceTrust = 'ready';
  }
  render();
}

// ── opening a competition ──

const openForm = () => openCompetitionForm(t, start);

// ── rendering ──

function me() {
  return signer ? store?.participant(signer.pubkey) : null;
}

function header(snapshot) {
  const competition = snapshot.competition;
  const now = Math.floor(Date.now() / 1000);
  const status = competitionRunning(competition, snapshot.state.status, now)
    ? 'running' : snapshot.state.status;
  const board = competition.board || {};
  return el('section', { className: 'participant-comp-header' }, [
    el('div', { className: 'participant-comp-title' }, [
      el('p', { className: 'eyebrow', text: t('participant.competition') }),
      el('h1', { text: competition.title }),
    ]),
    el('div', { className: 'participant-comp-badges' }, [
      el('span', { className: 'badge', text: t(`status.${status}`) }),
      competition.venue?.name && el('span', { className: 'badge', text: competition.venue.name }),
      el('span', {
        className: competition.fee_msat > 0 ? 'badge' : 'badge ok',
        text: competition.fee_msat > 0 ? formatSats(competition.fee_msat) : t('pay.not_required'),
      }),
    ]),
    el('p', { className: 'lead', text: competition.summary }),
    el('details', { className: 'disclosure participant-comp-details' }, [
      el('summary', { text: t('participant.details') }),
      el('dl', { className: 'key-value' }, [
        el('dt', { text: t('org.when') }),
        el('dd', { text: formatDateTime(competition.starts_at, language, competition.timezone) }),
        el('dt', { text: t('org.format') }),
        el('dd', {
          text: t('competition.format.summary', {
            available: competition.rules.climb_source === 'participant_choice'
              ? (competition.climb_pool?.options?.length || 0) : (competition.climbs?.length || 0),
            counted: competition.rules.counted_climb_count || competition.rules.climb_count,
            attempts: competition.rules.attempts_per_climb,
          }),
        }),
        el('dt', { text: t('org.board') }),
        el('dd', {
          text: [humanBoardModel(board.model), board.size, Number.isInteger(board.angle) ? `${board.angle}°` : '']
            .filter(Boolean).join(' · '),
        }),
        el('dt', { text: t('org.field.reg_close') }),
        el('dd', { text: formatDateTime(competition.registration_closes_at, language, competition.timezone) }),
      ]),
      competition.description && el('p', { text: competition.description }),
      el('aside', { className: 'subcard scoring-explanation' }, [
        el('h2', { text: t('scoring.info.title') }),
        el('p', { text: scoringExplanation(t, competition) }),
      ]),
    ]),
  ]);
}

function participantScreen(snapshot) {
  const now = Math.floor(Date.now() / 1000);
  if (competitionRunning(snapshot.competition, snapshot.state.status, now)
    || ['paused', 'finished', 'cancelled'].includes(snapshot.state.status)) return 'live';
  const mine = me();
  // Acceptance, not a mutually exclusive global phase, advances this person.
  // The check-in screen can therefore clearly say "not open yet" even while
  // registration remains open for somebody else.
  if (mine?.registration === 'accepted') return 'checkin';
  return 'registration';
}

function participantDestinations(snapshot) {
  const phase = participantScreen(snapshot);
  const mine = me();
  const available = new Set(['registration']);
  if (mine?.registration === 'accepted') available.add('checkin');
  if (phase === 'live') {
    available.add('live');
    available.add('leaderboard');
    if (mine && snapshot.competition.rules.climb_source === 'participant_choice') {
      available.add('chooser');
    }
  }
  return available;
}

function recordParticipantDestination(destination, { replaceState = false } = {}) {
  history[replaceState ? 'replaceState' : 'pushState']({
    ...(history.state || {}),
    [PARTICIPANT_HISTORY_KEY]: { address: store.address, destination },
  }, '');
}

function selectParticipantDestination(destination, { replaceState = false } = {}) {
  if (!store || !participantDestinations(store.snapshot()).has(destination)) return;
  participantDestination = destination;
  recordParticipantDestination(destination, { replaceState });
  render();
}

function participantDestinationNavigation(snapshot, active) {
  const available = participantDestinations(snapshot);
  return el('nav', {
    className: 'participant-destination-nav',
    attrs: { 'aria-label': t('participant.navigation') },
  }, [...PARTICIPANT_DESTINATIONS].map((destination) => el('button', {
    text: t(`participant.destination.${destination}`),
    attrs: {
      type: 'button',
      disabled: !available.has(destination) || destination === active,
      'aria-current': destination === active ? 'page' : null,
    },
    on: { click: () => selectParticipantDestination(destination) },
  })));
}

function phaseNavigation(screen, snapshot) {
  const phases = ['registration', 'checkin', 'live'];
  const current = phases.indexOf(screen);
  const mine = me();
  const completed = {
    registration: mine?.registration === 'accepted',
    checkin: mine?.checkin === 'checked_in',
    live: snapshot.state.status === 'finished',
  };
  return el('nav', { className: 'participant-phases', attrs: { 'aria-label': t('participant.progress') } }, [
    el('ol', {}, phases.map((phase, index) => el('li', {
      className: completed[phase] ? 'done' : index === current ? 'current' : 'upcoming',
      attrs: index === current ? { 'aria-current': 'step' } : {},
    }, [
      el('span', { className: 'participant-phase-number', text: completed[phase] ? '✓' : String(index + 1) }),
      el('span', {}, [
        el('strong', { text: t(`participant.phase.${phase}`) }),
        el('small', { text: t(`participant.phase_state.${completed[phase] ? 'done' : index === current ? 'current' : 'upcoming'}`) }),
      ]),
    ]))),
  ]);
}

function windowPosition(now, opensAt, closesAt) {
  if (now < opensAt) return 'upcoming';
  if (now > closesAt) return 'closed';
  return 'open';
}

function phaseIntro(screen) {
  return el('section', { className: `participant-phase-intro phase-${screen}` }, [
    el('p', { className: 'eyebrow', text: t(`participant.phase.${screen}`) }),
    el('h2', { text: t(`participant.${screen}.title`) }),
    el('p', { text: t(`participant.${screen}.hint`) }),
  ]);
}

function participantDestinationIntro(destination) {
  if (['registration', 'checkin', 'live'].includes(destination)) return phaseIntro(destination);
  return el('section', { className: `participant-phase-intro phase-${destination}` }, [
    el('p', { className: 'eyebrow', text: t(`participant.destination.${destination}`) }),
    el('h2', { text: t(`participant.${destination}.title`) }),
    el('p', { text: t(`participant.${destination}.hint`) }),
  ]);
}

function registrationPanel(snapshot) {
  const competition = snapshot.competition;
  const mine = me();
  const now = Math.floor(Date.now() / 1000);

  if (!signer) {
    return el('section', { className: 'card raised' }, [
      el('h2', { text: t('action.register') }),
      el('p', { text: t('signin.intro') }),
    ]);
  }

  if (mine) {
    const rows = [
      el('h2', { text: t('action.register') }),
      el('div', { className: `participant-decision participant-decision-${mine.registration}` }, [
        el('span', { className: `participant-status-icon ${mine.registration === 'accepted' ? 'ok' : ''}`, text: mine.registration === 'accepted' ? '✓' : '•' }),
        el('div', {}, [
          el('strong', { text: t(`reg.${mine.registration}`) }),
          el('span', { text: t(`reg.detail.${mine.registration}`) }),
        ]),
        competition.fee_msat > 0 && el('span', {
          className: mine.payment === 'settled' ? 'badge ok' : 'badge warn',
          text: t(`pay.${mine.payment}`),
        }),
      ]),
    ];
    if (mine.registration === 'waitlisted' && mine.waitlist_position) {
      rows.push(el('p', { className: 'small', text: `#${mine.waitlist_position}` }));
    }
    // Not only `pending`. A payment the organizer recorded as failed or
    // expired is precisely the state somebody has to be able to leave, and
    // showing the badge without the control strands them.
    if (competition.fee_msat > 0 && PAYABLE_STATES.has(mine.payment)) {
      rows.push(paymentPanel(snapshot, mine));
    }
    if (['pending', 'accepted', 'waitlisted'].includes(mine.registration)
      && !['finished', 'cancelled'].includes(snapshot.state.status)) {
      rows.push(el('button', {
        text: t('action.withdraw'),
        on: {
          click: () => {
            if (!confirm(t('reg.withdraw.confirm'))) return;
            guard(() => entrant.withdraw());
          },
        },
      }));
    }

    // Withdrawing is not meant to be a door that locks behind you. While
    // registration is open, asking again replaces the withdrawal rather than
    // adding a second request.
    if (['withdrawn', 'rejected'].includes(mine.registration)
      && registrationWindowOpen(competition, snapshot.state.status, now)) {
      const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
      rows.push(
        el('p', { className: 'small', text: t('reg.again.hint') }),
        el('button', {
          className: 'primary',
          text: t('reg.again'),
          on: {
            click: () => guard(async () => {
              await entrant.register({
                division: mine.division || competition.divisions[0].id,
                display: mine.display || shortKey(signer.pubkey),
                waiverAccepted: true,
                selections: [],
              });
              feedback.textContent = t('reg.sent');
              announce(t('reg.sent'));
            }, feedback),
          },
        }),
        feedback,
      );
    }
    return el('section', { className: 'card raised' }, rows);
  }

  const registrationPosition = windowPosition(
    now, competition.registration_opens_at, competition.registration_closes_at,
  );
  if (!registrationWindowOpen(competition, snapshot.state.status, now)) {
    return el('section', { className: 'card raised' }, [
      el('h2', { text: t('action.register') }),
      el('div', { className: `participant-window-state state-${registrationPosition}` }, [
        el('strong', { text: t(`reg.window.${registrationPosition}`) }),
        el('span', { text: registrationPosition === 'upcoming'
          ? formatDateTime(competition.registration_opens_at, language, competition.timezone)
          : formatDateTime(competition.registration_closes_at, language, competition.timezone) }),
      ]),
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
  const savedDraft = readRegistrationDraft(competition);
  const display = el('input', {
    attrs: {
      type: 'text', id: 'display', maxlength: '48', autocomplete: 'nickname',
      value: savedDraft?.display || signIn.displayName || '', required: 'required',
    },
  });
  const division = el('select', { attrs: { id: 'division', required: 'required' } },
    competition.divisions.map((d) => el('option', {
      attrs: { value: d.id, selected: d.id === savedDraft?.division }, text: d.label,
    })));
  const waiver = el('input', { attrs: { type: 'checkbox', id: 'waiver' } });
  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const readiness = el('p', { className: 'small registration-readiness', attrs: { role: 'status', 'aria-live': 'polite' } });

  const rows = [
    el('h2', { text: t('action.register') }),
    el('label', { attrs: { for: 'display' } }, [
      el('span', {}, [
        el('span', { text: t('reg.display') }),
        el('span', { className: 'field-marker required', text: t('field.required') }),
      ]),
      el('span', { className: 'hint', text: t('reg.display.hint') }),
      display,
    ]),
  ];

  if (competition.divisions.length > 1) {
    rows.push(el('label', { attrs: { for: 'division' } }, [
      el('span', { text: t('reg.division') }),
      el('span', { className: 'field-marker required', text: t('field.required') }),
      division,
    ]));
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
  const registerButton = el('button', {
    className: 'primary',
    text: t('action.register'),
    on: {
      click: () => guard(async () => {
        await entrant.register({
          division: competition.divisions.length > 1 ? division.value : competition.divisions[0].id,
          display: display.value.trim(),
          waiverAccepted: !competition.waiver_required || waiver.checked,
          selections: [],
        });
        clearRegistrationDraft(competition);
        feedback.textContent = t('reg.sent');
        announce(t('reg.sent'));
      }, feedback),
    },
  });
  const updateReady = () => {
    const missingName = !display.value.trim();
    const missingWaiver = competition.waiver_required && !waiver.checked;
    registerButton.disabled = missingName || missingWaiver;
    readiness.textContent = missingName ? t('reg.ready.name')
      : missingWaiver ? t('reg.ready.waiver') : t('reg.ready.complete');
  };
  const saveDraft = () => saveRegistrationDraft(competition, {
    display: display.value.trim(), division: division.value,
  });
  display.addEventListener('input', () => { updateReady(); saveDraft(); });
  division.addEventListener('change', saveDraft);
  waiver.addEventListener('change', updateReady);
  updateReady();
  rows.push(readiness, feedback, registerButton);
  return el('section', { className: 'card raised' }, rows);
}

function checkinPanel(snapshot) {
  const competition = snapshot.competition;
  const mine = me();
  const now = Math.floor(Date.now() / 1000);
  const rows = [el('h2', { text: t('participant.checkin.card_title') })];

  if (!signer) {
    rows.push(el('p', { text: t('participant.checkin.signin') }));
    return el('section', { className: 'card raised participant-checkin-card' }, rows);
  }
  if (!mine || mine.registration !== 'accepted') {
    rows.push(el('p', { text: mine ? t(`reg.${mine.registration}`) : t('reg.closed') }));
    return el('section', { className: 'card raised participant-checkin-card' }, rows);
  }

  if (mine.checkin === 'checked_in') clearCheckinRequested(competition);
  const requested = mine.checkin === 'none' && checkinRequested(competition);
  const position = windowPosition(now, competition.checkin_opens_at, competition.checkin_closes_at);
  rows.push(el('div', { className: 'participant-checkin-status' }, [
    el('span', {
      className: mine.checkin === 'checked_in' ? 'participant-status-icon ok' : 'participant-status-icon',
      text: mine.checkin === 'checked_in' ? '✓' : '2',
    }),
    el('div', {}, [
      el('strong', { text: requested ? t('checkin.requested') : t(`checkin.${mine.checkin}`) }),
      el('span', { text: mine.checkin === 'checked_in'
        ? t('participant.checkin.ready') : requested
          ? t('participant.checkin.requested_waiting') : t(`participant.checkin.${position}`) }),
    ]),
  ]));

  if (competition.fee_msat > 0 && PAYABLE_STATES.has(mine.payment)) rows.push(paymentPanel(snapshot, mine));
  if (mine.checkin === 'none' && !requested && checkinWindowOpen(competition, snapshot.state.status, now)) {
    const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
    rows.push(el('button', {
      className: 'primary participant-checkin-action', text: t('action.checkin'),
      on: { click: () => guard(async () => {
        await entrant.requestCheckIn();
        markCheckinRequested(competition);
        feedback.textContent = t('participant.checkin.sent');
        render();
      }, feedback) },
    }), feedback);
  } else if (mine.checkin === 'none' && !requested) {
    rows.push(el('div', { className: `participant-window-state state-${position}` }, [
      el('strong', { text: t(`checkin.window.${position}`) }),
      el('span', { text: position === 'upcoming'
        ? formatDateTime(competition.checkin_opens_at, language, competition.timezone)
        : formatDateTime(competition.checkin_closes_at, language, competition.timezone) }),
    ]));
  }

  if (!['finished', 'cancelled'].includes(snapshot.state.status)) rows.push(
    el('details', { className: 'disclosure participant-secondary-actions' }, [
      el('summary', { text: t('participant.registration.manage') }),
      el('button', {
        className: 'quiet danger', text: t('action.withdraw'),
        on: { click: () => {
          if (!confirm(t('reg.withdraw.confirm'))) return;
          guard(() => entrant.withdraw());
        } },
      }),
    ]),
  );
  return el('section', { className: 'card raised participant-checkin-card' }, rows);
}

function humanBoardModel(model) {
  const known = {
    'kilterboard-og': 'Kilter Board Original',
    'kilterboard-homewall': 'Kilter Board Homewall',
    'tension-board-1': 'Tension Board',
    'tension-board-2-mirror': 'Tension Board 2 (Mirror)',
    'tension-board-2-spray': 'Tension Board 2 (Spray)',
  };
  if (known[model]) return known[model];
  if (!model) return '';
  return model.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    .replace(/Moonboard/g, 'MoonBoard');
}

/**
 * What happened to this entrant's climb choices.
 *
 * With unique claims somebody has to lose a race, and losing silently is the
 * worst version of it: the screen names which climbs were granted, which are
 * still waiting on the organizer, and offers a way to pick again from what is
 * still free.
 */
/**
 * Payment failures that have their own sentence.
 *
 * Anything outside this set is the provider misbehaving in a way we cannot
 * usefully describe, and gets the generic wording rather than a raw code.
 */
/** Payment states an entrant can still act on. */
const PAYABLE_STATES = new Set(['pending', 'failed', 'expired']);

const PAY_ERRORS = new Set([
  'empty', 'bad_address', 'bad_domain', 'onion', 'bad_lnurl', 'bad_url', 'not_https',
  'unrecognised', 'not_a_pay_request', 'bad_callback', 'bad_limits', 'below_minimum',
  'above_maximum', 'no_metadata', 'bad_metadata', 'no_invoice', 'unreadable_invoice',
  'no_amount', 'wrong_amount', 'no_payment_hash', 'unreachable', 'timeout',
]);

function payError(code, values) {
  return new Error(PAY_ERRORS.has(code) ? t(`pay.error.${code}`, values) : t('pay.error.provider'));
}

/**
 * Paying the entry fee.
 *
 * Three steps, each of which can fail in a way the entrant has to be told
 * about: resolve the organizer's payment endpoint, ask it for an invoice
 * bound to this person and this registration, then show that invoice with a
 * countdown and a way to pay it.
 *
 * The invoice is checked before it is displayed. An invoice for a different
 * amount is refused rather than shown with a warning, because the number on the
 * screen and the number the wallet would send have to be the same number.
 */
function paymentPanel(snapshot, mine) {
  const competition = snapshot.competition;
  const rows = [
    el('h3', { text: t('pay.title') }),
    el('p', { text: t('pay.amount', { sats: Math.round(competition.fee_msat / 1000) }) }),
    // Before they pay, not after: where the money goes and who cannot get it
    // back for them.
    el('p', { className: 'small', text: t('money.no_custody.entrant') }),
  ];

  if (!competition.fee_lnurl) {
    // A fee with nowhere to send it is the organizer's problem to fix, but the
    // entrant still needs to know why there is no button.
    rows.push(el('p', { className: 'small', text: t('pay.no_endpoint') }));
    return el('div', { className: 'notice warn' }, rows);
  }

  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const invoiceBox = el('div', {});

  const showInvoice = (invoice, decoded, verifiable) => {
    const left = secondsLeft(decoded, Math.floor(Date.now() / 1000));
    replace(invoiceBox,
      el('p', { className: 'mono selectable wrap', text: invoice }),
      el('div', { className: 'row' }, [
        el('a', { className: 'button primary', attrs: { href: walletUri(invoice) }, text: t('pay.open_wallet') }),
        el('button', {
          text: t('pay.copy'),
          on: {
            click: () => {
              navigator.clipboard?.writeText(invoice)
                .then(() => { feedback.textContent = t('pay.copied'); })
                .catch(() => { feedback.textContent = t('pay.copy_failed'); });
            },
          },
        }),
      ]),
      el('p', {
        className: 'small',
        text: left > 0
          ? t('pay.expires_in', { minutes: Math.ceil(left / 60) })
          : t('pay.expired'),
      }),
      // Said before they pay, not after: what the organizer will be able to
      // check, and what they will have to take on trust.
      el('p', {
        className: 'small',
        text: verifiable ? t('pay.will_verify') : t('pay.manual_confirm'),
      }));
  };

  rows.push(
    el('button', {
      className: 'primary',
      text: t('pay.get_invoice'),
      on: {
        click: () => guard(async () => {
          feedback.textContent = t('pay.working');
          const result = await requestInvoice(snapshot, mine);
          showInvoice(result.invoice, result.decoded, result.verifiable);
          feedback.textContent = '';
        }, feedback),
      },
    }),
    invoiceBox,
    feedback,
    el('p', { className: 'small', text: t('pay.settle_hint') }),
  );
  return el('div', { className: 'notice warn' }, rows);
}

/**
 * Ask the organizer's payment endpoint for an invoice for this entry.
 *
 * The zap request is signed by the entrant and names the competition, the
 * amount and their registration nonce, which is what later lets the organizer
 * verify that *this* person paid *this* entry rather than that somebody paid
 * something.
 */
async function requestInvoice(snapshot, mine) {
  const competition = snapshot.competition;
  const endpoint = resolvePayEndpoint(competition.fee_lnurl);
  if (!endpoint.ok) throw payError(endpoint.error);

  const payResponse = await fetchJson(endpoint.url);
  const pay = validatePayResponse(payResponse, competition.fee_msat);
  if (!pay.ok) {
    throw payError(pay.error, {
      min: Math.round((pay.min || 0) / 1000), max: Math.round((pay.max || 0) / 1000),
    });
  }

  let zapRequest = null;
  if (pay.allowsNostr) {
    const draft = buildZapRequest({
      recipientPubkey: competition.authority,
      address: competitionAddress(ref.organizerPubkey, competition.comp_id),
      amountMsat: competition.fee_msat,
      relays: resolveRelays(),
      nonce: entrant.nonceFor('register'),
      createdAt: Math.floor(Date.now() / 1000),
    });
    zapRequest = await signer.signEvent(draft);
  }

  const response = await fetchJson(invoiceUrl(pay.callback, competition.fee_msat, { zapRequest }));
  const decoded = decodeInvoice(response?.pr || '');
  const checked = validateInvoiceResponse(response, decoded, competition.fee_msat);
  if (!checked.ok) {
    throw payError(checked.error, { sats: Math.round((checked.invoiceMsat || 0) / 1000) });
  }

  // Tell the organizer which receipt to look for. Sent even when the provider
  // cannot zap, because the payment claim is also how a manual confirmation
  // gets a paper trail.
  await entrant.claimPayment(zapRequest ? zapRequest.id : '', checked.invoice);
  return { invoice: checked.invoice, decoded, verifiable: pay.allowsNostr };
}

/** Fetch JSON with a deadline, because a hung request is not an answer. */
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw payError('unreachable');
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') throw payError('timeout');
    throw new Error(err.message || t('pay.error.unreachable'));
  } finally {
    clearTimeout(timer);
  }
}

function livePanel(snapshot) {
  const state = snapshot.state;
  const current = store.currentClimber();
  const next = store.nextClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const nextParticipant = next ? store.participant(next) : null;
  const mine = me();
  const isMyTurn = Boolean(mine && current === mine.pubkey);
  const runningNow = competitionRunning(snapshot.competition, state.status, Math.floor(Date.now() / 1000));
  const cue = personalCue(state, mine?.pubkey, runningNow);
  const estimate = turnEstimate(
    state, snapshot.competition, mine?.pubkey, Math.floor(Date.now() / 1000), runningNow,
  );
  const effectiveStatus = runningNow ? 'running' : state.status;
  const queue = queuePreview(state, state.participants, 6);
  const rotation = rotationPreview(snapshot.competition, state, mine, 4);
  const preparedId = mine ? preparedClimbs.get(`${snapshot.competition.comp_id}:${mine.pubkey}`) : '';
  const activeClimb = snapshot.competition.rules.climb_source === 'participant_choice'
    ? (snapshot.competition.climb_pool?.options || []).find((climb) => climb.id === preparedId)
    : (snapshot.competition.climbs || []).find((climb) => climb.id === state.current_climb_id);
  const cueKey = `live.cue.${cue.kind}`;
  const cueText = ['queued', 'next_round'].includes(cue.kind) ? t(cueKey, { n: cue.ahead }) : t(cueKey);
  const terminal = ['finished', 'cancelled'].includes(state.status);
  const rows = [
    el('div', { className: `participant-live-hero cue-${cue.kind}` }, [
      el('div', {}, [
        el('p', { className: 'eyebrow', text: t(`status.${effectiveStatus}`) }),
        el('h2', { text: cueText }),
        el('p', { className: 'participant-next-task', text: !terminal && isMyTurn && !activeClimb
          ? t('next.choose_required') : !terminal && activeClimb
          ? t('live.your_next_climb', { climb: activeClimb.label || activeClimb.id })
          : terminal ? t(`live.cue.${state.status}`) : t('live.no_next_climb') }),
        estimate && el('p', { className: 'participant-eta', text: t('live.eta', { time: formatSeconds(estimate.seconds) }) }),
      ]),
      el('div', { className: 'participant-turn-facts' }, [
        el('span', { className: 'participant-current-label', text: t('live.current') }),
        el('strong', { className: 'participant-current-person', text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
        runningNow && el('strong', {
          className: 'mono participant-deadline', attrs: { id: 'deadline', 'aria-label': t('live.deadline') }, text: formatSeconds(store.secondsToDeadline()),
        }),
      ]),
    ]),
  ];

  if (!runningNow && !['paused', 'finished', 'cancelled'].includes(state.status)) {
    rows.push(el('p', { className: 'participant-waiting', text: t('live.waiting') }));
  }

  if (runningNow || state.status === 'paused') rows.push(el('details', { className: 'participant-shared-state' }, [
    el('summary', { text: t('live.shared_state') }),
    el('div', { className: 'participant-live-grid' }, [
    el('section', { className: 'subcard' }, [
      el('h3', { text: t('live.now_and_next') }),
      el('dl', { className: 'key-value' }, [
        el('dt', { text: t('live.current') }),
        el('dd', { text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
        el('dt', { text: t('live.current_climb') }),
        el('dd', { text: climbLabel(snapshot, state.current_climb_id) }),
        el('dt', { text: t('live.next') }),
        el('dd', { text: nextParticipant ? displayName(nextParticipant) : '—' }),
      ]),
    ]),
    el('section', { className: 'subcard' }, [
      el('h3', { text: t('live.climber_queue') }),
      queue.entries.length ? el('ol', { className: 'participant-queue' }, queue.entries.map((entry) => el('li', {
        className: [entry.pubkey === mine?.pubkey ? 'me' : '', entry.current ? 'is-current' : '', entry.nextRound ? 'is-next-round' : ''].filter(Boolean).join(' '),
      }, [
        el('span', { text: entry.current ? t('live.now_short') : entry.nextRound ? t('live.next_round_short') : String(entry.queuePosition + 1) }),
        el('strong', { text: entry.participant ? displayName(entry.participant) : shortKey(entry.pubkey) }),
      ]))) : el('p', { className: 'small', text: t('live.queue_empty') }),
      queue.hidden > 0 && el('p', { className: 'small', text: t('live.more', { n: queue.hidden }) }),
    ]),
  ]),
  ]));

  if (mine) {
    const before = cue.ahead;
    rows.push(el('section', { className: 'participant-my-status' }, [
      el('h3', { text: t('live.your_status') }),
      el('div', { className: 'participant-metrics' }, [
        el('div', {}, [el('strong', { text: before === null ? '—' : String(before) }), el('span', { text: t('live.before_you') })]),
        el('div', {}, [el('strong', { text: activeClimb ? String(store.attemptsLeft(mine.pubkey, activeClimb.id)) : '—' }), el('span', { text: t('live.attempts_left') })]),
        el('div', {}, [el('strong', { text: String(store.defersLeft(mine.pubkey)) }), el('span', { text: t('live.defers_left') })]),
      ]),
      rotation.entries.length && el('div', { className: 'participant-rotation' }, [
        el('h3', { text: t('live.your_rotation') }),
        el('ol', {}, rotation.entries.map((climb, index) => el('li', {
          className: index === 0 ? 'is-next' : '', text: `${climb.label || climb.id}${Number.isInteger(climb.angle) ? ` · ${climb.angle}°` : ''}`,
        }))),
        rotation.hidden > 0 && el('p', { className: 'small', text: t('live.more', { n: rotation.hidden }) }),
      ]),
    ]));

    if (mine.climbs.length) {
      rows.push(el('h3', { text: t('table.attempts') }), el('ul', { className: 'plain' },
        mine.climbs.map((climb) => el('li', {
          text: `${climbLabel(snapshot, climb.climb_id)} — ${t(`org.${climb.outcome}`)} (${climb.attempts_used})`,
        }))));
    }

    if (runningNow) {
      const actions = [];
      if (activeClimb?.climb_uuid) actions.push(el('a', {
        className: 'button primary',
        text: isMyTurn ? t('live.open_now') : t('live.prepare_board'),
        attrs: { href: `/c/${activeClimb.climb_uuid}`, target: '_blank', rel: 'noopener' },
      }));
      if (store.canDefer(mine.pubkey)) actions.push(el('button', {
        text: t('live.defer'),
        on: { click: () => guard(() => entrant.requestDefer(state.current_climb_id, state.turn_deadline_at)) },
      }));
      const reason = !store.canDefer(mine.pubkey) && isMyTurn
        ? (state.paused ? t('next.paused') : store.defersLeft(mine.pubkey) === 0
          ? t('live.defer.none') : t('live.defer.consecutive')) : '';
      if (actions.length || reason) rows.push(el('aside', { className: 'participant-actions' }, [
        el('div', { className: 'participant-actions-copy' }, [
          el('strong', { text: isMyTurn ? t('live.your_turn') : t('live.next_action') }),
          el('span', { text: reason || (isMyTurn ? t('live.your_turn.hint') : t('live.prepare_hint')) }),
        ]),
        el('div', { className: 'row' }, actions),
      ]));
    } else if (state.status === 'paused') {
      rows.push(el('aside', { className: 'participant-actions participant-actions-status', attrs: { role: 'status' } }, [
        el('div', { className: 'participant-actions-copy' }, [
          el('strong', { text: t('live.paused') }),
          el('span', { text: t('live.paused.hint') }),
        ]),
      ]));
    } else if (terminal) {
      rows.push(el('aside', { className: 'participant-actions participant-actions-status' }, [
        el('div', { className: 'participant-actions-copy' }, [
          el('strong', { text: t(`live.cue.${state.status}`) }),
          el('span', { text: t('live.finished.hint') }),
        ]),
      ]));
    }
  }

  return el('section', { className: 'card participant-live' }, rows);
}

/**
 * Asynchronous turns: which of my climbs I go to next.
 *
 * Choosing is replaceable signed preparation and is therefore available before
 * the turn. It lets the host prepare without scoring anything. Signed result
 * controls appear only while the climber may actually act.
 */
function nextClimbChooser(snapshot, mine) {
  const remaining = store.remainingClimbs(mine.pubkey);
  const mayAct = store.mayAct(mine.pubkey);
  const key = `${snapshot.competition.comp_id}:${mine.pubkey}`;
  let selected = preparedClimbs.get(key) || '';
  if (selected && !remaining.some((climb) => climb.id === selected)) {
    preparedClimbs.delete(key);
    selected = '';
  }
  const rows = [
    el('p', { className: 'eyebrow', text: mayAct ? t('next.action_required') : t('next.prepare') }),
    el('h3', { text: mayAct ? t('next.choose_now') : t('next.title') }),
    el('p', { className: 'small', text: mayAct ? t('next.choose_now.hint') : t('next.prepare.hint') }),
  ];

  if (preparedChoiceTrust !== 'ready') {
    rows.push(el('div', { className: 'notice warn', attrs: { role: 'status' } }, [
      el('p', { text: t(preparedChoiceTrust === 'loading'
        ? 'next.choice_loading' : 'next.choice_untrusted') }),
      preparedChoiceTrust === 'untrusted' && el('button', {
        text: t('action.retry'), on: { click: () => { void restorePreparedChoice(); } },
      }),
    ]));
    return el('section', { className: 'participant-climb-choice' }, rows);
  }

  if (!remaining.length) {
    rows.push(el('p', { className: 'small', text: t('next.none_left') }));
    return el('section', { className: 'participant-climb-choice' }, rows);
  }

  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const chosen = el('select', { attrs: { id: 'next-climb', required: 'required' } }, [
    el('option', { attrs: { value: '', selected: !selected }, text: t('next.choose.placeholder') }),
    ...remaining.map((climb) => el('option', {
      attrs: { value: climb.id, selected: climb.id === selected },
      text: t('next.option', { label: climb.label, attempts: climb.attemptsLeft }),
    })),
  ]);
  chosen.addEventListener('change', async () => {
    const climbId = chosen.value;
    if (!climbId) {
      render();
      return;
    }
    chosen.disabled = true;
    try {
      await entrant.chooseClimb(climbId);
      preparedClimbs.set(key, climbId);
      preparedChoiceTrust = 'ready';
      announce(t('next.choice_shared'));
      render();
    } catch (err) {
      chosen.disabled = false;
      const message = err.message || t('error.generic');
      feedback.textContent = message;
      announce(message, { assertive: true });
    }
  });

  rows.push(
    el('label', { attrs: { for: 'next-climb' } }, [el('span', { text: t('next.choose') }), chosen]),
    selected && el('div', { className: 'participant-prepared-confirmation' }, [
      el('strong', { text: t('next.prepared') }),
      el('span', { text: t('next.choice_shared') }),
    ]),
  );
  const selectedClimb = remaining.find((climb) => climb.id === selected);
  const definition = (snapshot.competition.climb_pool?.options || snapshot.competition.climbs || [])
    .find((climb) => climb.id === selected);
  if (definition?.climb_uuid) rows.push(el('a', {
    className: `button ${mayAct ? 'primary' : ''}`,
    text: mayAct ? t('live.open_now') : t('live.prepare_board'),
    attrs: { href: `/c/${definition.climb_uuid}`, target: '_blank', rel: 'noopener' },
  }));
  if (mayAct) {
    rows.push(
      selectedClimb
        ? el('div', { className: 'participant-report-actions' }, [
          el('strong', { text: t('next.report_result') }),
          el('div', { className: 'row' }, ['top', 'zone', 'fall'].map((outcome) => el('button', {
            className: outcome === 'top' ? 'primary' : '',
            text: t(`org.${outcome}`),
            on: {
              click: () => guard(async () => {
                const current = store.remainingClimbs(mine.pubkey).find((c) => c.id === selected);
                if (!current) throw new Error(t('next.gone'));
                const used = snapshot.competition.rules.attempts_per_climb - current.attemptsLeft;
                await entrant.reportAttempt(current.id, outcome, used + 1);
                feedback.textContent = t('next.reported', { label: current.label });
                announce(t('next.reported', { label: current.label }));
              }, feedback),
            },
          }))),
          el('p', { className: 'small', text: t('next.reported.hint') }),
        ])
        : el('p', { className: 'notice warn', text: t('next.choose_required') }),
      feedback,
    );
  } else {
    rows.push(el('p', { className: 'small participant-action-lock', text: whyNotYet(snapshot, mine) }));
  }
  return el('section', { className: `participant-climb-choice ${mayAct ? 'action-required' : 'is-preparation'}` }, rows);
}

/** The one sentence that says why the chooser is not there. */
function whyNotYet(snapshot, mine) {
  const state = snapshot.state;
  if (state.status === 'paused') return t('next.paused');
  if (mine.result !== 'active') return t('next.out');
  if (mine.checkin !== 'checked_in') return t('next.not_checked_in');
  if (snapshot.competition.fee_msat > 0 && mine.payment !== 'settled') return t('next.unpaid');
  const rest = snapshot.competition.rules.min_rest_sec || 0;
  if (rest > 0 && mine.last_attempt_at > 0) {
    const left = rest - (Math.floor(Date.now() / 1000) - mine.last_attempt_at);
    if (left > 0) return t('next.resting', { seconds: left });
  }
  return t('next.not_your_turn');
}

function climbLabel(snapshot, climbId) {
  if (!climbId) return '—';
  const climb = (snapshot.competition.climbs || []).find((c) => c.id === climbId)
    || (snapshot.competition.climb_pool?.options || []).find((c) => c.id === climbId);
  return climb?.label || climbId;
}

/**
 * Claiming a prize you won.
 *
 * Only after the results are final, only for the prize you are actually
 * standing at, and only through an encrypted channel: the payout destination
 * goes to the organizer and nowhere else. The panel says, before anything is
 * typed, that the money is the organizer's to send and CruxCoach's to record.
 */
function prizePanel(snapshot) {
  const competition = snapshot.competition;
  const prizes = competition.prizes || [];
  if (prizes.length === 0) return null;
  if (snapshot.state.status !== 'finished') return null;

  const mine = me();
  if (!mine || !signer) return null;

  const resultsHash = snapshot.stateHash;
  const claimable = prizes.filter((prize) => {
    const winner = eligibleWinner(snapshot.standings, prize);
    return winner && winner.pubkey === mine.pubkey;
  });
  if (claimable.length === 0) return null;

  const rows = [el('h2', { text: t('prize.title') })];

  for (const prize of claimable) {
    const status = snapshot.state.prizes?.[prize.id];
    const cash = prize.kind === 'cash';

    rows.push(el('h3', {
      text: cash
        ? t('prize.won_cash', { label: prize.label, sats: Math.round(prize.value_msat / 1000) })
        : t('prize.won_goods', { label: prize.label }),
    }));
    // Said before they hand over a wallet address: whose money this is.
    rows.push(el('p', { className: 'small', text: t('money.prize_not_funded.entrant') }));

    if (status && ['approved', 'paid'].includes(status.state) && status.pubkey === mine.pubkey) {
      rows.push(el('p', { className: 'notice ok', text: t(`prize.state.${status.state}`) }));
      if (status.state === 'paid') {
        // The only evidence about a payout that comes from the person paid.
        const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
        rows.push(el('button', {
          text: t('prize.acknowledge'),
          on: {
            click: () => guard(async () => {
              await entrant.acknowledgePrize(prize.id);
              feedback.textContent = t('prize.acknowledged');
            }, feedback),
          },
        }), feedback);
      }
      continue;
    }
    if (status && status.state === 'rejected') {
      rows.push(el('p', { className: 'notice warn', text: t('prize.state.rejected') }));
    }
    if (status && status.state === 'expired') {
      rows.push(el('p', { className: 'notice warn', text: t('prize.state.expired') }));
      continue;
    }
    if (status && status.state === 'claimed') {
      rows.push(el('p', { className: 'small', text: t('prize.state.claimed') }));
    }

    const kindSelect = el('select', { attrs: { id: `prize-kind-${prize.id}` } },
      (cash
        ? [['lightning_address', t('prize.kind.address')], ['bolt11', t('prize.kind.invoice')]]
        : [['non_cash', t('prize.kind.non_cash')]]
      ).map(([value, label]) => el('option', { attrs: { value }, text: label })));
    const destination = el('input', {
      attrs: {
        type: 'text',
        id: `prize-dest-${prize.id}`,
        maxlength: '600',
        placeholder: cash ? t('prize.dest.address_hint') : t('prize.dest.goods_hint'),
      },
    });
    const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });

    rows.push(
      el('label', { attrs: { for: `prize-kind-${prize.id}` } }, [
        el('span', { text: t('prize.kind') }), kindSelect,
      ]),
      el('label', { attrs: { for: `prize-dest-${prize.id}` } }, [
        el('span', { text: t('prize.dest') }),
        el('span', { className: 'hint', text: t('prize.dest.hint') }),
        destination,
      ]),
      el('button', {
        className: 'primary',
        text: t('prize.claim'),
        on: {
          click: () => guard(async () => {
            const payoutKind = kindSelect.value;
            const checked = validateClaimInput({
              prize,
              payoutKind,
              destination: destination.value,
              nowSeconds: Math.floor(Date.now() / 1000),
            });
            // Refused here rather than by the organizer later: the winner is
            // standing right there and can fix it.
            if (!checked.ok) throw new Error(t(`prize.error.${checked.error}`, {}));

            if (!signer.encrypt) throw new Error(t('prize.error.no_encryption'));
            const body = buildClaimBody({
              compId: competition.comp_id,
              prizeId: prize.id,
              resultsHash,
              payoutKind,
              destination: destination.value,
            });
            const ciphertext = await signer.encrypt(competition.authority, body);
            await entrant.claimPrize(prize.id, ciphertext);
            feedback.textContent = t('prize.sent');
            announce(t('prize.sent'));
          }, feedback),
        },
      }),
      feedback,
    );
  }

  return el('section', { className: 'card raised' }, rows);
}

function leaderboard(snapshot) {
  const mine = me();
  const points = usesPointLeaderboard(snapshot.competition);
  if (!store.trustworthy || !snapshot.standings.length) {
    return el('section', { className: 'card participant-leaderboard', attrs: { id: 'leaderboard' } }, [
      el('h2', { text: t('live.leaderboard') }),
      el('p', { className: 'notice warn', text: store.trustworthy
        ? t('live.leaderboard.empty') : t('live.leaderboard.unavailable') }),
    ]);
  }
  return el('section', { className: 'card participant-leaderboard', attrs: { id: 'leaderboard' } }, [
    el('h2', { text: t('live.leaderboard') }),
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
          className: mine && row.pubkey === mine.pubkey ? 'me' : '',
        }, [
          el('td', { className: 'num', text: row.rank || '—' }),
          el('td', { text: row.display || shortKey(row.pubkey) }),
          points && el('td', { className: 'num', text: String(row.points) }),
          el('td', { className: 'num', text: String(row.tops) }),
          el('td', { className: 'num', text: String(row.zones) }),
          el('td', { className: 'num', text: String(row.attempts) }),
        ]))),
      ]),
    ]),
  ]);
}

function participantLiveContext(snapshot) {
  const mine = me();
  const current = store.currentClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const runningNow = competitionRunning(
    snapshot.competition, snapshot.state.status, Math.floor(Date.now() / 1000),
  );
  const cue = personalCue(snapshot.state, mine?.pubkey, runningNow);
  const cueText = ['queued', 'next_round'].includes(cue.kind)
    ? t(`live.cue.${cue.kind}`, { n: cue.ahead }) : t(`live.cue.${cue.kind}`);
  const preparedId = mine ? preparedClimbs.get(`${snapshot.competition.comp_id}:${mine.pubkey}`) : '';
  const prepared = preparedId ? climbLabel(snapshot, preparedId) : t('live.no_next_climb');
  return el('section', { className: 'card participant-live-context', attrs: { 'aria-label': t('participant.live_context') } }, [
    el('dl', { className: 'key-value' }, [
      el('dt', { text: t('live.current') }),
      el('dd', { text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
      mine && el('dt', { text: t('live.before_you') }),
      mine && el('dd', { text: cue.ahead === null ? '—' : String(cue.ahead) }),
      mine && snapshot.competition.rules.climb_source === 'participant_choice'
        && el('dt', { text: t('next.prepared') }),
      mine && snapshot.competition.rules.climb_source === 'participant_choice'
        && el('dd', { text: preparedChoiceTrust === 'ready' ? prepared
          : t(preparedChoiceTrust === 'untrusted' ? 'next.choice_untrusted' : 'next.choice_loading') }),
      el('dt', { text: t('live.next_action') }),
      el('dd', { text: cueText }),
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

function fixedClimbsPanel(snapshot) {
  const competition = snapshot.competition;
  if (competition.rules.climb_source !== 'organizer_set') return null;
  const climbs = competition.climbs || [];
  const gradeScale = storedGradeScale();
  const scaleButtons = el('div', {
    className: 'segmented-control', attrs: { role: 'group', 'aria-label': t('climb.filter.grade_scale') },
  }, [['v', t('climb.filter.grade_scale.v')], ['font', t('climb.filter.grade_scale.font')]]
    .map(([value, label]) => el('button', {
      className: gradeScale === value ? 'active' : '', text: label,
      attrs: { type: 'button', 'aria-pressed': String(gradeScale === value) },
      on: { click: () => { saveGradeScale(value); render(); } },
    })));
  return el('section', { className: 'card' }, [
    el('h2', { text: t('climb.list.title') }),
    el('p', { className: 'small', text: catalogueState === 'loading' ? t('select.catalogue.loading')
      : catalogueState === 'error' ? t('select.catalogue.error') : t('climb.list.hint') }),
    el('div', { className: 'catalogue-toolbar' }, [
      el('span', { className: 'small', text: t('climb.filter.grade_scale') }), scaleButtons,
    ]),
    el('div', { className: 'stack' }, climbs.map((climb) => {
      const details = catalogueDetails.get(String(climb.climb_uuid).toLowerCase()) || {};
      return climbCard({
        climb: { ...details, ...climb }, board: competition.board, t, gradeScale,
      });
    })),
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

function transportNotice(snapshot) {
  const health = syncHealth(snapshot, Math.floor(Date.now() / 1000));
  lastHealthKind = health.kind;
  if (health.kind === 'live') return null;
  const key = health.kind === 'stale' ? 'live.stale'
    : health.kind === 'offline' ? 'live.offline' : 'live.connecting';
  return el('div', { className: 'notice warn', attrs: { role: 'status' } }, [
    el('p', { text: t(key) }),
    health.age !== null && el('p', { className: 'small', text: t('live.last_update', { n: health.age }) }),
  ]);
}

function render() {
  if (!store) { replace(view, openForm()); return; }
  const snapshot = store.snapshot();
  if (!snapshot.state) return;

  const blocked = integrityGuard(snapshot, t);
  if (blocked) {
    replace(view, devRelayBanner(store, t), ...integrityNotices(snapshot, t),
      transportNotice(snapshot), header(snapshot), blocked);
    return;
  }

  const screen = participantScreen(snapshot);
  const available = participantDestinations(snapshot);
  const followedPreviousPhase = !participantDestination || participantDestination === lastParticipantScreen;
  if (!available.has(participantDestination) ||
    (lastParticipantScreen && screen !== lastParticipantScreen && followedPreviousPhase)) {
    participantDestination = screen;
    recordParticipantDestination(participantDestination, { replaceState: true });
  }
  lastParticipantScreen = screen;
  const destination = participantDestination;
  const primary = destination === 'registration'
    ? [participantDestinationIntro(destination), registrationPanel(snapshot)]
    : destination === 'checkin'
      ? [participantDestinationIntro(destination), checkinPanel(snapshot)]
      : destination === 'live'
        ? [participantDestinationIntro(destination), livePanel(snapshot), prizePanel(snapshot)]
        : destination === 'chooser'
          ? [participantDestinationIntro(destination), participantLiveContext(snapshot), nextClimbChooser(snapshot, me())]
          : [participantDestinationIntro(destination), participantLiveContext(snapshot),
            el('aside', { className: 'subcard scoring-explanation' }, [
              el('h3', { text: t('scoring.info.title') }),
              el('p', { text: scoringExplanation(t, snapshot.competition) }),
            ]), leaderboard(snapshot)];
  const secondary = screen === 'live' && destination !== 'registration'
    ? el('details', { className: 'disclosure participant-past-phase' }, [
      el('summary', { text: t('participant.registration.details') }),
      registrationPanel(snapshot),
    ])
    : fixedClimbsPanel(snapshot);
  replace(view,
    devRelayBanner(store, t),
    ...integrityNotices(snapshot, t),
    transportNotice(snapshot),
    el('div', { className: 'participant-screen', attrs: {
      'data-screen': screen, 'data-destination': destination,
    } }, [
      header(snapshot),
      phaseNavigation(screen, snapshot),
      participantDestinationNavigation(snapshot, destination),
      ...primary,
      announcements(snapshot),
      secondary,
      rejections(snapshot),
    ]),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.share') }),
      el('p', { className: 'mono selectable', text: joinLink(ref.naddr) }),
    ]));

  // Announce a turn change once, not on every re-render.
  const mine = me();
  const turnAnnouncement = `${snapshot.state.round}:${snapshot.state.turn_opened_at}:${mine?.pubkey || ''}`;
  if (mine && store.currentClimber() === mine.pubkey && lastTurnAnnouncement !== turnAnnouncement) {
    lastTurnAnnouncement = turnAnnouncement;
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
  const savedDestination = history.state?.[PARTICIPANT_HISTORY_KEY];
  participantDestination = savedDestination?.address === store.address
    && PARTICIPANT_DESTINATIONS.has(savedDestination.destination)
    ? savedDestination.destination : '';
  lastParticipantScreen = '';
  store.onChange(render);
  if (signer) {
    entrant = new EntrantWriter({
      pool, signer, competition: store.competition, organizerPubkey: store.organizerPubkey,
    });
  }
  preparedChoiceTrust = signer && store.competition.rules.climb_source === 'participant_choice'
    ? 'loading' : 'ready';
  render();
  void restorePreparedChoice();
  void hydrateCatalogue(store.competition);

  // The turn countdown is the one thing that has to move without an event.
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const snapshot = store?.snapshot();
    if (snapshot?.state && participantScreen(snapshot) !== lastParticipantScreen) {
      render();
      return;
    }
    const node = byId('deadline');
    if (node && store) node.textContent = formatSeconds(store.secondsToDeadline());
    const health = snapshot ? syncHealth(snapshot, Math.floor(Date.now() / 1000)) : null;
    if (health && health.kind !== lastHealthKind) render();
  }, 1000);
}

window.addEventListener('hashchange', start);
await signIn.restore();
await start();
