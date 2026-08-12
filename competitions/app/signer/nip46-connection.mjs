/** Encrypted, reusable NIP-46 client pairing. The one-time bunker secret is never stored. */
import { isHex32 } from '../protocol/nostr-event.mjs';
import { isAllowedRelayUrl } from '../protocol/relay-url.mjs';
import { KeyVaultSession } from './local-key.mjs';

export const NIP46_CONNECTION_KEY = 'cruxcoach:competitions:nip46:connection:v1';
export const NIP46_CLIENT_VAULT_KEY = 'cruxcoach:competitions:nip46:client-key:v1';
const VERSION = 1;

function validConnection(value) {
  return value?.v === VERSION
    && isHex32(value.remote_signer_pubkey)
    && isHex32(value.user_pubkey)
    && Array.isArray(value.relays)
    && value.relays.length > 0
    && value.relays.length <= 8
    && value.relays.every(isAllowedRelayUrl)
    && value.secret === undefined;
}

export function buildResumeUri(connection) {
  if (!validConnection(connection)) throw new Error('The saved signer connection is damaged.');
  const params = new URLSearchParams();
  for (const relay of connection.relays) params.append('relay', relay);
  return `bunker://${connection.remote_signer_pubkey}?${params.toString()}`;
}

export class Nip46ConnectionSession {
  constructor(options = {}) {
    this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    this.keys = new KeyVaultSession({ ...options, storage: this.storage, storageKey: NIP46_CLIENT_VAULT_KEY });
  }

  readConnection() {
    if (!this.storage) return null;
    try {
      const value = JSON.parse(this.storage.getItem(NIP46_CONNECTION_KEY) || 'null');
      return validConnection(value) ? value : null;
    } catch {
      return null;
    }
  }

  hasStoredConnection() {
    return Boolean(this.readConnection()) && this.keys.hasStoredKey();
  }

  describe() {
    const connection = this.readConnection();
    return connection ? { ...connection, client_pubkey: this.keys.storedPubkey() } : null;
  }

  adopt(secretKey) { this.keys.adopt(secretKey); }
  get secretKey() { return this.keys.secretKey; }

  async persist(connection, passphrase, sealOptions) {
    if (!this.storage) throw new Error('This device is marked as shared, so the pairing cannot be saved.');
    const record = {
      v: VERSION,
      remote_signer_pubkey: connection.remoteSignerPubkey,
      user_pubkey: connection.userPubkey,
      relays: [...new Set(connection.relays)],
    };
    if (!validConnection(record)) throw new Error('The signer returned an invalid connection.');
    await this.keys.persist(passphrase, sealOptions);
    try {
      this.storage.setItem(NIP46_CONNECTION_KEY, JSON.stringify(record));
    } catch (error) {
      this.keys.forget();
      throw error;
    }
    return record;
  }

  async unlock(passphrase) {
    const connection = this.readConnection();
    if (!connection || !this.keys.hasStoredKey()) throw new Error('There is no saved signer connection on this device.');
    await this.keys.unlock(passphrase);
    return { connection, secretKey: this.keys.secretKey };
  }

  touch() { return this.keys.touch(); }
  lock() { this.keys.lock(); }

  forget() {
    this.keys.forget();
    if (this.storage) this.storage.removeItem(NIP46_CONNECTION_KEY);
  }

  dispose() { this.keys.dispose(); }
}
