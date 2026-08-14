/**
 * Reload-only cache for an unlocked local key.
 *
 * The secret is encrypted with a non-extractable WebCrypto key in IndexedDB.
 * Its ciphertext and random record id live in sessionStorage, so a hard reload
 * can restore it but closing the tab cannot become a permanent login. The
 * durable ncryptsec in localStorage remains the source of truth.
 */
const DB_NAME = 'cruxcoach-competition-session';
const STORE_NAME = 'unlocked-keys';
const DB_VERSION = 1;
const TOKEN_PREFIX = 'cruxcoach:competitions:unlocked:v1:';

function encode(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return globalThis.btoa(text);
}

function decode(text) {
  const binary = globalThis.atob(text);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(crypto) {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encode(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Browser session storage failed.'));
  });
}

async function openDatabase(indexedDB) {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'token' });
    }
  };
  return requestResult(request);
}

async function inStore(indexedDB, mode, work) {
  const database = await openDatabase(indexedDB);
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await work(transaction.objectStore(STORE_NAME));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Browser session storage failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Browser session storage failed.'));
    });
    return result;
  } finally {
    database.close();
  }
}

export class ReloadSessionCache {
  constructor({ storageKey, sessionStorage, indexedDB, crypto, recordStore } = {}) {
    this.key = `${TOKEN_PREFIX}${storageKey || 'default'}`;
    try { this.storage = sessionStorage === undefined ? globalThis.sessionStorage : sessionStorage; }
    catch { this.storage = null; }
    this.indexedDB = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    this.crypto = crypto || globalThis.crypto;
    this.recordStore = recordStore || (this.indexedDB ? {
      put: (record) => inStore(this.indexedDB, 'readwrite', (store) => requestResult(store.put(record))),
      get: (token) => inStore(this.indexedDB, 'readonly', (store) => requestResult(store.get(token))),
      delete: (token) => inStore(this.indexedDB, 'readwrite', (store) => requestResult(store.delete(token))),
    } : null);
  }

  get available() { return Boolean(this.storage && this.recordStore && this.crypto?.subtle); }

  readMetadata() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      const value = raw ? JSON.parse(raw) : null;
      return value?.v === 1 && typeof value.token === 'string' ? value : null;
    } catch { return null; }
  }

  update({ startedAt, touchedAt, hiddenAt = null }) {
    const metadata = this.readMetadata();
    if (!metadata) return;
    try {
      this.storage.setItem(this.key, JSON.stringify({ ...metadata, startedAt, touchedAt, hiddenAt }));
    } catch { /* the in-memory session remains usable */ }
  }

  async save(secretKey, { pubkey, startedAt, touchedAt }) {
    if (!this.available) return false;
    await this.clear();
    try {
      const token = randomToken(this.crypto);
      const key = await this.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      );
      const iv = new Uint8Array(12);
      this.crypto.getRandomValues(iv);
      const ciphertext = new Uint8Array(await this.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, secretKey,
      ));
      // IndexedDB contains only the wrapping key. Without the tab-scoped
      // ciphertext in sessionStorage an orphaned record reveals nothing.
      await this.recordStore.put({ token, key });
      this.storage.setItem(this.key, JSON.stringify({
        v: 1, token, pubkey, iv: encode(iv), ciphertext: encode(ciphertext),
        startedAt, touchedAt, hiddenAt: null,
      }));
      return true;
    } catch {
      await this.clear();
      return false;
    }
  }

  async restore({ now, absoluteMs, idleMs, hiddenMs, expectedPubkey }) {
    if (!this.available) return null;
    const metadata = this.readMetadata();
    if (!metadata) return null;
    const expired = !Number.isFinite(metadata.startedAt) || !Number.isFinite(metadata.touchedAt)
      || now - metadata.startedAt > absoluteMs
      || now - metadata.touchedAt > idleMs
      || (Number.isFinite(metadata.hiddenAt) && now - metadata.hiddenAt > hiddenMs)
      || (expectedPubkey && metadata.pubkey !== expectedPubkey);
    if (expired) {
      await this.clear();
      return null;
    }
    try {
      const record = await this.recordStore.get(metadata.token);
      if (!record) throw new Error('Session record mismatch.');
      const secretKey = new Uint8Array(await this.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode(metadata.iv) }, record.key, decode(metadata.ciphertext),
      ));
      if (secretKey.length !== 32) throw new Error('Invalid session key.');
      return { secretKey, startedAt: metadata.startedAt, touchedAt: metadata.touchedAt };
    } catch {
      await this.clear();
      return null;
    }
  }

  async clear() {
    const token = this.readMetadata()?.token;
    try { this.storage?.removeItem(this.key); } catch { /* best effort */ }
    if (!token || !this.recordStore) return;
    try { await this.recordStore.delete(token); }
    catch { /* an orphaned wrapping key contains no secret by itself */ }
  }
}
