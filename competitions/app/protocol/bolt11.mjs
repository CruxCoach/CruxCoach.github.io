/**
 * Just enough BOLT11 to be honest about an invoice — FEAT-058 §11.3.
 *
 * A competition client does not pay invoices and does not need to verify their
 * signatures; a wallet does both. What it needs is to be able to say four true
 * things about the invoice it is showing someone:
 *
 *   - how much it is for, so "2000 sats" is not a number we made up
 *   - when it expires, so an entrant is not left staring at a dead invoice
 *   - its payment hash, so a zap receipt can be matched to *this* invoice
 *   - its description hash, which under NIP-57 commits the invoice to the zap
 *     request — the binding that makes a receipt mean "this person paid this
 *     competition" rather than "somebody paid something"
 *
 * Anything it cannot read, it says it cannot read. A parser that guesses here
 * would let a mismatched invoice through as a match.
 */
import { bech32DecodeWords, wordsToBytes, bytesToHex } from './nostr-event.mjs';

/**
 * Multipliers on the human-readable amount, in millisatoshi per unit.
 *
 * `p` is absent on purpose: pico-bitcoin is a *tenth* of a millisatoshi, so it
 * cannot be a whole-number multiplier and is handled separately below.
 */
const MULTIPLIERS = {
  m: 100000000n, // milli: 10^-3 BTC
  u: 100000n, //    micro: 10^-6 BTC
  n: 100n, //       nano:  10^-9 BTC
};
const UNITS = ['m', 'u', 'n', 'p'];

const NETWORKS = ['bcrt', 'tbs', 'tb', 'bcs', 'bs', 'bc'];

/** The default when an invoice carries no `x` field (BOLT11 §Tagged fields). */
export const DEFAULT_EXPIRY_SEC = 3600;

/**
 * Split `lnbc20u` into its network and its amount in msat.
 *
 * @returns {{network: string, amountMsat: number|null} | null}
 */
export function parseHrp(hrp) {
  if (typeof hrp !== 'string' || !hrp.startsWith('ln')) return null;
  const rest = hrp.slice(2);
  const network = NETWORKS.find((n) => rest.startsWith(n));
  if (!network) return null;

  const amount = rest.slice(network.length);
  if (amount === '') return { network, amountMsat: null };

  const last = amount[amount.length - 1];
  const hasUnit = UNITS.includes(last);
  const digits = hasUnit ? amount.slice(0, -1) : amount;
  if (!/^[0-9]+$/.test(digits)) return null;
  const value = BigInt(digits);

  if (!hasUnit) {
    // A bare number is whole bitcoin.
    return { network, amountMsat: Number(value * 100000000000n) };
  }
  if (last === 'p') {
    // Pico-bitcoin is a tenth of a millisatoshi; only multiples of ten are
    // expressible, and BOLT11 says an invoice that is not is invalid.
    if (value % 10n !== 0n) return null;
    return { network, amountMsat: Number(value / 10n) };
  }
  return { network, amountMsat: Number(value * MULTIPLIERS[last]) };
}

/** Read a big-endian integer out of 5-bit words. */
function wordsToInt(words) {
  return words.reduce((total, word) => total * 32 + word, 0);
}

/**
 * Decode an invoice.
 *
 * @returns {{ok: true, network: string, amountMsat: number|null, timestamp: number,
 *            expirySec: number, expiresAt: number, paymentHash: string|null,
 *            descriptionHash: string|null, description: string|null, payee: string|null}
 *          | {ok: false, error: string}}
 */
export function decodeInvoice(invoice) {
  if (typeof invoice !== 'string' || invoice.length < 20) return { ok: false, error: 'empty' };
  const decoded = bech32DecodeWords(invoice.trim());
  if (!decoded) return { ok: false, error: 'not_bech32' };

  const hrp = parseHrp(decoded.hrp);
  if (!hrp) return { ok: false, error: 'not_an_invoice' };

  const words = decoded.words;
  // 7 words of timestamp, then tagged fields, then 104 words of signature.
  if (words.length < 7 + 104) return { ok: false, error: 'too_short' };
  const timestamp = wordsToInt(words.slice(0, 7));
  const fields = words.slice(7, words.length - 104);

  let expirySec = null;
  let paymentHash = null;
  let descriptionHash = null;
  let description = null;
  let payee = null;

  let i = 0;
  while (i + 3 <= fields.length) {
    const type = fields[i];
    const length = fields[i + 1] * 32 + fields[i + 2];
    const start = i + 3;
    const end = start + length;
    if (end > fields.length) return { ok: false, error: 'truncated_field' };
    const value = fields.slice(start, end);
    i = end;

    switch (type) {
      case 1: // p — payment hash, 52 words = 256 bits
        if (length === 52 && paymentHash === null) paymentHash = hex(value);
        break;
      case 23: // h — description hash
        if (length === 52 && descriptionHash === null) descriptionHash = hex(value);
        break;
      case 13: // d — description
        if (description === null) description = text(value);
        break;
      case 19: // n — payee node id, 53 words = 264 bits
        if (length === 53 && payee === null) payee = hex(value);
        break;
      case 6: // x — expiry, in seconds
        if (expirySec === null) expirySec = wordsToInt(value);
        break;
      default:
        // Unknown fields are skipped by length, which is exactly why the
        // length is part of the format.
        break;
    }
  }

  const expiry = expirySec === null ? DEFAULT_EXPIRY_SEC : expirySec;
  return {
    ok: true,
    network: hrp.network,
    amountMsat: hrp.amountMsat,
    timestamp,
    expirySec: expiry,
    expiresAt: timestamp + expiry,
    paymentHash,
    descriptionHash,
    description,
    payee,
  };
}

function hex(words) {
  const bytes = wordsToBytes(words);
  return bytes ? bytesToHex(bytes) : null;
}

function text(words) {
  const bytes = wordsToBytes(words);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Whether an invoice is past its expiry at `nowSeconds`. */
export function isExpired(decoded, nowSeconds) {
  return Boolean(decoded?.ok) && nowSeconds >= decoded.expiresAt;
}

/** Seconds left before it expires, floored at zero. */
export function secondsLeft(decoded, nowSeconds) {
  if (!decoded?.ok) return 0;
  return Math.max(0, decoded.expiresAt - nowSeconds);
}

/** The URI a wallet on the same device opens. */
export function walletUri(invoice) {
  return `lightning:${String(invoice || '').trim().toLowerCase()}`;
}
