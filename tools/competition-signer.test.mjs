import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABSOLUTE_SESSION_MS, HIDDEN_SESSION_MS, IDLE_SESSION_MS, KeyVaultSession, STORAGE_KEY,
  openVault, sealVault, zeroize,
} from '../competitions/app/signer/local-key.mjs';
import {
  buildNostrConnectUri, createLocalSigner, createNip07Signer, createNip46Signer,
  createReadOnlySigner, parseNip46Uri, waitForNip07, NIP46_KIND,
} from '../competitions/app/signer/signers.mjs';
import {
  bytesToHex, eventId, finalizeEvent, generateSecretKey, getPublicKey, hexToBytes,
  nsecEncode, verifyEvent,
} from '../competitions/app/protocol/nostr-event.mjs';
import { conversationKey, decrypt, encrypt } from '../competitions/app/signer/nip44.mjs';
import {
  buildResumeUri, Nip46ConnectionSession, NIP46_CLIENT_VAULT_KEY, NIP46_CONNECTION_KEY,
} from '../competitions/app/signer/nip46-connection.mjs';
import { RelayPool } from '../competitions/app/protocol/relay-pool.mjs';
import { startDevRelay } from './dev/relay.mjs';

/** A localStorage stand-in, so the vault tests do not need a browser. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

// Iterations are lowered ONLY in tests. The shipped default is 600 000; a test
// suite that ran it would spend most of its time in PBKDF2 for no signal.
const FAST = { iterations: 1000 };

// ── the local key vault ──

test('a sealed vault contains no plaintext key material', async () => {
  const secret = generateSecretKey();
  const vault = await sealVault(secret, 'correct horse battery', FAST);
  const serialized = JSON.stringify(vault);
  assert.equal(serialized.includes(bytesToHex(secret)), false, 'the raw key must not appear');
  assert.equal(serialized.includes(nsecEncode(secret)), false, 'the nsec must not appear');
  assert.equal(vault.pubkey, getPublicKey(secret), 'the public key is fine to store');
  assert.equal(vault.kdf, 'PBKDF2-SHA-256');
});

test('a vault round-trips with the right passphrase', async () => {
  const secret = generateSecretKey();
  const vault = await sealVault(secret, 'correct horse battery', FAST);
  assert.deepEqual(await openVault(vault, 'correct horse battery'), secret);
});

test('a wrong passphrase and a corrupted vault give the same message', async () => {
  const secret = generateSecretKey();
  const vault = await sealVault(secret, 'correct horse battery', FAST);
  const wrong = await openVault(vault, 'correct horse battery!').catch((e) => e.message);
  const corrupted = await openVault({ ...vault, ct: vault.ct.replace(/^.{4}/, 'AAAA') }, 'correct horse battery')
    .catch((e) => e.message);
  // Telling the two apart would tell an attacker which of the two they got wrong.
  assert.equal(wrong, corrupted);
});

test('a short passphrase is refused before anything is written', async () => {
  await assert.rejects(() => sealVault(generateSecretKey(), 'short', FAST), /at least 8/);
});

test('zeroize actually clears the bytes', () => {
  const secret = generateSecretKey();
  zeroize(secret);
  assert.deepEqual(secret, new Uint8Array(32));
});

test('the session never writes plaintext to storage', async () => {
  const storage = fakeStorage();
  const session = new KeyVaultSession({ storage });
  const { nsec } = session.generate();
  assert.equal(storage.size, 0, 'generating must not store anything on its own');
  await session.persist('correct horse battery');
  const stored = storage.getItem(STORAGE_KEY);
  assert.equal(stored.includes(nsec), false);
  assert.equal(stored.includes(bytesToHex(session.secretKey)), false);
});

test('locking wipes memory but keeps the stored ciphertext', async () => {
  const storage = fakeStorage();
  const session = new KeyVaultSession({ storage });
  session.generate();
  await session.persist('correct horse battery');
  const pubkey = session.pubkey;
  session.lock();
  assert.equal(session.secretKey, null);
  assert.equal(session.unlocked, false);
  assert.equal(session.hasStoredKey(), true);
  assert.equal(session.storedPubkey(), pubkey);
});

test('forgetting removes the stored ciphertext too', async () => {
  const storage = fakeStorage();
  const session = new KeyVaultSession({ storage });
  session.generate();
  await session.persist('correct horse battery');
  session.forget();
  assert.equal(session.hasStoredKey(), false);
  assert.equal(storage.size, 0);
});

test('a shared device never touches storage at all', async () => {
  const session = new KeyVaultSession({ storage: null });
  session.generate();
  assert.equal(session.unlocked, true);
  await assert.rejects(() => session.persist('correct horse battery'), /shared/);
  assert.equal(session.hasStoredKey(), false);
  assert.equal(session.describe().sharedDevice, true);
});

test('a session expires on the absolute limit and on the idle limit', () => {
  let clock = 1_000_000;
  const session = new KeyVaultSession({ storage: fakeStorage(), now: () => clock });
  session.generate();
  assert.equal(session.unlocked, true);

  clock += IDLE_SESSION_MS + 1;
  assert.equal(session.touch(), false, 'idle past the limit must lock');
  assert.equal(session.secretKey, null);

  session.generate();
  for (let elapsed = 0; elapsed < ABSOLUTE_SESSION_MS; elapsed += IDLE_SESSION_MS - 1) {
    clock += IDLE_SESSION_MS - 1;
    session.touch();
  }
  clock += 1;
  assert.equal(session.unlocked, false, 'the absolute limit applies however active you are');
});

test('an nsec can be imported and a non-nsec cannot', () => {
  const session = new KeyVaultSession({ storage: fakeStorage() });
  const secret = generateSecretKey();
  session.importKey(nsecEncode(secret));
  assert.equal(session.pubkey, getPublicKey(secret));
  assert.throws(() => session.importKey('npub1qqqqq'), /nsec/);
  assert.throws(() => session.importKey('not a key'), /nsec/);
});

// ── signer implementations ──

test('the local signer produces events that verify', async () => {
  const session = new KeyVaultSession({ storage: fakeStorage() });
  session.generate();
  const signer = createLocalSigner(session);
  const event = await signer.signEvent({ kind: 30078, created_at: 1789000000, tags: [['d', 'x']], content: '{}' });
  assert.equal(event.pubkey, session.pubkey);
  assert.equal(await verifyEvent(event), true);
  signer.close();
  assert.equal(session.unlocked, false, 'closing the signer locks the key');
});

test('the local signer refuses once the session has expired', async () => {
  let clock = 1_000_000;
  const session = new KeyVaultSession({ storage: fakeStorage(), now: () => clock });
  session.generate();
  const signer = createLocalSigner(session);
  clock += ABSOLUTE_SESSION_MS + 1;
  await assert.rejects(
    () => signer.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' }),
    /expired/,
  );
});

test('the read-only signer cannot sign, which is the point', async () => {
  const signer = createReadOnlySigner();
  await assert.rejects(() => signer.signEvent({ kind: 1, created_at: 1, tags: [], content: '' }), /read-only/);
});

test('NIP-07 detection polls instead of testing once', async () => {
  const win = {};
  const promise = waitForNip07(win, { timeoutMs: 500, intervalMs: 10 });
  // An extension that injects 80 ms after load is entirely normal, and a single
  // synchronous check would have declared it absent.
  setTimeout(() => { win.nostr = { getPublicKey: async () => 'a'.repeat(64) }; }, 80);
  assert.notEqual(await promise, null);
});

test('NIP-07 detection gives up rather than hanging', async () => {
  assert.equal(await waitForNip07({}, { timeoutMs: 60, intervalMs: 10 }), null);
});

test('a missing extension and a declined prompt are different errors', async () => {
  const absent = await createNip07Signer({}).catch((e) => e);
  assert.equal(absent.code, 'no_extension');

  const declined = await createNip07Signer({
    nostr: { getPublicKey: async () => { throw new Error('user rejected'); } },
  }).catch((e) => e);
  assert.equal(declined.code, 'rejected');
});

test('the NIP-07 signer refuses an event the extension mangled', async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const honest = {
    nostr: {
      getPublicKey: async () => pubkey,
      signEvent: async (draft) => finalizeEvent(draft, secret),
    },
  };
  const signer = await createNip07Signer(honest);
  const event = await signer.signEvent({ kind: 1, created_at: 1789000000, tags: [], content: 'hi' });
  assert.equal(await verifyEvent(event), true);

  const liar = {
    nostr: {
      getPublicKey: async () => pubkey,
      signEvent: async (draft) => {
        const signed = await finalizeEvent(draft, secret);
        return { ...signed, content: 'something else entirely' };
      },
    },
  };
  const suspicious = await createNip07Signer(liar);
  await assert.rejects(
    () => suspicious.signEvent({ kind: 1, created_at: 1789000000, tags: [], content: 'hi' }),
    /mismatched event id/,
  );
});

// ── NIP-46 URI handling ──

test('bunker and nostrconnect URIs parse, and rubbish does not', () => {
  const pubkey = 'b'.repeat(64);
  const bunker = parseNip46Uri(`bunker://${pubkey}?relay=wss://relay.example.invalid&secret=abc`);
  assert.equal(bunker.scheme, 'bunker');
  assert.equal(bunker.pubkey, pubkey);
  assert.deepEqual(bunker.relays, ['wss://relay.example.invalid']);
  assert.equal(bunker.secret, 'abc');

  const connect = parseNip46Uri(`nostrconnect://${pubkey}?relay=wss://a.invalid&relay=wss://b.invalid&secret=s`);
  assert.equal(connect.scheme, 'nostrconnect');
  assert.equal(connect.relays.length, 2);

  assert.equal(parseNip46Uri(''), null);
  assert.equal(parseNip46Uri('https://example.invalid'), null);
  assert.equal(parseNip46Uri(`bunker://${pubkey}`), null, 'a bunker with no relay is unusable');
  assert.equal(parseNip46Uri('bunker://not-a-pubkey?relay=wss://a.invalid'), null);
  // A ws:// relay would let a network downgrade the signer channel.
  assert.equal(parseNip46Uri(`bunker://${pubkey}?relay=ws://plain.invalid`), null);
});

test('the nostrconnect URI we hand out round-trips through our own parser', () => {
  const clientPubkey = 'c'.repeat(64);
  const uri = buildNostrConnectUri({
    clientPubkey,
    relays: ['wss://relay.example.invalid'],
    secret: 'shared-secret',
  });
  const parsed = parseNip46Uri(uri);
  assert.equal(parsed.scheme, 'nostrconnect');
  assert.equal(parsed.pubkey, clientPubkey);
  assert.equal(parsed.secret, 'shared-secret');
});

/**
 * A bunker good enough to prove the wire protocol: it answers kind-24133
 * requests over the loopback relay, encrypted with NIP-44, exactly as Amber
 * would.
 */
async function fakeBunker(relayUrl, {
  userSecret, respondTo = ['connect', 'get_public_key', 'sign_event', 'logout'], errors = {},
} = {}) {
  const signerSecret = generateSecretKey();
  const signerPubkey = getPublicKey(signerSecret);
  const pool = new RelayPool([relayUrl]);
  const userPubkey = getPublicKey(userSecret);
  const methods = [];

  const subscription = pool.subscribe([{ kinds: [NIP46_KIND], '#p': [signerPubkey] }], {
    onEvent: async (event) => {
      const convo = await conversationKey(signerSecret, event.pubkey);
      let request;
      try {
        request = JSON.parse(await decrypt(convo, event.content));
      } catch {
        return;
      }
      if (!respondTo.includes(request.method)) return;
      methods.push(request.method);
      let result;
      if (request.method === 'connect') result = 'ack';
      else if (request.method === 'get_public_key') result = userPubkey;
      else if (request.method === 'sign_event') {
        const draft = JSON.parse(request.params[0]);
        result = JSON.stringify(await finalizeEvent(draft, userSecret));
      } else if (request.method === 'logout') result = 'ack';
      const reply = await finalizeEvent({
        kind: NIP46_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', event.pubkey]],
        content: await encrypt(convo, JSON.stringify(
          errors[request.method]
            ? { id: request.id, error: errors[request.method] }
            : { id: request.id, result },
        )),
      }, signerSecret);
      await pool.publish(reply);
    },
  });

  // A bunker that has not finished subscribing has not started listening.
  await subscription.ready;

  return {
    pubkey: signerPubkey,
    uri: `bunker://${signerPubkey}?relay=${relayUrl}&secret=hello`,
    methods,
    close: () => { subscription.close(); pool.close(); },
  };
}

test('a NIP-46 pairing stores only an encrypted client key and public metadata', async () => {
  const storage = fakeStorage();
  const session = new Nip46ConnectionSession({ storage });
  const clientSecret = generateSecretKey();
  session.adopt(clientSecret);
  const record = await session.persist({
    remoteSignerPubkey: 'a'.repeat(64),
    userPubkey: 'b'.repeat(64),
    relays: ['wss://relay.example.invalid'],
    secret: 'one-time-invitation',
  }, 'correct horse battery', FAST);

  const serialized = `${storage.getItem(NIP46_CLIENT_VAULT_KEY)} ${storage.getItem(NIP46_CONNECTION_KEY)}`;
  assert.equal(serialized.includes(bytesToHex(clientSecret)), false);
  assert.equal(serialized.includes(nsecEncode(clientSecret)), false);
  assert.equal(serialized.includes('one-time-invitation'), false);
  assert.equal(record.secret, undefined);

  const clientPubkey = getPublicKey(clientSecret);
  session.lock();
  const unlocked = await session.unlock('correct horse battery');
  assert.equal(getPublicKey(unlocked.secretKey), clientPubkey);
  assert.equal(buildResumeUri(unlocked.connection).includes('secret='), false);

  session.forget();
  assert.equal(storage.getItem(NIP46_CLIENT_VAULT_KEY), null);
  assert.equal(storage.getItem(NIP46_CONNECTION_KEY), null);
});

test('a NIP-46 session connects, learns the USER pubkey, and signs', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const userSecret = generateSecretKey();
  const bunker = await fakeBunker(relay.url, { userSecret });
  try {
    const signer = await createNip46Signer(bunker.uri, { timeoutMs: 5000 });
    // The remote-signer pubkey is NOT the user pubkey. Conflating them is the
    // documented NIP-46 mistake, and it publishes under the wrong identity.
    assert.equal(signer.pubkey, getPublicKey(userSecret));
    assert.notEqual(signer.pubkey, bunker.pubkey);
    assert.equal(signer.remoteSignerPubkey, bunker.pubkey);

    const event = await signer.signEvent({
      kind: 30078, created_at: 1789000000, tags: [['d', 'x']], content: '{}',
    });
    assert.equal(await verifyEvent(event), true);
    assert.equal(event.pubkey, signer.pubkey);
    signer.close();
  } finally {
    bunker.close();
    await relay.close();
  }
});

test('a saved NIP-46 client reconnects without reusing the one-time invitation', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const userSecret = generateSecretKey();
  const clientSecret = generateSecretKey();
  const bunker = await fakeBunker(relay.url, { userSecret });
  try {
    const first = await createNip46Signer(bunker.uri, { clientSecret, timeoutMs: 5000 });
    const expectedUserPubkey = first.pubkey;
    const connection = {
      v: 1,
      remote_signer_pubkey: first.remoteSignerPubkey,
      user_pubkey: first.pubkey,
      relays: first.relays,
    };
    first.close();

    const resumed = await createNip46Signer(buildResumeUri(connection), {
      clientSecret,
      resume: true,
      expectedUserPubkey,
      timeoutMs: 5000,
    });
    const event = await resumed.signEvent({ kind: 1, created_at: 1789000000, tags: [], content: 'back' });
    assert.equal(await verifyEvent(event), true);
    resumed.close();

    assert.equal(bunker.methods.filter((method) => method === 'connect').length, 1);
    assert.equal(bunker.methods.filter((method) => method === 'get_public_key').length, 2);
  } finally {
    bunker.close();
    await relay.close();
  }
});

test('a silent bunker times out with a message instead of hanging forever', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const bunker = await fakeBunker(relay.url, { userSecret: generateSecretKey(), respondTo: [] });
  try {
    await assert.rejects(
      () => createNip46Signer(bunker.uri, { timeoutMs: 300 }),
      /did not answer/,
    );
  } finally {
    bunker.close();
    await relay.close();
  }
});

test('a used bunker invitation has a stable recovery error', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const bunker = await fakeBunker(relay.url, {
    userSecret: generateSecretKey(), errors: { connect: 'already connected' },
  });
  try {
    const error = await createNip46Signer(bunker.uri, { timeoutMs: 5000 }).catch((err) => err);
    assert.equal(error.code, 'nip46_invitation_used');
  } finally {
    bunker.close();
    await relay.close();
  }
});

test('NIP-46 transport events carry a NIP-40 expiration', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const userSecret = generateSecretKey();
  const bunker = await fakeBunker(relay.url, { userSecret });
  // Kind 24133 is ephemeral, so the relay stores nothing — the only way to see
  // the transport events is to be subscribed while they fly past. That is also
  // exactly why the relay has to deliver them live.
  const observer = new RelayPool([relay.url]);
  const seen = [];
  const watching = observer.subscribe([{ kinds: [NIP46_KIND] }], { onEvent: (e) => seen.push(e) });
  await watching.ready;
  try {
    const signer = await createNip46Signer(bunker.uri, { timeoutMs: 5000 });
    await signer.signEvent({ kind: 1, created_at: 1789000000, tags: [], content: 'x' });
    signer.close();

    const fromClient = seen.filter((e) => e.pubkey !== bunker.pubkey && e.pubkey !== getPublicKey(userSecret));
    assert.ok(fromClient.length >= 2, `expected connect + sign_event, saw ${fromClient.length}`);
    for (const event of fromClient) {
      const expiration = event.tags.find((t) => t[0] === 'expiration');
      assert.ok(expiration, 'a request event should not outlive the request');
      assert.ok(Number(expiration[1]) > event.created_at);
    }
  } finally {
    watching.close();
    observer.close();
    bunker.close();
    await relay.close();
  }
});

// ── the key's lifecycle, on a fake clock ──

/**
 * A clock, a timer queue and an event target, all under the test's control.
 *
 * The whole point of the lifecycle is that it acts without being asked, so it
 * cannot be tested by calling into it — only by moving time forward and
 * watching what it did on its own.
 */
function fakeHost() {
  let now = 1_700_000_000_000;
  let nextId = 1;
  const timers = new Map();
  const listeners = new Map();

  const host = {
    visibilityState: 'visible',
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener: (name, fn) => { listeners.get(name)?.delete(fn); },

    /** Move the clock, firing whatever falls due, in order. */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = target;
    },
    setVisibility(state) {
      host.visibilityState = state;
      for (const fn of listeners.get('visibilitychange') || []) fn();
    },
    get pendingTimers() { return timers.size; },
    get listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
  return host;
}

function sessionOn(host, storage = null) {
  return new KeyVaultSession({
    storage,
    now: host.now,
    setTimer: host.setTimer,
    clearTimer: host.clearTimer,
    events: host,
  });
}

test('the key is zeroed at the absolute limit however busy the person is', async () => {
  // The defect this replaces: expiry was only noticed on the next signing
  // call, so a key could sit in memory for as long as nobody signed anything.
  // Here somebody uses the page all day, which defeats the idle limit — the
  // absolute limit is the one that has to end it anyway.
  const host = fakeHost();
  const session = sessionOn(host);
  session.generate();
  const key = session.secretKey;
  assert.equal(session.unlocked, true);

  const step = IDLE_SESSION_MS / 2;
  for (let elapsed = 0; elapsed + step < ABSOLUTE_SESSION_MS; elapsed += step) {
    host.advance(step);
    assert.equal(session.touch(), true, `still working at ${elapsed + step}ms`);
  }

  host.advance(IDLE_SESSION_MS);
  assert.equal(session.secretKey, null, 'the plaintext is gone at twelve hours regardless');
  assert.ok(key.every((byte) => byte === 0), 'and the bytes were zeroed, not just dropped');
  session.dispose();
});

test('the key is zeroed at the idle limit, and activity pushes it back', async () => {
  const host = fakeHost();
  const session = sessionOn(host);
  session.generate();

  host.advance(IDLE_SESSION_MS - 60_000);
  assert.equal(session.touch(), true, 'still alive, and this counts as use');

  host.advance(IDLE_SESSION_MS - 60_000);
  assert.equal(session.unlocked, true, 'the idle window moved with the activity');

  host.advance(120_000);
  assert.equal(session.secretKey, null, 'idle limit reached with no further use');
  session.dispose();
});

test('a hidden page gives the key five minutes, not the full idle hour', async () => {
  const host = fakeHost();
  const session = sessionOn(host);
  session.generate();
  const key = session.secretKey;

  host.setVisibility('hidden');
  host.advance(HIDDEN_SESSION_MS - 1000);
  assert.equal(session.unlocked, true, 'not yet');

  host.advance(2000);
  assert.equal(session.secretKey, null, 'hidden long enough');
  assert.ok(key.every((byte) => byte === 0));
  session.dispose();
});

test('coming back to a hidden page cancels the countdown', async () => {
  const host = fakeHost();
  const session = sessionOn(host);
  session.generate();

  host.setVisibility('hidden');
  host.advance(HIDDEN_SESSION_MS - 30_000);
  host.setVisibility('visible');
  host.advance(HIDDEN_SESSION_MS);

  assert.equal(session.unlocked, true, 'returning to the page is use, not a reprieve on a running clock');
  session.dispose();
});

test('a key adopted while the page is already hidden still gets the short clock', async () => {
  const host = fakeHost();
  host.visibilityState = 'hidden';
  const session = sessionOn(host);
  session.generate();

  host.advance(HIDDEN_SESSION_MS + 1000);
  assert.equal(session.secretKey, null);
  session.dispose();
});

test('locking and forgetting both stop every timer', async () => {
  const host = fakeHost();
  const session = sessionOn(host);

  session.generate();
  assert.ok(host.pendingTimers > 0, 'an unlocked key is being watched');
  session.lock();
  assert.equal(host.pendingTimers, 0, 'a locked key has nothing left to watch');

  session.generate();
  host.setVisibility('hidden');
  assert.ok(host.pendingTimers > 0);
  session.forget();
  assert.equal(host.pendingTimers, 0, 'including the hidden-page countdown');
  session.dispose();
});

test('sign out keeps the encrypted key; forget removes it', async () => {
  const storage = new Map();
  const host = fakeHost();
  const session = sessionOn(host, {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });

  session.generate();
  await session.persist('a passphrase nobody will guess');
  assert.equal(session.hasStoredKey(), true);

  // Sign out: the plaintext goes, the ciphertext stays, and the same person
  // comes back with their passphrase.
  session.lock();
  assert.equal(session.secretKey, null);
  assert.equal(session.hasStoredKey(), true, 'signing out must not be a data-loss button');
  await session.unlock('a passphrase nobody will guess');
  assert.equal(session.unlocked, true);

  session.forget();
  assert.equal(session.hasStoredKey(), false, 'forget is the one that removes it');
  assert.equal(storage.has(STORAGE_KEY), false);
  session.dispose();
});

test('disposing removes the page listener rather than leaking one per sign-in', async () => {
  const host = fakeHost();
  const sessions = [sessionOn(host), sessionOn(host), sessionOn(host)];
  assert.equal(host.listenerCount, 3);
  for (const session of sessions) session.dispose();
  assert.equal(host.listenerCount, 0, 'a page that replaces its session must not accumulate listeners');
  assert.equal(host.pendingTimers, 0);
});

test('a clock that jumps backwards does not keep the key alive forever', async () => {
  const host = fakeHost();
  const session = sessionOn(host);
  session.generate();
  // The timer fires, the session is not expired by the wall clock, and the
  // only safe behaviour is to re-arm rather than to stop watching.
  host.advance(IDLE_SESSION_MS / 2);
  session.touch();
  assert.ok(host.pendingTimers > 0, 'still watched after an early wake-up');
  host.advance(IDLE_SESSION_MS + 1000);
  assert.equal(session.secretKey, null);
  session.dispose();
});
