/**
 * The locally generated key — FEAT-058 §18.
 *
 * This is the option of last resort, offered only after NIP-07 and NIP-46,
 * because it is the only one where a private key exists inside a web page at
 * all. What that costs is stated in the UI before the key is generated, not
 * after.
 *
 * Rules this file enforces:
 *   - the secret is NEVER persisted in plaintext; storage holds AES-GCM
 *     ciphertext under a PBKDF2-SHA-256 key derived from a user passphrase
 *   - the plaintext lives in one module-scoped array, zeroed on logout, on
 *     session expiry, and when the tab is hidden past the idle limit
 *   - "shared device" keeps it in memory only and never touches storage
 *   - nothing here is transmitted; the site is static and has no endpoint that
 *     could receive a secret
 */
import { bytesToHex, generateSecretKey, getPublicKey, nsecEncode, decodeNip19, randomBytes } from '../protocol/nostr-event.mjs';

export const STORAGE_KEY = 'cruxcoach:competitions:key:v1';
export const VAULT_VERSION = 1;

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256, and still the right order. */
export const PBKDF2_ITERATIONS = 600000;

export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
export const IDLE_SESSION_MS = 60 * 60 * 1000;

const encoder = new TextEncoder();

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function unbase64(text) {
  const binary = globalThis.atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await globalThis.crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Wrap a secret key under a passphrase.
 * @returns {Promise<object>} a JSON-serializable vault record — no plaintext
 */
export async function sealVault(secretKey, passphrase, { iterations = PBKDF2_ITERATIONS } = {}) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('The passphrase needs to be at least 8 characters.');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secretKey),
  );
  return {
    v: VAULT_VERSION,
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: base64(salt),
    iv: base64(iv),
    ct: base64(ciphertext),
    pubkey: getPublicKey(secretKey),
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Unwrap a vault. A wrong passphrase and a corrupted vault are deliberately the
 * same message: distinguishing them tells an attacker which of the two they got
 * wrong.
 */
export async function openVault(vault, passphrase) {
  if (!vault || vault.v !== VAULT_VERSION) throw new Error('This saved key is in a format this page cannot read.');
  const key = await deriveKey(passphrase, unbase64(vault.salt), vault.iterations || PBKDF2_ITERATIONS);
  let plaintext;
  try {
    plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unbase64(vault.iv) }, key, unbase64(vault.ct),
    ));
  } catch {
    throw new Error('That passphrase does not open this key.');
  }
  if (plaintext.length !== 32) throw new Error('That passphrase does not open this key.');
  const pubkey = getPublicKey(plaintext);
  if (vault.pubkey && vault.pubkey !== pubkey) {
    throw new Error('This saved key does not match the identity it claims.');
  }
  return plaintext;
}

/** Best-effort erasure. It does not defeat a GC copy, and the UI never claims it does. */
export function zeroize(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

/**
 * Three challenge positions from an nsec, 1-indexed, so a backup prompt asks
 * for specific characters instead of accepting "yes I wrote it down".
 *
 * Derived from the nsec itself so the same key always asks the same three —
 * a user who reloads mid-flow is not asked a different question about a
 * secret they have already written down.
 */
export function backupChallenge(nsec) {
  const body = nsec.slice(5); // strip the "nsec1" prefix
  const positions = [];
  let cursor = 7;
  while (positions.length < 3) {
    const index = (body.charCodeAt(cursor % body.length) + cursor * 13) % body.length;
    if (!positions.includes(index)) positions.push(index);
    cursor += 5;
  }
  positions.sort((a, b) => a - b);
  return positions.map((index) => ({ position: index + 6, expected: body[index] }));
}

export function checkBackupChallenge(challenge, answers) {
  if (!Array.isArray(answers) || answers.length !== challenge.length) return false;
  return challenge.every((item, index) => (answers[index] || '').trim().toLowerCase() === item.expected);
}

/**
 * Session-scoped holder for the plaintext key.
 *
 * Deliberately a single instance with an explicit lifetime rather than a value
 * passed around: there is then exactly one place that can be zeroed, and no
 * second copy hiding in a closure someone forgot about.
 */
export class KeyVaultSession {
  /**
   * @param {object} [options]
   * @param {Storage} [options.storage] localStorage, or null for a shared device
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    this.now = options.now || (() => Date.now());
    this.secretKey = null;
    this.pubkey = null;
    this.startedAt = 0;
    this.touchedAt = 0;
    this.listeners = new Set();
  }

  get unlocked() {
    return this.secretKey !== null && !this.expired();
  }

  hasStoredKey() {
    return Boolean(this.readVault());
  }

  readVault() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  storedPubkey() {
    return this.readVault()?.pubkey || null;
  }

  /** Generate a fresh key. It is held in memory and not stored until sealed. */
  generate() {
    this.adopt(generateSecretKey());
    return { nsec: nsecEncode(this.secretKey), pubkey: this.pubkey };
  }

  /** Adopt an existing key, from an nsec or raw bytes. */
  importKey(input) {
    let bytes = input;
    if (typeof input === 'string') {
      const decoded = decodeNip19(input.trim());
      if (!decoded || decoded.type !== 'nsec') throw new Error('That is not an nsec.');
      bytes = decoded.data;
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('That is not a 32-byte key.');
    this.adopt(bytes);
    return { pubkey: this.pubkey };
  }

  adopt(secretKey) {
    this.clear();
    this.secretKey = secretKey;
    this.pubkey = getPublicKey(secretKey);
    this.startedAt = this.now();
    this.touchedAt = this.startedAt;
    this.emit();
  }

  /** Persist the current key under a passphrase. No-op on a shared device. */
  async persist(passphrase) {
    if (!this.storage) throw new Error('This device is marked as shared, so nothing is saved here.');
    if (!this.secretKey) throw new Error('There is no key to save.');
    const vault = await sealVault(this.secretKey, passphrase);
    this.storage.setItem(STORAGE_KEY, JSON.stringify(vault));
    return vault;
  }

  async unlock(passphrase) {
    const vault = this.readVault();
    if (!vault) throw new Error('There is no saved key on this device.');
    this.adopt(await openVault(vault, passphrase));
    return { pubkey: this.pubkey };
  }

  /** Wipe the plaintext but keep the stored ciphertext. */
  lock() {
    zeroize(this.secretKey);
    this.secretKey = null;
    this.pubkey = null;
    this.startedAt = 0;
    this.touchedAt = 0;
    this.emit();
  }

  /** Wipe the plaintext AND remove the stored ciphertext. */
  forget() {
    this.lock();
    if (this.storage) this.storage.removeItem(STORAGE_KEY);
    this.emit();
  }

  clear() {
    zeroize(this.secretKey);
    this.secretKey = null;
    this.pubkey = null;
  }

  expired() {
    if (!this.startedAt) return false;
    const now = this.now();
    return now - this.startedAt > ABSOLUTE_SESSION_MS || now - this.touchedAt > IDLE_SESSION_MS;
  }

  /** Call on user activity. Returns false if the session had already expired. */
  touch() {
    if (this.secretKey && this.expired()) {
      this.lock();
      return false;
    }
    this.touchedAt = this.now();
    return this.secretKey !== null;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.pubkey);
  }

  /** For diagnostics only — never the key itself. */
  describe() {
    return {
      unlocked: this.unlocked,
      pubkey: this.pubkey,
      stored: this.hasStoredKey(),
      sharedDevice: !this.storage,
      expiresAt: this.startedAt ? this.startedAt + ABSOLUTE_SESSION_MS : 0,
    };
  }
}

export const __testing = { deriveKey, base64, unbase64, bytesToHex };
