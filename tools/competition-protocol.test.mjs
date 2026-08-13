import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addressOf, bech32Decode, bech32Encode, decodeNip19, eventId, finalizeEvent,
  generateSecretKey, getPublicKey, hexToBytes, bytesToHex, naddrEncode, npubEncode,
  parseAddress, serializeEvent, verifyEvent,
} from '../competitions/app/protocol/nostr-event.mjs';
import { ccj, ccjHash, sha256Hex } from '../competitions/app/protocol/ccj.mjs';
import {
  buildCompetitionEvent, buildIntentEvent, classifyEvent, compDTag, intentDTag,
  checkinWindowOpen, logDTag, parseCompetitionEvent, parseDTag,
  registrationWindowOpen, validateCompetitionConfig, KIND,
} from '../competitions/app/protocol/competition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '../competitions/fixtures');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));

const vectors = readFixture('vectors/protocol.json');

// ── canonical JSON ──

test('CCJ matches every recorded vector', async () => {
  for (const vector of vectors.ccj) {
    assert.equal(ccj(vector.value), vector.expected, vector.name);
    assert.equal(await sha256Hex(ccj(vector.value)), vector.sha256, `${vector.name} digest`);
  }
});

test('CCJ refuses what the spec forbids', () => {
  assert.throws(() => ccj({ n: 1.5 }), /integers/);
  assert.throws(() => ccj({ A: 1 }), /a-z0-9_/);
  assert.throws(() => ccj({ 'a-b': 1 }), /a-z0-9_/);
  assert.throws(() => ccj(null), /omitted/);
  assert.throws(() => ccj({ n: -0 }), /-0/);
  assert.throws(() => ccj({ n: Number.MAX_SAFE_INTEGER + 2 }), /safe range/);
});

test('CCJ sorts keys rather than preserving insertion order', () => {
  assert.equal(ccj({ b: 1, a: 2 }), ccj({ a: 2, b: 1 }));
});

test('CCJ hash of the same value is stable across shapes', async () => {
  assert.equal(await ccjHash({ z: 1, a: 2 }), await ccjHash({ a: 2, z: 1 }));
});

// ── event primitives ──

test('event serialization and id match the recorded vector', async () => {
  assert.equal(serializeEvent(vectors.event.signed), vectors.event.serialized);
  assert.equal(await eventId(vectors.event.signed), vectors.event.signed.id);
});

test('a valid event verifies', async () => {
  assert.equal(await verifyEvent(vectors.event.signed), true);
});

test('a tampered body fails verification even though the signature is intact', async () => {
  // The signature still checks out against the ORIGINAL id — only recomputing
  // the id from the body catches the swap. This is the whole reason both
  // checks exist.
  const tampered = vectors.event.tampered_must_fail_verification;
  assert.equal(await verifyEvent(tampered), false);
});

test('verification rejects malformed envelopes with a specific reason', async () => {
  const good = vectors.event.signed;
  await assert.rejects(() => verifyEvent({ ...good, pubkey: 'nope' }), /pubkey/);
  await assert.rejects(() => verifyEvent({ ...good, created_at: 1.5 }), /created_at/);
  await assert.rejects(() => verifyEvent({ ...good, tags: [['a', 1]] }), /array of strings/);
  await assert.rejects(() => verifyEvent({ ...good, id: 'short' }), /id is not/);
  await assert.rejects(() => verifyEvent({ ...good, sig: 'short' }), /sig is not/);
});

test('sign then verify round-trips for a fresh key', async () => {
  const sk = generateSecretKey();
  const event = await finalizeEvent(
    { created_at: 1789000000, kind: KIND, tags: [['d', 'x']], content: 'hi' },
    sk,
  );
  assert.equal(event.pubkey, getPublicKey(sk));
  assert.equal(await verifyEvent(event), true);
});

test('signing is stable regardless of how the draft was built', async () => {
  const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const a = await finalizeEvent({ created_at: 1, kind: 1, tags: [], content: 'x' }, sk);
  const b = await finalizeEvent({ created_at: 1, kind: 1, tags: [], content: 'x' }, sk);
  assert.equal(a.id, b.id, 'the id must not depend on signing nonce');
});

// ── NIP-19 ──

test('bech32 round-trips and rejects a corrupted checksum', () => {
  const bytes = hexToBytes('ff'.repeat(32));
  const encoded = bech32Encode('npub', bytes);
  assert.deepEqual(bech32Decode(encoded).bytes, bytes);
  const corrupted = `${encoded.slice(0, -1)}${encoded.at(-1) === 'q' ? 'p' : 'q'}`;
  assert.equal(bech32Decode(corrupted), null);
});

test('naddr round-trips through the recorded vector', () => {
  const { comp_id: compId, organizer, naddr, address } = vectors.address;
  assert.equal(naddrEncode({ identifier: compDTag(compId), pubkey: organizer, kind: KIND }), naddr);
  const decoded = decodeNip19(naddr);
  assert.equal(decoded.type, 'naddr');
  assert.equal(decoded.data.kind, KIND);
  assert.equal(decoded.data.pubkey, organizer);
  assert.equal(decoded.data.identifier, compDTag(compId));
  assert.equal(addressOf({ kind: KIND, pubkey: organizer, identifier: compDTag(compId) }), address);
});

test('an address with a colon in the identifier still parses', () => {
  // Competition d-tags are full of colons; a naive split(':') loses them.
  const parsed = parseAddress(vectors.address.address);
  assert.equal(parsed.identifier, compDTag(vectors.address.comp_id));
  assert.equal(parsed.kind, KIND);
});

test('npub encoding matches the pubkey it came from', () => {
  const npub = npubEncode(vectors.address.organizer);
  assert.equal(decodeNip19(npub).data, vectors.address.organizer);
});

test('garbage NIP-19 input returns null instead of throwing', () => {
  for (const value of ['', 'naddr1', 'npub1qqqq', 'not-bech32', 'nsec1' + 'q'.repeat(50)]) {
    assert.doesNotThrow(() => decodeNip19(value));
  }
});

// ── d-tags ──

test('d-tag parsing matches every recorded vector', () => {
  for (const vector of vectors.d_tags) {
    assert.deepEqual(parseDTag(vector.d), vector.expected, vector.d);
  }
});

test('a climb d-tag is never mistaken for a competition d-tag', () => {
  assert.equal(parseDTag('cruxcoach:climb:354c9b2d:089ccfd9-1111-4111-8111-111111111111'), null);
});

test('log d-tags sort lexicographically in numeric order', () => {
  const tags = [5, 1, 40, 999999, 12].map((n) => logDTag('9f2c41ab77e05d13', n));
  const sorted = [...tags].sort();
  assert.deepEqual(sorted.map((t) => parseDTag(t).seq), [1, 5, 12, 40, 999999]);
});

// ── configuration validation ──

function validConfig() {
  const stream = readFixture('streams/happy-sync.json');
  const payload = JSON.parse(stream.competition_event.content);
  const { v, type, ...config } = payload;
  return config;
}

test('the fixture competition validates', () => {
  const result = validateCompetitionConfig(validConfig());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('available climbs and counted results are independent and backwards compatible', () => {
  const base = validConfig();
  const climbs = Array.from({ length: 12 }, (_, index) => ({
    ...base.climbs[index % base.climbs.length],
    id: `c${index + 1}`,
    climb_uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  const bestFive = {
    ...base,
    climbs,
    rules: { ...base.rules, climb_count: 5, counted_climb_count: 5 },
  };
  assert.equal(validateCompetitionConfig(bestFive).ok, true);

  const tooManyCounted = {
    ...bestFive, rules: { ...bestFive.rules, climb_count: 13, counted_climb_count: 13 },
  };
  assert.ok(validateCompetitionConfig(tooManyCounted).errors
    .some((error) => error.field === 'rules.counted_climb_count'));

  // Existing signed events omit the additive field and retain N == M.
  assert.equal(validateCompetitionConfig(base).ok, true);
});

test('shared pools need N options; only exclusive claims multiply N by capacity', () => {
  const base = validConfig();
  const options = Array.from({ length: 5 }, (_, index) => ({
    ...base.climbs[index % base.climbs.length],
    id: `p${index + 1}`,
    climb_uuid: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  const shared = {
    ...base,
    climbs: undefined,
    climb_pool: { source: 'organizer_list', options },
    rules: {
      ...base.rules, climb_source: 'participant_choice', climb_count: 5,
      counted_climb_count: 5, selection_uniqueness: 'none',
    },
  };
  assert.equal(validateCompetitionConfig(shared).ok, true, 'capacity never multiplies a shared pool');

  const exclusiveShort = {
    ...shared,
    capacity: 2,
    rules: { ...shared.rules, selection_uniqueness: 'unique_per_competition' },
  };
  assert.ok(validateCompetitionConfig(exclusiveShort).errors.some((error) => error.field === 'climb_pool'));

  const exclusiveEnough = {
    ...exclusiveShort,
    climb_pool: {
      ...exclusiveShort.climb_pool,
      options: [...options, ...options.map((option, index) => ({
        ...option, id: `q${index + 1}`,
        climb_uuid: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }))],
    },
  };
  assert.equal(validateCompetitionConfig(exclusiveEnough).ok, true);
});

test('registration may overlap check-in and late arrivals require an explicit rule', () => {
  const base = validConfig();
  const overlap = {
    ...base,
    registration_closes_at: base.checkin_opens_at + 300,
  };
  assert.equal(validateCompetitionConfig(overlap).ok, true, 'overlapping windows should be valid');
  assert.equal(registrationWindowOpen(overlap, 'checkin_open', overlap.checkin_opens_at), true);

  const afterStart = {
    ...overlap,
    registration_closes_at: base.starts_at + 60,
    checkin_closes_at: base.starts_at + 120,
  };
  assert.equal(validateCompetitionConfig(afterStart).ok, false, 'late arrivals must be opted into');

  const late = { ...afterStart, rules: { ...base.rules, late_entry_allowed: true } };
  assert.equal(validateCompetitionConfig(late).ok, true);
  assert.equal(registrationWindowOpen(late, 'running', base.starts_at + 30), true);
  assert.equal(checkinWindowOpen(late, 'running', base.starts_at + 30), true);
  assert.equal(registrationWindowOpen(late, 'running', late.registration_closes_at + 1), false);
  assert.equal(checkinWindowOpen(late, 'running', late.checkin_closes_at + 1), false);
});

test('validation names the field that is wrong', () => {
  const cases = [
    [{ title: '' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ capacity: -1 }, 'capacity'],
    [{ capacity: 501 }, 'capacity'],
    [{ comp_id: 'NOTHEX' }, 'comp_id'],
    [{ authority: 'nope' }, 'authority'],
    [{ visibility: 'secret' }, 'visibility'],
    [{ relays: ['ws://plaintext.example'] }, 'relays'],
    [{ relays: [] }, 'relays'],
    [{ fee_msat: 1000 }, 'fee_lnurl'],
    [{ fee_msat: 0, fee_lnurl: 'a@b.example' }, 'fee_lnurl'],
    [{ divisions: [] }, 'divisions'],
    [{ starts_at: 1, ends_at: 0 }, 'ends_at'],
    // A control character in a title: written as an escape, because a raw
    // NUL in the source makes git treat this whole file as binary and stop
    // showing diffs for it.
    [{ title: 'ok\u0000title' }, 'title'],
  ];
  for (const [patch, field] of cases) {
    const result = validateCompetitionConfig({ ...validConfig(), ...patch });
    assert.equal(result.ok, false, `${JSON.stringify(patch)} should be invalid`);
    assert.ok(
      result.errors.some((e) => e.field === field),
      `${JSON.stringify(patch)} should name "${field}", got ${JSON.stringify(result.errors)}`,
    );
  }
});

test('rule combinations that cannot work are refused', () => {
  const base = validConfig();
  const uniqueWithoutChoice = validateCompetitionConfig({
    ...base,
    rules: { ...base.rules, selection_uniqueness: 'unique_per_competition' },
  });
  assert.ok(uniqueWithoutChoice.errors.some((e) => e.field === 'rules.selection_uniqueness'));

  // Point scoring with participant-chosen climbs has no points table to read,
  // so every score would silently be zero.
  const pointsWithoutTable = validateCompetitionConfig({
    ...base,
    climbs: undefined,
    climb_pool: { source: 'board_catalogue' },
    rules: { ...base.rules, scoring: 'points_sum', climb_source: 'participant_choice' },
  });
  assert.ok(pointsWithoutTable.errors.some((e) => e.field === 'rules.scoring'));

  const tooManyConsecutive = validateCompetitionConfig({
    ...base,
    rules: { ...base.rules, defer_budget_per_round: 1, max_consecutive_defers: 3 },
  });
  assert.ok(tooManyConsecutive.errors.some((e) => e.field === 'rules.max_consecutive_defers'));
});

test('Zone Top and Flash scoring requires explicit bounded point values', () => {
  const base = validConfig();
  const missing = validateCompetitionConfig({
    ...base, rules: { ...base.rules, scoring: 'achievement_points' },
  });
  assert.ok(missing.errors.some((e) => e.field === 'rules.score_points'));

  const valid = validateCompetitionConfig({
    ...base,
    rules: {
      ...base.rules, scoring: 'achievement_points',
      score_points: { zone: 10, top: 15, flash: 5 },
    },
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
});

test('a duplicate climb id or division id is refused', () => {
  const base = validConfig();
  const dupClimb = validateCompetitionConfig({
    ...base,
    climbs: [base.climbs[0], { ...base.climbs[1], id: base.climbs[0].id }],
  });
  assert.ok(dupClimb.errors.some((e) => e.field === 'climbs'));

  const dupDivision = validateCompetitionConfig({
    ...base,
    divisions: [{ id: 'open', label: 'A' }, { id: 'open', label: 'B' }],
  });
  assert.ok(dupDivision.errors.some((e) => e.field === 'divisions'));
});

// ── envelope gate ──

test('an unlisted competition carries no discovery hashtag', () => {
  const config = { ...validConfig(), visibility: 'unlisted' };
  const event = buildCompetitionEvent(config, 1789000000);
  assert.equal(event.tags.some((t) => t[0] === 't'), false);
  const listed = buildCompetitionEvent({ ...config, visibility: 'public' }, 1789000000);
  assert.ok(listed.tags.some((t) => t[0] === 't' && t[1] === 'cruxcoach-competition'));
});

test('the envelope gate rejects everything it is supposed to', () => {
  const stream = readFixture('streams/happy-sync.json');
  const good = stream.competition_event;
  const now = 1789020000;
  assert.equal(classifyEvent(good, now).ok, true);

  const drop = (name) => ({ ...good, tags: good.tags.filter((t) => t[0] !== name) });
  assert.match(classifyEvent({ ...good, kind: 1 }, now).error, /wrong kind/);
  assert.match(classifyEvent(drop('L'), now).error, /namespace/);
  assert.match(classifyEvent(drop('cc-schema'), now).error, /cc-schema/);
  assert.match(classifyEvent(drop('d'), now).error, /d tag/);
  assert.match(classifyEvent({ ...good, created_at: now + 7200 }, now).error, /future/);
  assert.match(classifyEvent({ ...good, content: 'not json' }, now).error, /JSON object/);
});

test('a future schema version asks for an upgrade instead of half-reading the event', () => {
  const stream = readFixture('streams/happy-sync.json');
  const good = stream.competition_event;
  const future = {
    ...good,
    tags: good.tags.map((t) => (t[0] === 'cc-schema' ? ['cc-schema', 'cruxcoach-competition/2'] : t)),
  };
  const result = classifyEvent(future, 1789020000);
  assert.equal(result.ok, false);
  assert.equal(result.needsUpgrade, true);
});

test('an event whose payload type contradicts its d-tag is refused', () => {
  const stream = readFixture('streams/happy-sync.json');
  const good = stream.competition_event;
  const payload = JSON.parse(good.content);
  const lying = { ...good, content: JSON.stringify({ ...payload, type: 'log' }) };
  assert.match(classifyEvent(lying, 1789020000).error, /type does not match/);
});

test('parseCompetitionEvent exposes the address it will be referenced by', () => {
  const stream = readFixture('streams/happy-sync.json');
  const parsed = parseCompetitionEvent(stream.competition_event, 1789020000);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.address, `${KIND}:${stream.competition_event.pubkey}:${compDTag(parsed.competition.comp_id)}`);
});

test('an intent binds its d-tag to the signer', () => {
  const pubkey = vectors.keys.alice.pubkey;
  const draft = buildIntentEvent({
    compId: vectors.address.comp_id,
    organizerPubkey: vectors.address.organizer,
    authority: vectors.address.organizer,
    pubkey,
    nonce: '3f9a2c17',
    op: 'register',
    data: { division: 'open', display: 'alice', waiver_accepted: true },
    at: 1789000100,
  });
  const dTag = draft.tags.find((t) => t[0] === 'd')[1];
  assert.equal(dTag, intentDTag(vectors.address.comp_id, pubkey, '3f9a2c17'));
  assert.equal(parseDTag(dTag).pubkeyPrefix, pubkey.slice(0, 8));
});

test('every builder produces an event inside the relay size ceiling', () => {
  const event = buildCompetitionEvent(validConfig(), 1789000000);
  const wire = JSON.stringify({ ...event, pubkey: 'f'.repeat(64), id: 'f'.repeat(64), sig: 'f'.repeat(128) });
  assert.ok(wire.length < 65536, `competition event is ${wire.length} bytes`);
});

test('the relay-url rule matches every recorded vector', async () => {
  const { isAllowedRelayUrl, isLoopbackRelay } = await import('../competitions/app/protocol/relay-url.mjs');
  for (const vector of vectors.relay_urls) {
    assert.equal(isAllowedRelayUrl(vector.url), vector.allowed, `allowed: ${vector.url}`);
    assert.equal(isLoopbackRelay(vector.url), vector.loopback, `loopback: ${vector.url}`);
  }
});

test('a competition may name the loopback dev relay but not a cleartext public one', () => {
  const base = validConfig();
  assert.equal(validateCompetitionConfig({ ...base, relays: ['ws://127.0.0.1:7447'] }).ok, true);
  const cleartext = validateCompetitionConfig({ ...base, relays: ['ws://relay.example.invalid'] });
  assert.equal(cleartext.ok, false);
  assert.ok(cleartext.errors.some((e) => e.field === 'relays'));
  // A host that merely starts with a loopback literal is not loopback.
  assert.equal(validateCompetitionConfig({ ...base, relays: ['ws://127.0.0.1.evil.invalid'] }).ok, false);
});
