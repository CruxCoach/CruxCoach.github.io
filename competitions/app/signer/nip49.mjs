/** NIP-49 password-encrypted private keys (ncryptsec). */
import { scryptAsync } from '../../../assets/vendor/nostr-crypto/hashes/scrypt.js';
import { xchacha20poly1305 } from '../../../assets/vendor/nostr-crypto/ciphers/chacha.js';
import { bech32Decode, bech32Encode, randomBytes } from '../protocol/nostr-event.mjs';

const encoder = new TextEncoder();
export const NIP49_LOG_N = 16;
// Generated here and never handled unencrypted outside this page.
export const NIP49_KEY_SECURITY = 0x01;

async function derive(password, salt, logN) {
  if (typeof password !== 'string') throw new Error('A passphrase is required.');
  return scryptAsync(encoder.encode(password.normalize('NFKC')), salt, {
    N: 2 ** logN, r: 8, p: 1, dkLen: 32, maxmem: 128 * 8 * ((2 ** logN) + 1) + 1024,
    asyncTick: 10,
  });
}

export async function encryptNcryptsec(secretKey, password, options = {}) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) throw new Error('Invalid private key.');
  if (typeof password !== 'string' || password.length < 12) throw new Error('The passphrase needs to be at least 12 characters.');
  const logN = options.logN ?? NIP49_LOG_N;
  const salt = options.salt || randomBytes(16);
  const nonce = options.nonce || randomBytes(24);
  const security = options.keySecurity ?? NIP49_KEY_SECURITY;
  if (salt.length !== 16 || nonce.length !== 24 || ![0, 1, 2].includes(security)) throw new Error('Invalid NIP-49 options.');
  const key = await derive(password, salt, logN);
  try {
    const ciphertext = xchacha20poly1305(key, nonce, Uint8Array.of(security)).encrypt(secretKey);
    const payload = new Uint8Array(91);
    payload.set([2, logN], 0);
    payload.set(salt, 2);
    payload.set(nonce, 18);
    payload[42] = security;
    payload.set(ciphertext, 43);
    return bech32Encode('ncryptsec', payload);
  } finally {
    key.fill(0);
  }
}

export async function decryptNcryptsec(value, password) {
  const decoded = bech32Decode(String(value || '').trim());
  if (!decoded || decoded.hrp !== 'ncryptsec' || decoded.bytes.length !== 91 || decoded.bytes[0] !== 2) {
    throw new Error('That is not a supported ncryptsec backup.');
  }
  const logN = decoded.bytes[1];
  // NIP-49 permits larger values, but 20–22 require 1–4 GiB and can crash a
  // browser tab. Cap imports at 18 (256 MiB) instead of allowing a key file to
  // become a memory-exhaustion payload.
  if (logN < 1 || logN > 18) throw new Error('That ncryptsec uses unsupported security settings.');
  const salt = decoded.bytes.slice(2, 18);
  const nonce = decoded.bytes.slice(18, 42);
  const aad = decoded.bytes.slice(42, 43);
  const ciphertext = decoded.bytes.slice(43);
  const key = await derive(password, salt, logN);
  try {
    const secret = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
    if (secret.length !== 32) throw new Error('invalid key');
    return secret;
  } catch {
    throw new Error('That passphrase does not open this backup.');
  } finally {
    key.fill(0);
  }
}
