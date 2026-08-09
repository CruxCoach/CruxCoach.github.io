import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_FIELDS, MAX_CONTENT_BYTES, buildProfileEvent, competitionDisplayName,
  parseProfileEvent, selectNewestProfile, validateProfileFields, PROFILE_KIND,
} from '../competitions/app/protocol/profile.mjs';
import { GateState, fetchProfile, publishProfile } from '../competitions/app/ui/profile-gate.mjs';
import { RelayPool } from '../competitions/app/protocol/relay-pool.mjs';
import { startDevRelay } from './dev/relay.mjs';
import {
  finalizeEvent, generateSecretKey, getPublicKey, verifyEvent,
} from '../competitions/app/protocol/nostr-event.mjs';
import { KeyVaultSession } from '../competitions/app/signer/local-key.mjs';
import {
  createLocalSigner, createNip07Signer, createNip46Signer, NIP46_KIND,
} from '../competitions/app/signer/signers.mjs';
import { conversationKey, decrypt, encrypt } from '../competitions/app/signer/nip44.mjs';

/**
 * The mandatory kind-0 gate.
 *
 * Signing in proves you hold a key; it does not give you a name. A competition
 * is public and has named people in it, so no create, register or check-in is
 * offered until a kind-0 profile exists that a relay actually accepted.
 *
 * These tests run all three signer paths against a real loopback relay, because
 * the property that matters — "a relay will hand this profile back" — cannot be
 * checked with a local flag.
 */

const AT = 1789000000;

function localSigner() {
  const session = new KeyVaultSession({ storage: null });
  session.generate();
  return createLocalSigner(session);
}

// ── field validation ──

test('a profile needs a readable name and nothing else', () => {
  assert.equal(validateProfileFields({ name: 'Ines' }).ok, true);
  assert.equal(validateProfileFields({}).ok, false);
  assert.equal(validateProfileFields({ name: '   ' }).ok, false);
  // A name of invisible characters is what someone reaches for to appear on a
  // public screen as nothing.
  assert.equal(validateProfileFields({ name: '\u200b\u200b' }).ok, false);
  assert.equal(validateProfileFields({ name: 'x'.repeat(49) }).ok, false);
});

test('validation names the field that is wrong', () => {
  const cases = [
    [{ name: '' }, 'name'],
    [{ name: 'Ines', picture: 'http://insecure.example/p.png' }, 'picture'],
    [{ name: 'Ines', website: 'not-a-url' }, 'website'],
    [{ name: 'Ines', lud16: 'not-an-address' }, 'lud16'],
    [{ name: 'Ines', nip05: 'nope' }, 'nip05'],
    [{ name: 'Ines', about: 'x'.repeat(501) }, 'about'],
    [{ name: 'In\u0000es' }, 'name'],
  ];
  for (const [fields, field] of cases) {
    const result = validateProfileFields(fields);
    assert.equal(result.ok, false, JSON.stringify(fields));
    assert.ok(result.errors.some((e) => e.field === field),
      `${JSON.stringify(fields)} should name ${field}, got ${JSON.stringify(result.errors)}`);
  }
});

test('an about field may contain newlines but not other control characters', () => {
  assert.equal(validateProfileFields({ name: 'Ines', about: 'line one\nline two' }).ok, true);
  assert.equal(validateProfileFields({ name: 'Ines', about: 'bad\u0007bell' }).ok, false);
});

// ── event shape ──

test('building a profile preserves fields this form has no box for', () => {
  // Signing in to a competition must never quietly delete someone's NIP-05 or
  // their banner because our form is shorter than their profile.
  const existing = { name: 'Old', nip05: 'ines@example.com', banner: 'https://x.invalid/b.png', custom: 'keep me' };
  const draft = buildProfileEvent({ name: 'Ines' }, AT, existing);
  const content = JSON.parse(draft.content);
  assert.equal(content.name, 'Ines');
  assert.equal(content.nip05, 'ines@example.com');
  assert.equal(content.banner, 'https://x.invalid/b.png');
  assert.equal(content.custom, 'keep me');
  assert.equal(draft.kind, PROFILE_KIND);
  assert.deepEqual(draft.tags, []);
});

test('clearing a field removes it rather than storing an empty string', () => {
  const draft = buildProfileEvent({ name: 'Ines', about: '' }, AT, { about: 'gone' });
  assert.equal('about' in JSON.parse(draft.content), false);
});

test('an invalid profile refuses to build', () => {
  assert.throws(() => buildProfileEvent({ name: '' }, AT), /invalid profile/);
});

test('parsing is total against relay-controlled input', () => {
  const base = { kind: PROFILE_KIND, pubkey: 'a'.repeat(64), created_at: AT, id: 'b'.repeat(64) };
  assert.equal(parseProfileEvent(null).ok, false);
  assert.equal(parseProfileEvent({ ...base, kind: 1, content: '{}' }).error, 'wrong_kind');
  assert.equal(parseProfileEvent({ ...base, content: 'not json' }).error, 'invalid_json');
  assert.equal(parseProfileEvent({ ...base, content: '[]' }).error, 'invalid_json');
  assert.equal(parseProfileEvent({ ...base, content: '"a string"' }).error, 'invalid_json');
  assert.equal(parseProfileEvent({ ...base, content: 'x'.repeat(MAX_CONTENT_BYTES + 1) }).error, 'too_large');
  // Numbers where strings belong are ignored rather than rendered as "[object]".
  const odd = parseProfileEvent({ ...base, content: JSON.stringify({ name: 42, about: 'ok' }) });
  assert.equal(odd.ok, true);
  assert.equal(odd.profile.fields.name, undefined);
  assert.equal(odd.profile.complete, false);
});

test('display_name wins over name, and contact details never leak into it', () => {
  const profile = parseProfileEvent({
    kind: PROFILE_KIND, pubkey: 'a'.repeat(64), created_at: AT, id: 'b'.repeat(64),
    content: JSON.stringify({ name: 'ines', display_name: 'Ines K', nip05: 'ines@example.com', lud16: 'ines@pay.example' }),
  }).profile;
  assert.equal(competitionDisplayName(profile), 'Ines K');
  assert.equal(competitionDisplayName(profile).includes('@'), false);
  assert.equal(competitionDisplayName({ fields: {} }, 'f'.repeat(64)), 'ffffffff…');
});

// ── choosing between relays ──

async function signedProfile(secret, fields, createdAt) {
  return finalizeEvent(buildProfileEvent(fields, createdAt), secret);
}

test('the newest verified profile wins, never the first answer', async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const older = await signedProfile(secret, { name: 'Old' }, AT);
  const newer = await signedProfile(secret, { name: 'New' }, AT + 10);
  // Deliberately in "stale relay answered first" order.
  const selected = await selectNewestProfile([older, newer], pubkey);
  assert.equal(selected.profile.name, 'New');
  assert.equal(selected.stale, true);
});

test('an unsigned or tampered profile is ignored entirely', async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const good = await signedProfile(secret, { name: 'Ines' }, AT);
  const tampered = { ...good, content: JSON.stringify({ name: 'Someone else' }) };
  assert.equal(await verifyEvent(tampered), false);
  const selected = await selectNewestProfile([tampered], pubkey);
  assert.equal(selected.found, false);
  // And a valid profile belonging to someone else is not ours.
  const other = await signedProfile(generateSecretKey(), { name: 'Other' }, AT + 100);
  assert.equal((await selectNewestProfile([other], pubkey)).found, false);
});

test('two different profiles at the same second are reported as conflicting', async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const a = await signedProfile(secret, { name: 'A' }, AT);
  const b = await signedProfile(secret, { name: 'B' }, AT);
  const selected = await selectNewestProfile([a, b], pubkey);
  assert.equal(selected.conflicting, true);
  // Still deterministic: both clients take the same one.
  const reversed = await selectNewestProfile([b, a], pubkey);
  assert.equal(selected.profile.eventId, reversed.profile.eventId);
});

// ── the gate, against a real relay ──

test('a new identity is told to make a profile, not waved through', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    const result = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(result.state, GateState.NEEDS_PROFILE);
    assert.equal(result.profile, undefined);
  } finally {
    pool.close();
    await relay.close();
  }
});

test('a returning identity with a profile passes straight through', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    await publishProfile(pool, signer, { name: 'Ines' }, {}, AT);
    const result = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(result.state, GateState.READY);
    assert.equal(result.profile.name, 'Ines');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('a profile with no name does not satisfy the gate', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    // Published directly: `buildProfileEvent` would refuse this, but somebody
    // else's client may well have written it.
    const event = await signer.signEvent({
      kind: PROFILE_KIND, created_at: AT, tags: [], content: JSON.stringify({ about: 'no name here' }),
    });
    await pool.publish(event);
    const result = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(result.state, GateState.NEEDS_PROFILE);
    // The existing fields come back so the form can pre-fill rather than wipe.
    assert.equal(result.profile.fields.about, 'no name here');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('a profile whose JSON is broken is reported as broken, not as absent', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    const event = await signer.signEvent({
      kind: PROFILE_KIND, created_at: AT, tags: [], content: '{not json',
    });
    await pool.publish(event);
    const result = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(result.state, GateState.NEEDS_PROFILE);
    assert.equal(result.invalid, 'invalid_json');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('an unreachable relay is not mistaken for "you have no profile"', async () => {
  // The distinction matters: treating a timeout as "no profile" invites
  // somebody to overwrite a profile they already have.
  const pool = new RelayPool(['ws://127.0.0.1:1']);
  try {
    const result = await fetchProfile(pool, 'a'.repeat(64), { timeoutMs: 300 });
    assert.equal(result.state, GateState.UNREACHABLE);
  } finally {
    pool.close();
  }
});

test('publishing a profile no relay accepts is a failure, not a warning', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  const signer = localSigner();
  await relay.close();
  try {
    await assert.rejects(() => publishProfile(pool, signer, { name: 'Ines' }, {}, AT));
  } finally {
    pool.close();
  }
});

// ── every signer path reaches the same gate ──

test('the NIP-07 path publishes a profile that satisfies the gate', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const secret = generateSecretKey();
    const extension = {
      nostr: {
        getPublicKey: async () => getPublicKey(secret),
        signEvent: async (draft) => finalizeEvent(draft, secret),
      },
    };
    const signer = await createNip07Signer(extension);
    assert.equal((await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 })).state, GateState.NEEDS_PROFILE);
    await publishProfile(pool, signer, { name: 'Extension user' }, {}, AT);
    const after = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(after.state, GateState.READY);
    assert.equal(after.profile.name, 'Extension user');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('the NIP-46 path publishes a profile that satisfies the gate', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const userSecret = generateSecretKey();
  const signerSecret = generateSecretKey();
  const signerPubkey = getPublicKey(signerSecret);
  const bunkerPool = new RelayPool([relay.url]);
  const pool = new RelayPool([relay.url]);

  const subscription = bunkerPool.subscribe([{ kinds: [NIP46_KIND], '#p': [signerPubkey] }], {
    onEvent: async (event) => {
      const convo = await conversationKey(signerSecret, event.pubkey);
      let request;
      try { request = JSON.parse(await decrypt(convo, event.content)); } catch { return; }
      let result;
      if (request.method === 'connect') result = 'ack';
      else if (request.method === 'get_public_key') result = getPublicKey(userSecret);
      else if (request.method === 'sign_event') {
        result = JSON.stringify(await finalizeEvent(JSON.parse(request.params[0]), userSecret));
      } else return;
      await bunkerPool.publish(await finalizeEvent({
        kind: NIP46_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', event.pubkey]],
        content: await encrypt(convo, JSON.stringify({ id: request.id, result })),
      }, signerSecret));
    },
  });
  await subscription.ready;

  try {
    const signer = await createNip46Signer(
      `bunker://${signerPubkey}?relay=${relay.url}&secret=hello`,
      { timeoutMs: 8000 },
    );
    assert.equal(signer.pubkey, getPublicKey(userSecret));
    await publishProfile(pool, signer, { name: 'Bunker user' }, {}, AT);
    const after = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(after.state, GateState.READY);
    assert.equal(after.profile.name, 'Bunker user');
    signer.close();
  } finally {
    subscription.close();
    bunkerPool.close();
    pool.close();
    await relay.close();
  }
});

test('the local-key path publishes a profile that satisfies the gate', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    await publishProfile(pool, signer, { name: 'Local user', about: 'hello' }, {}, AT);
    const after = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(after.state, GateState.READY);
    assert.equal(after.profile.fields.about, 'hello');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('editing a profile keeps the fields the form does not show', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  const pool = new RelayPool([relay.url]);
  try {
    const signer = localSigner();
    await publishProfile(pool, signer, { name: 'Ines' }, { nip05: 'ines@example.com' }, AT);
    const first = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    await publishProfile(pool, signer, { name: 'Ines K' }, first.profile.raw, AT + 60);
    const second = await fetchProfile(pool, signer.pubkey, { timeoutMs: 3000 });
    assert.equal(second.profile.name, 'Ines K');
    assert.equal(second.profile.fields.nip05, 'ines@example.com');
  } finally {
    pool.close();
    await relay.close();
  }
});

test('the known field list covers what a competition reads', () => {
  for (const field of ['name', 'display_name', 'about', 'picture', 'lud16', 'nip05']) {
    assert.ok(KNOWN_FIELDS.includes(field), field);
  }
});
