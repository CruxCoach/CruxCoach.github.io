/**
 * The three signer paths — FEAT-058 §18.
 *
 * A signer is `{ kind, pubkey, signEvent(draft), close() }`. `signEvent` takes
 * an unsigned draft `{ kind, created_at, tags, content }` and returns a fully
 * signed event. Everything above this layer is identical across the three.
 *
 * Order of preference, enforced by the UI that calls this:
 *   1. NIP-07 browser extension — the key never enters this page
 *   2. NIP-46 remote signer / bunker — the key never enters this page
 *   3. a locally generated key — offered last, with the trade-off stated first
 *
 * NIP-07 and NIP-46 sources accessed 2026-08-09:
 *   https://github.com/nostr-protocol/nips/blob/master/07.md
 *   https://github.com/nostr-protocol/nips/blob/master/46.md
 */
import {
  bytesToHex, decodeNip19, eventId, finalizeEvent, generateSecretKey, getPublicKey,
  hexToBytes, isHex32, randomBytes,
} from '../protocol/nostr-event.mjs';
import { conversationKey, decrypt, encrypt } from './nip44.mjs';
import { RelayPool } from '../protocol/relay-pool.mjs';
import { isAllowedRelayUrl } from '../protocol/relay-url.mjs';

export const NIP46_KIND = 24133;
const NIP46_TIMEOUT_MS = 60000;
/** NIP-40: the transport events are disposable and should not outlive the request. */
const NIP46_EXPIRY_SEC = 300;

// ── NIP-07 ──

/**
 * Wait for an extension to inject `window.nostr`.
 *
 * Injection is asynchronous, so a single synchronous `if (!window.nostr)` is a
 * real race that presents to the user as "I have Alby installed and it says I
 * do not". Polling briefly is the standard fix.
 */
export function waitForNip07(win = globalThis, { timeoutMs = 1000, intervalMs = 50 } = {}) {
  return new Promise((resolve) => {
    if (win.nostr) { resolve(win.nostr); return; }
    const started = Date.now();
    const timer = setInterval(() => {
      if (win.nostr) { clearInterval(timer); resolve(win.nostr); return; }
      if (Date.now() - started >= timeoutMs) { clearInterval(timer); resolve(null); }
    }, intervalMs);
  });
}

export async function createNip07Signer(win = globalThis) {
  const extension = await waitForNip07(win);
  if (!extension) {
    const error = new Error('No Nostr extension answered. Alby and nos2x are the common ones.');
    error.code = 'no_extension';
    throw error;
  }
  let pubkey;
  try {
    pubkey = await extension.getPublicKey();
  } catch (cause) {
    // "no extension" and "the user said no" are different problems with
    // different fixes, and collapsing them into one message is how a person
    // ends up reinstalling an extension that was working.
    const error = new Error('The extension did not release your public key. Did you decline the prompt?');
    error.code = 'rejected';
    error.cause = cause;
    throw error;
  }
  if (!isHex32(pubkey)) throw new Error('The extension returned something that is not a public key.');

  return {
    kind: 'nip07',
    pubkey,
    async signEvent(draft) {
      const signed = await extension.signEvent({
        kind: draft.kind,
        created_at: draft.created_at,
        tags: draft.tags,
        content: draft.content,
      });
      if (!signed?.sig) throw new Error('The extension returned an unsigned event.');
      // Trust nothing, including our own extension: an event we did not
      // actually sign must not be published under our name.
      if (signed.pubkey !== pubkey) throw new Error('The extension signed as a different identity.');
      if ((await eventId(signed)) !== signed.id) throw new Error('The extension returned a mismatched event id.');
      return signed;
    },
    close() {},
  };
}

// ── NIP-46 ──

/**
 * Parse a connection URI.
 *
 * `bunker://<remote-signer-pubkey>?relay=…&secret=…` — the signer invites us.
 * `nostrconnect://<client-pubkey>?relay=…&secret=…` — we invite the signer.
 *
 * The remote-signer pubkey is NOT the user pubkey. The spec's own change log
 * calls this out, and it is the mistake that produces a client happily
 * publishing under the bunker's identity.
 */
export function parseNip46Uri(uri) {
  if (typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  let scheme;
  if (trimmed.startsWith('bunker://')) scheme = 'bunker';
  else if (trimmed.startsWith('nostrconnect://')) scheme = 'nostrconnect';
  else return null;

  let url;
  try {
    // The URL parser treats the pubkey as a host and lowercases it, which is
    // harmless for hex but would silently corrupt anything else — so the
    // pubkey is validated as hex right after.
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const pubkey = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase();
  if (!isHex32(pubkey)) return null;
  const relays = url.searchParams.getAll('relay').filter(isAllowedRelayUrl);
  if (relays.length === 0) return null;
  return {
    scheme,
    pubkey,
    relays,
    secret: url.searchParams.get('secret') || null,
    name: url.searchParams.get('name') || null,
  };
}

/** Build the `nostrconnect://` URI a bunker scans or pastes. */
export function buildNostrConnectUri({ clientPubkey, relays, secret, name = 'CruxCoach Competitions', url = 'https://cruxcoach.org/competitions/' }) {
  const params = new URLSearchParams();
  for (const relay of relays) params.append('relay', relay);
  params.set('secret', secret);
  params.set('name', name);
  params.set('url', url);
  return `nostrconnect://${clientPubkey}?${params.toString()}`;
}

/**
 * A NIP-46 session.
 *
 * Every request carries a timeout. An un-settling promise is not a rare edge
 * case — it is what a bunker that is simply asleep produces, and without a
 * timeout it presents as a button that spins forever with no way back.
 */
export async function createNip46Signer(uri, options = {}) {
  const parsed = parseNip46Uri(uri);
  if (!parsed) throw new Error('That is not a bunker:// or nostrconnect:// address.');

  const clientSecret = options.clientSecret || generateSecretKey();
  const clientPubkey = getPublicKey(clientSecret);
  const pool = options.pool || new RelayPool(parsed.relays, { WebSocketImpl: options.WebSocketImpl });
  const timeoutMs = options.timeoutMs ?? NIP46_TIMEOUT_MS;
  const now = options.now || (() => Math.floor(Date.now() / 1000));

  const convoKey = await conversationKey(clientSecret, parsed.pubkey);
  /** @type {Map<string, {resolve: Function, reject: Function, timer: any}>} */
  const pending = new Map();

  const subscription = pool.subscribe(
    [{ kinds: [NIP46_KIND], '#p': [clientPubkey], since: now() - 60 }],
    {
      onEvent: async (event) => {
        if (event.pubkey !== parsed.pubkey) return;
        let payload;
        try {
          payload = JSON.parse(await decrypt(convoKey, event.content));
        } catch {
          return; // not for us, or corrupt; a bunker retries
        }
        const waiter = pending.get(payload.id);
        if (!waiter) return;
        pending.delete(payload.id);
        clearTimeout(waiter.timer);
        if (payload.error) waiter.reject(new Error(`The signer refused: ${payload.error}`));
        else waiter.resolve(payload.result);
      },
    },
  );

  async function request(method, params) {
    const id = bytesToHex(randomBytes(8));
    const body = JSON.stringify({ id, method, params });
    const draft = {
      kind: NIP46_KIND,
      created_at: now(),
      tags: [
        ['p', parsed.pubkey],
        ['expiration', String(now() + NIP46_EXPIRY_SEC)],
      ],
      content: await encrypt(convoKey, body),
    };
    const event = await finalizeEvent(draft, clientSecret);

    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The remote signer did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
    });

    const publish = await pool.publish(event);
    if (publish.accepted === 0) {
      pending.delete(id);
      throw new Error('No relay accepted the message to your signer.');
    }
    return answer;
  }

  // The bunker's answer is an ephemeral event: if our REQ is not live when it
  // arrives, it is gone for good — nothing stores kind 24133 to fetch later.
  await subscription.ready;

  /** Tear down everything this function created. */
  function teardown() {
    for (const [, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('The signer session was closed.'));
    }
    pending.clear();
    subscription.close();
    if (!options.pool) pool.close();
  }

  let userPubkey;
  try {
    if (parsed.scheme === 'bunker') {
      const result = await request('connect', [parsed.pubkey, parsed.secret || '']);
      if (parsed.secret && result !== 'ack' && result !== parsed.secret) {
        throw new Error('The signer answered the connect request with the wrong secret.');
      }
    } else if (options.awaitConnect !== false) {
      // nostrconnect: the bunker initiates. Wait for it to say hello.
      await options.waitForConnect?.();
    }

    // The remote-signer pubkey is not the user pubkey, so this call is
    // mandatory rather than an optimisation to skip.
    userPubkey = await request('get_public_key', []);
    if (!isHex32(userPubkey)) throw new Error('The signer returned something that is not a public key.');
  } catch (err) {
    // A handshake that fails must not leave a relay connection and a live
    // subscription behind. A bunker being asleep is the COMMON case, so the
    // failure path is the one that gets exercised most.
    teardown();
    throw err;
  }

  return {
    kind: 'nip46',
    pubkey: userPubkey,
    remoteSignerPubkey: parsed.pubkey,
    relays: parsed.relays,
    async signEvent(draft) {
      const unsigned = {
        kind: draft.kind,
        created_at: draft.created_at,
        tags: draft.tags,
        content: draft.content,
        pubkey: userPubkey,
      };
      const raw = await request('sign_event', [JSON.stringify(unsigned)]);
      const signed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!signed?.sig) throw new Error('The signer returned an unsigned event.');
      if (signed.pubkey !== userPubkey) throw new Error('The signer signed as a different identity.');
      if ((await eventId(signed)) !== signed.id) throw new Error('The signer returned a mismatched event id.');
      return signed;
    },
    close: teardown,
  };
}

// ── local key ──

/**
 * @param {KeyVaultSession} session an unlocked session from ./local-key.mjs
 */
export function createLocalSigner(session) {
  if (!session?.unlocked) throw new Error('The local key is locked.');
  return {
    kind: 'local',
    pubkey: session.pubkey,
    async signEvent(draft) {
      if (!session.touch()) throw new Error('Your session expired. Unlock the key again.');
      return finalizeEvent(draft, session.secretKey);
    },
    close() {
      session.lock();
    },
  };
}

/** A signer that can only read. The projector uses this and holds no key at all. */
export function createReadOnlySigner(pubkey = null) {
  return {
    kind: 'readonly',
    pubkey,
    async signEvent() {
      throw new Error('This screen is read-only and has no signing key.');
    },
    close() {},
  };
}

export const __testing = { hexToBytes, decodeNip19 };
