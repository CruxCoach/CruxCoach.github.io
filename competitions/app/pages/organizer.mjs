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
} from './common.mjs?v=20260814-2';
import { SignIn } from '../ui/shell.mjs?v=20260814-2';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { AuthorityWriter, publishCompetition } from '../authority.mjs?v=20260814-4';
import {
  MUTABLE_CONFIG_FIELDS, NAMESPACE, configPatchImpact, newCompId,
  parseCompetitionEvent, parseIntentEvent, parseLogEvent,
  checkinWindowOpen, competitionRunning, registrationWindowOpen, validateCompetitionConfig,
} from '../protocol/competition.mjs?v=20260813-2';
import { reduce } from '../protocol/reduce.mjs';
import { outstandingClaims, registrationOrder } from '../protocol/claims.mjs';
import { verifyZapReceipt, receiptFilter, ZAP_RECEIPT_KIND } from '../protocol/zap.mjs';
import { verifyClaim, eligibleWinner, claimDeadline } from '../protocol/prize.mjs';
import { walletUri } from '../protocol/bolt11.mjs';
import { resolvePayEndpoint, validatePayResponse } from '../protocol/lnurl.mjs';
import { competitionAddress } from '../protocol/competition.mjs?v=20260813-2';
import { verifyEvent } from '../protocol/nostr-event.mjs';
import { competitionToFormDraft, createCompetitionForm } from './organizer-form.mjs?v=20260814-1';
import { naddrEncode } from '../protocol/nostr-event.mjs';
import { KIND, compDTag } from '../protocol/competition.mjs?v=20260813-2';
import { announce, displayName, formatDateTime, formatSeconds, shortKey } from '../ui/dom.mjs';
import { describeRejection } from '../ui/i18n.mjs?v=20260814-4';
import { scoringExplanation } from '../ui/scoring-copy.mjs?v=20260813-1';
import { syncHealth } from '../ui/live-view.mjs?v=20260813-1';

const { t, language } = bootstrap();

let signer = null;
let store = null;
let pool = null;
let writer = null;
let lastEffectiveStatus = '';
let ref = null;
let ticker = null;
let lastHealthKind = '';
let cleanupResult = null;
let editingDefinition = false;
let activeEditView = null;
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
  // Competition input and signing credentials have independent lifecycles.
  // Forgetting a key must not silently erase or stop saving the form somebody
  // may have spent half an hour completing. The pubkey still keeps drafts
  // isolated; signing back into the same identity restores its draft.
  let saveTimer = null;
  const rememberedStep = historyWizardStep();
  const form = createCompetitionForm({
    t,
    pool: profilePool,
    signerPubkey: signer.pubkey,
    defaultDisplayName: signIn.displayName,
    defaultLud16: signIn.profile?.fields?.lud16 || '',
    relays: resolveRelays([]).slice(0, 8),
    initialDraft: readLocalDraft(ownerPubkey),
    persistDraft: true,
    initialStep: rememberedStep,
    onStepChange: (step) => recordWizardStep(step),
    onStepBack: () => history.back(),
    onDraftDiscard: () => {
      clearTimeout(saveTimer);
      clearLocalDraft(ownerPubkey);
      location.reload();
    },
    onDraftChange: (draft) => {
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
      text: t('org.publish_competition'),
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
          publishButton.textContent = t('org.publish_working');
          let relayPool = null;
          try {
            relayPool = new RelayPool(config.relays);
            const published = await publishCompetition(relayPool, signer, config);
            announce(t('publish.ok', published));
            const naddr = naddrEncode({
              identifier: compDTag(config.comp_id), pubkey: signer.pubkey, kind: KIND,
            });
            clearTimeout(saveTimer);
            clearLocalDraft(ownerPubkey);
            location.hash = naddr;
            await start();
          } catch (err) {
            replace(errors, el('div', { className: 'notice bad' }, [
              el('p', { text: err.message || t('publish.none') }),
            ]));
          } finally {
            relayPool?.close();
            publishButton.disabled = false;
            publishButton.textContent = t('org.publish_competition');
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

function competitionPatch(previous, next) {
  const patch = {};
  for (const field of MUTABLE_CONFIG_FIELDS) {
    const before = previous[field];
    const after = next[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    patch[field] = after === undefined ? null : after;
  }
  return patch;
}

function editCompetitionForm(snapshot) {
  const competition = snapshot.competition;
  const form = createCompetitionForm({
    t, pool: profilePool, signerPubkey: signer.pubkey,
    defaultDisplayName: competition.organizer_name,
    defaultLud16: competition.fee_lnurl || '', relays: competition.relays,
    initialDraft: competitionToFormDraft(competition), persistDraft: false,
  });
  activeCreateForm = form;
  const errors = el('div', { attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const reason = el('textarea', {
    attrs: { required: 'required', maxlength: '500', rows: '3', placeholder: t('org.edit.reason_placeholder') },
  });
  const impact = el('div', { className: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } }, [
    el('strong', { text: t('org.edit.impact.none') }),
    el('p', { text: t('org.edit.impact.none_hint') }),
  ]);
  const refreshImpact = () => {
    try {
      const patch = competitionPatch(competition, form.build());
      const kind = configPatchImpact(patch);
      replace(impact,
        el('strong', { text: t(`org.edit.impact.${kind || 'none'}`) }),
        el('p', { text: t(`org.edit.impact.${kind || 'none'}_hint`) }));
    } catch { /* incomplete form: its own validation remains authoritative */ }
  };
  form.node.addEventListener('input', refreshImpact);
  const save = el('button', {
    className: 'primary', text: t('org.edit.publish_revision'),
    on: { click: async () => {
      replace(errors);
      let config;
      try {
        config = { ...form.build(), comp_id: competition.comp_id };
      } catch (err) {
        replace(errors, el('div', { className: 'notice bad' }, [el('p', { text: err.message })]));
        return;
      }
      const validation = validateCompetitionConfig(config);
      if (!validation.ok) {
        replace(errors, el('div', { className: 'notice bad' }, [el('ul', { className: 'plain' },
          validation.errors.map((error) => el('li', { text: `${error.field} ${error.message}` })))]));
        return;
      }
      const patch = competitionPatch(competition, config);
      if (!configPatchImpact(patch)) {
        replace(errors, el('div', { className: 'notice warn' }, [el('p', { text: t('org.edit.no_changes') })]));
        return;
      }
      if (!reason.value.trim()) {
        replace(errors, el('div', { className: 'notice bad' }, [el('p', { text: t('org.reason.required') })]));
        reason.focus();
        return;
      }
      save.disabled = true;
      try {
        await writer.updateConfig(patch, reason.value.trim());
        announce(t('org.edit.saved'));
        editingDefinition = false;
        activeEditView = null;
        render();
      } catch (err) {
        const message = err.code?.startsWith('config_') ? t(`rejection.${err.code}`) : (err.message || t('publish.none'));
        replace(errors, el('div', { className: 'notice bad' }, [el('p', { text: message })]));
        save.disabled = false;
      }
    } },
  });
  form.reviewActions.append(impact, el('label', {}, [
    el('span', { text: t('org.edit.reason') }), reason,
    el('small', { className: 'hint', text: t('org.edit.reason_hint') }),
  ]), errors, el('div', { className: 'row' }, [
    el('button', { text: t('action.cancel'), on: { click: () => {
      editingDefinition = false; activeEditView = null; render();
    } } }),
    save,
  ]));
  return el('div', {}, [
    el('section', { className: 'notice warn' }, [
      el('strong', { text: t('org.edit.title') }),
      el('p', { text: t('org.edit.revision_notice', { revision: snapshot.state.config_revision + 1 }) }),
    ]),
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
            className: 'button primary',
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

  const runningNow = competitionRunning(snapshot.competition, status, Math.floor(Date.now() / 1000));
  if (runningNow) step(t('org.pause'), 'paused');
  if (status === 'paused') step(t('org.resume'), 'running', 'primary');
  if (!['finished', 'cancelled'].includes(status)) {
    actions.push(el('details', { className: 'host-danger-menu' }, [
      el('summary', { text: t('org.more_controls') }),
      (runningNow || status === 'paused') && el('button', {
        text: t('org.finish'),
        on: {
          click: () => {
            if (!confirm(`${t('org.finish')}?`)) return;
            act(() => writer.setStatus('finished'));
          },
        },
      }),
      el('button', {
        className: 'danger',
        text: t('org.cancel_comp'),
        on: {
          click: () => {
            if (!confirm(`${t('org.cancel_comp')}?`)) return;
            act(async () => {
              await writer.setStatus('cancelled');
              cleanupResult = await writer.deleteCompetition();
              replace(feedback, el('div', { className: 'notice warn' }, [
                el('p', { text: t('org.cleanup.result', {
                  tombstone: cleanupResult.tombstone.accepted,
                  deletion: cleanupResult.deletion.accepted,
                  total: Math.max(cleanupResult.tombstone.attempted, cleanupResult.deletion.attempted),
                }) }),
              ]));
            });
          },
        },
      }),
    ]));
  }
  if (status === 'cancelled') {
    actions.push(el('button', {
      className: 'danger',
      text: t('org.cleanup.retry'),
      on: {
        click: () => act(async () => {
          if (!confirm(t('org.cleanup.confirm'))) return;
          cleanupResult = await writer.deleteCompetition();
          replace(feedback, el('div', { className: 'notice warn' }, [
            el('p', { text: t('org.cleanup.result', {
              tombstone: cleanupResult.tombstone.accepted,
              deletion: cleanupResult.deletion.accepted,
              total: Math.max(cleanupResult.tombstone.attempted, cleanupResult.deletion.attempted),
            }) }),
            el('p', { text: t('org.cleanup.limit') }),
          ]));
        }),
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
  const now = Math.floor(Date.now() / 1000);
  const runningNow = competitionRunning(snapshot.competition, state.status, now);
  const effectiveStatus = runningNow ? 'running' : state.status;
  if (!checkinWindowOpen(snapshot.competition, state.status, now) && !runningNow && state.status !== 'paused') return null;

  const eligible = state.participants
    .filter((p) => p.registration === 'accepted' && p.checkin === 'checked_in' && p.result === 'active')
    .map((p) => p.pubkey);
  const current = store.currentClimber();
  const currentParticipant = current ? store.participant(current) : null;
  const next = store.nextClimber();
  const nextParticipant = next ? store.participant(next) : null;
  const rows = [
    el('div', { className: 'host-run-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow', text: t('org.now_to_do') }),
        el('h2', { text: t('org.run') }),
      ]),
      el('span', { className: `phase-badge phase-${effectiveStatus}`, text: t(`status.${effectiveStatus}`) }),
    ]),
  ];

  if (state.order.length !== eligible.length || state.order.length === 0) {
    rows.push(el('div', { className: 'host-empty-action' }, [
      el('strong', { text: t('org.queue_needed') }),
      el('span', { text: t('org.queue_needed.hint', { n: eligible.length }) }),
      el('button', {
        className: 'primary host-primary-action',
        text: t('live.queue'),
        on: {
          click: () => act(async () => {
            const order = await AuthorityWriter.defaultOrder(snapshot.competition.comp_id, eligible);
            await writer.seed(order);
          }),
        },
      }),
    ]));
  }

  if ((runningNow || state.status === 'paused') && state.order.length) {
    rows.push(el('div', { className: 'host-turn-hero' }, [
      el('div', {}, [
        el('span', { className: 'host-turn-label', text: t('live.current') }),
        el('strong', { className: 'host-current-name', text: currentParticipant ? displayName(currentParticipant) : t('live.nobody') }),
        el('span', { className: 'host-current-climb', text: state.current_climb_id
          ? snapshot.competition.climbs?.find((climb) => climb.id === state.current_climb_id)?.label || state.current_climb_id
          : t('live.rotation_empty') }),
      ]),
      el('div', { className: 'host-turn-timer' }, [
        el('span', { text: t('live.deadline') }),
        el('strong', {
          className: 'mono', attrs: { id: 'host-deadline' },
          text: state.status === 'paused' ? t('live.paused') : formatSeconds(store.secondsToDeadline()),
        }),
      ]),
    ]));
    rows.push(el('div', { className: 'host-next-strip' }, [
      el('span', { text: t('live.next') }),
      el('strong', { text: nextParticipant ? displayName(nextParticipant) : t('live.queue_empty') }),
    ]));
    if (!currentParticipant) {
      if (runningNow) rows.push(el('button', {
        className: 'primary host-primary-action',
        text: t('org.next_climber'),
        on: { click: () => act(() => writer.advance()) },
      }));
      else rows.push(el('p', { className: 'host-paused-copy', text: t('org.paused.hint') }));
    } else {
      if (state.status === 'paused') {
        rows.push(el('p', { className: 'host-paused-copy', text: t('org.paused.hint') }));
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

      rows.push(el('fieldset', { className: 'host-result-actions' }, [
        el('legend', { text: t('org.record_result') }),
        ...['top', 'zone', 'fall', 'timeout'].map((outcome) => el('button', {
        className: `host-result-${outcome}`,
        text: t(`org.${outcome}`),
        on: {
          click: () => act(async () => {
            await writer.recordAttempt(current, climbId, outcome, attemptNo);
            await writer.closeTurn();
          }),
        },
      })),
      ]));
      rows.push(el('div', { className: 'host-secondary-turn-actions' }, [
        el('button', {
          text: t('live.defer'),
          on: { click: () => act(() => writer.decideDefer(current, 'granted')) },
        }),
      ]));
      }
    }

    const climbs = snapshot.competition.climbs || [];
    if (climbs.length && runningNow) {
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

  return el('section', { className: `card host-run-card host-state-${state.status}` }, rows);
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
        className: 'button primary',
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

function hostSyncState(snapshot) {
  const health = syncHealth(snapshot, Math.floor(Date.now() / 1000));
  lastHealthKind = health.kind;
  if (health.kind === 'live') {
    return el('span', { className: 'sync-state ok', text: t('live.synced', { n: health.connected }) });
  }
  const key = health.kind === 'stale' ? 'live.stale'
    : health.kind === 'offline' ? 'live.offline' : 'live.connecting';
  return el('div', { className: `host-sync-state sync-${health.kind}`, attrs: { role: 'status' } }, [
    el('strong', { text: t(key) }),
    health.age !== null && el('span', { text: t('live.last_update', { n: health.age }) }),
  ]);
}

function hostOverview(snapshot, isAuthority) {
  const now = Math.floor(Date.now() / 1000);
  const accepted = snapshot.state.participants.filter((p) => p.registration === 'accepted').length;
  const checkedIn = snapshot.state.participants.filter((p) => p.checkin === 'checked_in').length;
  const openRequests = [...intents.values()]
    .filter((intent) => ['register', 'withdraw', 'checkin_request', 'defer_request', 'attempt_report'].includes(intent.intent.op))
    .filter((intent) => !requestAnswered(intent)).length;
  const effectiveStatus = competitionRunning(snapshot.competition, snapshot.state.status, now)
    ? 'running' : snapshot.state.status;
  const windowCard = (kind, opensAt, closesAt, open) => {
    const position = now < opensAt ? 'upcoming' : now > closesAt ? 'closed' : open ? 'open' : 'closed';
    return el('div', { className: `host-window state-${position}` }, [
      el('strong', { text: t(`org.window.${kind}`) }),
      el('span', { className: 'badge', text: t(`org.window.${position}`) }),
      el('small', { text: `${formatDateTime(opensAt, language, snapshot.competition.timezone)} → ${formatDateTime(closesAt, language, snapshot.competition.timezone)}` }),
    ]);
  };
  return el('header', { className: 'host-overview' }, [
    el('div', { className: 'host-overview-title' }, [
      el('p', { className: 'eyebrow', text: t('org.control_room') }),
      el('h1', { text: snapshot.competition.title }),
      el('span', { text: formatDateTime(snapshot.competition.starts_at, language, snapshot.competition.timezone) }),
    ]),
    el('div', { className: 'host-overview-state' }, [
      el('span', { className: `phase-badge phase-${effectiveStatus}`, text: t(`status.${effectiveStatus}`) }),
      hostSyncState(snapshot),
    ]),
    el('div', { className: 'host-window-grid' }, [
      windowCard('registration', snapshot.competition.registration_opens_at,
        snapshot.competition.registration_closes_at,
        registrationWindowOpen(snapshot.competition, snapshot.state.status, now)),
      windowCard('checkin', snapshot.competition.checkin_opens_at,
        snapshot.competition.checkin_closes_at,
        checkinWindowOpen(snapshot.competition, snapshot.state.status, now)),
      windowCard('live', snapshot.competition.starts_at, snapshot.competition.ends_at,
        competitionRunning(snapshot.competition, snapshot.state.status, now)),
    ]),
    el('dl', { className: 'host-overview-metrics' }, [
      el('div', {}, [el('dt', { text: t('org.entrants') }), el('dd', { text: String(accepted) })]),
      el('div', {}, [el('dt', { text: t('participant.phase.checkin') }), el('dd', { text: String(checkedIn) })]),
      el('div', {}, [el('dt', { text: t('org.requests') }), el('dd', { text: String(openRequests) })]),
    ]),
    isAuthority ? el('div', { className: 'host-lifecycle' }, [
      el('button', {
        text: t('org.edit.action'), on: { click: () => {
          editingDefinition = true; activeEditView = null; render();
        } },
      }),
      ...lifecycleActions(snapshot),
    ]) : null,
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
  lastEffectiveStatus = competitionRunning(
    snapshot.competition, snapshot.state.status, Math.floor(Date.now() / 1000),
  ) ? 'running' : snapshot.state.status;
  const isAuthority = signer.pubkey === snapshot.competition.authority;

  if (editingDefinition && isAuthority) {
    activeEditView ||= editCompetitionForm(snapshot);
    replace(view, activeEditView);
    return;
  }

  replace(view,
    devRelayBanner(store, t),
    ...integrityNotices(snapshot, t),
    hostOverview(snapshot, isAuthority),
    !isAuthority ? el('div', { className: 'notice warn' }, [el('p', { text: t('org.not_owner') })]) : null,
    feedback,
    isAuthority ? el('div', { className: 'host-console-layout' }, [
      el('section', { className: 'host-console-primary' }, [
        queuePanel(snapshot),
        requestsPanel(snapshot),
        prizeClaimsPanel(snapshot),
      ]),
      el('aside', { className: 'host-console-secondary' }, [
        entrantsPanel(snapshot),
        sharePanel(snapshot),
        el('details', { className: 'disclosure' }, [
          el('summary', { text: t('scoring.info.title') }),
          el('div', { className: 'scoring-explanation' }, [
            el('p', { text: scoringExplanation(t, snapshot.competition) }),
          ]),
        ]),
      ]),
    ]) : el('section', { className: 'card' }, [
      el('aside', { className: 'subcard scoring-explanation' }, [
        el('h3', { text: t('scoring.info.title') }),
        el('p', { text: scoringExplanation(t, snapshot.competition) }),
      ]),
    ]),
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

  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const snapshot = store?.snapshot();
    const effectiveStatus = snapshot?.state && competitionRunning(
      snapshot.competition, snapshot.state.status, Math.floor(Date.now() / 1000),
    ) ? 'running' : snapshot?.state?.status || '';
    if (effectiveStatus && effectiveStatus !== lastEffectiveStatus) {
      render();
      return;
    }
    const deadline = byId('host-deadline');
    if (deadline && store && effectiveStatus === 'running') {
      deadline.textContent = formatSeconds(store.secondsToDeadline());
    }
    const health = snapshot ? syncHealth(snapshot, Math.floor(Date.now() / 1000)) : null;
    if (health && health.kind !== lastHealthKind) render();
  }, 1000);
}

window.addEventListener('hashchange', start);
await signIn.restore();
await start();

export { DISCOVERY_RELAYS };
