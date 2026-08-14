/**
 * A small multi-relay client.
 *
 * DOM-free, so `node --test` drives the same code the browser runs against the
 * loopback dev relay. Behaviour follows the lessons already written down in the
 * Android client's `docs/nostr-architecture.md`:
 *
 *   - never first-success across relays; a relay that missed the last publish
 *     still answers, and answering fast does not make it right
 *   - deduplicate by event id, because several relays return the same event
 *   - a publish reports how many relays accepted, not merely whether one did
 *   - a short result set never means "that is all of them": most relays clamp
 *     `limit` to 500 silently
 */

import { isAllowedRelayUrl } from './relay-url.mjs';

const DEFAULT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let subCounter = 0;
const nextSubId = () => `cc${(subCounter += 1).toString(36)}${Math.floor(Date.now() % 1e6).toString(36)}`;

export class RelayPool {
  /**
   * @param {string[]} urls
   * @param {object} [options]
   * @param {typeof WebSocket} [options.WebSocketImpl]
   * @param {(message: string) => void} [options.onStatusChange]
   */
  constructor(urls, options = {}) {
    this.urls = [...new Set(urls)];
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.onStatusChange = options.onStatusChange || (() => {});
    /** @type {Map<string, {socket: WebSocket|null, ready: Promise<void>|null, attempts: number, closed: boolean, generation: number}>} */
    this.connections = new Map();
    /** @type {Map<string, {filters: object[], onEvent: Function, onEose: Function, seen: Set<string>, eosed: Set<string>}>} */
    this.subscriptions = new Map();
    /** @type {Map<string, {resolve: Function, url: string}>} */
    this.pendingOks = new Map();
    this.closed = false;
  }

  /** Relays currently holding an open socket. */
  get connectedUrls() {
    return [...this.connections.entries()]
      .filter(([, c]) => c.socket && c.socket.readyState === 1)
      .map(([url]) => url);
  }

  async connect() {
    await Promise.allSettled(this.urls.map((url) => this._ensure(url)));
    return this.connectedUrls;
  }

  _ensure(url) {
    let connection = this.connections.get(url);
    if (!connection) {
      connection = { socket: null, ready: null, attempts: 0, closed: false, generation: 0 };
      this.connections.set(url, connection);
    }
    if (connection.socket && connection.socket.readyState === 1) return Promise.resolve();
    if (connection.ready) return connection.ready;

    connection.ready = new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new this.WebSocketImpl(url);
      } catch (err) {
        connection.ready = null;
        reject(err);
        return;
      }
      connection.socket = socket;

      const settleTimer = setTimeout(() => {
        connection.ready = null;
        try { socket.close(); } catch { /* already gone */ }
        reject(new Error(`timed out connecting to ${url}`));
      }, DEFAULT_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        clearTimeout(settleTimer);
        connection.attempts = 0;
        connection.generation += 1;
        this.onStatusChange(`connected:${url}`);
        // Re-arm every live subscription: a reconnect that forgets them looks
        // exactly like a competition where nothing is happening.
        for (const [subId, sub] of this.subscriptions) {
          this._arm(url, connection, subId, sub);
        }
        resolve();
      });

      socket.addEventListener('message', (event) => this._onMessage(url, event.data, socket));

      const drop = () => {
        if (connection.socket !== socket) return;
        clearTimeout(settleTimer);
        connection.ready = null;
        connection.socket = null;
        // Fail in-flight publishes for this relay immediately rather than
        // making every caller wait out its own timeout.
        for (const [id, pending] of [...this.pendingOks]) {
          if (pending.url === url) {
            this.pendingOks.delete(id);
            pending.resolve({ ok: false, reason: 'connection lost' });
          }
        }
        this.onStatusChange(`disconnected:${url}`);
        if (!this.closed && !connection.closed) this._scheduleReconnect(url);
        reject(new Error(`connection to ${url} closed`));
      };
      socket.addEventListener('close', drop);
      socket.addEventListener('error', drop);
    }).catch((err) => {
      connection.ready = null;
      throw err;
    });

    return connection.ready;
  }

  _scheduleReconnect(url) {
    const connection = this.connections.get(url);
    if (!connection || connection.timer) return;
    connection.attempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (connection.attempts - 1), RECONNECT_MAX_MS);
    connection.timer = setTimeout(() => {
      connection.timer = null;
      if (this.closed || connection.closed) return;
      this._ensure(url).catch(() => { /* the next close event reschedules */ });
    }, delay);
    // Node keeps the process alive for a pending timer; a reconnect timer must
    // not be the reason a test run never exits.
    connection.timer.unref?.();
  }

  _send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  _arm(url, connection, subId, sub) {
    if (!connection.socket || connection.socket.readyState !== 1) return false;
    if (sub.armed.get(url) === connection.generation) return true;
    // EOSE is scoped to one REQ on one socket generation. A reconnect starts a
    // fresh stored-event prefix; duplicate EOSE frames on that socket do not.
    sub.eosed.delete(url);
    sub.failed.delete(url);
    if (!this._send(connection.socket, ['REQ', subId, ...sub.filters])) return false;
    sub.armed.set(url, connection.generation);
    return true;
  }

  _onMessage(url, raw, sourceSocket = null) {
    // A close/reconnect can race a final queued callback from the old socket.
    // Its EVENT/EOSE belongs to the old REQ generation and cannot settle the
    // new one, even though both use the same relay URL and subscription id.
    if (sourceSocket && this.connections.get(url)?.socket !== sourceSocket) return;
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;

    if (message[0] === 'EVENT') {
      const sub = this.subscriptions.get(message[1]);
      if (!sub) return;
      const event = message[2];
      if (!event || typeof event.id !== 'string') return;
      if (sub.seen.has(event.id)) return;
      sub.seen.add(event.id);
      sub.onEvent(event, url);
      return;
    }
    if (message[0] === 'EOSE') {
      const sub = this.subscriptions.get(message[1]);
      if (!sub) return;
      if (sub.eosed.has(url)) return;
      sub.eosed.add(url);
      sub.onEose(url, sub.eosed.size, { failed: false, settled: sub.eosed.size + sub.failed.size });
      return;
    }
    if (message[0] === 'OK') {
      const pending = this.pendingOks.get(`${url}|${message[1]}`);
      if (pending) {
        this.pendingOks.delete(`${url}|${message[1]}`);
        pending.resolve({ ok: message[2] === true, reason: message[3] || '' });
      }
      return;
    }
    if (message[0] === 'NOTICE' || message[0] === 'CLOSED') {
      this.onStatusChange(`${message[0].toLowerCase()}:${url}:${message[1] ?? ''}`);
    }
  }

  /**
   * Publish to every relay.
   * @returns {Promise<{attempted: number, accepted: number, results: Array}>}
   */
  async publish(event, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const results = await Promise.all(this.urls.map(async (url) => {
      try {
        await this._ensure(url);
      } catch (err) {
        return { url, ok: false, reason: err.message };
      }
      const connection = this.connections.get(url);
      if (!connection?.socket) return { url, ok: false, reason: 'not connected' };

      const key = `${url}|${event.id}`;
      const settled = new Promise((resolve) => {
        this.pendingOks.set(key, { resolve, url });
        const timer = setTimeout(() => {
          this.pendingOks.delete(key);
          resolve({ ok: false, reason: 'no OK before the timeout' });
        }, timeoutMs);
        timer.unref?.();
      });
      if (!this._send(connection.socket, ['EVENT', event])) {
        this.pendingOks.delete(key);
        return { url, ok: false, reason: 'send failed' };
      }
      const outcome = await settled;
      return { url, ...outcome };
    }));

    return {
      attempted: results.length,
      accepted: results.filter((r) => r.ok).length,
      results,
    };
  }

  /**
   * Open a live subscription. Returns a handle whose `close()` is idempotent.
   */
  subscribe(filters, { onEvent, onEose = () => {} } = {}) {
    const subId = nextSubId();
    // `eosed` is relays that genuinely reported end-of-stored-events; `failed`
    // is relays that never connected. Conflating the two is how "no relay
    // answered" becomes indistinguishable from "the relays answered and there
    // is nothing there" — and for a profile lookup, that difference decides
    // whether someone is invited to overwrite a profile they already have.
    const sub = {
      filters, onEvent, onEose, seen: new Set(), eosed: new Set(), failed: new Set(), armed: new Map(),
    };
    this.subscriptions.set(subId, sub);

    const armed = this.urls.map((url) => this._ensure(url)
      .then(() => {
        const connection = this.connections.get(url);
        return connection ? this._arm(url, connection, subId, sub) : false;
      })
      .catch(() => {
        // A relay that will not connect must not stall the barrier — but it is
        // recorded as failed, not as having answered.
        if (!sub.failed.has(url)) {
          sub.failed.add(url);
          onEose(url, sub.eosed.size, { failed: true, settled: sub.eosed.size + sub.failed.size });
        }
        return false;
      }));

    return {
      id: subId,
      /**
       * Resolves once the REQ has reached at least one relay.
       *
       * Callers that publish and then expect to see their own event — a
       * responder, or a console watching its own writes — must await this
       * first. Subscribing is not instantaneous, and an event published into
       * the gap is simply never delivered: ephemeral kinds are not stored, so
       * there is nothing to fetch afterwards.
       */
      ready: Promise.all(armed).then((results) => results.some(Boolean)),
      close: () => {
        if (!this.subscriptions.delete(subId)) return;
        for (const url of this.urls) {
          const connection = this.connections.get(url);
          if (connection?.socket?.readyState === 1) this._send(connection.socket, ['CLOSE', subId]);
        }
      },
    };
  }

  /**
   * One-shot query.
   *
   * Resolves when every relay has either reported end-of-stored-events or
   * failed to connect, or on timeout.
   *
   * `complete` means something specific: **at least one relay genuinely
   * answered**, so an empty `events` array is evidence of absence rather than
   * evidence of a broken network. A timeout, or every relay failing, is
   * reported as incomplete — a partial result cannot prove there is nothing
   * newer, and a caller that treats it as complete will show a stale
   * competition as the current one, or invite someone to overwrite a profile
   * they already have.
   *
   * @returns {Promise<{events: object[], complete: boolean, answered: number, failed: number}>}
   */
  query(filters, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
      const events = [];
      const answeredUrls = new Set();
      const failedUrls = new Set();
      let done = false;
      const finish = (timedOut) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        handle.close();
        resolve({
          events,
          complete: !timedOut && answeredUrls.size > 0,
          answered: answeredUrls.size,
          failed: failedUrls.size,
        });
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      timer.unref?.();
      const handle = this.subscribe(filters, {
        onEvent: (event) => events.push(event),
        onEose: (url, _count, info = {}) => {
          if (info.failed) {
            if (!answeredUrls.has(url)) failedUrls.add(url);
          } else {
            failedUrls.delete(url);
            answeredUrls.add(url);
          }
          if (answeredUrls.size + failedUrls.size >= this.urls.length) finish(false);
        },
      });
    });
  }

  close() {
    this.closed = true;
    for (const [, connection] of this.connections) {
      connection.closed = true;
      if (connection.timer) clearTimeout(connection.timer);
      try { connection.socket?.close(); } catch { /* already gone */ }
    }
    this.connections.clear();
    this.subscriptions.clear();
    this.pendingOks.clear();
  }
}

/**
 * Merge candidate relay lists in priority order. Authority callers pass only
 * the exact signed competition list; discovery callers may add untrusted
 * naddr/default hints before a definition is actionable.
 */
export function mergeRelays(competitionRelays, userRelays = [], limit = 8) {
  const out = [];
  for (const url of [...competitionRelays, ...userRelays]) {
    if (!isAllowedRelayUrl(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}
