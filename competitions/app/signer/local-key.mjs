/**
 * The locally generated key — FEAT-058 §18.
 *
 * This is the option of last resort, offered only after NIP-07 and NIP-46,
 * because it is the only one where a private key exists inside a web page at
 * all. What that costs is stated in the UI before the key is generated, not
 * after.
 *
 * Rules this file enforces:
 *   - the secret is NEVER persisted in plaintext; new identities store the
 *     portable NIP-49 ncryptsec backup, while the old AES-GCM/PBKDF2 reader is
 *     retained solely so identities saved by earlier releases still unlock
 *   - the plaintext lives in one array, zeroed when the session is locked, and
 *     zeroed BY A SCHEDULED TIMER at the absolute limit, at the idle limit, and
 *     five minutes after the page is hidden — not merely noticed before the
 *     next signing attempt, which would leave the key in memory for as long as
 *     nobody asked for a signature
 *   - "shared device" keeps it in memory only and never touches storage
 *   - nothing here is transmitted; the site is static and has no endpoint that
 *     could receive a secret
 */
import { bytesToHex, generateSecretKey, getPublicKey, nsecEncode, decodeNip19, randomBytes } from '../protocol/nostr-event.mjs';
import { decryptNcryptsec, encryptNcryptsec } from './nip49.mjs';

export const STORAGE_KEY = 'cruxcoach:competitions:key:v1';
export const VAULT_VERSION = 1;
export const NIP49_VAULT_VERSION = 2;

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256, and still the right order. */
export const PBKDF2_ITERATIONS = 600000;

export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
export const IDLE_SESSION_MS = 60 * 60 * 1000;

/**
 * How long a hidden page keeps the plaintext key.
 *
 * Shorter than the idle limit on purpose. A hidden tab is the case where the
 * person has walked away from a gym desk or handed the phone over, and the
 * usual idle budget assumes they are still the one holding it.
 */
export const HIDDEN_SESSION_MS = 5 * 60 * 1000;

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
   * @param {string} [options.storageKey] isolated vault slot
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    if (options.storage !== undefined) {
      this.storage = options.storage;
    } else {
      // Access itself can throw in hardened/private browser contexts. Treat
      // that as session-only instead of crashing before the UI can explain it.
      try { this.storage = globalThis.localStorage || null; } catch { this.storage = null; }
    }
    this.storageKey = options.storageKey || STORAGE_KEY;
    // A local signing key is locked aggressively by default. Callers that use
    // this holder for a revocable, remote-signer client credential can opt out:
    // that credential should live for the browser session and is still wiped
    // on explicit sign-out or disposal.
    this.expiryEnabled = options.expiryEnabled !== false;
    this.now = options.now || (() => Date.now());
    this.secretKey = null;
    this.pubkey = null;
    this.startedAt = 0;
    this.touchedAt = 0;
    this.listeners = new Set();

    // Injectable so the lifecycle can be tested with a fake clock and a fake
    // event target rather than by waiting twelve hours.
    this.setTimer = options.setTimer || ((fn, ms) => {
      const id = setTimeout(fn, ms);
      // A browser does not care, but Node keeps the process alive for a
      // pending timer — so an armed session would hang any test runner that
      // imports this module. `unref` is absent in a browser, where the handle
      // is a number, and the optional call is a no-op there.
      id?.unref?.();
      return id;
    });
    this.clearTimer = options.clearTimer || ((id) => clearTimeout(id));
    this.events = options.events === undefined ? globalThis.document : options.events;
    this.timer = null;
    this.hiddenTimer = null;

    // One listener for the page's whole life, removed by `dispose()`. Attaching
    // it per unlock would leak one per sign-in.
    this.onVisibility = () => this.visibilityChanged();
    if (this.expiryEnabled) this.events?.addEventListener?.('visibilitychange', this.onVisibility);
  }

  /** True when the host page is currently hidden. */
  get pageHidden() {
    return this.events?.visibilityState === 'hidden';
  }

  /**
   * Schedule the zeroing.
   *
   * One timer, always pointing at the nearest deadline, re-armed whenever the
   * deadlines move. Checking on the way out as well as on the way in means a
   * clock that jumped backwards cannot leave the key alive forever.
   */
  arm() {
    this.clearTimer(this.timer);
    this.timer = null;
    if (!this.secretKey || !this.expiryEnabled) return;

    const now = this.now();
    const deadline = Math.min(
      this.startedAt + ABSOLUTE_SESSION_MS,
      this.touchedAt + IDLE_SESSION_MS,
    );
    // At least one millisecond, always. `expired()` is a strict comparison, so
    // waking up at exactly the deadline finds the session *not* expired — and a
    // re-arm at zero delay would then fire at the same instant, forever. A
    // re-arm has to move time forward or it is a spin.
    const wait = Math.max(1, deadline - now);
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.expired()) this.lock();
      else this.arm();
    }, wait);
  }

  /** Hidden starts a shorter clock; visible again cancels it and counts as use. */
  visibilityChanged() {
    if (!this.secretKey || !this.expiryEnabled) return;
    if (this.pageHidden) {
      this.clearTimer(this.hiddenTimer);
      this.hiddenTimer = this.setTimer(() => {
        this.hiddenTimer = null;
        this.lock();
      }, HIDDEN_SESSION_MS);
      return;
    }
    this.clearTimer(this.hiddenTimer);
    this.hiddenTimer = null;
    this.touch();
  }

  /** Stop every timer this session owns. Idempotent. */
  disarm() {
    this.clearTimer(this.timer);
    this.clearTimer(this.hiddenTimer);
    this.timer = null;
    this.hiddenTimer = null;
  }

  /**
   * Release the page-level listener as well as the timers.
   *
   * A page that replaces its session without this leaks one visibility
   * listener per sign-in, each holding the old session alive.
   */
  dispose() {
    this.disarm();
    if (this.expiryEnabled) this.events?.removeEventListener?.('visibilitychange', this.onVisibility);
    this.lock();
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
      const raw = this.storage.getItem(this.storageKey);
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
    // From this moment the key has a deadline, and something has to be
    // watching it. Adopting a key without arming leaves plaintext alive until
    // somebody happens to ask for a signature.
    this.arm();
    if (this.pageHidden) this.visibilityChanged();
    this.emit();
  }

  /** Persist the current key under a passphrase. No-op on a shared device. */
  async persist(passphrase, sealOptions) {
    if (!this.storage) throw new Error('This device is marked as shared, so nothing is saved here.');
    if (!this.secretKey) throw new Error('There is no key to save.');
    const vault = await sealVault(this.secretKey, passphrase, sealOptions);
    this.storage.setItem(this.storageKey, JSON.stringify(vault));
    return vault;
  }

  /** Create a portable NIP-49 backup without storing it. */
  async createNcryptsec(passphrase, options) {
    if (!this.secretKey) throw new Error('There is no key to save.');
    return encryptNcryptsec(this.secretKey, passphrase, options);
  }

  /** Keep the already encrypted portable backup on this device. */
  saveNcryptsec(ncryptsec) {
    if (!this.storage) return false;
    this.storage.setItem(this.storageKey, JSON.stringify({
      v: NIP49_VAULT_VERSION,
      format: 'ncryptsec',
      ncryptsec,
      pubkey: this.pubkey,
      created_at: Math.floor(Date.now() / 1000),
    }));
    return true;
  }

  async unlock(passphrase) {
    const vault = this.readVault();
    if (!vault) throw new Error('There is no saved key on this device.');
    const secret = vault.v === NIP49_VAULT_VERSION && vault.format === 'ncryptsec'
      ? await decryptNcryptsec(vault.ncryptsec, passphrase)
      : await openVault(vault, passphrase);
    this.adopt(secret);
    if (vault.pubkey && vault.pubkey !== this.pubkey) {
      this.lock();
      throw new Error('This saved key does not match the identity it claims.');
    }
    return { pubkey: this.pubkey };
  }

  /**
   * Wipe the plaintext but keep the stored ciphertext.
   *
   * This is what "sign out" does, and it is deliberately not the same as
   * throwing the key away: the same person coming back to the same device
   * unlocks with their passphrase. [forget] is the one that removes it.
   */
  lock() {
    this.disarm();
    zeroize(this.secretKey);
    this.secretKey = null;
    this.pubkey = null;
    this.startedAt = 0;
    this.touchedAt = 0;
    this.emit();
  }

  /**
   * Wipe the plaintext AND remove the stored ciphertext.
   *
   * Irreversible: the key is gone from this device and nothing can recover it.
   * The UI asks for confirmation before calling this.
   */
  forget() {
    this.lock();
    if (this.storage) this.storage.removeItem(this.storageKey);
    this.emit();
  }

  clear() {
    this.disarm();
    zeroize(this.secretKey);
    this.secretKey = null;
    this.pubkey = null;
  }

  expired() {
    if (!this.expiryEnabled || !this.startedAt) return false;
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
    // The idle deadline just moved, so the timer has to move with it.
    this.arm();
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
      expiresAt: this.expiryEnabled && this.startedAt ? this.startedAt + ABSOLUTE_SESSION_MS : 0,
    };
  }
}

export const __testing = { deriveKey, base64, unbase64, bytesToHex };
