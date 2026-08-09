/**
 * Zap requests and receipts, for a competition entry fee — FEAT-058 §11.2.
 *
 * The point of this file is one sentence from the spec: **a zap receipt is a
 * provider's attestation, not a proof of payment.** It is signed by whoever the
 * LNURL endpoint said would sign it, and that is all it is. So the question a
 * competition client can actually answer is narrow, and this file answers only
 * that question:
 *
 *   Is this receipt signed by the key this competition's own payment endpoint
 *   named, over the zap request this entrant signed, for this competition, for
 *   the right amount, referencing the invoice we issued?
 *
 * Every one of those has to hold. Dropping any of them produces a different
 * attack: any relay user could mint a receipt (signer), somebody else's payment
 * could settle your entry (payer), a receipt for another competition could be
 * replayed (address), or a 1-sat payment could settle a 2000-sat fee (amount).
 *
 * When the answer is no, the organizer is not blocked — they can still record
 * the payment by hand, but as an override that carries their name and a reason,
 * which is a different thing from a button that says "settled".
 */
import { verifyEvent } from './nostr-event.mjs';
import { sha256Hex } from './ccj.mjs';
import { decodeInvoice } from './bolt11.mjs';

export const ZAP_REQUEST_KIND = 9734;
export const ZAP_RECEIPT_KIND = 9735;

/** The tag that ties a zap to the registration it is paying for. */
export const INTENT_TAG = 'cc-intent';

/**
 * Build the kind-9734 a participant signs before asking for an invoice.
 *
 * @param {object} args
 * @param {string} args.recipientPubkey who is being paid (the organizer)
 * @param {string} args.address the competition's `a` address
 * @param {number} args.amountMsat the entry fee
 * @param {string[]} args.relays where the receipt should be published
 * @param {string} args.nonce the registration intent's nonce, so a receipt can
 *        be matched to a specific attempt to enter rather than to a person
 * @param {number} args.createdAt
 */
export function buildZapRequest({
  recipientPubkey, address, amountMsat, relays, nonce, createdAt, comment,
}) {
  return {
    kind: ZAP_REQUEST_KIND,
    created_at: createdAt,
    tags: [
      ['p', recipientPubkey],
      ['a', address],
      ['amount', String(amountMsat)],
      ['relays', ...relays],
      [INTENT_TAG, nonce],
    ],
    content: comment || 'CruxCoach competition entry',
  };
}

const tag = (event, name) => (event.tags || []).find((t) => t[0] === name);

/**
 * Verify a zap receipt against everything it has to agree with.
 *
 * Deliberately takes the expectations as arguments rather than reading them
 * from anywhere: a verifier that fetches its own idea of what is correct can be
 * pointed at the wrong competition.
 *
 * @param {object} receipt the kind-9735 event
 * @param {object} expected
 * @param {string} expected.providerPubkey `nostrPubkey` from THIS competition's
 *        LNURL endpoint — not from the receipt, and not from anywhere else
 * @param {string} expected.payerPubkey the entrant
 * @param {string} expected.recipientPubkey the organizer
 * @param {string} expected.address the competition address
 * @param {number} expected.amountMsat the fee
 * @param {string} [expected.nonce] the registration intent nonce
 * @param {number} [expected.notBefore] earliest `created_at` this may have
 * @param {number} [expected.notAfter] latest `created_at` this may have
 * @returns {Promise<{ok: true, amountMsat: number} | {ok: false, error: string}>}
 */
export async function verifyZapReceipt(receipt, expected) {
  if (!receipt || receipt.kind !== ZAP_RECEIPT_KIND) return fail('not_a_receipt');
  if (!expected?.providerPubkey) {
    // Not "unverified" — unverifiABLE. The endpoint never named a key, so there
    // is nothing a signature could be checked against.
    return fail('no_provider_key');
  }
  if (receipt.pubkey !== expected.providerPubkey) return fail('wrong_signer');
  if (!(await verifyEvent(receipt).catch(() => false))) return fail('bad_signature');

  if (tag(receipt, 'p')?.[1] !== expected.recipientPubkey) return fail('wrong_recipient');
  if (expected.address && tag(receipt, 'a')?.[1] !== expected.address) return fail('wrong_competition');

  const bolt11 = tag(receipt, 'bolt11')?.[1];
  if (!bolt11) return fail('no_invoice');

  const description = tag(receipt, 'description')?.[1];
  if (!description) return fail('no_description');

  let request;
  try {
    request = JSON.parse(description);
  } catch {
    return fail('bad_description');
  }
  if (!request || request.kind !== ZAP_REQUEST_KIND) return fail('bad_description');

  // The description is the zap request verbatim, so its own signature has to
  // hold. Without this anyone could paste a request naming somebody else.
  if (!(await verifyEvent(request).catch(() => false))) return fail('bad_request_signature');
  if (request.pubkey !== expected.payerPubkey) return fail('wrong_payer');
  if (tag(request, 'p')?.[1] !== expected.recipientPubkey) return fail('request_wrong_recipient');
  if (expected.address && tag(request, 'a')?.[1] !== expected.address) return fail('request_wrong_competition');

  const requested = Number(tag(request, 'amount')?.[1]);
  if (!Number.isInteger(requested)) return fail('no_amount');
  if (requested !== expected.amountMsat) return fail('wrong_amount');

  if (expected.nonce && tag(request, INTENT_TAG)?.[1] !== expected.nonce) {
    return fail('wrong_registration');
  }

  // A `P` tag is optional in NIP-57, but when the provider includes one it must
  // agree with the request it is attesting to.
  const payerTag = tag(receipt, 'P')?.[1];
  if (payerTag && payerTag !== expected.payerPubkey) return fail('wrong_payer');

  // Last, because the checks above produce the more useful answer when both
  // fail: the invoice itself. Its amount has to cover the fee, and where it
  // carries a description hash that hash has to be over this exact request —
  // the one thing here that is cryptography rather than trust.
  const invoice = decodeInvoice(bolt11);
  if (!invoice.ok) return fail('unreadable_invoice');
  if (invoice.amountMsat !== null && invoice.amountMsat < expected.amountMsat) {
    return fail('invoice_too_small');
  }

  let weaklyBound = false;
  if (invoice.descriptionHash) {
    if (invoice.descriptionHash !== await sha256Hex(description)) {
      return fail('invoice_not_bound');
    }
  } else {
    // NIP-57 makes the description hash a SHOULD. A receipt without one still
    // counts, but the audit trail says it was bound weakly rather than
    // pretending the strongest check happened.
    weaklyBound = true;
  }

  if (Number.isInteger(expected.notBefore) && receipt.created_at < expected.notBefore) {
    return fail('receipt_too_early');
  }
  if (Number.isInteger(expected.notAfter) && receipt.created_at > expected.notAfter) {
    return fail('receipt_too_late');
  }

  return { ok: true, amountMsat: requested, bolt11, weaklyBound };
}

function fail(error) {
  return { ok: false, error };
}

/**
 * Does this receipt's invoice match the one we showed?
 *
 * Kept separate because it is the one check a client can only make when it
 * still has the invoice it issued — after a reload it does not, and the rest of
 * the verification still stands on its own.
 */
export function receiptMatchesInvoice(receipt, invoice) {
  const bolt11 = tag(receipt, 'bolt11')?.[1];
  if (!bolt11 || !invoice) return false;
  return bolt11.trim().toLowerCase() === String(invoice).trim().toLowerCase();
}

/**
 * The description hash an LNURL provider must commit the invoice to (NIP-57).
 *
 * sha256 of the zap request as it was sent, so a provider cannot swap in a
 * different request after the fact.
 */
export async function zapDescriptionHash(zapRequest) {
  return sha256Hex(JSON.stringify(zapRequest));
}

/** A relay filter that finds receipts for one competition. */
export function receiptFilter({ recipientPubkey, address, since }) {
  const filter = { kinds: [ZAP_RECEIPT_KIND], '#p': [recipientPubkey], limit: 200 };
  if (address) filter['#a'] = [address];
  if (Number.isInteger(since)) filter.since = since;
  return filter;
}
