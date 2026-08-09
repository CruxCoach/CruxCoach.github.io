/**
 * Which relay URLs this client will talk to.
 *
 * `wss://` everywhere, plus `ws://` for loopback only.
 *
 * The loopback exception is not a convenience. Cleartext WebSocket to a public
 * host lets any network on the path rewrite a competition's results in transit,
 * so it is refused outright. Cleartext to 127.0.0.1 has no network on the path
 * by definition, and it is the only way the development relay in
 * `tools/dev/relay.mjs` can be used at all — a TLS certificate for a throwaway
 * loopback port would be theatre.
 *
 * The rule lives in one file because it is enforced in three places that must
 * not drift: competition validation, the relay pool, and NIP-46 URI parsing.
 * The Kotlin port is `CompetitionProtocol.isAllowedRelayUrl`.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackRelay(url) {
  if (typeof url !== 'string' || !url.startsWith('ws://')) return false;
  const rest = url.slice('ws://'.length);
  const host = rest.split('/')[0].split('?')[0];
  const withoutPort = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  return LOOPBACK_HOSTS.has(withoutPort.toLowerCase());
}

export function isAllowedRelayUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || /\s/.test(url)) return false;
  if (url.startsWith('wss://')) return url.length > 'wss://'.length;
  return isLoopbackRelay(url);
}

/** True when a relay set contains a development relay — the UI must say so. */
export function usesDevelopmentRelay(urls) {
  return urls.some((url) => isLoopbackRelay(url));
}
