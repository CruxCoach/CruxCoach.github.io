import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayPool } from '../competitions/app/protocol/relay-pool.mjs';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) || []) listener(value);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  send(json) {
    this.sent.push(JSON.parse(json));
  }

  message(frame) {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
}

const reqs = (socket) => socket.sent.filter(([type]) => type === 'REQ');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test.beforeEach(() => { FakeWebSocket.instances = []; });

test('a subscription arms exactly once when its first socket opens', async () => {
  const pool = new RelayPool(['wss://one.example'], { WebSocketImpl: FakeWebSocket });
  const subscription = pool.subscribe([{ kinds: [30078] }], { onEvent: () => {} });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.equal(await subscription.ready, true);
  assert.equal(reqs(socket).length, 1);
  pool.close();
});

test('a subscription on an already-open socket arms exactly once', async () => {
  const pool = new RelayPool(['wss://one.example'], { WebSocketImpl: FakeWebSocket });
  const connecting = pool.connect();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await connecting;
  const subscription = pool.subscribe([{ kinds: [30078] }], { onEvent: () => {} });
  assert.equal(await subscription.ready, true);
  assert.equal(reqs(socket).length, 1);
  pool.close();
});

test('EOSE is idempotent per relay and connection generation, then re-arms on reconnect', async () => {
  const eose = [];
  const pool = new RelayPool(['wss://one.example'], { WebSocketImpl: FakeWebSocket });
  const subscription = pool.subscribe([{ kinds: [30078] }], {
    onEvent: () => {}, onEose: (url) => eose.push(url),
  });
  const first = FakeWebSocket.instances[0];
  first.open();
  await subscription.ready;
  const subId = reqs(first)[0][1];
  first.message(['EOSE', subId]);
  first.message(['EOSE', subId]);
  assert.deepEqual(eose, ['wss://one.example']);

  first.close();
  const reconnecting = pool._ensure('wss://one.example');
  const second = FakeWebSocket.instances[1];
  second.open();
  await reconnecting;
  assert.equal(reqs(second).length, 1);
  first.emit('close');
  assert.deepEqual(pool.connectedUrls, ['wss://one.example']);
  first.message(['EOSE', subId]);
  assert.deepEqual(eose, ['wss://one.example'], 'a queued frame from the old socket is stale');
  second.message(['EOSE', subId]);
  second.message(['EOSE', subId]);
  assert.deepEqual(eose, ['wss://one.example', 'wss://one.example']);
  pool.close();
});

test('duplicate EOSE from one relay cannot complete a query while another is silent', async () => {
  const urls = ['wss://one.example', 'wss://two.example'];
  const pool = new RelayPool(urls, { WebSocketImpl: FakeWebSocket });
  const query = pool.query([{ kinds: [30078] }], { timeoutMs: 1000 });
  const [one, two] = FakeWebSocket.instances;
  one.open();
  two.open();
  await tick();
  const subId = reqs(one)[0][1];
  one.message(['EOSE', subId]);
  one.message(['EOSE', subId]);
  const premature = await Promise.race([query.then(() => true), tick().then(() => false)]);
  assert.equal(premature, false);
  two.message(['EOSE', subId]);
  assert.deepEqual(await query, { events: [], complete: true, answered: 2, failed: 0 });
  pool.close();
});
