/**
 * Bootstrap shared by every competition page.
 *
 * Resolving "which competition" is the interesting part: a link can arrive as a
 * full URL, a bare `naddr`, a `nostr:` URI, or in the hash after `404.html`
 * rewrote a `/comp/…` path. All four end up in the same place, and anything
 * else is rejected loudly rather than half-loaded.
 */
import { decodeNip19 } from '../protocol/nostr-event.mjs';
import { KIND, compDTag, isCompId, parseDTag } from '../protocol/competition.mjs';
import { RelayPool, mergeRelays } from '../protocol/relay-pool.mjs';
import { CompetitionStore } from '../ui/store.mjs';
import { createTranslator, detectLanguage } from '../ui/i18n.mjs';
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
 * A development relay can be pointed at only by an explicit, deliberate action:
 * a `?relay=ws://127.0.0.1:…` parameter that the runbook tells you to use. It is
 * remembered for the session and every screen says loudly that it is in use, so
 * a demo can never be mistaken for a real event.
 */
export function resolveRelays(competitionRelays = []) {
  const params = new URLSearchParams(location.search);
  const requested = params.get('relay');
  if (requested) {
    try { sessionStorage.setItem(DEV_RELAY_KEY, requested); } catch { /* private mode */ }
  }
  let remembered = null;
  try { remembered = sessionStorage.getItem(DEV_RELAY_KEY); } catch { /* private mode */ }
  const override = requested || remembered;
  if (override) return mergeRelays([override], competitionRelays);
  return mergeRelays(competitionRelays, DISCOVERY_RELAYS);
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
export async function openCompetition({ organizerPubkey, compId, t, statusNode }) {
  const say = (message) => { if (statusNode) replace(statusNode, el('p', { text: message })); };
  say(t('comp.loading'));

  // Two passes: find it on the discovery relays, then reconnect to the relays
  // the competition itself names. A competition run on a gym's own relay is
  // invisible otherwise.
  let pool = new RelayPool(resolveRelays());
  let store = new CompetitionStore({ pool, organizerPubkey, compId });
  let loaded = await store.loadCompetition();

  if (loaded.ok) {
    const wanted = resolveRelays(loaded.competition.relays);
    const current = pool.urls.join('|');
    if (wanted.join('|') !== current) {
      pool.close();
      pool = new RelayPool(wanted);
      store = new CompetitionStore({ pool, organizerPubkey, compId });
      loaded = await store.loadCompetition();
    }
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
  return notices;
}

export { el, replace, byId, CompetitionStore, RelayPool, compDTag, isCompId };
