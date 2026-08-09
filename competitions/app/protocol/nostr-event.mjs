/**
 * NIP-01 event primitives + NIP-19 bech32 entities.
 *
 * Deliberately DOM-free so the same file runs in the browser and under
 * `node --test`. That is not tidiness: the cross-client conformance argument
 * only holds if the tests exercise the code the site actually ships, not a
 * second implementation that happens to agree today.
 *
 * Crypto comes from the vendored, audited @noble/secp256k1 (see
 * ../../../assets/vendor/nostr-crypto/PROVENANCE.md). Hashing is WebCrypto.
 * Nothing here rolls its own primitive.
 *
 * Sources (accessed 2026-08-09):
 *   NIP-01 https://github.com/nostr-protocol/nips/blob/master/01.md
 *   NIP-19 https://github.com/nostr-protocol/nips/blob/master/19.md
 */
import { schnorr, getPublicKey as secpGetPublicKey } from '../../../assets/vendor/nostr-crypto/secp256k1/secp256k1.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── bytes / hex ──

export function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('not a hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isHex32(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{128}$/.test(value);
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export function randomBytes(length) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

// ── event id ──

/**
 * NIP-01 canonical serialization: the UTF-8 JSON of
 * `[0, pubkey, created_at, kind, tags, content]` with no whitespace.
 *
 * `JSON.stringify` already produces exactly the escaping NIP-01 asks for
 * (`"`, `\`, `\n`, `\r`, `\t`, `\b`, `\f`, and other control characters as
 * `\uXXXX`), so the serialization is not hand-rolled here — a hand-rolled one
 * is precisely how two clients end up computing different ids for the same
 * event.
 */
export function serializeEvent(event) {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

export async function eventId(event) {
  return bytesToHex(await sha256(encoder.encode(serializeEvent(event))));
}

/** Structural check — shape only, no crypto. Throws with a specific reason. */
export function assertEventShape(event) {
  if (!event || typeof event !== 'object') throw new Error('event is not an object');
  if (!isHex32(event.pubkey)) throw new Error('pubkey is not 32 lowercase hex bytes');
  if (!Number.isInteger(event.created_at)) throw new Error('created_at is not an integer');
  if (!Number.isInteger(event.kind) || event.kind < 0 || event.kind > 65535) {
    throw new Error('kind is not an integer in 0..65535');
  }
  if (!Array.isArray(event.tags)) throw new Error('tags is not an array');
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.some((v) => typeof v !== 'string')) {
      throw new Error('every tag must be an array of strings');
    }
  }
  if (typeof event.content !== 'string') throw new Error('content is not a string');
  return true;
}

/**
 * Full trust boundary: the id must bind the body AND the signature must
 * authenticate the id. Checking only the signature lets a relay hand back a
 * validly signed envelope whose tags or content it swapped afterwards — the
 * same rule the Android client enforces in `NostrEventPolicy`.
 */
export async function verifyEvent(event) {
  assertEventShape(event);
  if (!isHex32(event.id)) throw new Error('id is not 32 lowercase hex bytes');
  if (!isHex64(event.sig)) throw new Error('sig is not 64 lowercase hex bytes');
  if ((await eventId(event)) !== event.id) return false;
  return schnorr.verifyAsync(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
}

// ── local key handling ──

export function generateSecretKey() {
  // Rejection-sample into [1, n-1]. `schnorr.getPublicKey` throws on an
  // out-of-range scalar, so this loop terminates on the first draw in
  // practice and never silently produces an unusable key.
  for (let i = 0; i < 8; i++) {
    const candidate = randomBytes(32);
    try {
      schnorr.getPublicKey(candidate);
      return candidate;
    } catch {
      /* astronomically unlikely; draw again */
    }
  }
  throw new Error('could not generate a valid secp256k1 secret key');
}

export function getPublicKey(secretKey) {
  return bytesToHex(schnorr.getPublicKey(secretKey));
}

/** Compressed (33-byte) public key — the form ECDH needs for NIP-44. */
export function getCompressedPublicKey(secretKey) {
  return secpGetPublicKey(secretKey, true);
}

/**
 * Stamp, id and sign an unsigned event with a raw secret key.
 * Only the local-key signer path uses this; NIP-07 and NIP-46 sign remotely
 * and the secret never exists in this process.
 */
export async function finalizeEvent(draft, secretKey) {
  const event = {
    pubkey: getPublicKey(secretKey),
    created_at: draft.created_at,
    kind: draft.kind,
    tags: draft.tags ?? [],
    content: draft.content ?? '',
  };
  assertEventShape(event);
  event.id = await eventId(event);
  event.sig = bytesToHex(await schnorr.signAsync(hexToBytes(event.id), secretKey));
  return event;
}

// ── NIP-19 bech32 ──

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GENERATOR[i];
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return out;
}

export function bech32Encode(hrp, bytes, limit = 5000) {
  const data = convertBits([...bytes], 8, 5, true);
  if (!data) throw new Error('bech32: cannot convert payload');
  const checksum = polymod(hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const combined = data.concat([0, 1, 2, 3, 4, 5].map((i) => (checksum >> (5 * (5 - i))) & 31));
  const encoded = `${hrp}1${combined.map((v) => CHARSET[v]).join('')}`;
  if (encoded.length > limit) throw new Error('bech32: too long');
  return encoded;
}

export function bech32Decode(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) return null;
  const split = lower.lastIndexOf('1');
  if (split < 1 || split + 7 > lower.length) return null;
  const hrp = lower.slice(0, split);
  const data = [];
  for (let i = split + 1; i < lower.length; i++) {
    const index = CHARSET.indexOf(lower[i]);
    if (index === -1) return null;
    data.push(index);
  }
  if (polymod(hrpExpand(hrp).concat(data)) !== 1) return null;
  const converted = convertBits(data.slice(0, -6), 5, 8, false);
  if (!converted) return null;
  return { hrp, bytes: Uint8Array.from(converted) };
}

function tlv(entries) {
  const parts = [];
  for (const [type, value] of entries) {
    if (value.length > 255) throw new Error('bech32 TLV value too long');
    parts.push(Uint8Array.from([type, value.length]), value);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function parseTlv(bytes) {
  const out = {};
  let i = 0;
  while (i + 1 < bytes.length) {
    const type = bytes[i++];
    const length = bytes[i++];
    if (i + length > bytes.length) return null;
    (out[type] ||= []).push(bytes.slice(i, i + length));
    i += length;
  }
  return out;
}

export function npubEncode(pubkeyHex) {
  return bech32Encode('npub', hexToBytes(pubkeyHex));
}

export function nsecEncode(secretKey) {
  return bech32Encode('nsec', secretKey);
}

/**
 * `naddr` for an addressable event: TLV 0 = d-tag (UTF-8), 1 = relay hint,
 * 2 = author pubkey, 3 = kind (big-endian uint32).
 */
export function naddrEncode({ identifier, pubkey, kind, relays = [] }) {
  const kindBytes = new Uint8Array(4);
  new DataView(kindBytes.buffer).setUint32(0, kind, false);
  return bech32Encode('naddr', tlv([
    [0, encoder.encode(identifier)],
    ...relays.map((r) => [1, encoder.encode(r)]),
    [2, hexToBytes(pubkey)],
    [3, kindBytes],
  ]));
}

export function decodeNip19(value) {
  const decoded = bech32Decode(value);
  if (!decoded) return null;
  const { hrp, bytes } = decoded;
  if (hrp === 'npub' || hrp === 'note') {
    if (bytes.length !== 32) return null;
    return { type: hrp, data: bytesToHex(bytes) };
  }
  if (hrp === 'nsec') {
    if (bytes.length !== 32) return null;
    return { type: 'nsec', data: bytes };
  }
  const parsed = parseTlv(bytes);
  if (!parsed) return null;
  const relays = (parsed[1] || []).map((b) => decoder.decode(b));
  if (hrp === 'nprofile') {
    const pubkey = parsed[0]?.[0];
    if (!pubkey || pubkey.length !== 32) return null;
    return { type: 'nprofile', data: { pubkey: bytesToHex(pubkey), relays } };
  }
  if (hrp === 'nevent') {
    const id = parsed[0]?.[0];
    if (!id || id.length !== 32) return null;
    const author = parsed[2]?.[0];
    return {
      type: 'nevent',
      data: {
        id: bytesToHex(id),
        relays,
        author: author && author.length === 32 ? bytesToHex(author) : undefined,
      },
    };
  }
  if (hrp === 'naddr') {
    const identifier = parsed[0]?.[0];
    const author = parsed[2]?.[0];
    const kindBytes = parsed[3]?.[0];
    if (identifier === undefined || !author || author.length !== 32 || !kindBytes || kindBytes.length !== 4) {
      return null;
    }
    return {
      type: 'naddr',
      data: {
        identifier: decoder.decode(identifier),
        pubkey: bytesToHex(author),
        kind: new DataView(kindBytes.buffer, kindBytes.byteOffset, 4).getUint32(0, false),
        relays,
      },
    };
  }
  return null;
}

/** The NIP-01 `a` tag value for an addressable event: `kind:pubkey:d`. */
export function addressOf({ kind, pubkey, identifier }) {
  return `${kind}:${pubkey}:${identifier}`;
}

export function parseAddress(value) {
  if (typeof value !== 'string') return null;
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  if (first === -1 || second === -1) return null;
  const kind = Number(value.slice(0, first));
  const pubkey = value.slice(first + 1, second);
  if (!Number.isInteger(kind) || !isHex32(pubkey)) return null;
  return { kind, pubkey, identifier: value.slice(second + 1) };
}

/** First value of the first tag named `name`, or undefined. */
export function tagValue(event, name) {
  const tag = (event.tags || []).find((t) => t[0] === name);
  return tag ? tag[1] : undefined;
}

/** Every value of every tag named `name`. */
export function tagValues(event, name) {
  return (event.tags || []).filter((t) => t[0] === name).map((t) => t[1]);
}
