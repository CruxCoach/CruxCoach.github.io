import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesFilter, replacementKey, startDevRelay, storageClass } from './dev/relay.mjs';
import {
  finalizeEvent, generateSecretKey, getPublicKey,
} from '../competitions/app/protocol/nostr-event.mjs';

const AT = 1789000000;

/** Minimal promise-based client over the platform WebSocket. */
async function connect(url) {
  const socket = new WebSocket(url);
  const received = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    received.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(message)) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  return {
    send: (message) => socket.send(JSON.stringify(message)),
    received,
    /** Resolve when a message matching `match` arrives (or has already). */
    await: (match, timeoutMs = 2000) => {
      const existing = received.find(match);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a relay message')), timeoutMs);
        waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close: () => socket.close(),
  };
}

test('storage classes follow NIP-01', () => {
  assert.equal(storageClass(1), 'regular');
  assert.equal(storageClass(0), 'replaceable');
  assert.equal(storageClass(3), 'replaceable');
  assert.equal(storageClass(10002), 'replaceable');
  assert.equal(storageClass(24133), 'ephemeral');
  assert.equal(storageClass(30078), 'addressable');
  assert.equal(storageClass(9735), 'regular');
});

test('the replacement key includes the d tag only for addressable kinds', () => {
  const base = { kind: 30078, pubkey: 'a'.repeat(64), tags: [['d', 'x']] };
  assert.equal(replacementKey(base), `30078:${'a'.repeat(64)}:x`);
  assert.equal(replacementKey({ ...base, kind: 10002 }), `10002:${'a'.repeat(64)}:`);
  assert.equal(replacementKey({ ...base, kind: 1 }), null);
});

test('filters match the way NIP-01 says', () => {
  const event = {
    id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 30078, created_at: 100,
    tags: [['d', 'x'], ['t', 'climbing'], ['t', 'kilter']],
  };
  assert.equal(matchesFilter(event, {}), true);
  assert.equal(matchesFilter(event, { kinds: [30078] }), true);
  assert.equal(matchesFilter(event, { kinds: [1] }), false);
  assert.equal(matchesFilter(event, { authors: ['b'.repeat(64)] }), true);
  assert.equal(matchesFilter(event, { '#d': ['x'] }), true);
  assert.equal(matchesFilter(event, { '#d': ['y'] }), false);
  assert.equal(matchesFilter(event, { '#t': ['kilter'] }), true, 'a second tag of the same name must match');
  assert.equal(matchesFilter(event, { since: 101 }), false);
  assert.equal(matchesFilter(event, { until: 99 }), false);
  assert.equal(matchesFilter(event, { unknown_key: ['whatever'] }), true, 'unknown filter keys are ignored');
});

test('the relay refuses to bind anything but loopback', async () => {
  await assert.rejects(() => startDevRelay({ port: 0, host: '0.0.0.0' }), /loopback/);
});

test('a valid event is stored, echoed to subscribers and returned on a later REQ', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const client = await connect(relay.url);

    client.send(['REQ', 'live', { kinds: [30078], authors: [pk] }]);
    await client.await((m) => m[0] === 'EOSE' && m[1] === 'live');

    const event = await finalizeEvent(
      { created_at: AT, kind: 30078, tags: [['d', 'comp']], content: '{}' }, sk,
    );
    client.send(['EVENT', event]);
    const ok = await client.await((m) => m[0] === 'OK' && m[1] === event.id);
    assert.equal(ok[2], true, ok[3]);

    const live = await client.await((m) => m[0] === 'EVENT' && m[1] === 'live');
    assert.equal(live[2].id, event.id, 'an open subscription must receive the event');

    const second = await connect(relay.url);
    second.send(['REQ', 'stored', { kinds: [30078], '#d': ['comp'] }]);
    const replayed = await second.await((m) => m[0] === 'EVENT' && m[1] === 'stored');
    assert.equal(replayed[2].id, event.id);
    await second.await((m) => m[0] === 'EOSE');

    client.close();
    second.close();
  } finally {
    await relay.close();
  }
});

test('a tampered event is rejected with a NIP-01 machine-readable reason', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const client = await connect(relay.url);
    const event = await finalizeEvent(
      { created_at: AT, kind: 30078, tags: [['d', 'comp']], content: '{"a":1}' }, sk,
    );
    const tampered = { ...event, content: '{"a":2}' };
    client.send(['EVENT', tampered]);
    const ok = await client.await((m) => m[0] === 'OK' && m[1] === tampered.id);
    assert.equal(ok[2], false);
    assert.match(ok[3], /^invalid:/);
    assert.equal(relay.events().length, 0);
    client.close();
  } finally {
    await relay.close();
  }
});

test('an addressable event replaces its older version and never the reverse', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const client = await connect(relay.url);
    const older = await finalizeEvent(
      { created_at: AT, kind: 30078, tags: [['d', 'comp']], content: '{"v":1}' }, sk,
    );
    const newer = await finalizeEvent(
      { created_at: AT + 1, kind: 30078, tags: [['d', 'comp']], content: '{"v":2}' }, sk,
    );
    client.send(['EVENT', newer]);
    await client.await((m) => m[0] === 'OK' && m[1] === newer.id);
    client.send(['EVENT', older]);
    const ok = await client.await((m) => m[0] === 'OK' && m[1] === older.id);
    assert.equal(ok[2], true, 'a superseded event is accepted, not an error');
    assert.match(ok[3], /^replaced:/);
    assert.equal(relay.events().length, 1);
    assert.equal(relay.events()[0].id, newer.id);
    client.close();
  } finally {
    await relay.close();
  }
});

test('two different d tags are two different slots', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const client = await connect(relay.url);
    for (const d of ['a', 'b']) {
      const event = await finalizeEvent(
        { created_at: AT, kind: 30078, tags: [['d', d]], content: '{}' }, sk,
      );
      client.send(['EVENT', event]);
      await client.await((m) => m[0] === 'OK' && m[1] === event.id);
    }
    assert.equal(relay.events().length, 2);
    client.close();
  } finally {
    await relay.close();
  }
});

test('an ephemeral event is acknowledged, delivered live, and not stored', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const client = await connect(relay.url);
    client.send(['REQ', 'eph', { kinds: [24133], authors: [pk] }]);
    await client.await((m) => m[0] === 'EOSE');
    const event = await finalizeEvent({ created_at: AT, kind: 24133, tags: [], content: 'x' }, sk);
    client.send(['EVENT', event]);
    const ok = await client.await((m) => m[0] === 'OK' && m[1] === event.id);
    assert.equal(ok[2], true);
    assert.equal(relay.events().length, 0, 'ephemeral events are not stored');
    client.close();
  } finally {
    await relay.close();
  }
});

test('a filter limit is honoured', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const client = await connect(relay.url);
    for (let i = 0; i < 5; i++) {
      const event = await finalizeEvent(
        { created_at: AT + i, kind: 30078, tags: [['d', `d${i}`]], content: '{}' }, sk,
      );
      client.send(['EVENT', event]);
      await client.await((m) => m[0] === 'OK' && m[1] === event.id);
    }
    const reader = await connect(relay.url);
    reader.send(['REQ', 'few', { kinds: [30078], limit: 2 }]);
    await reader.await((m) => m[0] === 'EOSE');
    const delivered = reader.received.filter((m) => m[0] === 'EVENT');
    assert.equal(delivered.length, 2);
    // Newest first, so a limit returns the most recent, not an arbitrary two.
    assert.equal(delivered[0][2].created_at, AT + 4);
    client.close();
    reader.close();
  } finally {
    await relay.close();
  }
});

test('a message that is not a NIP-01 frame gets a NOTICE, not a crash', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const client = await connect(relay.url);
    client.send({ not: 'an array' });
    await client.await((m) => m[0] === 'NOTICE');
    client.send(['REQ']);
    await client.await((m) => m[0] === 'NOTICE' && /subscription id/.test(m[1]));
    // Still alive afterwards.
    const sk = generateSecretKey();
    const event = await finalizeEvent({ created_at: AT, kind: 30078, tags: [['d', 'x']], content: '{}' }, sk);
    client.send(['EVENT', event]);
    const ok = await client.await((m) => m[0] === 'OK');
    assert.equal(ok[2], true);
    client.close();
  } finally {
    await relay.close();
  }
});

test('CLOSE stops delivery on that subscription', async () => {
  const relay = await startDevRelay({ port: 0, quiet: true });
  try {
    const sk = generateSecretKey();
    const client = await connect(relay.url);
    client.send(['REQ', 'sub', { kinds: [30078] }]);
    await client.await((m) => m[0] === 'EOSE');
    client.send(['CLOSE', 'sub']);
    await client.await((m) => m[0] === 'CLOSED' && m[1] === 'sub');
    const event = await finalizeEvent({ created_at: AT, kind: 30078, tags: [['d', 'x']], content: '{}' }, sk);
    client.send(['EVENT', event]);
    await client.await((m) => m[0] === 'OK');
    assert.equal(client.received.some((m) => m[0] === 'EVENT' && m[1] === 'sub'), false);
    client.close();
  } finally {
    await relay.close();
  }
});
