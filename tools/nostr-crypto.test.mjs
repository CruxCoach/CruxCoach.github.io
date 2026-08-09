import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schnorr, getSharedSecret } from '../assets/vendor/nostr-crypto/secp256k1/secp256k1.js';
import { chacha20 } from '../assets/vendor/nostr-crypto/ciphers/chacha.js';
import { bytesToHex, hexToBytes } from '../competitions/app/protocol/nostr-event.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(here, '../assets/vendor/nostr-crypto');

/**
 * The vendored crypto is the one dependency this site takes, and a truncated or
 * mis-vendored copy would fail in a way that looks like a protocol bug. These
 * tests run the OFFICIAL published vectors against the exact bytes we serve.
 */

const bip340 = JSON.parse(fs.readFileSync(path.join(vendorDir, 'bip340-test-vectors.json'), 'utf8'));

test('BIP-340: every signing vector reproduces the published signature', async () => {
  const signing = bip340.filter((v) => v.secret_key);
  assert.ok(signing.length >= 8, 'the vector file looks truncated');
  for (const vector of signing) {
    const sk = hexToBytes(vector.secret_key);
    assert.equal(bytesToHex(schnorr.getPublicKey(sk)), vector.public_key, `vector ${vector.index}: public key`);
    const sig = await schnorr.signAsync(
      hexToBytes(vector.message),
      sk,
      hexToBytes(vector.aux_rand),
    );
    assert.equal(bytesToHex(sig), vector.signature, `vector ${vector.index}: signature ${vector.comment}`);
  }
});

test('BIP-340: every vector verifies exactly as the file says it should', async () => {
  for (const vector of bip340) {
    let result;
    try {
      result = await schnorr.verifyAsync(
        hexToBytes(vector.signature),
        hexToBytes(vector.message),
        hexToBytes(vector.public_key),
      );
    } catch {
      // An input the library refuses outright (a public key that is not an x
      // coordinate, an s value at the curve order) is a failed verification,
      // which is what the vector asks for.
      result = false;
    }
    assert.equal(result, vector.verifies, `vector ${vector.index}: ${vector.comment || 'must verify'}`);
  }
});

test('BIP-340: variable-length messages are covered', () => {
  const lengths = new Set(bip340.filter((v) => v.secret_key).map((v) => v.message.length / 2));
  for (const length of [0, 1, 17, 32, 100]) {
    assert.ok(lengths.has(length), `no vector with a ${length}-byte message`);
  }
});

test('RFC 8439 A.1 #1: the ChaCha20 keystream matches the published block', () => {
  // Encrypting 64 zero bytes under a zero key and zero nonce yields the
  // keystream itself, which RFC 8439 publishes verbatim.
  const keystream = chacha20(new Uint8Array(32), new Uint8Array(12), new Uint8Array(64));
  assert.equal(
    bytesToHex(keystream),
    '76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7'
    + 'da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586',
  );
});

test('ChaCha20 round-trips', () => {
  const key = hexToBytes('00'.repeat(31) + '2a');
  const nonce = hexToBytes('01'.repeat(12));
  const plaintext = new TextEncoder().encode('Kellerwand Winter Session');
  const ciphertext = chacha20(key, nonce, plaintext);
  assert.notDeepEqual(ciphertext, plaintext);
  assert.deepEqual(chacha20(key, nonce, ciphertext), plaintext);
});

test('ECDH agrees in both directions, which is what NIP-44 needs', () => {
  const a = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const b = hexToBytes('0000000000000000000000000000000000000000000000000000000000000005');
  const aPub = schnorr.getPublicKey(a);
  const bPub = schnorr.getPublicKey(b);
  // NIP-44 uses the x-coordinate of the shared point, with the peer's x-only
  // key lifted to an even-y point (the `02` prefix).
  const ab = getSharedSecret(a, hexToBytes(`02${bytesToHex(bPub)}`), true).slice(1);
  const ba = getSharedSecret(b, hexToBytes(`02${bytesToHex(aPub)}`), true).slice(1);
  assert.deepEqual(ab, ba);
  assert.equal(ab.length, 32);
});

test('every vendored file is byte-identical to its recorded digest', async () => {
  // The whole reason `.gitattributes` exempts assets/vendor from
  // `git diff --check`: upstream ships lines with trailing whitespace, and
  // stripping them would be a silent local edit of an audited library. This is
  // the stronger guarantee that replaces the whitespace check.
  const { createHash } = await import('node:crypto');
  const provenance = fs.readFileSync(path.join(vendorDir, 'PROVENANCE.md'), 'utf8');
  const block = provenance.match(/## Per-file digests[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(block, 'PROVENANCE.md has no per-file digest block');
  const rows = block[1].trim().split('\n').map((line) => line.trim().split(/\s+/));
  assert.ok(rows.length >= 5, `expected every vendored source, found ${rows.length}`);
  for (const [digest, relative] of rows) {
    const bytes = fs.readFileSync(path.join(vendorDir, relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest,
      `${relative} is not the upstream file the provenance records`);
  }
});

test('the vendored files are the ones the provenance file describes', () => {
  const provenance = fs.readFileSync(path.join(vendorDir, 'PROVENANCE.md'), 'utf8');
  for (const file of ['secp256k1/secp256k1.js', 'secp256k1/LICENSE-noble-secp256k1',
    'ciphers/chacha.js', 'ciphers/_arx.js', 'ciphers/utils.js', 'ciphers/_poly1305.js',
    'ciphers/LICENSE-noble-ciphers']) {
    assert.ok(fs.existsSync(path.join(vendorDir, file)), `missing vendored file ${file}`);
  }
  assert.match(provenance, /@noble\/secp256k1/);
  assert.match(provenance, /@noble\/ciphers/);
  assert.match(provenance, /MIT/);
  // A version bump that forgets the digest is the failure mode this catches.
  assert.match(provenance, /[0-9a-f]{64}/);
});

test('both licences are present and are the MIT text', () => {
  for (const file of ['secp256k1/LICENSE-noble-secp256k1', 'ciphers/LICENSE-noble-ciphers']) {
    const text = fs.readFileSync(path.join(vendorDir, file), 'utf8');
    assert.match(text, /MIT License/i);
    assert.match(text, /Paul Miller/);
  }
});
