/**
 * Bootstrap shared by every competition page.
 *
 * Resolving "which competition" is the interesting part: a link can arrive as a
 * full URL, a bare `naddr`, a `nostr:` URI, or in the hash after `404.html`
 * rewrote a `/comp/…` path. All four end up in the same place, and anything
 * else is rejected loudly rather than half-loaded.
 */
import { decodeNip19 } from '../protocol/nostr-event.mjs';
import { KIND, compDTag, isCompId, parseDTag } from '../protocol/competition.mjs?v=20260815-1';
import { RelayPool, mergeRelays } from '../protocol/relay-pool.mjs';
import { isLoopbackRelay } from '../protocol/relay-url.mjs';
import { CompetitionStore } from '../ui/store.mjs?v=20260815-1';
import { createTranslator, detectLanguage } from '../ui/i18n.mjs?v=20260815-1';
import { el, replace, byId } from '../ui/dom.mjs';

/**
 * Relays used to FIND a competition before its own relay list is known.
 *
 * The same set the Android client ships (`NostrConfig.DEFAULT_RELAYS`), for the
 * same reason: a competition published from the app must be discoverable from
 * the website without either side having to be configured.
 */
export const DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.oxtr.dev',
];

const DEV_RELAY_KEY = 'cruxcoach:competitions:dev-relay';

/**
 * `?relay=…` exists for one purpose: the localhost runbook.
 *
 * It is therefore accepted **only for a loopback address**. A link carrying
 * `?relay=wss://somewhere.example` would otherwise let a stranger choose which
 * relay a viewer reads a competition from — and while such a relay could not
 * forge anything (every event is signature-checked and bound to the organizer's
 * key from the naddr), it could serve a truncated prefix of the log, which
 * reduces cleanly and looks like a competition that simply has not progressed.
 *
 * It is a discovery aid only. Once a signed definition has been found, its
 * relay list is the complete authority/read/write scope; neither a URL hint nor
 * a user's optional relays may weaken or expand that completeness barrier.
 */
export function resolveRelays(competitionRelays = []) {
  if (competitionRelays.length > 0) {
    return mergeRelays(competitionRelays, []);
  }
  return resolveDiscoveryRelays();
}

/** Untrusted candidate discovery: hints first, then local/default finders. */
export function resolveDiscoveryRelays(relayHints = []) {
  const params = new URLSearchParams(location.search);
  const requested = params.get('relay');
  if (requested && isLoopbackRelay(requested)) {
    try { sessionStorage.setItem(DEV_RELAY_KEY, requested); } catch { /* private mode */ }
  }
  let remembered = null;
  try { remembered = sessionStorage.getItem(DEV_RELAY_KEY); } catch { /* private mode */ }
  const override = [requested, remembered].find((url) => url && isLoopbackRelay(url));
  // Hints are controlled by whoever made the link. Reserve most of the bounded
  // pool for normal discovery so eight attacker hints cannot crowd it out.
  const boundedHints = mergeRelays(relayHints, [], 3);
  if (override) return mergeRelays([override], [...boundedHints, ...DISCOVERY_RELAYS]);
  return mergeRelays(boundedHints, DISCOVERY_RELAYS);
}

/**
 * Pull a competition address out of whatever the user pasted or followed.
 * @returns {{ok: true, organizerPubkey: string, compId: string, naddr: string} | {ok: false, error: string}}
 */
export function parseCompetitionRef(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'empty' };
  let text = input.trim();

  // A full URL, in any of the shapes we hand out.
  const match = text.match(/(?:^|\/)(?:comp|competitions)\/?(?:[^#]*#)?(naddr1[0-9a-z]+)/i)
    || text.match(/#(naddr1[0-9a-z]+)/i)
    || text.match(/^nostr:(naddr1[0-9a-z]+)$/i)
    || text.match(/^(naddr1[0-9a-z]+)$/i);
  if (match) text = match[1];
  if (!/^naddr1[0-9a-z]+$/i.test(text)) return { ok: false, error: 'not_an_naddr' };

  // A different code from the one above on purpose: "that is not a competition
  // link" and "that link is damaged" are different problems, and a person who
  // mistyped one character deserves to be told which.
  const decoded = decodeNip19(text.toLowerCase());
  if (!decoded || decoded.type !== 'naddr') return { ok: false, error: 'damaged_link' };
  // Strict: the right kind, and a d-tag that is actually a competition. A QR
  // from anywhere can carry an naddr; only ours addresses a competition.
  if (decoded.data.kind !== KIND) return { ok: false, error: 'wrong_kind' };
  const dTag = parseDTag(decoded.data.identifier);
  if (!dTag || dTag.kind !== 'competition') return { ok: false, error: 'not_a_competition' };

  return {
    ok: true,
    organizerPubkey: decoded.data.pubkey,
    compId: dTag.compId,
    naddr: text.toLowerCase(),
    relayHints: decoded.data.relays || [],
  };
}

/** The canonical join link for a competition. */
export function joinLink(naddr, origin = location.origin) {
  return `${origin}/comp/${naddr}`;
}

/**
 * The "open a competition" card, shared by the participant and live screens.
 *
 * Both pages can be reached without a competition in the fragment — a bare
 * `/competitions/live.html` on a projector is a normal way to start — and both
 * then need the same thing: somewhere to paste the link. It lives here so a
 * page cannot end up describing a way in that it does not actually offer.
 *
 * @param {(key: string) => string} t
 * @param {(parsed: object) => void} onOpen  called once the input parsed
 */
export function openCompetitionForm(t, onOpen) {
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
          onOpen(parsed);
        },
      },
    }),
  ]);
}

/** Set up language, translator and the two live regions every page needs. */
export function bootstrap() {
  const language = detectLanguage();
  const t = createTranslator(language);
  document.documentElement.lang = language;
  return { language, t };
}

/**
 * Load a competition and start following it.
 * @returns {{store: CompetitionStore, pool: RelayPool} | null}
 */
export async function openCompetition({ organizerPubkey, compId, relayHints = [], t, statusNode }) {
  const say = (message) => { if (statusNode) replace(statusNode, el('p', { text: message })); };
  say(t('comp.loading'));

  // Two passes: find it on the discovery relays, then reconnect to the relays
  // the competition itself names. A competition run on a gym's own relay is
  // invisible otherwise.
  let pool = new RelayPool(resolveDiscoveryRelays(relayHints));
  let store = new CompetitionStore({ pool, organizerPubkey, compId });
  pool.onStatusChange = (status) => store.connectionChanged(status);
  let loaded = await store.loadCompetition({ requireAllRelays: false });

  // A replacement definition may itself migrate the signed relay set. Follow
  // that signed chain until the set used for the fetch matches the newest
  // definition; only then is the candidate actionable. Bound/cycle-check
  // malformed migrations rather than spinning forever.
  const authorityScopes = new Set();
  while (loaded.ok) {
    const wanted = resolveRelays(loaded.competition.relays);
    const current = pool.urls.join('|');
    const scopeKey = wanted.join('|');
    if (scopeKey === current) break;
    if (authorityScopes.has(scopeKey) || authorityScopes.size >= 8) {
      loaded = { ok: false, error: 'invalid' };
      break;
    }
    authorityScopes.add(scopeKey);
    pool.close();
    pool = new RelayPool(wanted);
    store = new CompetitionStore({ pool, organizerPubkey, compId });
    pool.onStatusChange = (status) => store.connectionChanged(status);
    loaded = await store.loadCompetition();
  }

  if (!loaded.ok) {
    pool.close();
    if (loaded.needsUpgrade) say(t('comp.upgrade'));
    else if (loaded.error === 'not_found') say(t('comp.notfound'));
    else if (loaded.error === 'unreachable') say(t('error.offline'));
    else say(t('comp.invalid'));
    return null;
  }

  await store.follow();
  if (statusNode) replace(statusNode);
  return { store, pool };
}

/** A one-line banner whenever a development relay is in use. */
export function devRelayBanner(store, t) {
  if (!store.snapshot().developmentRelay) return null;
  return el('div', { className: 'dev-banner', attrs: { role: 'status' }, text: t('live.dev_relay') });
}

/** Render the two problems every live screen must never hide. */
export function integrityNotices(snapshot, t) {
  const notices = [];
  if (!snapshot.historyComplete) {
    notices.push(el('div', { className: 'notice bad', attrs: { role: 'alert' } }, [
      el('p', { text: t('live.history_incomplete') }),
    ]));
  }
  if (snapshot.chainBreakAt) {
    notices.push(el('div', { className: 'notice bad', attrs: { role: 'alert' } }, [
      el('p', { text: t('live.chain_break', { n: snapshot.chainBreakAt }) }),
    ]));
  }
  if (snapshot.state?.fork_detected) {
    notices.push(el('div', { className: 'notice bad', attrs: { role: 'alert' } }, [
      el('p', { text: t('live.fork') }),
    ]));
  }
  if (snapshot.intentHistoryComplete === false) {
    notices.push(el('div', { className: 'notice bad', attrs: { role: 'alert' } }, [
      el('p', { text: t('live.intents_incomplete') }),
    ]));
  }
  return notices;
}

/** Block every personal/authority projection until relay history is trustworthy. */
export function integrityGuard(snapshot, t) {
  if (snapshot.trustworthy) return null;
  return el('section', { className: 'card integrity-guard', attrs: { 'aria-labelledby': 'integrity-title' } }, [
    el('h2', { attrs: { id: 'integrity-title' }, text: t('live.integrity_title') }),
    el('p', { text: t('live.integrity_blocked') }),
    el('button', {
      className: 'primary', text: t('comp.refresh'),
      on: { click: () => location.reload() },
    }),
  ]);
}

export { el, replace, byId, CompetitionStore, RelayPool, compDTag, isCompId };
