/**
 * A BOLT11 invoice that nothing can pay.
 *
 * Structurally valid — correct human-readable prefix, timestamp, tagged fields
 * and checksum — with a signature of all zeros. That is deliberate and load
 * bearing: the fixtures and tests need an invoice the decoder can read, and
 * they must never contain one a wallet would try to settle.
 *
 * Used by the fixture builder and by the end-to-end tests, so there is one
 * implementation of it rather than two that can drift.
 */
import { bech32EncodeWords, hexToBytes } from '../../competitions/app/protocol/nostr-event.mjs';

function hexToWords(hex) {
  const bits = [...hexToBytes(hex)]
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join('');
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
  const words = [];
  for (let i = 0; i < padded.length; i += 5) words.push(parseInt(padded.slice(i, i + 5), 2));
  return words;
}

/**
 * @param {object} args
 * @param {number} args.amountMsat must be a whole micro-bitcoin (100000 msat)
 * @param {number} args.timestamp
 * @param {number} args.expirySec
 * @param {string} args.paymentHash 32 bytes of hex
 * @param {string} [args.descriptionHash] 32 bytes of hex; omit for an invoice
 *        that carries no description hash, which NIP-57 permits and which the
 *        verifier must treat as weakly bound rather than as invalid
 */
export function fakeInvoice({
  amountMsat, timestamp, expirySec, paymentHash, descriptionHash,
}) {
  const words = [];
  for (let i = 6; i >= 0; i--) words.push((timestamp >> (5 * i)) & 31);

  const field = (type, valueWords) => {
    words.push(type);
    words.push((valueWords.length >> 5) & 31, valueWords.length & 31);
    words.push(...valueWords);
  };

  field(1, hexToWords(paymentHash)); // p — payment hash
  if (descriptionHash) field(23, hexToWords(descriptionHash)); // h
  field(6, [(expirySec >> 5) & 31, expirySec & 31]); // x — expiry
  for (let i = 0; i < 104; i++) words.push(0); // signature: deliberately not one

  const micro = amountMsat / 100000;
  if (!Number.isInteger(micro)) throw new Error('amount must be a whole micro-bitcoin');
  return bech32EncodeWords(`lnbc${micro}u`, words);
}
