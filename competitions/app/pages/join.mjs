/**
 * The participant screen — the iOS and non-app route into a competition.
 *
 * It answers, in this order and without being asked twice: what is happening
 * right now, what do I have to do, and where do I stand. Everything else is
 * below the fold.
 */
import {
  bootstrap, byId, devRelayBanner, el, integrityNotices, joinLink,
  openCompetition, openCompetitionForm, parseCompetitionRef, replace, resolveRelays,
} from './common.mjs?v=20260813-10';
import { SignIn } from '../ui/shell.mjs?v=20260813-9';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { freeClimbs, outstandingCount } from '../protocol/claims.mjs';
import { decodeInvoice, secondsLeft, walletUri } from '../protocol/bolt11.mjs';
import {
  resolvePayEndpoint, validatePayResponse, invoiceUrl, validateInvoiceResponse,
} from '../protocol/lnurl.mjs';
import { buildZapRequest } from '../protocol/zap.mjs';
import { buildClaimBody, validateClaimInput, eligibleWinner } from '../protocol/prize.mjs';
import {
  checkinWindowOpen, competitionAddress, registrationWindowOpen,
} from '../protocol/competition.mjs';
import { EntrantWriter } from '../authority.mjs';
import {
  announce, displayName, formatDateTime, formatSats, formatSeconds, shortKey,
} from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs?v=20260813-13';
import { scoringExplanation, usesPointLeaderboard } from '../ui/scoring-copy.mjs';
import { loadCatalogueClimbs } from '../data/climb-catalogue.mjs';
import { BOARD_TYPES, catalogueProductSizeId } from '../protocol/board-catalog.mjs';
import {
  climbCard, filterCatalogue, gradeFilterOptions, saveGradeScale, storedGradeScale,
} from '../ui/climb-card.mjs?v=20260813-2';

const { t, language } = bootstrap();

let store = null;
let pool = null;
let entrant = null;
let signer = null;
let ref = null;
let lastTurnAnnouncement = null;
let ticker = null;
let catalogueDetails = new Map();
let catalogueState = 'idle';
let catalogueError = '';
let catalogueCompetition = '';

function catalogueBoard(competition) {
  const board = competition.board;
  const model = BOARD_TYPES.flatMap((type) => type.models)
    .find((candidate) => candidate.value === board.model && candidate.layoutId === board.layout_id);
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
    const { climbs } = await loadCatalogueClimbs(board);
    if (catalogueCompetition !== token) return;
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

function catalogueFilters(onChange) {
  let gradeScale = storedGradeScale();
  const search = el('input', { attrs: { type: 'search', placeholder: t('climb.browser.search.placeholder') } });
  const minGrade = el('select');
  const maxGrade = el('select');
  const sends = el('input', { attrs: { type: 'number', min: '0', value: '0' } });
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
  return signer?.kind === 'nip07'
    || (signer?.kind === 'local' && signIn.session.hasStoredKey())
    || (signer?.kind === 'nip46' && signIn.remoteSession.hasStoredConnection());
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
  },
});

// ── opening a competition ──

const openForm = () => openCompetitionForm(t, start);

// ── rendering ──

function me() {
  return signer ? store?.participant(signer.pubkey) : null;
}

function header(snapshot) {
  const competition = snapshot.competition;
  const board = competition.board || {};
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
    // Not only `pending`. A payment the organizer recorded as failed or
    // expired is precisely the state somebody has to be able to leave, and
    // showing the badge without the control strands them.
    if (competition.fee_msat > 0 && PAYABLE_STATES.has(mine.payment)) {
      rows.push(paymentPanel(snapshot, mine));
    }
    if (competition.rules.climb_source === 'participant_choice') {
      rows.push(...claimStatus(snapshot, mine));
    }
    // Ask to be checked in, rather than only waiting to be. The organizer
    // still decides; this is how somebody at the back of a queue says they
    // are here.
    if (mine.registration === 'accepted' && mine.checkin === 'none'
      && checkinWindowOpen(competition, snapshot.state.status, now)) {
      rows.push(el('button', {
        className: 'primary',
        text: t('action.checkin'),
        on: { click: () => guard(() => entrant.requestCheckIn()) },
      }));
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
                selections: mine.selections,
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

  if (!registrationWindowOpen(competition, snapshot.state.status, now)) {
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

  // ── climb selection, when the organizer configured it ──
  const selection = new Set();
  if (competition.rules.climb_source === 'participant_choice') {
    const options = competition.climb_pool?.options || [];
    const needed = competition.rules.climb_count;
    const unique = competition.rules.selection_uniqueness === 'unique_per_competition';
    for (const id of Array.isArray(savedDraft?.selections) ? savedDraft.selections : []) {
      if (selection.size >= needed) break;
      const option = options.find((candidate) => candidate.id === id);
      if (!option || (unique && snapshot.state.claims[option.id])) continue;
      selection.add(option.id);
    }
    if (catalogueState !== 'ready') selection.clear();
    const counter = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
    const updateCounter = () => {
      counter.textContent = t('select.count', { chosen: selection.size, needed });
    };

    if (catalogueState !== 'ready') {
      rows.push(
        el('h3', { text: t('select.title') }),
        el('div', { className: `notice ${catalogueState === 'error' ? 'bad' : ''}`, attrs: { role: 'status' } }, [
          el('p', { text: catalogueState === 'loading' ? t('select.catalogue.loading') : catalogueError || t('select.catalogue.loading') }),
          catalogueState === 'error' ? el('button', {
            text: t('select.catalogue.retry'), on: { click: () => hydrateCatalogue(competition) },
          }) : null,
        ]),
      );
    } else rows.push(
      el('h3', { text: t('select.title') }),
      el('p', { className: 'small', text: t('select.hint', { needed }) }),
      unique ? el('p', { className: 'small', text: t('select.unique_hint') }) : null,
      counter,
      (() => {
        const results = el('div', { className: 'stack' });
        let renderOptions = () => {};
        const filters = catalogueFilters(() => renderOptions());
        renderOptions = () => replace(results, ...filterCatalogue(options.map((option) => ({
          option, described: { ...(catalogueDetails.get(String(option.climb_uuid).toLowerCase()) || {}), ...option },
        })), filters.values()).map(({ option }) => {
        // Live: a climb somebody else already holds is shown as taken, and the
        // control is absent rather than present-and-doomed.
        const takenBy = unique ? snapshot.state.claims[option.id] : undefined;
        const taken = Boolean(takenBy);
        const resolved = catalogueDetails.has(String(option.climb_uuid).toLowerCase());
        const limitReached = selection.size >= needed && !selection.has(option.id);
        const box = el('input', {
          attrs: {
            type: 'checkbox', id: `sel-${option.id}`, disabled: taken || !resolved || limitReached,
            checked: selection.has(option.id),
          },
          on: {
            change: (event) => {
              if (event.target.checked) {
                if (selection.size >= needed) { event.target.checked = false; return; }
                selection.add(option.id);
              } else {
                selection.delete(option.id);
              }
              updateCounter();
              renderOptions();
              updateReady();
              saveRegistrationDraft(competition, {
                display: display.value.trim(), division: division.value, selections: [...selection],
              });
            },
          },
        });
        const details = catalogueDetails.get(String(option.climb_uuid).toLowerCase()) || option;
        const action = taken ? null : el('label', { className: 'climb-card-select', attrs: { for: `sel-${option.id}` } }, [
          box, el('span', { text: selection.has(option.id) ? t('climb.browser.added') : t('climb.browser.choose') }),
        ]);
        return climbCard({ climb: { ...details, ...option }, board: competition.board, t,
          selected: selection.has(option.id), taken, action, gradeScale: filters.gradeScale() });
        }));
        renderOptions();
        return el('div', {}, [filters.node, results]);
      })(),
    );
    updateCounter();
  }
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
        if (competition.rules.climb_source === 'participant_choice'
          && selection.size !== competition.rules.climb_count) {
          throw new Error(t('select.incomplete', { needed: competition.rules.climb_count }));
        }
        await entrant.register({
          division: competition.divisions.length > 1 ? division.value : competition.divisions[0].id,
          display: display.value.trim(),
          waiverAccepted: !competition.waiver_required || waiver.checked,
          selections: [...selection].sort(),
        });
        clearRegistrationDraft(competition);
        feedback.textContent = t('reg.sent');
        announce(t('reg.sent'));
      }, feedback),
    },
  });
  const updateReady = () => {
    const missingName = !display.value.trim();
    const missingClimbs = competition.rules.climb_source === 'participant_choice'
      && (catalogueState !== 'ready' || selection.size !== competition.rules.climb_count);
    const missingWaiver = competition.waiver_required && !waiver.checked;
    registerButton.disabled = missingName || missingClimbs || missingWaiver;
    readiness.textContent = missingName ? t('reg.ready.name')
      : catalogueState !== 'ready' && competition.rules.climb_source === 'participant_choice'
        ? t('reg.ready.catalogue')
        : missingClimbs ? t('reg.ready.climbs', { count: competition.rules.climb_count - selection.size })
        : missingWaiver ? t('reg.ready.waiver') : t('reg.ready.complete');
  };
  const saveDraft = () => saveRegistrationDraft(competition, {
    display: display.value.trim(), division: division.value, selections: [...selection],
  });
  display.addEventListener('input', () => { updateReady(); saveDraft(); });
  division.addEventListener('change', saveDraft);
  waiver.addEventListener('change', updateReady);
  for (const control of rows.flatMap((row) => row?.querySelectorAll?.('input') || [])) {
    if (String(control.id || '').startsWith('sel-')) control.addEventListener('change', updateReady);
  }
  updateReady();
  rows.push(readiness, feedback, registerButton);
  return el('section', { className: 'card raised' }, rows);
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

function claimStatus(snapshot, mine) {
  const competition = snapshot.competition;
  const options = competition.climb_pool?.options || [];
  const needed = competition.rules.climb_count;
  const granted = mine.selections;
  const rows = [el('h3', { text: t('select.your_climbs') })];

  if (granted.length) {
    rows.push(el('ul', { className: 'plain' }, granted.map((id) => el('li', {
      text: options.find((o) => o.id === id)?.label || id,
    }))));
  }

  if (granted.length >= needed) {
    rows.push(el('p', { className: 'small', text: t('select.complete') }));
    return rows;
  }

  const free = freeClimbs(competition, snapshot.state);
  if (!registrationWindowOpen(competition, snapshot.state.status, Math.floor(Date.now() / 1000))) {
    rows.push(el('p', { className: 'small', text: t('select.pending') }));
    return rows;
  }
  if (free.length === 0) {
    rows.push(el('p', { className: 'small', text: t('select.none_left') }));
    return rows;
  }

  // Losing a race is recoverable: re-registering replaces the earlier request,
  // because an intent reuses its nonce.
  const repick = new Set(granted);
  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const readiness = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const results = el('div', { className: 'stack' });
  const repickButton = el('button', { text: t('select.repick') });
  let renderRepick = () => {};
  const filters = catalogueFilters(() => renderRepick());
  renderRepick = () => {
    const outstanding = needed - repick.size;
    repickButton.disabled = catalogueState !== 'ready' || outstanding !== 0;
    readiness.textContent = catalogueState !== 'ready' ? t('reg.ready.catalogue')
      : outstanding > 0 ? t('select.repick.remaining', { count: outstanding }) : t('select.repick.ready');
    replace(results, ...filterCatalogue(free.map((option) => ({
      option, described: { ...(catalogueDetails.get(String(option.climb_uuid).toLowerCase()) || {}), ...option },
    })), filters.values()).map(({ option, described }) => {
      const resolved = catalogueDetails.has(String(option.climb_uuid).toLowerCase());
      const checked = repick.has(option.id);
      const box = el('input', {
        attrs: {
          type: 'checkbox', id: `repick-${option.id}`, checked,
          disabled: catalogueState !== 'ready' || !resolved || (!checked && repick.size >= needed),
        },
        on: { change: (event) => { if (event.target.checked) repick.add(option.id); else repick.delete(option.id); renderRepick(); } },
      });
      return climbCard({
        climb: described, board: competition.board, t, selected: checked,
        gradeScale: filters.gradeScale(),
        action: el('label', { className: 'climb-card-select', attrs: { for: box.id } }, [box, el('span', { text: checked ? t('climb.browser.added') : t('climb.browser.choose') })]),
      });
    }));
  };
  repickButton.addEventListener('click', () => guard(async () => {
    if (catalogueState !== 'ready' || repick.size !== needed) throw new Error(t('select.incomplete', { needed }));
    await entrant.register({
      division: mine.division || competition.divisions[0].id, display: mine.display,
      waiverAccepted: true, selections: [...repick].sort(),
    });
    feedback.textContent = t('select.repick_sent');
  }, feedback));
  rows.push(
    el('p', { className: 'small', text: t('select.lost', { needed: outstandingCount(competition, mine) }) }),
    filters.node,
    results,
    readiness,
    feedback,
    repickButton,
  );
  renderRepick();
  return rows;
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

    if (snapshot.competition.rules.progression === 'asynchronous_turns') {
      rows.push(...nextClimbChooser(snapshot, mine));
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

/**
 * Asynchronous turns: which of my climbs I go to next.
 *
 * The control exists only while this climber may actually act. Every reason
 * they cannot — not their turn, resting, unpaid, no attempts left — gets its
 * own sentence instead, because a disabled button teaches nobody anything, and
 * a button that publishes a report the reducer then rejects is worse still:
 * they would walk away believing the attempt counted.
 */
function nextClimbChooser(snapshot, mine) {
  const rows = [el('h3', { text: t('next.title') })];
  const remaining = store.remainingClimbs(mine.pubkey);

  if (!remaining.length) {
    rows.push(el('p', { className: 'small', text: t('next.none_left') }));
    return rows;
  }
  if (!store.mayAct(mine.pubkey)) {
    rows.push(el('p', { className: 'small', text: whyNotYet(snapshot, mine) }));
    return rows;
  }

  const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const chosen = el('select', { attrs: { id: 'next-climb' } },
    remaining.map((climb) => el('option', {
      attrs: { value: climb.id },
      text: t('next.option', { label: climb.label, attempts: climb.attemptsLeft }),
    })));

  rows.push(
    el('label', { attrs: { for: 'next-climb' } }, [el('span', { text: t('next.choose') }), chosen]),
    el('div', { className: 'row' }, ['top', 'zone', 'fall'].map((outcome) => el('button', {
      className: outcome === 'top' ? 'primary' : '',
      text: t(`org.${outcome}`),
      on: {
        click: () => guard(async () => {
          const climb = remaining.find((c) => c.id === chosen.value);
          if (!climb) throw new Error(t('next.gone'));
          const used = snapshot.competition.rules.attempts_per_climb - climb.attemptsLeft;
          await entrant.reportAttempt(climb.id, outcome, used + 1);
          feedback.textContent = t('next.reported', { label: climb.label });
          announce(t('next.reported', { label: climb.label }));
        }, feedback),
      },
    }))),
    el('p', { className: 'small', text: t('next.reported.hint') }),
    feedback,
  );
  return rows;
}

/** The one sentence that says why the chooser is not there. */
function whyNotYet(snapshot, mine) {
  const state = snapshot.state;
  if (state.paused) return t('next.paused');
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
  if (!snapshot.standings.length) return null;
  const mine = me();
  const points = usesPointLeaderboard(snapshot.competition);
  return el('section', { className: 'card' }, [
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

function render() {
  if (!store) { replace(view, openForm()); return; }
  const snapshot = store.snapshot();
  if (!snapshot.state) return;

  replace(view,
    devRelayBanner(store, t),
    ...integrityNotices(snapshot, t),
    header(snapshot),
    fixedClimbsPanel(snapshot),
    registrationPanel(snapshot),
    livePanel(snapshot),
    prizePanel(snapshot),
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
  hydrateCatalogue(store.competition);

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
