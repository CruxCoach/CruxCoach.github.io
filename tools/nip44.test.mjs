import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { conversationKey, decrypt, encrypt, paddedLength } from '../competitions/app/signer/nip44.mjs';
import { bytesToHex, hexToBytes, getPublicKey } from '../competitions/app/protocol/nostr-event.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  fs.readFileSync(path.resolve(here, '../assets/vendor/nostr-crypto/nip44-test-vectors.json'), 'utf8'),
).v2;

/**
 * The official NIP-44 vectors, run against the shipped implementation.
 *
 * NIP-46 rides on this, so a mistake here does not present as "encryption is
 * broken" — it presents as "bunker sign-in hangs", which is much harder to
 * trace back.
 */

test('conversation keys match every published vector', async () => {
  const cases = vectors.valid.get_conversation_key;
  assert.ok(cases.length >= 30, 'the vector file looks truncated');
  for (const vector of cases) {
    const key = await conversationKey(hexToBytes(vector.sec1), vector.pub2);
    assert.equal(bytesToHex(key), vector.conversation_key, vector.note || '');
  }
});

test('the conversation key is the same in both directions', async () => {
  const sec1 = hexToBytes('00'.repeat(31) + '01');
  const sec2 = hexToBytes('00'.repeat(31) + '02');
  const a = await conversationKey(sec1, getPublicKey(sec2));
  const b = await conversationKey(sec2, getPublicKey(sec1));
  assert.equal(bytesToHex(a), bytesToHex(b));
});

test('padding matches every published vector', () => {
  for (const [unpadded, padded] of vectors.valid.calc_padded_len) {
    assert.equal(paddedLength(unpadded), padded, `${unpadded} bytes`);
  }
});

test('encrypt reproduces the published payload byte for byte', async () => {
  for (const vector of vectors.valid.encrypt_decrypt) {
    const key = await conversationKey(hexToBytes(vector.sec1), getPublicKey(hexToBytes(vector.sec2)));
    assert.equal(bytesToHex(key), vector.conversation_key, 'conversation key');
    const payload = await encrypt(key, vector.plaintext, hexToBytes(vector.nonce));
    assert.equal(payload, vector.payload, vector.note || vector.plaintext.slice(0, 24));
  }
});

test('decrypt recovers the plaintext from every published payload', async () => {
  for (const vector of vectors.valid.encrypt_decrypt) {
    const key = await conversationKey(hexToBytes(vector.sec2), getPublicKey(hexToBytes(vector.sec1)));
    assert.equal(await decrypt(key, vector.payload), vector.plaintext);
  }
});

test('long messages round-trip against their recorded digests', async () => {
  const { createHash } = await import('node:crypto');
  for (const vector of vectors.valid.encrypt_decrypt_long_msg) {
    const key = hexToBytes(vector.conversation_key);
    const plaintext = vector.pattern.repeat(vector.repeat);
    assert.equal(createHash('sha256').update(plaintext).digest('hex'), vector.plaintext_sha256);
    const payload = await encrypt(key, plaintext, hexToBytes(vector.nonce));
    assert.equal(createHash('sha256').update(payload).digest('hex'), vector.payload_sha256);
    assert.equal(await decrypt(key, payload), plaintext);
  }
});

test('every payload the vectors mark invalid is refused', async () => {
  for (const vector of vectors.invalid.decrypt) {
    const key = hexToBytes(vector.conversation_key);
    await assert.rejects(() => decrypt(key, vector.payload), vector.note);
  }
});

test('plaintext lengths outside the allowed range are refused', async () => {
  const key = hexToBytes('00'.repeat(32));
  await assert.rejects(() => encrypt(key, ''), /1\.\.65535/);
  await assert.rejects(() => encrypt(key, 'a'.repeat(65536)), /1\.\.65535/);
});

test('a tampered ciphertext fails authentication rather than decrypting to noise', async () => {
  const sec1 = hexToBytes('00'.repeat(31) + '01');
  const sec2 = hexToBytes('00'.repeat(31) + '02');
  const key = await conversationKey(sec1, getPublicKey(sec2));
  const payload = await encrypt(key, 'the queue is now open');
  const flipped = `${payload.slice(0, 60)}${payload[60] === 'A' ? 'B' : 'A'}${payload.slice(61)}`;
  await assert.rejects(() => decrypt(key, flipped));
});

test('a round trip with fresh randomness works', async () => {
  const sec1 = hexToBytes('11'.repeat(32));
  const sec2 = hexToBytes('22'.repeat(32));
  const forward = await conversationKey(sec1, getPublicKey(sec2));
  const backward = await conversationKey(sec2, getPublicKey(sec1));
  const message = 'Kellerwand — Übung 🧗 {"a":1}';
  assert.equal(await decrypt(backward, await encrypt(forward, message)), message);
});
