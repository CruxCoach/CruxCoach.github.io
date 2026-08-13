import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAIM_SCHEMA, buildClaimBody, validateClaimInput, verifyClaim, eligibleWinner, claimDeadline,
} from '../competitions/app/protocol/prize.mjs';

/**
 * Who may claim a prize, and what a claim may say.
 *
 * These are the cases where being wrong costs somebody real money: paying the
 * wrong person, paying twice, paying against standings that have since been
 * corrected, or paying an invoice for an amount nobody agreed to.
 *
 * Nothing here holds money. A prize is the organizer's promise and these rules
 * only decide whether a request to be paid is a legitimate one.
 */

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const RESULTS = '1234567890abcdef'.repeat(4);

const CASH = { id: 'place_1', rank: 1, kind: 'cash', value_msat: 500_000, label: 'First' };
const GOODS = { id: 'place_2', rank: 2, kind: 'non_cash', label: 'Chalk bag' };

const STANDINGS = [
  { rank: 1, pubkey: ALICE, division: 'open', display: 'Alice' },
  { rank: 2, pubkey: BOB, division: 'open', display: 'Bob' },
  { rank: 3, pubkey: CAROL, division: 'open', display: 'Carol' },
];

/** A 500-sat invoice, structurally valid and deliberately unpayable. */
function invoice(amountMsat = 500_000, { expirySec = 3600, timestamp = 1_789_000_000 } = {}) {
  // Built the same way the fixtures build theirs: real prefix, real checksum,
  // a signature of zeros. Nothing can settle it.
  const words = [];
  for (let i = 6; i >= 0; i--) words.push((timestamp >> (5 * i)) & 31);
  const field = (type, value) => {
    words.push(type, (value.length >> 5) & 31, value.length & 31, ...value);
  };
  const hexWords = (hex) => {
    const bits = [...hex.matchAll(/../g)]
      .map(([pair]) => parseInt(pair, 16).toString(2).padStart(8, '0')).join('');
    return [...bits.matchAll(/.{1,5}/g)].map(([chunk]) => parseInt(chunk.padEnd(5, '0'), 2));
  };
  field(1, hexWords('a'.repeat(64)));
  field(6, [(expirySec >> 5) & 31, expirySec & 31]);
  for (let i = 0; i < 104; i++) words.push(0);

  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const polymod = (values) => {
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  };
  const hrp = `lnbc${amountMsat / 100000}u`;
  const expand = [...hrp].map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const chk = polymod(expand.concat(words).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const tail = [...Array(6)].map((_, i) => (chk >> (5 * (5 - i))) & 31);
  return `${hrp}1${words.concat(tail).map((w) => CHARSET[w]).join('')}`;
}

const expected = (overrides = {}) => ({
  compId: 'aa00bb11cc22dd33',
  claimantPubkey: ALICE,
  resultsHash: RESULTS,
  standings: STANDINGS,
  prizes: [CASH, GOODS],
  prizeStates: {},
  nowSeconds: 1_789_000_500,
  ...overrides,
});

const body = (overrides = {}) => buildClaimBody({
  compId: 'aa00bb11cc22dd33',
  prizeId: 'place_1',
  resultsHash: RESULTS,
  payoutKind: 'lightning_address',
  destination: 'alice@example.org',
  ...overrides,
});

// ── eligibility ──

test('the winner of a prize is the one person standing at its rank', () => {
  assert.equal(eligibleWinner(STANDINGS, CASH).pubkey, ALICE);
  assert.equal(eligibleWinner(STANDINGS, GOODS).pubkey, BOB);
});

test('a prize for a division is claimed from that division only', () => {
  const standings = [
    { rank: 1, pubkey: ALICE, division: 'open' },
    { rank: 1, pubkey: BOB, division: 'youth' },
  ];
  assert.equal(eligibleWinner(standings, { ...CASH, division: 'youth' }).pubkey, BOB);
  assert.equal(eligibleWinner(standings, { ...CASH, division: 'open' }).pubkey, ALICE);
});

test('a tie makes nobody automatically eligible', () => {
  // Two people share first place. No protocol can decide which of them the
  // money is for, so neither is handed it — the organizer has to choose.
  const tied = [
    { rank: 1, pubkey: ALICE, division: 'open' },
    { rank: 1, pubkey: BOB, division: 'open' },
  ];
  assert.equal(eligibleWinner(tied, CASH), null);
  const result = verifyClaim(body(), expected({ standings: tied }));
  assert.equal(result.error, 'nobody_is_eligible');
});

test('a rank nobody reached is claimable by nobody', () => {
  assert.equal(eligibleWinner(STANDINGS, { ...CASH, rank: 9 }), null);
});

// ── the claim itself ──

test('a well-formed claim from the actual winner verifies', () => {
  const result = verifyClaim(body(), expected());
  assert.equal(result.ok, true, result.error);
  assert.equal(result.prize.id, 'place_1');
  assert.equal(result.claim.destination, 'alice@example.org');
});

test('a claim signed by anyone but the winner is refused', () => {
  // The intent is signed, so this is the case where somebody else's key sends
  // a perfectly well-formed claim for a prize they did not win.
  const result = verifyClaim(body(), expected({ claimantPubkey: CAROL }));
  assert.equal(result.error, 'not_the_winner');
});

test('a claim cannot be replayed into another competition', () => {
  const result = verifyClaim(body(), expected({ compId: 'ffffffffffffffff' }));
  assert.equal(result.error, 'wrong_competition');
});

test('a claim made against superseded results is refused', () => {
  // A correction moved the standings. Paying out on the numbers this claim was
  // made against would pay the wrong person for a reason nobody could see.
  const result = verifyClaim(body(), expected({ resultsHash: 'f'.repeat(64) }));
  assert.equal(result.error, 'stale_results');
  // And a claim with no results binding at all is not a claim.
  assert.equal(
    verifyClaim(body({ resultsHash: 'not-a-hash' }), expected()).error,
    'stale_results',
  );
});

test('a prize somebody already holds cannot be claimed by somebody else', () => {
  const states = { place_1: { pubkey: BOB, state: 'approved' } };
  assert.equal(verifyClaim(body(), expected({ prizeStates: states })).error, 'already_awarded');

  // The person who holds it may still send another claim — a corrected invoice,
  // say — and that must not be mistaken for a second winner.
  const mine = { place_1: { pubkey: ALICE, state: 'approved' } };
  assert.equal(verifyClaim(body(), expected({ prizeStates: mine })).ok, true);
});

test('a claim after the deadline is refused', () => {
  const deadline = 1_789_000_400;
  assert.equal(
    verifyClaim(body(), expected({ deadline, nowSeconds: deadline + 1 })).error,
    'deadline_passed',
  );
  assert.equal(verifyClaim(body(), expected({ deadline, nowSeconds: deadline })).ok, true);
});

test('malicious or malformed ciphertext is an ordinary outcome, not a crash', () => {
  for (const [plaintext, error] of [
    ['not json at all', 'unreadable'],
    ['{}', 'unknown_schema'],
    [JSON.stringify({ schema: 'something/else' }), 'unknown_schema'],
    [JSON.stringify({ schema: CLAIM_SCHEMA, comp_id: 'aa00bb11cc22dd33', prize_id: 'nope' }), 'unknown_prize'],
  ]) {
    assert.equal(verifyClaim(plaintext, expected()).error, error, plaintext.slice(0, 30));
  }
});

// ── payout destinations ──

test('a lightning address destination is held to the same rules as an entry fee', () => {
  const ok = validateClaimInput({ prize: CASH, payoutKind: 'lightning_address', destination: 'alice@example.org' });
  assert.equal(ok.ok, true);

  for (const [destination, error] of [
    ['http://example.org/pay', 'destination_not_https'],
    ['alice@abcdefgh.onion', 'destination_onion'],
    ['https://evil.example@bank.example/pay', 'destination_bad_url'],
    ['', 'no_destination'],
  ]) {
    assert.equal(
      validateClaimInput({ prize: CASH, payoutKind: 'lightning_address', destination }).error,
      error,
      destination,
    );
  }
});

test('an invoice destination must be for the prize amount and still alive', () => {
  const good = invoice(CASH.value_msat);
  assert.equal(
    validateClaimInput({ prize: CASH, payoutKind: 'bolt11', destination: good, nowSeconds: 1_789_000_500 }).ok,
    true,
  );

  // For more than the prize, or less: both are asking to be paid something
  // other than what was promised.
  assert.equal(
    validateClaimInput({ prize: CASH, payoutKind: 'bolt11', destination: invoice(1_000_000) }).error,
    'destination_wrong_amount',
  );
  assert.equal(
    validateClaimInput({ prize: CASH, payoutKind: 'bolt11', destination: invoice(100_000) }).error,
    'destination_wrong_amount',
  );

  // An expired invoice cannot be paid, so it must not reach the organizer.
  assert.equal(
    validateClaimInput({
      prize: CASH,
      payoutKind: 'bolt11',
      destination: invoice(CASH.value_msat, { expirySec: 60 }),
      nowSeconds: 1_789_000_000 + 61,
    }).error,
    'destination_expired',
  );

  assert.equal(
    validateClaimInput({ prize: CASH, payoutKind: 'bolt11', destination: 'lnbc-nonsense' }).error,
    'destination_unreadable_invoice',
  );
});

test('a non-cash prize collects contact details, not a wallet', () => {
  assert.equal(
    validateClaimInput({ prize: GOODS, payoutKind: 'non_cash', destination: 'I will collect it at the desk' }).ok,
    true,
  );
  // Keeping the two apart matters: a t-shirt is not a Lightning payout and a
  // screen that blurred them would ask for a wallet to hand over a t-shirt.
  assert.equal(
    validateClaimInput({ prize: GOODS, payoutKind: 'lightning_address', destination: 'bob@example.org' }).error,
    'not_a_cash_prize',
  );
  assert.equal(
    validateClaimInput({ prize: CASH, payoutKind: 'non_cash', destination: 'call me' }).error,
    'cash_prize_needs_a_wallet',
  );
});

test('the claim body carries no more than it must, and says which schema it is', () => {
  const parsed = JSON.parse(body({ note: 'thanks!' }));
  assert.deepEqual(Object.keys(parsed).sort(), [
    'comp_id', 'destination', 'note', 'payout_kind', 'prize_id', 'results_hash', 'schema',
  ]);
  assert.equal(parsed.schema, CLAIM_SCHEMA);
});

test('the claim deadline defaults to thirty days after the results', () => {
  const at = 1_789_000_000;
  assert.equal(claimDeadline(at, 30), at + 30 * 86400);
  assert.equal(claimDeadline(at, undefined), at + 30 * 86400);
  assert.equal(claimDeadline(at, 7), at + 7 * 86400);
});

// ── the encrypted channel, on a real key ──

test('a claim survives the round trip through NIP-44 and still verifies', async () => {
  // The end the organizer sees: a ciphertext off a relay, decrypted with their
  // own key, checked against the standings before anybody looks at a wallet
  // address.
  const { KeyVaultSession } = await import('../competitions/app/signer/local-key.mjs');
  const { createLocalSigner } = await import('../competitions/app/signer/signers.mjs');

  const winnerSession = new KeyVaultSession({ storage: null });
  winnerSession.generate();
  const organizerSession = new KeyVaultSession({ storage: null });
  organizerSession.generate();
  const winner = createLocalSigner(winnerSession);
  const organizer = createLocalSigner(organizerSession);

  try {
    const standings = [{ rank: 1, pubkey: winner.pubkey, division: 'open', display: 'Winner' }];
    const plaintext = buildClaimBody({
      compId: 'aa00bb11cc22dd33',
      prizeId: 'place_1',
      resultsHash: RESULTS,
      payoutKind: 'lightning_address',
      destination: 'winner@example.org',
    });

    const ciphertext = await winner.encrypt(organizer.pubkey, plaintext);
    assert.notEqual(ciphertext, plaintext, 'the destination must not travel in the clear');
    assert.ok(!ciphertext.includes('winner@example.org'), 'nor appear inside the ciphertext');

    const decrypted = await organizer.decrypt(winner.pubkey, ciphertext);
    const result = verifyClaim(decrypted, {
      compId: 'aa00bb11cc22dd33',
      claimantPubkey: winner.pubkey,
      resultsHash: RESULTS,
      standings,
      prizes: [CASH],
      prizeStates: {},
      nowSeconds: 1_789_000_500,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.claim.destination, 'winner@example.org');

    // And the same ciphertext, presented as somebody else's claim, is refused
    // on eligibility rather than on decryption.
    const impostor = verifyClaim(decrypted, {
      compId: 'aa00bb11cc22dd33',
      claimantPubkey: CAROL,
      resultsHash: RESULTS,
      standings,
      prizes: [CASH],
      prizeStates: {},
      nowSeconds: 1_789_000_500,
    });
    assert.equal(impostor.error, 'not_the_winner');
  } finally {
    winnerSession.dispose();
    organizerSession.dispose();
  }
});

test('a stranger cannot read a claim addressed to the organizer', async () => {
  const { KeyVaultSession } = await import('../competitions/app/signer/local-key.mjs');
  const { createLocalSigner } = await import('../competitions/app/signer/signers.mjs');

  const sessions = [new KeyVaultSession({ storage: null }), new KeyVaultSession({ storage: null }),
    new KeyVaultSession({ storage: null })];
  sessions.forEach((session) => session.generate());
  const [winner, organizer, stranger] = sessions.map(createLocalSigner);

  try {
    const ciphertext = await winner.encrypt(organizer.pubkey, buildClaimBody({
      compId: 'aa00bb11cc22dd33',
      prizeId: 'place_1',
      resultsHash: RESULTS,
      payoutKind: 'lightning_address',
      destination: 'winner@example.org',
    }));
    await assert.rejects(() => stranger.decrypt(winner.pubkey, ciphertext));
  } finally {
    sessions.forEach((session) => session.dispose());
  }
});
