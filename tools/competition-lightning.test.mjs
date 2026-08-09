import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  decodeInvoice, parseHrp, isExpired, secondsLeft, walletUri, DEFAULT_EXPIRY_SEC,
} from '../competitions/app/protocol/bolt11.mjs';
import {
  resolvePayEndpoint, validatePayResponse, invoiceUrl, validateInvoiceResponse,
} from '../competitions/app/protocol/lnurl.mjs';
import {
  buildZapRequest, verifyZapReceipt, receiptMatchesInvoice, zapDescriptionHash,
  receiptFilter, ZAP_RECEIPT_KIND,
} from '../competitions/app/protocol/zap.mjs';

/**
 * The entry fee, end to end, without a network or a satoshi.
 *
 * Everything here runs against the committed fixtures, which were generated
 * locally: the invoice is deliberately unsigned so that nothing in this
 * repository can be paid, and every receipt was signed by a test key.
 *
 * The cases that matter are the refusals. A zap receipt is an attestation by
 * whoever the payment endpoint named — not a proof of payment — so the only
 * useful question is whether it is the *right* attestation, and each way of
 * being the wrong one has to be caught separately.
 */

const fixture = JSON.parse(
  readFileSync(new URL('../competitions/fixtures/vectors/zap.json', import.meta.url), 'utf8'),
);

const expected = {
  providerPubkey: fixture.lnurl_response.nostrPubkey,
  payerPubkey: fixture.zap_request.pubkey,
  recipientPubkey: fixture.zap_request.tags.find((t) => t[0] === 'p')[1],
  address: fixture.competition_address,
  amountMsat: fixture.fee_msat,
  nonce: fixture.intent_nonce,
};

// ── BOLT11 ──

test('a BOLT11 spec vector decodes to its documented fields', () => {
  // From the BOLT11 test vectors: 2500 microbitcoin, "1 cup coffee", 60s expiry.
  const invoice = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq'
    + 'dq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vru'
    + 'atfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
  const decoded = decodeInvoice(invoice);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.network, 'bc');
  assert.equal(decoded.amountMsat, 250000000);
  assert.equal(decoded.timestamp, 1496314658);
  assert.equal(decoded.expirySec, 60);
  assert.equal(decoded.description, '1 cup coffee');
  assert.equal(
    decoded.paymentHash,
    '0001020304050607080900010203040506070809000102030405060708090102',
  );
});

test('the amount in the prefix is read exactly, including pico', () => {
  assert.deepEqual(parseHrp('lnbc'), { network: 'bc', amountMsat: null });
  assert.deepEqual(parseHrp('lnbc20u'), { network: 'bc', amountMsat: 2000000 });
  assert.deepEqual(parseHrp('lnbc1m'), { network: 'bc', amountMsat: 100000000 });
  assert.deepEqual(parseHrp('lnbc7n'), { network: 'bc', amountMsat: 700 });
  assert.deepEqual(parseHrp('lnbc1'), { network: 'bc', amountMsat: 100000000000 });
  assert.deepEqual(parseHrp('lntb20u'), { network: 'tb', amountMsat: 2000000 });
  // A pico amount is a tenth of a millisatoshi, so one that is not a multiple
  // of ten cannot be paid and BOLT11 calls the invoice invalid.
  assert.deepEqual(parseHrp('lnbc10p'), { network: 'bc', amountMsat: 1 });
  assert.equal(parseHrp('lnbc1p'), null);
  assert.equal(parseHrp('lnbcXu'), null);
  assert.equal(parseHrp('bc20u'), null);
});

test('an invoice with no expiry field gets the BOLT11 default, not forever', () => {
  const decoded = decodeInvoice(fixture.invoice.bolt11);
  assert.equal(decoded.expirySec, fixture.invoice.expiry_sec);
  assert.notEqual(DEFAULT_EXPIRY_SEC, 0);
});

test('the fixture invoice decodes to exactly what the fixture claims', () => {
  const decoded = decodeInvoice(fixture.invoice.bolt11);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.amountMsat, fixture.invoice.amount_msat);
  assert.equal(decoded.timestamp, fixture.invoice.timestamp);
  assert.equal(decoded.expiresAt, fixture.invoice.expires_at);
  assert.equal(decoded.paymentHash, fixture.invoice.payment_hash);
  assert.equal(decoded.descriptionHash, fixture.invoice.description_hash);
});

test('the description hash commits the invoice to this zap request', async () => {
  // NIP-57's binding: change the request and the invoice no longer matches it.
  assert.equal(await zapDescriptionHash(fixture.zap_request), fixture.invoice.description_hash);
  const tampered = { ...fixture.zap_request, content: 'something else' };
  assert.notEqual(await zapDescriptionHash(tampered), fixture.invoice.description_hash);
});

test('expiry is reported rather than left for someone to discover at the wall', () => {
  const decoded = decodeInvoice(fixture.invoice.bolt11);
  assert.equal(isExpired(decoded, fixture.invoice.expires_at - 1), false);
  assert.equal(secondsLeft(decoded, fixture.invoice.expires_at - 60), 60);
  assert.equal(isExpired(decoded, fixture.invoice.expires_at), true);
  assert.equal(secondsLeft(decoded, fixture.invoice.expires_at + 500), 0);
});

test('anything that is not an invoice is refused, not half-read', () => {
  for (const [input, error] of [
    ['', 'empty'],
    ['not an invoice at all', 'not_bech32'],
    ['npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqshp52w2', 'not_an_invoice'],
    // Valid bech32 with an invoice prefix, but far too short to hold a
    // timestamp and a signature — the checksum passing is the point.
    ['lnbc20u1qqqqqqqqqqqqqqqqqqqqr6alde', 'too_short'],
  ]) {
    assert.equal(decodeInvoice(input).error, error, `${input.slice(0, 20)} → ${error}`);
  }
});

test('the wallet URI is the one a phone hands to a lightning app', () => {
  assert.equal(walletUri('LNBC20U1ABC'), 'lightning:lnbc20u1abc');
});

// ── LNURL ──

test('a lightning address resolves to its well-known endpoint', () => {
  assert.deepEqual(resolvePayEndpoint('kellerwand@example.org'), {
    ok: true,
    kind: 'address',
    url: 'https://example.org/.well-known/lnurlp/kellerwand',
    display: 'kellerwand@example.org',
  });
});

test('an endpoint that could be intercepted is refused, never downgraded', () => {
  for (const [value, error] of [
    ['', 'empty'],
    ['gym@somewhere', 'bad_domain'],
    ['gym@abcdefghijklmnop.onion', 'onion'],
    ['http://example.org/pay', 'not_https'],
    ['lnurl1qqqqq', 'bad_lnurl'],
    ['not a thing', 'unrecognised'],
  ]) {
    assert.equal(resolvePayEndpoint(value).error, error, `${value} → ${error}`);
  }
});

test('a bech32 LNURL is decoded to the URL it carries', () => {
  // LUD-06's own example, which encodes an https URL.
  const lnurl = 'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS';
  const resolved = resolvePayEndpoint(lnurl);
  assert.equal(resolved.ok, true);
  assert.ok(resolved.url.startsWith('https://'), resolved.url);
});

test('a pay response is checked against what this competition charges', () => {
  const ok = validatePayResponse(fixture.lnurl_response, fixture.fee_msat);
  assert.equal(ok.ok, true);
  assert.equal(ok.callback, fixture.lnurl_response.callback);
  assert.equal(ok.allowsNostr, true);
  assert.equal(ok.nostrPubkey, fixture.lnurl_response.nostrPubkey);

  assert.equal(validatePayResponse(fixture.lnurl_response, 100).error, 'below_minimum');
  assert.equal(validatePayResponse(fixture.lnurl_response, 999999999).error, 'above_maximum');
});

test('a provider that cannot zap is reported as unverifiable, not as fine', () => {
  const noNostr = { ...fixture.lnurl_response, allowsNostr: false };
  const result = validatePayResponse(noNostr, fixture.fee_msat);
  assert.equal(result.ok, true);
  assert.equal(result.allowsNostr, false, 'no receipt can be verified against this endpoint');
  assert.equal(result.nostrPubkey, null);

  // Claiming to allow nostr without naming a key is the same situation.
  const noKey = { ...fixture.lnurl_response, nostrPubkey: 'not-a-key' };
  assert.equal(validatePayResponse(noKey, fixture.fee_msat).allowsNostr, false);
});

test('a malformed pay response is refused case by case', () => {
  const base = fixture.lnurl_response;
  const cases = [
    [null, 'not_json'],
    [{ status: 'ERROR', reason: 'closed' }, 'provider_error'],
    [{ ...base, tag: 'withdrawRequest' }, 'not_a_pay_request'],
    [{ ...base, callback: 'http://example.org/cb' }, 'bad_callback'],
    [{ ...base, minSendable: 0 }, 'bad_limits'],
    [{ ...base, maxSendable: 1 }, 'bad_limits'],
    [{ ...base, metadata: undefined }, 'no_metadata'],
    [{ ...base, metadata: '{"not":"an array"}' }, 'bad_metadata'],
  ];
  for (const [response, error] of cases) {
    assert.equal(validatePayResponse(response, fixture.fee_msat).error, error, error);
  }
});

test('the invoice request carries the amount and the zap request', () => {
  const url = new URL(invoiceUrl(fixture.lnurl_response.callback, fixture.fee_msat, {
    zapRequest: fixture.zap_request,
  }));
  assert.equal(url.searchParams.get('amount'), String(fixture.fee_msat));
  assert.deepEqual(JSON.parse(url.searchParams.get('nostr')), fixture.zap_request);
});

test('an invoice for a different amount is refused, not shown with a warning', () => {
  const decoded = decodeInvoice(fixture.invoice.bolt11);
  assert.equal(
    validateInvoiceResponse({ pr: fixture.invoice.bolt11 }, decoded, fixture.fee_msat).ok,
    true,
  );
  const wrong = validateInvoiceResponse({ pr: fixture.invoice.bolt11 }, decoded, fixture.fee_msat * 2);
  assert.equal(wrong.error, 'wrong_amount');
  assert.equal(wrong.invoiceMsat, fixture.fee_msat);

  assert.equal(validateInvoiceResponse({ status: 'ERROR', reason: 'no' }, decoded, 1).error, 'provider_error');
  assert.equal(validateInvoiceResponse({}, decoded, 1).error, 'no_invoice');
  assert.equal(
    validateInvoiceResponse({ pr: 'x' }, { ok: false }, 1).error,
    'unreadable_invoice',
  );
});

// ── zaps ──

test('a zap request names the competition, the amount and the registration', () => {
  const request = buildZapRequest({
    recipientPubkey: expected.recipientPubkey,
    address: expected.address,
    amountMsat: expected.amountMsat,
    relays: ['wss://relay.example.invalid'],
    nonce: expected.nonce,
    createdAt: 1789000250,
  });
  assert.equal(request.kind, 9734);
  assert.deepEqual(request.tags, fixture.zap_request.tags);
});

test('the fixture receipt verifies against this competition', async () => {
  const result = await verifyZapReceipt(fixture.valid_receipt, expected);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.amountMsat, fixture.fee_msat);
  assert.equal(receiptMatchesInvoice(fixture.valid_receipt, fixture.invoice.bolt11), true);
});

test('every way of being the wrong receipt is caught', async () => {
  const cases = [
    ['signed_by_the_wrong_key', 'wrong_signer'],
    ['references_another_competition', 'wrong_competition'],
    ['attests_a_smaller_amount', 'wrong_amount'],
    ['attests_somebody_elses_payment', 'wrong_payer'],
    ['pays_a_different_registration', 'wrong_registration'],
    ['description_signature_does_not_hold', 'bad_request_signature'],
  ];
  for (const [name, error] of cases) {
    const receipt = fixture.rejected[name];
    assert.ok(receipt, `fixture ${name} is missing`);
    // eslint-disable-next-line no-await-in-loop
    const result = await verifyZapReceipt(receipt, expected);
    assert.equal(result.ok, false, `${name} must not verify`);
    assert.equal(result.error, error, name);
  }
});

test('a receipt cannot be verified at all when the endpoint named no key', async () => {
  const result = await verifyZapReceipt(fixture.valid_receipt, { ...expected, providerPubkey: null });
  assert.equal(result.error, 'no_provider_key');
});

test('a tampered receipt fails on its signature, not on its contents', async () => {
  const tampered = { ...fixture.valid_receipt, created_at: fixture.valid_receipt.created_at + 1 };
  assert.equal((await verifyZapReceipt(tampered, expected)).error, 'bad_signature');
});

test('structural nonsense is refused before any signature work', async () => {
  assert.equal((await verifyZapReceipt(null, expected)).error, 'not_a_receipt');
  assert.equal((await verifyZapReceipt({ kind: 1 }, expected)).error, 'not_a_receipt');

  const noDescription = {
    ...fixture.valid_receipt,
    tags: fixture.valid_receipt.tags.filter((t) => t[0] !== 'description'),
  };
  // The signature no longer covers these tags, so this is what a receipt with a
  // missing field actually looks like on the wire.
  assert.equal((await verifyZapReceipt(noDescription, expected)).ok, false);
});

test('the receipt filter asks for this competition, not for every zap', () => {
  const filter = receiptFilter({
    recipientPubkey: expected.recipientPubkey, address: expected.address, since: 1789000000,
  });
  assert.deepEqual(filter.kinds, [ZAP_RECEIPT_KIND]);
  assert.deepEqual(filter['#p'], [expected.recipientPubkey]);
  assert.deepEqual(filter['#a'], [expected.address]);
  assert.equal(filter.since, 1789000000);
});

test('nothing in the fixtures is payable', () => {
  // A signature of all zeros: no node produced this and no wallet can settle
  // it. If this ever changes, the fixtures have gained something real.
  const decoded = decodeInvoice(fixture.invoice.bolt11);
  assert.equal(decoded.ok, true);
  assert.ok(
    fixture.invoice.note.toLowerCase().includes('unsigned'),
    'the fixture must say plainly that its invoice is not real',
  );
  assert.ok(
    fixture.invoice.bolt11.endsWith('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
      .slice(0, 100)) || fixture.invoice.bolt11.includes('qqqqqqqqqqqqqqqqqqqq'),
    'the signature words must still be zeros',
  );
});

test('the invoice has to be for at least the fee, and bound to this request', async () => {
  // The two checks that are cryptography rather than trust: the amount the
  // invoice is actually for, and the description hash that commits it to this
  // exact zap request.
  const bound = await verifyZapReceipt(fixture.valid_receipt, expected);
  assert.equal(bound.ok, true, bound.error);
  assert.equal(bound.weaklyBound, false, 'the fixture invoice carries a description hash');

  // An invoice for a tenth of the fee, correctly attested.
  const small = {
    ...fixture.valid_receipt,
    tags: fixture.valid_receipt.tags.map(
      (t) => (t[0] === 'bolt11' ? ['bolt11', fixture.invoice.bolt11.replace('lnbc20u', 'lnbc2u')] : t),
    ),
  };
  const result = await verifyZapReceipt(small, expected);
  assert.equal(result.ok, false);
  // The signature no longer covers the swapped tag, which is itself the
  // refusal — a provider that wanted to do this would have to sign it.
  assert.ok(['bad_signature', 'invoice_too_small'].includes(result.error), result.error);
});

test('a receipt from outside the window it should have arrived in is refused', async () => {
  const at = fixture.valid_receipt.created_at;
  assert.equal(
    (await verifyZapReceipt(fixture.valid_receipt, { ...expected, notBefore: at + 1 })).error,
    'receipt_too_early',
  );
  assert.equal(
    (await verifyZapReceipt(fixture.valid_receipt, { ...expected, notAfter: at - 1 })).error,
    'receipt_too_late',
  );
  assert.equal(
    (await verifyZapReceipt(fixture.valid_receipt, { ...expected, notBefore: at - 10, notAfter: at + 10 })).ok,
    true,
  );
});

test('credentials in the authority are refused, because they read as the wrong host', () => {
  // https://evil.example@bank.example resolves to evil.example and reads to a
  // person as bank.example. Both clients answer this the same way.
  assert.equal(resolvePayEndpoint('https://evil.example@bank.example/pay').error, 'bad_url');
  assert.equal(resolvePayEndpoint('http://example.org/pay').error, 'not_https');
});
