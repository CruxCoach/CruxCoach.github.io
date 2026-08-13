/**
 * Claiming a prize — FEAT-058 §11.7.
 *
 * A cash prize is one person's promise to pay another. CruxCoach holds nothing,
 * escrows nothing and guarantees nothing, so this file is not a payment system:
 * it is the part that makes a promise *checkable* — who is entitled, to which
 * prize, against which results — and keeps the payout details out of public
 * view while it happens.
 *
 * Two rules shape everything here.
 *
 * **Nothing private goes in the log.** A Lightning address, an invoice, a
 * preimage or a postal address in a public competition record would publish the
 * one thing a winner has most reason to keep to themselves, permanently and
 * next to their identity. The claim body is NIP-44 encrypted to the organizer;
 * the log carries a status and nothing else.
 *
 * **A claim is bound to one result.** It names the competition, the prize and
 * the `results_hash` of the standings it was made against. That is what stops a
 * claim being replayed into another competition, and what makes a corrected
 * result invalidate the claims made against the old one rather than silently
 * paying out on numbers that have since changed.
 */
import { resolvePayEndpoint } from './lnurl.mjs';
import { decodeInvoice } from './bolt11.mjs';
import { isHex32 } from './nostr-event.mjs';

/** The claim body, before encryption. Version so a later shape is detectable. */
export const CLAIM_SCHEMA = 'cruxcoach-prize-claim/1';

/** How a winner wants to be paid. */
export const PAYOUT_KINDS = ['lightning_address', 'bolt11', 'non_cash'];

/**
 * Build the plaintext a winner encrypts to the organizer.
 *
 * @param {object} args
 * @param {string} args.compId
 * @param {string} args.prizeId
 * @param {string} args.resultsHash the standings this claim is made against
 * @param {string} args.payoutKind one of PAYOUT_KINDS
 * @param {string} args.destination a lightning address, an invoice, or contact
 *        details for a non-cash prize
 * @param {string} [args.note] anything the winner wants to add
 */
export function buildClaimBody({ compId, prizeId, resultsHash, payoutKind, destination, note }) {
  return JSON.stringify({
    schema: CLAIM_SCHEMA,
    comp_id: compId,
    prize_id: prizeId,
    results_hash: resultsHash,
    payout_kind: payoutKind,
    destination: String(destination || '').trim(),
    ...(note ? { note: String(note).slice(0, 280) } : {}),
  });
}

/**
 * Check a winner's own claim before it is sent.
 *
 * Refusing early is kinder than an organizer refusing later: the winner is
 * standing there and can fix it, and a malformed destination that reached the
 * organizer would be a payout that silently never arrives.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateClaimInput({ prize, payoutKind, destination, nowSeconds }) {
  if (!PAYOUT_KINDS.includes(payoutKind)) return fail('unknown_payout_kind');
  const text = String(destination || '').trim();
  if (!text) return fail('no_destination');

  if (prize?.kind === 'non_cash') {
    if (payoutKind !== 'non_cash') return fail('not_a_cash_prize');
    if (text.length > 500) return fail('too_long');
    return { ok: true };
  }

  if (payoutKind === 'non_cash') return fail('cash_prize_needs_a_wallet');

  if (payoutKind === 'lightning_address') {
    const resolved = resolvePayEndpoint(text);
    // The same rules as an entry fee: https only, never .onion, no credentials
    // in the authority. A payout destination deserves them at least as much.
    if (!resolved.ok) return fail(`destination_${resolved.error}`);
    return { ok: true };
  }

  const decoded = decodeInvoice(text);
  if (!decoded.ok) return fail('destination_unreadable_invoice');
  if (decoded.amountMsat === null) return fail('destination_no_amount');
  if (prize && decoded.amountMsat !== prize.value_msat) {
    // An invoice for the wrong amount is the winner asking to be paid something
    // other than the prize, whichever direction it errs in.
    return fail('destination_wrong_amount');
  }
  if (Number.isInteger(nowSeconds) && decoded.expiresAt <= nowSeconds) {
    return fail('destination_expired');
  }
  return { ok: true };
}

/**
 * Read and check a claim the organizer decrypted.
 *
 * Takes everything it compares against as arguments: a verifier that fetched
 * its own idea of the standings could be pointed at the wrong ones.
 *
 * @param {string} plaintext the decrypted claim body
 * @param {object} expected
 * @param {string} expected.compId
 * @param {string} expected.claimantPubkey who signed the intent
 * @param {string} expected.resultsHash the final standings' hash
 * @param {Array} expected.standings final standings, ranked
 * @param {Array} expected.prizes the competition's prizes
 * @param {object} expected.prizeStates current `state.prizes`
 * @param {number} [expected.nowSeconds]
 * @param {number} [expected.deadline] claims close at this time
 * @returns {{ok: true, claim: object, prize: object} | {ok: false, error: string}}
 */
export function verifyClaim(plaintext, expected) {
  let claim;
  try {
    claim = JSON.parse(plaintext);
  } catch {
    // Anyone can send an organizer a ciphertext. Malformed plaintext is an
    // ordinary outcome, not an exception.
    return fail('unreadable');
  }
  if (claim?.schema !== CLAIM_SCHEMA) return fail('unknown_schema');
  if (claim.comp_id !== expected.compId) return fail('wrong_competition');

  const prize = (expected.prizes || []).find((p) => p.id === claim.prize_id);
  if (!prize) return fail('unknown_prize');

  // Bound to the standings it was made against, so a correction does not
  // silently pay out on numbers that have since moved.
  if (!isHex32(claim.results_hash) || claim.results_hash !== expected.resultsHash) {
    return fail('stale_results');
  }

  const held = (expected.prizeStates || {})[prize.id];
  if (held && ['approved', 'paid'].includes(held.state) && held.pubkey !== expected.claimantPubkey) {
    return fail('already_awarded');
  }

  const winner = eligibleWinner(expected.standings, prize);
  if (!winner) return fail('nobody_is_eligible');
  if (winner.pubkey !== expected.claimantPubkey) return fail('not_the_winner');

  if (Number.isInteger(expected.deadline) && Number.isInteger(expected.nowSeconds)
    && expected.nowSeconds > expected.deadline) {
    return fail('deadline_passed');
  }

  const input = validateClaimInput({
    prize,
    payoutKind: claim.payout_kind,
    destination: claim.destination,
    nowSeconds: expected.nowSeconds,
  });
  if (!input.ok) return fail(input.error);

  return { ok: true, claim, prize };
}

/**
 * Who is entitled to a prize.
 *
 * A prize names a rank and, where the competition has divisions, one division.
 * Ranking inside a division is by the order the standings already put people
 * in, because that is the order the reducer produced and every client agrees on.
 */
export function eligibleWinner(standings, prize) {
  const rows = (standings || []).filter(
    (row) => !prize.division || row.division === prize.division,
  );
  if (rows.length === 0) return null;

  // A tie means two people share a rank, and no protocol can decide which of
  // them the money is for. The organizer has to, so nobody is auto-eligible.
  const atRank = rows.filter((row) => row.rank === prize.rank);
  if (atRank.length !== 1) return null;
  return atRank[0];
}

/** When claims close, in epoch seconds. */
export function claimDeadline(resultsAt, claimDays) {
  const days = Number.isInteger(claimDays) && claimDays > 0 ? claimDays : 30;
  return resultsAt + days * 24 * 60 * 60;
}

function fail(error) {
  return { ok: false, error };
}
