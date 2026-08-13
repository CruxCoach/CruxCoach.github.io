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
} from './common.mjs?v=20260813-10';
import { SignIn } from '../ui/shell.mjs?v=20260813-9';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { AuthorityWriter, publishCompetition } from '../authority.mjs';
import {
  NAMESPACE, newCompId, parseCompetitionEvent, parseIntentEvent, parseLogEvent,
  checkinWindowOpen, registrationWindowOpen, validateCompetitionConfig,
} from '../protocol/competition.mjs';
import { reduce } from '../protocol/reduce.mjs';
import { outstandingClaims, registrationOrder } from '../protocol/claims.mjs';
import { verifyZapReceipt, receiptFilter, ZAP_RECEIPT_KIND } from '../protocol/zap.mjs';
import { verifyClaim, eligibleWinner, claimDeadline } from '../protocol/prize.mjs';
import { walletUri } from '../protocol/bolt11.mjs';
import { resolvePayEndpoint, validatePayResponse } from '../protocol/lnurl.mjs';
import { competitionAddress } from '../protocol/competition.mjs';
import { verifyEvent } from '../protocol/nostr-event.mjs';
import { createCompetitionForm } from './organizer-form.mjs?v=20260813-14';
import { naddrEncode } from '../protocol/nostr-event.mjs';
import { KIND, compDTag } from '../protocol/competition.mjs';
import { announce, displayName, formatDateTime, shortKey } from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs?v=20260813-13';
import { scoringExplanation } from '../ui/scoring-copy.mjs';

const { t, language } = bootstrap();

let signer = null;
let store = null;
let pool = null;
let writer = null;
let ref = null;
const intents = new Map();

/**
 * Zap receipts, indexed by who paid.
 *
 * Kept out of the reduced state on purpose: a receipt is evidence the organizer
 * weighs, not a fact about the competition. What goes in the log is the
 * organizer's decision after weighing it.
 */
const receipts = new Map();

/**
 * prize_id -> a decrypted, checked claim.
 *
 * Decrypted once when the intent arrives and kept in memory only. Nothing here
 * is written anywhere: a payout destination that reached storage would outlive
 * the reason it was ever shared.
 */
const prizeClaims = new Map();
const DRAFT_PREFIX = 'cruxcoach:competitions:create-draft:v1:';
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WIZARD_HISTORY_KEY = 'cruxcoachCompetitionWizard';
let activeCreateForm = null;

function historyWizardStep() {
  const value = history.state?.[WIZARD_HISTORY_KEY];
  return value?.path === location.pathname && Number.isInteger(value.step) ? value.step : null;
}

function recordWizardStep(step, { replaceState = false } = {}) {
  history[replaceState ? 'replaceState' : 'pushState']({
    ...(history.state || {}),
    [WIZARD_HISTORY_KEY]: { path: location.pathname, step },
  }, '');
}

window.addEventListener('popstate', (event) => {
  const value = event.state?.[WIZARD_HISTORY_KEY];
  if (!activeCreateForm || value?.path !== location.pathname || !Number.isInteger(value.step)) return;
  activeCreateForm.showStep(value.step, { recordHistory: false });
});

function draftKey(pubkey) { return `${DRAFT_PREFIX}${pubkey}`; }

function readLocalDraft(pubkey) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(pubkey)) || 'null');
    if (!saved || saved.version !== 1 || Date.now() - saved.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(draftKey(pubkey));
      return null;
    }
    return saved.draft;
  } catch { return null; }
}

function saveLocalDraft(pubkey, draft) {
  try {
    localStorage.setItem(draftKey(pubkey), JSON.stringify({ version: 1, savedAt: Date.now(), draft }));
  } catch { /* private mode or a full storage quota: the form still works */ }
}

function clearLocalDraft(pubkey) {
  try { localStorage.removeItem(draftKey(pubkey)); } catch { /* private mode */ }
}

/**
 * This competition's payment endpoint, resolved once.
 *
 * `nostrPubkey` is the only key a receipt may be signed by. Taking it from the
 * endpoint the ORGANIZER published — rather than from the receipt itself —
 * is the whole reason verification means anything.
 */
let lnurl = { resolved: false, nostrPubkey: null, error: null };

function receiptFor(pubkey) {
  return receipts.get(pubkey) || null;
}

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
  onChange: (next) => {
    signer = next;
    writer = null;
    owned = { loading: false, loaded: false, listings: [] };
    // A shared organizer link is normally opened before sign-in. Re-open it
    // after the profile gate completes so the authority writer and intent
    // subscription are actually attached to the newly available signer.
    if (signer && store) void start();
    else if (signer) void loadOwned();
    else render();
  },
});

// ── create ──

/** The full create form lives in its own module; this only publishes it. */
function createForm() {
  const ownerPubkey = signer.pubkey;
  // A person who chose a session-only identity also chose not to leave data on
  // this device. Respect that choice for the form, not only for their key.
  const canPersistDraft = signer.kind === 'nip07'
    || (signer.kind === 'local' && signIn.session.hasStoredKey())
    || (signer.kind === 'nip46' && signIn.remoteSession.hasStoredConnection());
  let saveTimer = null;
  const rememberedStep = historyWizardStep();
  const form = createCompetitionForm({
    t,
    pool: profilePool,
    signerPubkey: signer.pubkey,
    defaultDisplayName: signIn.displayName,
    defaultLud16: signIn.profile?.fields?.lud16 || '',
    relays: resolveRelays([]).slice(0, 8),
    initialDraft: canPersistDraft ? readLocalDraft(ownerPubkey) : null,
    persistDraft: canPersistDraft,
    initialStep: rememberedStep,
    onStepChange: (step) => recordWizardStep(step),
    onStepBack: () => history.back(),
    onDraftDiscard: () => {
      clearTimeout(saveTimer);
      clearLocalDraft(ownerPubkey);
      location.reload();
    },
    onDraftChange: (draft) => {
      if (!canPersistDraft) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveLocalDraft(ownerPubkey, draft), 180);
    },
  });
  activeCreateForm = form;
  if (rememberedStep === null) {
    // A restored draft may reopen several screens in. Seed its earlier screens
    // so Browser Back still means "previous wizard screen", not "leave".
    recordWizardStep(0, { replaceState: true });
    for (let step = 1; step <= form.currentStep; step += 1) recordWizardStep(step);
  }
  const errors = el('div', { attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const publishButton = el('button', {
      className: 'primary',
      text: t('org.create_draft'),
      on: {
        click: async () => {
          replace(errors);
          let config;
          try {
            config = form.build();
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
          publishButton.disabled = true;
          publishButton.textContent = t('org.create_draft_working');
          let relayPool = null;
          try {
            relayPool = new RelayPool(config.relays);
            const published = await publishCompetition(relayPool, signer, config);
            announce(t('publish.ok', published));
            const naddr = naddrEncode({
              identifier: compDTag(config.comp_id), pubkey: signer.pubkey, kind: KIND,
            });
            clearTimeout(saveTimer);
            if (canPersistDraft) clearLocalDraft(ownerPubkey);
            location.hash = naddr;
            await start();
          } catch (err) {
            replace(errors, el('div', { className: 'notice bad' }, [
              el('p', { text: err.message || t('publish.none') }),
            ]));
          } finally {
            relayPool?.close();
            publishButton.disabled = false;
            publishButton.textContent = t('org.create_draft');
          }
        },
      },
    });
  form.reviewActions.append(errors, publishButton);

  return el('div', {}, [
    overviewSection(),
    form.node,
  ]);
}

// ── overview of competitions this organizer authored ──

let owned = { loading: false, loaded: false, listings: [] };

function overviewSection() {
  const rows = owned.listings.map((listing) => {
    const naddr = naddrEncode({
      identifier: compDTag(listing.competition.comp_id),
      pubkey: signer.pubkey,
      kind: KIND,
    });
    const venue = listing.competition.venue?.name || '';
    return el('li', {}, [
      el('div', { className: 'row between' }, [
        el('div', {}, [
          el('strong', { text: listing.competition.title }),
          el('div', { className: 'small' }, [
            el('span', { text: t(`status.${listing.state?.status || listing.competition.status}`) }),
            el('span', { text: ' · ' }),
            el('span', {
              text: formatDateTime(listing.competition.starts_at, language, listing.competition.timezone),
            }),
            venue ? el('span', { text: ` · ${venue}` }) : null,
          ]),
          el('div', {
            className: 'small',
            text: t('org.overview.counts', {
              accepted: listing.accepted,
              capacity: listing.competition.capacity || '∞',
              checkedIn: listing.checkedIn,
            }),
          }),
        ]),
        el('div', { className: 'row' }, [
          // One obvious next action, plus the few that are genuinely useful.
          el('button', {
            className: 'primary',
            text: t(`org.overview.next.${nextActionFor(listing)}`),
            on: { click: () => { location.hash = naddr; start(); } },
          }),
          el('a', {
            className: 'button',
            text: t('org.projector'),
            attrs: { href: `live.html#${naddr}`, target: '_blank', rel: 'noopener' },
          }),
          el('button', {
            text: t('action.copy_link'),
            on: {
              click: async (event) => {
                await navigator.clipboard.writeText(joinLink(naddr));
                event.target.textContent = t('action.copied');
              },
            },
          }),
        ]),
      ]),
    ]);
  });

  return el('section', { className: 'card' }, [
    el('div', { className: 'row between' }, [
      el('h2', { text: t('org.mine') }),
      el('button', { text: t('comp.refresh'), on: { click: () => loadOwned(true) } }),
    ]),
    owned.loading && !owned.loaded
      ? el('p', { text: t('comp.loading') })
      : rows.length
        ? el('ul', { className: 'plain' }, rows)
        : el('p', { text: owned.loaded ? t('org.none') : t('error.offline') }),
  ]);
}

/** The single most useful thing to do with a competition in this state. */
function nextActionFor(listing) {
  const status = listing.state?.status || listing.competition.status;
  if (status === 'draft') return 'resume';
  if (status === 'finished' || status === 'cancelled') return 'results';
  return 'open';
}

/**
 * Load the competitions this key authored.
 *
 * Queried by author + namespace rather than by hashtag, so unlisted and draft
 * competitions appear too — they are the organizer's own, and a console that
 * hid their drafts would be useless.
 */
async function loadOwned(force = false) {
  if (!signer || (owned.loaded && !force)) { render(); return; }
  owned = { ...owned, loading: true };
  render();
  const now = Math.floor(Date.now() / 1000);
  const { events, complete } = await profilePool.query([{
    kinds: [KIND],
    authors: [signer.pubkey],
    '#L': [NAMESPACE],
    limit: 200,
  }], { timeoutMs: 8000 });

  const newest = new Map();
  for (const event of events) {
    if (!(await verifyEvent(event).catch(() => false))) continue;
    const parsed = parseCompetitionEvent(event, now);
    if (!parsed.ok) continue;
    const existing = newest.get(parsed.competition.comp_id);
    if (!existing || event.created_at > existing.createdAt) {
      newest.set(parsed.competition.comp_id, { competition: parsed.competition, createdAt: event.created_at });
    }
  }

  // Enrollment counts come from each competition's log, which is what the
  // organizer actually wants to see at a glance.
  const listings = [];
  for (const entry of newest.values()) {
    const summary = await summarise(entry.competition);
    listings.push({ competition: entry.competition, ...summary });
  }
  listings.sort((a, b) => b.competition.starts_at - a.competition.starts_at);
  owned = { loading: false, loaded: complete, listings };
  render();
}

async function summarise(competition) {
  const address = `${KIND}:${signer.pubkey}:${compDTag(competition.comp_id)}`;
  const { events } = await profilePool.query([{
    kinds: [KIND], authors: [competition.authority], '#a': [address], limit: 500,
  }], { timeoutMs: 6000 });
  const now = Math.floor(Date.now() / 1000);
  const entries = [];
  for (const event of events) {
    if (!(await verifyEvent(event).catch(() => false))) continue;
    const parsed = parseLogEvent(event, competition, signer.pubkey, now);
    if (parsed.ok) entries.push(parsed);
  }
  const { state } = reduce({
    competition,
    competitionEventId: '',
    entries,
  });
  // Without the definition's event id the chain cannot link, which is fine
  // here: the overview only needs counts, and it says so by not claiming a
  // status the log would have changed.
  const accepted = state.participants.filter((p) => p.registration === 'accepted').length;
  const checkedIn = state.participants.filter((p) => p.checkin === 'checked_in').length;
  return { accepted, checkedIn, state: null };
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

/** Everything the claim rule needs, read out of this console's own state. */
function claimInputs(snapshot) {
  const requests = new Map();
  for (const [, intent] of intents) {
    if (intent.intent.op !== 'register') continue;
    if (Array.isArray(intent.intent.data.selections)) {
      requests.set(intent.pubkey, intent.intent.data.selections);
    }
  }
  const entries = store.logEntries();
  const answered = new Set(entries
    .filter((entry) => entry.op === 'claim_decision')
    .map((entry) => `${entry.data.pubkey}:${entry.data.climb_id}`));
  return {
    competition: snapshot.competition,
    state: snapshot.state,
    requests,
    answered,
    order: registrationOrder(entries),
  };
}

let settling = false;

/**
 * Publish those decisions.
 *
 * Runs automatically: the organizer chose participant selection, and the
 * resolution rule is fixed, so making them click "grant" once per climb per
 * entrant would only add the delay in which the race is unresolved. One pass
 * at a time, and re-entered by the store's own change notification once the
 * grants land, so a batch settles in log order rather than all at seq n+1.
 */
/**
 * Decrypt and check one prize claim.
 *
 * The check happens before the destination is ever put on screen, so an
 * organizer looking at somebody's Lightning address has already been told
 * whether the standings agree that this is the person who won.
 *
 * A claim that will not decrypt is an ordinary event: anybody can address a
 * ciphertext to an organizer, and the console must not break because somebody
 * sent it nonsense.
 */
async function readPrizeClaim(parsedIntent) {
  const competition = store?.competition;
  if (!competition || !signer?.decrypt) return;
  const prizeId = parsedIntent.intent.data?.prize_id;
  const ciphertext = parsedIntent.intent.data?.enc;
  if (!prizeId || typeof ciphertext !== 'string') return;

  let plaintext;
  try {
    plaintext = await signer.decrypt(parsedIntent.pubkey, ciphertext);
  } catch {
    prizeClaims.set(prizeId, { error: 'unreadable', pubkey: parsedIntent.pubkey });
    render();
    return;
  }

  const snapshot = store.snapshot();
  const result = verifyClaim(plaintext, {
    compId: competition.comp_id,
    claimantPubkey: parsedIntent.pubkey,
    resultsHash: snapshot.stateHash,
    standings: snapshot.standings,
    prizes: competition.prizes || [],
    prizeStates: snapshot.state?.prizes || {},
    nowSeconds: Math.floor(Date.now() / 1000),
    deadline: claimDeadline(snapshot.state?.results_at || 0, competition.prize_claim_days),
  });
  prizeClaims.set(prizeId, result.ok
    ? { claim: result.claim, prize: result.prize, pubkey: parsedIntent.pubkey }
    : { error: result.error, pubkey: parsedIntent.pubkey });
  render();
}

async function settleClaims() {
  if (settling || !writer || !store?.state) return;
  const owed = outstandingClaims(claimInputs(store.snapshot()));
  if (!owed.length) return;
  settling = true;
  try {
    for (const claim of owed) {
      // Sequential on purpose: each entry chains to the previous head.
      // eslint-disable-next-line no-await-in-loop
      await writer.decideClaim(claim.pubkey, claim.climbId, claim.decision, claim.reason);
    }
  } catch (err) {
    replace(feedback, el('div', { className: 'notice bad' }, [
      el('p', { text: err.message || t('error.generic') }),
    ]));
  } finally {
    settling = false;
  }
}

/** Which pool climbs an entrant asked for, as labels. */
function selectionLabels(snapshot, ids) {
  const options = [
    ...(snapshot.competition.climb_pool?.options || []),
    ...(snapshot.competition.climbs || []),
  ];
  return ids.map((id) => options.find((o) => o.id === id)?.label || id);
}

function entrantsPanel(snapshot) {
  const rows = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [, intent] of intents) {
    if (intent.intent.op !== 'register') continue;
    // A rejected or withdrawn entrant may ask again while registration is
    // open. Presence in state therefore does not mean this newest request was
    // answered; compare it with the authority log instead.
    if (requestAnswered(intent)) continue;
    const requested = Array.isArray(intent.intent.data.selections) ? intent.intent.data.selections : [];
    const rejectReason = el('input', {
      attrs: { type: 'text', maxlength: '240', placeholder: t('org.reason') },
    });
    rows.push(el('li', {}, [
      el('div', { className: 'row between' }, [
        el('span', {}, [
          el('span', { text: intent.intent.data.display || shortKey(intent.pubkey) }),
          requested.length ? el('span', {
            className: 'hint',
            text: t('org.requested_climbs', { climbs: selectionLabels(snapshot, requested).join(', ') }),
          }) : null,
        ]),
        el('span', { className: 'row' }, [
          el('button', {
            className: 'primary',
            text: t('org.accept'),
            on: {
              click: () => act(() => writer.decideRegistration(intent.pubkey, 'accepted', {
                division: intent.intent.data.division,
                display: intent.intent.data.display,
                intentId: intent.eventId,
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
                intentId: intent.eventId,
              })),
            },
          }),
          el('button', {
            className: 'danger',
            text: t('org.reject'),
            on: {
              click: () => act(() => writer.decideRegistration(intent.pubkey, 'rejected', {
                division: intent.intent.data.division,
                display: intent.intent.data.display,
                reason: rejectReason.value.trim() || undefined,
                intentId: intent.eventId,
              })),
            },
          }),
        ]),
      ]),
      rejectReason,
    ]));
  }

  const participants = snapshot.state.participants.map((p) => {
    const controls = [];
    if (p.registration === 'waitlisted'
      && registrationWindowOpen(snapshot.competition, snapshot.state.status, now)) {
      controls.push(el('button', {
        className: 'primary', text: t('org.promote'),
        on: { click: () => act(() => writer.decideRegistration(p.pubkey, 'accepted', {
          division: p.division, display: p.display,
        })) },
      }));
    }
    if (p.registration === 'accepted' && p.checkin === 'none'
      && checkinWindowOpen(snapshot.competition, snapshot.state.status, now)) {
      controls.push(
        el('button', { text: t('action.checkin'), on: { click: () => act(() => writer.checkIn(p.pubkey)) } }),
        el('button', { text: t('org.no_show'), on: { click: () => act(() => writer.checkIn(p.pubkey, 'no_show')) } }),
      );
    }
    if (snapshot.competition.fee_msat > 0 && p.payment === 'pending') {
      controls.push(paymentControls(snapshot, p));
    }
    const disqualifyReason = el('input', {
      attrs: { type: 'text', maxlength: '240', placeholder: t('org.reason') },
    });
    const mayDisqualify = p.result === 'active'
      && ['running', 'paused'].includes(snapshot.state.status)
      && p.registration === 'accepted';

    return el('li', {}, [
      el('div', { className: 'row between' }, [
        el('span', {}, [
          el('span', { text: displayName(p) }),
          el('span', { className: 'badge', text: t(`reg.${p.registration}`) }),
          el('span', { className: 'badge', text: t(`checkin.${p.checkin}`) }),
          snapshot.competition.fee_msat > 0
            && el('span', { className: p.payment === 'settled' ? 'badge ok' : 'badge warn', text: t(`pay.${p.payment}`) }),
          p.selections.length ? el('span', {
            className: 'hint',
            text: t('org.granted_climbs', { climbs: selectionLabels(snapshot, p.selections).join(', ') }),
          }) : null,
        ]),
        el('span', { className: 'row' }, controls),
      ]),
      mayDisqualify ? el('details', { className: 'disclosure' }, [
        el('summary', { text: t('org.disqualify') }),
        disqualifyReason,
        el('button', {
          className: 'danger', text: t('org.disqualify'),
          on: {
            click: () => {
              if (!disqualifyReason.value.trim()) {
                announce(t('org.reason.required'), { assertive: true });
                return;
              }
              void act(() => writer.disqualify(p.pubkey, disqualifyReason.value.trim()));
            },
          },
        }),
      ]) : null,
    ]);
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: t('org.entrants') }),
    rows.length ? el('ul', { className: 'plain' }, rows) : null,
    participants.length ? el('ul', { className: 'plain' }, participants) : el('p', { text: t('org.none') }),
  ]);
}

/** Whether an authority entry already answered this participant request. */
function requestAnswered(intent) {
  return store.logEntries().some((entry) => {
    if (entry.data?.pubkey !== intent.pubkey) return false;
    const op = intent.intent.op;
    const answersOperation = op === 'register' ? entry.op === 'registration_decision'
      : op === 'withdraw' ? entry.op === 'registration_decision' && entry.data.decision === 'withdrawn'
        : op === 'checkin_request' ? entry.op === 'checkin' && entry.data.state === 'checked_in'
          : op === 'defer_request' ? entry.op === 'defer_decision'
            : op === 'attempt_report' ? entry.op === 'attempt_result'
              && entry.data.climb_id === intent.intent.data.climb_id
              && entry.data.attempt_no === intent.intent.data.attempt_no
              : false;
    if (!answersOperation) return false;
    // New decisions name the exact replaceable intent. The strict timestamp
    // fallback is only for old logs and deliberately avoids same-second guesses.
    if (entry.data.intent_id) return entry.data.intent_id === intent.eventId;
    if ((entry.at || 0) <= intent.createdAt) return false;
    return true;
  });
}

/** Participant intents that need an explicit authority decision. */
function requestsPanel(snapshot) {
  const actionable = [...intents.values()]
    .filter((intent) => ['withdraw', 'checkin_request', 'defer_request', 'attempt_report'].includes(intent.intent.op))
    .filter((intent) => !requestAnswered(intent))
    .sort((a, b) => a.createdAt - b.createdAt);

  const rows = actionable.map((intent) => {
    const participant = store.participant(intent.pubkey);
    const name = participant ? displayName(participant) : shortKey(intent.pubkey);
    const op = intent.intent.op;
    let description;
    let controls = [];

    if (op === 'withdraw') {
      description = t('org.request.withdraw');
      controls = [el('button', {
        className: 'primary', text: t('org.request.confirm_withdraw'),
        on: { click: () => act(() => writer.decideRegistration(intent.pubkey, 'withdrawn', {
          intentId: intent.eventId,
        })) },
      })];
    } else if (op === 'checkin_request') {
      description = t('org.request.checkin');
      controls = [el('button', {
        className: 'primary', text: t('org.request.grant_checkin'),
        on: { click: () => act(() => writer.checkIn(intent.pubkey, 'checked_in', intent.eventId)) },
      })];
    } else if (op === 'defer_request') {
      description = t('org.request.defer');
      controls = [
        store.canDefer(intent.pubkey) ? el('button', {
          className: 'primary', text: t('org.request.grant_defer'),
          on: { click: () => act(() => writer.decideDefer(intent.pubkey, 'granted', undefined, intent.eventId)) },
        }) : null,
        el('button', {
          text: t('org.request.deny'),
          on: { click: () => act(() => writer.decideDefer(intent.pubkey, 'denied', undefined, intent.eventId)) },
        }),
      ];
    } else {
      const data = intent.intent.data;
      description = t('org.request.attempt', {
        climb: selectionLabels(snapshot, [data.climb_id])[0],
        outcome: t(`org.${data.outcome}`),
      });
      controls = [el('button', {
        className: 'primary', text: t('org.request.record_attempt'),
        on: { click: () => act(() => writer.recordAttempt(
          intent.pubkey, data.climb_id, data.outcome, data.attempt_no, intent.eventId,
        )) },
      })];
    }

    return el('li', {}, [
      el('div', { className: 'row between' }, [
        el('span', { text: `${name} — ${description}` }),
        el('span', { className: 'row' }, controls),
      ]),
    ]);
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: t('org.requests') }),
    rows.length ? el('ul', { className: 'plain' }, rows) : el('p', { text: t('org.request.none') }),
  ]);
}

/**
 * Recording an entry fee as paid.
 *
 * There are two ways to do it and they are deliberately not the same button.
 *
 * The first is a verified receipt: a kind-9735 signed by the key this
 * competition's own payment endpoint named, over a zap request this entrant
 * signed, for this competition, for the right amount. That is checked here and
 * only then recorded, so "settled" means something.
 *
 * The second is the organizer saying so. Plenty of gyms take cash, and plenty
 * of payment providers publish no verifiable receipt, so this has to exist —
 * but it goes in as an override carrying a mandatory reason, which lands in the
 * audit trail every client can read. A button that silently says "settled"
 * without either of those is how a record stops being worth anything.
 */
function paymentControls(snapshot, participant) {
  const receipt = receiptFor(participant.pubkey);
  const controls = [];

  if (receipt) {
    controls.push(el('button', {
      className: 'primary',
      text: t('pay.verify'),
      on: {
        click: () => act(async () => {
          const verified = await verifyZapReceipt(receipt.event, {
            providerPubkey: lnurl.nostrPubkey,
            payerPubkey: participant.pubkey,
            recipientPubkey: snapshot.competition.authority,
            address: competitionAddress(store.organizerPubkey, snapshot.competition.comp_id),
            amountMsat: snapshot.competition.fee_msat,
          });
          if (!verified.ok) throw new Error(t(`pay.reject.${verified.error}`));
          await writer.decidePayment(participant.pubkey, 'settled', {
            zapReceiptId: receipt.event.id,
            amountMsat: verified.amountMsat,
            zapperPubkey: receipt.event.pubkey,
          });
        }),
      },
    }));
  } else if (lnurl.nostrPubkey) {
    controls.push(el('span', { className: 'hint', text: t('pay.no_receipt_yet') }));
  } else {
    controls.push(el('span', { className: 'hint', text: t('pay.unverifiable') }));
  }

  controls.push(el('button', {
    text: t('pay.manual'),
    on: {
      click: () => act(async () => {
        const reason = prompt(t('pay.manual_reason'));
        if (!reason || !reason.trim()) throw new Error(t('pay.manual_no_reason'));
        await writer.override(
          'payment_decision',
          { pubkey: participant.pubkey, state: 'settled' },
          reason.trim(),
          [participant.pubkey],
        );
      }),
    },
  }));

  return el('span', { className: 'row' }, controls);
}

/**
 * Prize claims waiting on the organizer.
 *
 * Every claim is decrypted here and nowhere else, checked against the final
 * standings before it is shown, and paid from the organizer's own wallet. The
 * console never holds the money and cannot send it — it produces a wallet link
 * and records what the organizer says happened.
 *
 * The check runs *before* the payout destination is displayed. An organizer
 * looking at a Lightning address has already been told whether the person who
 * sent it is the person the standings say won.
 */
function prizeClaimsPanel(snapshot) {
  const competition = snapshot.competition;
  const prizes = competition.prizes || [];
  if (prizes.length === 0) return null;

  const rows = [el('h2', { text: t('org.prizes.claims') })];
  rows.push(el('p', { className: 'small', text: t('money.no_custody') }));

  if (snapshot.state.status !== 'finished') {
    rows.push(el('p', { className: 'small', text: t('org.prizes.not_final') }));
    return el('section', { className: 'card' }, rows);
  }

  const deadline = claimDeadline(snapshot.state.results_at || 0, competition.prize_claim_days);
  let any = false;

  for (const prize of prizes) {
    const status = snapshot.state.prizes?.[prize.id];
    const claim = prizeClaims.get(prize.id);
    const winner = eligibleWinner(snapshot.standings, prize);

    rows.push(el('h3', {
      text: prize.kind === 'cash'
        ? t('prize.won_cash', { label: prize.label, sats: Math.round(prize.value_msat / 1000) })
        : t('prize.won_goods', { label: prize.label }),
    }));

    if (!winner) {
      // A tie, or a rank nobody reached. Neither is something the console can
      // resolve on its own.
      rows.push(el('p', { className: 'small', text: t('org.prizes.no_winner') }));
      continue;
    }
    rows.push(el('p', { className: 'small', text: t('org.prizes.winner', { name: winner.display || shortKey(winner.pubkey) }) }));

    if (status) {
      rows.push(el('span', { className: 'badge', text: t(`prize.state.${status.state}`) }));
    }
    if (!claim) {
      rows.push(el('p', { className: 'small', text: t('org.prizes.no_claim_yet') }));
      continue;
    }
    any = true;

    if (claim.error) {
      // Named, not hidden: an organizer who sees "not the winner" knows not to
      // pay, and one who sees "stale results" knows to ask for a fresh claim.
      rows.push(el('p', { className: 'notice bad', text: t(`org.prizes.refused.${claim.error}`, {}) }));
      rows.push(el('button', {
        text: t('org.prizes.reject'),
        on: { click: () => act(() => writer.decidePrize(prize.id, winner.pubkey, 'rejected')) },
      }));
      continue;
    }

    rows.push(
      el('p', { className: 'small', text: t('org.prizes.destination') }),
      el('p', { className: 'mono selectable wrap', text: claim.claim.destination }),
    );
    if (prize.kind === 'cash' && claim.claim.payout_kind !== 'non_cash') {
      rows.push(el('a', {
        className: 'button primary',
        attrs: {
          href: claim.claim.payout_kind === 'bolt11'
            ? walletUri(claim.claim.destination)
            : `lightning:${claim.claim.destination}`,
        },
        text: t('org.prizes.pay'),
      }));
    }
    rows.push(el('div', { className: 'row' }, [
      el('button', {
        text: t('org.prizes.approve'),
        on: { click: () => act(() => writer.decidePrize(prize.id, winner.pubkey, 'approved')) },
      }),
      el('button', {
        className: 'primary',
        text: t('org.prizes.mark_paid'),
        on: {
          click: () => act(async () => {
            // "Paid" is the organizer's assertion and the spec says so. The
            // reason is what makes it auditable rather than merely asserted.
            const reason = prompt(t('org.prizes.paid_reason'));
            if (!reason || !reason.trim()) throw new Error(t('org.prizes.paid_no_reason'));
            await writer.decidePrize(prize.id, winner.pubkey, 'paid', reason.trim());
          }),
        },
      }),
      el('button', {
        text: t('org.prizes.reject'),
        on: { click: () => act(() => writer.decidePrize(prize.id, winner.pubkey, 'rejected')) },
      }),
    ]));
    rows.push(el('p', { className: 'small', text: t('org.prizes.paid_is_your_word') }));
  }

  if (!any && snapshot.state.status === 'finished'
    && Number.isInteger(deadline) && Math.floor(Date.now() / 1000) > deadline) {
    rows.push(el('p', { className: 'small', text: t('org.prizes.deadline_passed') }));
  }
  return el('section', { className: 'card' }, rows);
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
      // Under participant choice the climber is on a climb of their own, not on
      // `current_climb_id` — recording against the wrong one would score
      // somebody else's problem. Their report says which; failing that, the
      // organizer picks from the set that climber actually holds.
      const reported = intents.get(`${current}:attempt_report`)?.intent.data;
      const own = store.remainingClimbs(current);
      const climbId = snapshot.competition.rules.climb_source === 'participant_choice'
        ? (own.find((c) => c.id === reported?.climb_id)?.id || own[0]?.id || '')
        : state.current_climb_id;
      const attemptNo = (currentParticipant.climbs.find((c) => c.climb_id === climbId)?.attempts_used || 0) + 1;

      if (reported?.climb_id) {
        rows.push(el('p', {
          className: 'notice',
          text: t('org.reported', {
            climb: own.find((c) => c.id === reported.climb_id)?.label || reported.climb_id,
            outcome: t(`org.${reported.outcome}`),
          }),
        }));
      }
      if (own.length > 1) {
        rows.push(el('p', { className: 'small', text: t('org.recording_for', { climb: own.find((c) => c.id === climbId)?.label || climbId }) }));
      }

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
    if (climbs.length) {
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
  activeCreateForm = null;
  if (!signer) {
    replace(view, el('div', { className: 'card' }, [
      el('h2', { text: t('nav.organizer') }),
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
      el('h2', { text: snapshot.competition.title }),
      el('div', { className: 'row' }, [
        el('span', { className: 'badge', text: t(`status.${snapshot.state.status}`) }),
        el('span', { className: 'badge', text: formatDateTime(snapshot.competition.starts_at, language, snapshot.competition.timezone) }),
      ]),
      isAuthority ? el('div', { className: 'row' }, lifecycleActions(snapshot))
        : el('div', { className: 'notice warn' }, [el('p', { text: t('org.not_owner') })]),
      el('aside', { className: 'subcard scoring-explanation' }, [
        el('h3', { text: t('scoring.info.title') }),
        el('p', { text: scoringExplanation(t, snapshot.competition) }),
      ]),
    ]),
    feedback,
    isAuthority ? requestsPanel(snapshot) : null,
    isAuthority ? entrantsPanel(snapshot) : null,
    isAuthority ? queuePanel(snapshot) : null,
    isAuthority ? prizeClaimsPanel(snapshot) : null,
    sharePanel(snapshot),
    snapshot.state.rejected.length ? el('details', { className: 'disclosure' }, [
      el('summary', { text: String(snapshot.state.rejected.length) }),
      el('ul', { className: 'plain' }, snapshot.state.rejected.map(
        (r) => el('li', { className: 'small', text: describeRejection(t, r) }),
      )),
    ]) : null);
}

/**
 * Ask the organizer's own payment endpoint which key signs its receipts.
 *
 * Failing is not fatal: without it no receipt can be verified, and the console
 * says so rather than pretending it checked something.
 */
async function resolvePaymentEndpoint() {
  lnurl = { resolved: false, nostrPubkey: null, error: null };
  const competition = store?.competition;
  if (!competition || competition.fee_msat <= 0 || !competition.fee_lnurl) {
    lnurl = { resolved: true, nostrPubkey: null, error: null };
    return;
  }
  const endpoint = resolvePayEndpoint(competition.fee_lnurl);
  if (!endpoint.ok) {
    lnurl = { resolved: true, nostrPubkey: null, error: endpoint.error };
    render();
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(endpoint.url, { signal: controller.signal }).finally(
      () => clearTimeout(timer),
    );
    const pay = validatePayResponse(await response.json(), competition.fee_msat);
    lnurl = {
      resolved: true,
      nostrPubkey: pay.ok ? pay.nostrPubkey : null,
      error: pay.ok ? null : pay.error,
    };
  } catch {
    lnurl = { resolved: true, nostrPubkey: null, error: 'unreachable' };
  }
  render();
}

/**
 * Collect zap receipts for this competition.
 *
 * Indexed by the pubkey inside the zap request rather than by the receipt's own
 * `P` tag, which is optional — the request is what is signed by the payer.
 */
async function followReceipts() {
  const competition = store?.competition;
  if (!competition || competition.fee_msat <= 0) return;
  const address = competitionAddress(store.organizerPubkey, competition.comp_id);
  pool.subscribe([receiptFilter({ recipientPubkey: competition.authority, address })], {
    onEvent: (event) => {
      if (event.kind !== ZAP_RECEIPT_KIND) return;
      const description = (event.tags || []).find((tag) => tag[0] === 'description')?.[1];
      if (!description) return;
      let request;
      try {
        request = JSON.parse(description);
      } catch {
        return;
      }
      if (!request?.pubkey) return;
      const known = receipts.get(request.pubkey);
      if (known && known.event.created_at >= event.created_at) return;
      receipts.set(request.pubkey, { event, request });
      render();
    },
  });
}

async function start() {
  const hash = location.hash.replace(/^#/, '');
  const parsed = parseCompetitionRef(hash);
  if (!parsed.ok) { store = null; render(); return; }
  ref = parsed;
  writer = null;
  intents.clear();

  if (pool) { store?.close(); pool.close(); }
  const opened = await openCompetition({
    organizerPubkey: parsed.organizerPubkey, compId: parsed.compId, t, statusNode,
  });
  if (!opened) return;
  ({ store, pool } = opened);
  store.onChange(() => { render(); void settleClaims(); });
  void resolvePaymentEndpoint();
  void followReceipts();
  if (signer && signer.pubkey === store.competition.authority) {
    writer = new AuthorityWriter({ store, pool, signer });
    await store.followIntents((event) => {
      const parsedIntent = parseIntentEvent(event, store.competition, store.organizerPubkey,
        Math.floor(Date.now() / 1000));
      if (!parsedIntent.ok) return;
      // Newest wins. An intent is replaceable, so a participant who re-picks
      // after losing a race publishes a second one under the same nonce; a
      // relay that backfills the old copy last must not undo the new choice.
      const key = `${parsedIntent.pubkey}:${parsedIntent.intent.op}`;
      const known = intents.get(key);
      if (!known || parsedIntent.createdAt > known.createdAt
        || (parsedIntent.createdAt === known.createdAt && parsedIntent.eventId > known.eventId)) {
        intents.set(key, parsedIntent);
        if (parsedIntent.intent.op === 'prize_claim') void readPrizeClaim(parsedIntent);
      }
      render();
      void settleClaims();
    });
  }
  render();
}

window.addEventListener('hashchange', start);
await signIn.restore();
await start();

export { DISCOVERY_RELAYS };
