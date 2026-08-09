/**
 * DEVELOPMENT-ONLY ephemeral Nostr relay (NIP-01) — loopback, in-memory.
 *
 * This exists so the competition protocol can be exercised end to end without
 * ever touching a public relay. It is NOT shipped with the site, is NOT
 * referenced by any page, and refuses to bind anything but a loopback address.
 * Nothing it stores survives the process.
 *
 * Zero dependencies on purpose: it speaks RFC 6455 over `node:http` directly,
 * because adding a WebSocket package would be the first runtime dependency this
 * repository has ever taken and a dev relay is not worth that precedent.
 *
 *   node tools/dev/relay.mjs --port 7447
 *   node tools/dev/relay.mjs --port 7447 --dump /tmp/stream.jsonl
 *
 * Programmatic use (tests):
 *   import { startDevRelay } from './tools/dev/relay.mjs'
 *   const relay = await startDevRelay({ port: 0 })
 *   ...
 *   await relay.close()
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { verifyEvent } from '../../competitions/app/protocol/nostr-event.mjs';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** NIP-01 storage classes, derived from the kind. */
export function storageClass(kind) {
  if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) return 'replaceable';
  if (kind >= 20000 && kind < 30000) return 'ephemeral';
  if (kind >= 30000 && kind < 40000) return 'addressable';
  return 'regular';
}

/** The replacement key an event occupies, or null for regular/ephemeral kinds. */
export function replacementKey(event) {
  const cls = storageClass(event.kind);
  if (cls === 'replaceable') return `${event.kind}:${event.pubkey}:`;
  if (cls === 'addressable') {
    const d = (event.tags.find((t) => t[0] === 'd') || [])[1] || '';
    return `${event.kind}:${event.pubkey}:${d}`;
  }
  return null;
}

/** NIP-01 filter match. Unknown filter keys are ignored, as relays do. */
export function matchesFilter(event, filter) {
  if (filter.ids && !filter.ids.some((p) => event.id === p)) return false;
  if (filter.authors && !filter.authors.some((p) => event.pubkey === p)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false;
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (key.length !== 2 || key[0] !== '#') continue;
    const tagName = key[1];
    const present = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
    if (!values.some((v) => present.includes(v))) return false;
  }
  return true;
}

// ── RFC 6455, only what a relay needs: text frames, close, ping/pong ──

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + opcode 1 (text)
  return Buffer.concat([header, payload]);
}

/**
 * Pulls whole frames out of a rolling buffer. Returns the frames decoded and
 * the bytes still unconsumed — a socket hands us arbitrary slices, so a frame
 * routinely straddles two `data` events.
 */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (buffer.length - cursor < 2) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (buffer.length - cursor < 8) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > 16n * 1024n * 1024n) throw new Error('frame too large');
      len = Number(big);
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (buffer.length - cursor < 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buffer.length - cursor < len) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    cursor += len;
    offset = cursor;
    frames.push({ opcode, payload });
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Start the relay.
 *
 * @param {object} opts
 * @param {number} opts.port  0 picks a free port; the resolved one is returned.
 * @param {string} [opts.host='127.0.0.1']  must be loopback.
 * @param {string} [opts.dumpPath]  append every accepted event as JSONL.
 * @param {number} [opts.maxEventBytes=131072]
 * @param {boolean} [opts.quiet=false]
 */
export async function startDevRelay(opts = {}) {
  const host = opts.host || '127.0.0.1';
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `dev relay refuses to bind ${host}: only a loopback address is allowed. ` +
        'This relay has no auth, no rate limit and no persistence, and must ' +
        'never be reachable off this machine.',
    );
  }
  const maxEventBytes = opts.maxEventBytes ?? 131072;
  const quiet = Boolean(opts.quiet);
  const log = (...a) => { if (!quiet) console.log('[dev-relay]', ...a); };

  /** @type {Map<string, object>} id → event */
  const byId = new Map();
  /** @type {Map<string, string>} replacement key → id */
  const byReplacement = new Map();
  /** @type {Set<{send:Function, subs:Map<string,object[]>}>} */
  const clients = new Set();
  /** Upgraded sockets are NOT closed by `server.close()`, so they are tracked
   *  here — otherwise a finished test run simply never exits. */
  const sockets = new Set();

  const dump = opts.dumpPath ? fs.createWriteStream(opts.dumpPath, { flags: 'a' }) : null;

  function storedEvents() {
    // Newest first, and `id` breaks ties so two events in the same second
    // always come back in the same order — a fixture that reorders itself
    // between runs is not a fixture.
    return [...byId.values()].sort(
      (a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  async function ingest(event) {
    if (JSON.stringify(event).length > maxEventBytes) {
      return { ok: false, reason: 'invalid: event exceeds this relay\'s size limit' };
    }
    let valid = false;
    try {
      valid = await verifyEvent(event);
    } catch (err) {
      return { ok: false, reason: `invalid: ${err.message}` };
    }
    if (!valid) return { ok: false, reason: 'invalid: bad id or signature' };

    const cls = storageClass(event.kind);
    // Ephemeral events are delivered to live subscribers and kept by nobody.
    // Not delivering them is not a milder failure than not storing them: a
    // NIP-46 answer that is neither stored nor delivered is simply lost, and
    // the signer session hangs waiting for a reply that already happened.
    if (cls === 'ephemeral') return { ok: true, reason: 'ephemeral: not stored', deliver: true };

    if (byId.has(event.id)) {
      return { ok: true, reason: 'duplicate: already have this event', deliver: false };
    }

    const key = replacementKey(event);
    if (key) {
      const existingId = byReplacement.get(key);
      if (existingId) {
        const existing = byId.get(existingId);
        // NIP-01: the newer event wins; on an exact created_at tie the LOWER
        // id wins, so every relay converges on the same survivor.
        const incomingWins =
          event.created_at > existing.created_at ||
          (event.created_at === existing.created_at && event.id < existing.id);
        if (!incomingWins) {
          return { ok: true, reason: 'replaced: a newer event is stored', deliver: false };
        }
        byId.delete(existingId);
      }
      byReplacement.set(key, event.id);
    }
    byId.set(event.id, event);
    if (dump) dump.write(`${JSON.stringify(event)}\n`);
    return { ok: true, reason: '', deliver: true };
  }

  const server = http.createServer((req, res) => {
    // NIP-11 relay information document, so a client can discover the limits.
    if ((req.headers.accept || '').includes('application/nostr+json')) {
      res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        name: 'cruxcoach-dev-relay',
        description: 'Ephemeral loopback relay for CruxCoach competition tests. Not a public relay.',
        supported_nips: [1, 9, 11],
        software: 'https://cruxcoach.org/ (tools/dev/relay.mjs)',
        limitation: { max_message_length: maxEventBytes, auth_required: false, payment_required: false },
      }));
      return;
    }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('This is a development Nostr relay. Connect over WebSocket.\n');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    sockets.add(socket);

    const send = (msg) => {
      if (!socket.destroyed) socket.write(encodeTextFrame(JSON.stringify(msg)));
    };
    const client = { send, subs: new Map() };
    clients.add(client);

    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let decoded;
      try {
        decoded = decodeFrames(buffer);
      } catch {
        socket.destroy();
        return;
      }
      buffer = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.opcode === 0x8) { socket.end(); return; }
        if (frame.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0x00])); continue; }
        if (frame.opcode !== 0x1) continue;
        const text = frame.payload.toString('utf8');
        // Serialise handling: an EVENT must be stored before a REQ that
        // arrives right behind it is answered, or a client that publishes
        // then immediately queries races its own write.
        queue = queue.then(() => handleMessage(client, text)).catch((err) => {
          log('message handling failed:', err.message);
        });
      }
    });

    const drop = () => { clients.delete(client); sockets.delete(socket); };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  async function handleMessage(client, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      client.send(['NOTICE', 'invalid: message is not JSON']);
      return;
    }
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') {
      client.send(['NOTICE', 'invalid: message is not a NIP-01 frame']);
      return;
    }

    if (msg[0] === 'EVENT') {
      const event = msg[1];
      if (!event || typeof event.id !== 'string') {
        client.send(['NOTICE', 'invalid: EVENT without an id']);
        return;
      }
      const result = await ingest(event);
      client.send(['OK', event.id, result.ok, result.reason]);
      if (result.ok && result.deliver) {
        for (const other of clients) {
          for (const [subId, filters] of other.subs) {
            if (filters.some((f) => matchesFilter(event, f))) other.send(['EVENT', subId, event]);
          }
        }
      }
      return;
    }

    if (msg[0] === 'REQ') {
      const subId = msg[1];
      const filters = msg.slice(2);
      if (typeof subId !== 'string' || filters.length === 0) {
        client.send(['NOTICE', 'invalid: REQ needs a subscription id and at least one filter']);
        return;
      }
      client.subs.set(subId, filters);
      const all = storedEvents();
      for (const filter of filters) {
        const limit = typeof filter.limit === 'number' ? filter.limit : Infinity;
        let sent = 0;
        for (const event of all) {
          if (sent >= limit) break;
          if (matchesFilter(event, filter)) { client.send(['EVENT', subId, event]); sent++; }
        }
      }
      client.send(['EOSE', subId]);
      return;
    }

    if (msg[0] === 'CLOSE') {
      client.subs.delete(msg[1]);
      client.send(['CLOSED', msg[1], 'closed by client']);
      return;
    }

    client.send(['NOTICE', `invalid: unsupported frame ${msg[0]}`]);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, resolve);
  });
  const port = server.address().port;
  const url = `ws://${host === '::1' ? '[::1]' : host}:${port}`;
  log(`listening on ${url} — in-memory, loopback only, nothing is persisted`);

  return {
    url,
    port,
    /** Every stored event, newest first. */
    events: () => storedEvents(),
    /** Drop all stored events and replacement bookkeeping (keeps connections). */
    reset: () => { byId.clear(); byReplacement.clear(); },
    close: () =>
      new Promise((resolve) => {
        for (const client of clients) client.send(['NOTICE', 'relay shutting down']);
        clients.clear();
        if (dump) dump.end();
        for (const socket of sockets) { try { socket.destroy(); } catch { /* already gone */ } }
        sockets.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

// ── CLI ──
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
  };
  const relay = await startDevRelay({
    port: Number(arg('port', '7447')),
    dumpPath: arg('dump', undefined),
  });
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │  CruxCoach DEVELOPMENT relay — test identities only.         │');
  console.log('  │  Loopback, in-memory, no auth. Never expose this port.       │');
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  URL: ${relay.url}`);
  console.log('  Stop with Ctrl-C.');
  const stop = async () => { await relay.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
