/**
 * LNURL-pay, for a competition entry fee — FEAT-058 §11.1.
 *
 * The organizer publishes one string: a lightning address (`gym@example.org`)
 * or an LNURL. Everything else is derived, and every derivation is checked,
 * because this is the one part of a competition where being wrong costs an
 * entrant money.
 *
 * Rules this file exists to enforce:
 *   - https only, and never to a host the organizer did not name; a redirect to
 *     http would hand the invoice request to anyone on the path
 *   - the amount we ask for is the amount the competition charges, inside the
 *     provider's own limits, so an entrant cannot be quietly charged something
 *     else
 *   - the invoice that comes back is checked against what we asked for before
 *     it is shown; an invoice for a different amount is refused, not displayed
 *     with a warning
 *
 * Onion and clearnet-http LNURLs are refused rather than downgraded. A gym that
 * needs one can publish a normal https endpoint.
 */
import { bech32Decode } from './nostr-event.mjs';

export const MAX_RESPONSE_BYTES = 65536;

/**
 * Turn what the organizer published into a URL to fetch.
 *
 * @returns {{ok: true, url: string, kind: 'address'|'lnurl', display: string}
 *          | {ok: false, error: string}}
 */
export function resolvePayEndpoint(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: false, error: 'empty' };

  // A lightning address: local-part@domain, resolved per LUD-16.
  const at = text.indexOf('@');
  if (at > 0 && !text.toLowerCase().startsWith('lnurl')) {
    const name = text.slice(0, at);
    const domain = text.slice(at + 1).toLowerCase();
    if (!/^[a-z0-9._-]+$/i.test(name)) return { ok: false, error: 'bad_address' };
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false, error: 'bad_domain' };
    if (domain.endsWith('.onion')) return { ok: false, error: 'onion' };
    return {
      ok: true,
      kind: 'address',
      url: `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`,
      display: `${name}@${domain}`,
    };
  }

  // A bech32 LNURL (LUD-01), which encodes the URL directly.
  if (/^lnurl1[0-9a-z]+$/i.test(text)) {
    const decoded = bech32Decode(text.toLowerCase());
    if (!decoded || decoded.hrp !== 'lnurl') return { ok: false, error: 'bad_lnurl' };
    const url = new TextDecoder().decode(decoded.bytes);
    return checkedUrl(url, text);
  }

  if (/^https:\/\//i.test(text)) return checkedUrl(text, text);
  return { ok: false, error: 'unrecognised' };
}

function checkedUrl(url, display) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'bad_url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'not_https' };
  if (parsed.hostname.endsWith('.onion')) return { ok: false, error: 'onion' };
  return { ok: true, kind: 'lnurl', url: parsed.toString(), display };
}

/**
 * Check the provider's pay-request response.
 *
 * @param {object} response parsed JSON from the endpoint
 * @param {number} amountMsat what this competition charges
 * @returns {{ok: true, callback: string, metadata: string, allowsNostr: boolean,
 *            nostrPubkey: string|null, commentAllowed: number}
 *          | {ok: false, error: string}}
 */
export function validatePayResponse(response, amountMsat) {
  if (!response || typeof response !== 'object') return { ok: false, error: 'not_json' };
  if (response.status === 'ERROR') {
    return { ok: false, error: 'provider_error', reason: String(response.reason || '').slice(0, 200) };
  }
  if (response.tag !== 'payRequest') return { ok: false, error: 'not_a_pay_request' };

  const callback = checkedUrl(String(response.callback || ''), '');
  if (!callback.ok) return { ok: false, error: 'bad_callback' };

  const min = Number(response.minSendable);
  const max = Number(response.maxSendable);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    return { ok: false, error: 'bad_limits' };
  }
  if (amountMsat < min) return { ok: false, error: 'below_minimum', min, max };
  if (amountMsat > max) return { ok: false, error: 'above_maximum', min, max };

  // The metadata string is hashed into the invoice's description hash for a
  // non-zap payment, so it has to be the exact string, not a re-serialisation.
  const metadata = response.metadata;
  if (typeof metadata !== 'string' || metadata.length === 0) {
    return { ok: false, error: 'no_metadata' };
  }
  try {
    const parsed = JSON.parse(metadata);
    if (!Array.isArray(parsed)) return { ok: false, error: 'bad_metadata' };
  } catch {
    return { ok: false, error: 'bad_metadata' };
  }

  // NIP-57: a provider that zaps names the key its receipts will be signed
  // with. Without it there is nothing to verify a receipt against, so the
  // entrant is told the organizer will have to confirm by hand.
  const allowsNostr = response.allowsNostr === true;
  const nostrPubkey = typeof response.nostrPubkey === 'string'
    && /^[0-9a-f]{64}$/i.test(response.nostrPubkey)
    ? response.nostrPubkey.toLowerCase()
    : null;

  return {
    ok: true,
    callback: callback.url,
    metadata,
    allowsNostr: allowsNostr && nostrPubkey !== null,
    nostrPubkey: allowsNostr ? nostrPubkey : null,
    commentAllowed: Number.isInteger(response.commentAllowed) ? response.commentAllowed : 0,
  };
}

/**
 * Build the callback URL that asks for the invoice.
 *
 * The zap request rides along as a query parameter (NIP-57), which is what
 * makes the resulting receipt attributable to the person who paid.
 */
export function invoiceUrl(callback, amountMsat, { zapRequest, comment } = {}) {
  const url = new URL(callback);
  url.searchParams.set('amount', String(amountMsat));
  if (zapRequest) url.searchParams.set('nostr', JSON.stringify(zapRequest));
  if (comment) url.searchParams.set('comment', String(comment).slice(0, 200));
  return url.toString();
}

/**
 * Check the invoice the provider returned before showing it to anybody.
 *
 * @param {object} response parsed JSON from the callback
 * @param {object} decoded result of `decodeInvoice`
 * @param {number} amountMsat what we asked for
 */
export function validateInvoiceResponse(response, decoded, amountMsat) {
  if (!response || typeof response !== 'object') return { ok: false, error: 'not_json' };
  if (response.status === 'ERROR') {
    return { ok: false, error: 'provider_error', reason: String(response.reason || '').slice(0, 200) };
  }
  if (typeof response.pr !== 'string' || !response.pr.trim()) return { ok: false, error: 'no_invoice' };
  if (!decoded?.ok) return { ok: false, error: 'unreadable_invoice' };
  if (decoded.amountMsat === null) return { ok: false, error: 'no_amount' };
  if (decoded.amountMsat !== amountMsat) {
    // Refused, not shown with a warning: the number on screen and the number
    // the wallet would pay have to be the same number.
    return { ok: false, error: 'wrong_amount', invoiceMsat: decoded.amountMsat };
  }
  if (!decoded.paymentHash) return { ok: false, error: 'no_payment_hash' };
  return { ok: true, invoice: response.pr.trim() };
}
