/**
 * NIP-44 v2 encryption.
 *
 * Needed because NIP-46 remote signing transports its requests this way. The
 * competition payloads themselves are public in v1 — this exists so the private
 * competitions described in FEAT-058 §13.2 need no new cryptography later, and
 * so bunker sign-in works today.
 *
 * Primitives: ChaCha20 from the vendored @noble/ciphers, secp256k1 ECDH from
 * the vendored @noble/secp256k1, and HMAC-SHA256 from WebCrypto. HKDF is
 * assembled from HMAC here rather than using WebCrypto's one-shot HKDF, because
 * NIP-44 needs the intermediate conversation key as a value in its own right
 * (it is cached per peer, and the published test vectors pin it).
 *
 * Source: https://github.com/nostr-protocol/nips/blob/master/44.md (2026-08-09)
 */
import { getSharedSecret } from '../../../assets/vendor/nostr-crypto/secp256k1/secp256k1.js';
import { chacha20 } from '../../../assets/vendor/nostr-crypto/ciphers/chacha.js';
import { bytesToHex, hexToBytes, randomBytes } from '../protocol/nostr-event.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SALT = encoder.encode('nip44-v2');
const VERSION = 2;

async function hmacSha256(key, data) {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, data));
}

const hkdfExtract = (salt, ikm) => hmacSha256(salt, ikm);

async function hkdfExpand(prk, info, length) {
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let written = 0;
  for (let counter = 1; written < length; counter++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous, 0);
    input.set(info, previous.length);
    input[input.length - 1] = counter;
    previous = await hmacSha256(prk, input);
    const take = Math.min(previous.length, length - written);
    out.set(previous.subarray(0, take), written);
    written += take;
  }
  return out;
}

/**
 * The per-pair key. Symmetric: A→B and B→A produce the same value, which is
 * what makes a two-party conversation work at all.
 *
 * @param {Uint8Array} secretKey  our 32-byte secret
 * @param {string} peerPubkeyHex  the peer's 32-byte x-only public key
 */
export async function conversationKey(secretKey, peerPubkeyHex) {
  // x-only keys are lifted to the even-y point, per BIP-340 and NIP-44.
  const shared = getSharedSecret(secretKey, hexToBytes(`02${peerPubkeyHex}`), true).subarray(1);
  return hkdfExtract(SALT, shared);
}

/**
 * NIP-44 padding: hides the exact plaintext length in power-of-two buckets.
 *
 * A pure function of the length, deliberately without the 1..65535 message
 * check — that limit belongs to `encrypt`, and the published vectors include
 * 65536 precisely to pin that the two are separate.
 */
export function paddedLength(unpadded) {
  if (!Number.isInteger(unpadded) || unpadded < 1) throw new Error('nip44: length must be a positive integer');
  if (unpadded <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(unpadded - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((unpadded - 1) / chunk) + 1);
}

function pad(plaintextBytes) {
  const unpadded = plaintextBytes.length;
  if (unpadded < 1 || unpadded > 65535) throw new Error('nip44: plaintext must be 1..65535 bytes');
  const total = paddedLength(unpadded);
  const out = new Uint8Array(2 + total);
  new DataView(out.buffer).setUint16(0, unpadded, false);
  out.set(plaintextBytes, 2);
  return out;
}

function unpad(padded) {
  if (padded.length < 3) throw new Error('nip44: padded payload is too short');
  const unpaddedLength = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(0, false);
  if (unpaddedLength === 0) throw new Error('nip44: invalid padding');
  const plaintext = padded.subarray(2, 2 + unpaddedLength);
  if (plaintext.length !== unpaddedLength || padded.length !== 2 + paddedLength(unpaddedLength)) {
    throw new Error('nip44: invalid padding');
  }
  return plaintext;
}

async function messageKeys(convoKey, nonce) {
  const expanded = await hkdfExpand(convoKey, nonce, 76);
  return {
    chachaKey: expanded.subarray(0, 32),
    chachaNonce: expanded.subarray(32, 44),
    hmacKey: expanded.subarray(44, 76),
  };
}

function base64Encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64Decode(text) {
  const binary = globalThis.atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Constant-time comparison — a fast reject leaks which byte differed. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * @param {Uint8Array} convoKey
 * @param {string} plaintext
 * @param {Uint8Array} [nonce] 32 bytes; supplied only by the test vectors
 */
export async function encrypt(convoKey, plaintext, nonce = randomBytes(32)) {
  const padded = pad(encoder.encode(plaintext));
  const { chachaKey, chachaNonce, hmacKey } = await messageKeys(convoKey, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, padded);
  const mac = await hmacSha256(hmacKey, concat(nonce, ciphertext));
  return base64Encode(concat(Uint8Array.of(VERSION), nonce, ciphertext, mac));
}

export async function decrypt(convoKey, payload) {
  if (typeof payload !== 'string' || payload.length < 132 || payload.length > 87472) {
    throw new Error('nip44: payload is not a plausible length');
  }
  if (payload[0] === '#') throw new Error('nip44: unsupported future encryption version');
  const bytes = base64Decode(payload);
  if (bytes[0] !== VERSION) throw new Error(`nip44: unknown version ${bytes[0]}`);
  if (bytes.length < 99) throw new Error('nip44: payload is too short');

  const nonce = bytes.subarray(1, 33);
  const ciphertext = bytes.subarray(33, bytes.length - 32);
  const mac = bytes.subarray(bytes.length - 32);
  const { chachaKey, chachaNonce, hmacKey } = await messageKeys(convoKey, nonce);

  // Authenticate BEFORE decrypting. Decrypting first and checking afterwards
  // means running attacker-chosen bytes through the parser.
  const expected = await hmacSha256(hmacKey, concat(nonce, ciphertext));
  if (!equalBytes(expected, mac)) throw new Error('nip44: message authentication failed');

  return decoder.decode(unpad(chacha20(chachaKey, chachaNonce, ciphertext)));
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export const __testing = { hkdfExpand, hkdfExtract, messageKeys, bytesToHex };
