import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlaceholderUuid, normalizeUuid, parseClimbRef, describeClimbEvent,
  checkBoardCompatibility, buildClimbList, climbEventFilter,
} from '../competitions/app/protocol/climb-ref.mjs';
import { validateCompetitionConfig, KIND } from '../competitions/app/protocol/competition.mjs';

/**
 * Competition climbs have to be real climbs.
 *
 * The failure this guards against is not subtle once it happens and completely
 * invisible before: a competition whose climbs are made-up uuids publishes,
 * validates, reduces and scores perfectly, and then cannot be climbed, because
 * no board can load a climb that does not exist.
 */

const REAL = 'a1c93f57-6e28-4b04-9d75-2f8a1e63c0b9';
const SETTER = '2014dc3b1e6ca37888d3b4620fd4f23f1d8e5440dfbe51121cf787ad63b15004';

test('a placeholder uuid is refused in every form it arrives in', () => {
  const placeholders = [
    '00000000-0000-0000-0000-000000000000',
    '00000001-0000-4000-8000-000000000000',
    '00000009-0000-4000-8000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    // Dressed up as a version-4 uuid, which is how a placeholder gets past a
    // check that only looks for repetition across the whole string.
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000000000000000000000000000',
  ];
  for (const value of placeholders) {
    assert.equal(isPlaceholderUuid(value), true, value);
    assert.equal(parseClimbRef(value).error, 'placeholder', value);
  }
  // The shape a real climb has must not be caught by the same net. A uuid is
  // random, so one whose digits merely start the same is perfectly ordinary.
  assert.equal(isPlaceholderUuid(REAL), false);
  assert.equal(isPlaceholderUuid('11111111-2222-4333-8444-555555555555'), false);
  assert.equal(isPlaceholderUuid('not a uuid'), false);
});

test('a bare uuid, in either dialect, is a catalogue climb', () => {
  assert.deepEqual(parseClimbRef(REAL), { ok: true, kind: 'catalogue', uuid: REAL });
  // Kilter's legacy 32-hex ids occur in the wild alongside dashed uuids.
  const legacy = 'a'.repeat(31) + '1';
  assert.deepEqual(parseClimbRef(legacy), { ok: true, kind: 'catalogue', uuid: legacy });
  assert.deepEqual(parseClimbRef(REAL.toUpperCase()), { ok: true, kind: 'catalogue', uuid: REAL });
});

test('the share link the app already produces is accepted', () => {
  assert.deepEqual(parseClimbRef(`https://cruxcoach.org/c/${REAL}`), {
    ok: true, kind: 'catalogue', uuid: REAL,
  });
  assert.deepEqual(parseClimbRef(`  https://cruxcoach.org/c/${REAL}/  `), {
    ok: true, kind: 'catalogue', uuid: REAL,
  });
});

test('anything that is not a climb reference is refused, not half-read', () => {
  for (const [input, error] of [
    ['', 'empty'],
    [null, 'empty'],
    ['https://example.org/', 'not_a_climb'],
    ['naddr1notarealone', 'damaged_link'],
    ['just some words', 'not_a_climb'],
  ]) {
    assert.equal(parseClimbRef(input).error, error, String(input));
  }
});

test('a climb event is read for what the organizer needs to see before committing', () => {
  const event = {
    pubkey: SETTER,
    tags: [
      ['board_brand', 'kilter'],
      ['layout_id', '1'],
      ['l', 'Kilter Board', 'com.cruxcoach.board'],
      ['l', '12x12', 'com.cruxcoach.size'],
      ['setter_grade', '17', '40'],
    ],
    content: JSON.stringify({ uuid: REAL, name: 'Blue slab', description: 'Warm-up' }),
  };
  assert.deepEqual(describeClimbEvent(event), {
    uuid: REAL,
    label: 'Blue slab',
    description: 'Warm-up',
    brand: 'kilter',
    boardLabel: 'Kilter Board',
    size: '12x12',
    layoutId: 1,
    setterGradeId: 17,
    angle: 40,
    setterPubkey: SETTER,
  });
});

test('a climb event with unreadable content still yields what it can', () => {
  const described = describeClimbEvent({ pubkey: SETTER, tags: [], content: 'not json' });
  assert.equal(described.label, '');
  assert.equal(described.setterPubkey, SETTER);
  assert.equal(described.setterGradeId, null);
});

test('a climb the board cannot load is a problem; a different angle is only a warning', () => {
  const board = { brand: 'kilter', layout_id: 1, size: '12x12', angle: 40 };
  const climb = {
    brand: 'kilter', layoutId: 1, size: '12x12', angle: 40,
  };
  assert.deepEqual(checkBoardCompatibility(climb, board), {
    compatible: true, problems: [], warnings: [],
  });

  // Brand and layout decide whether the wall can light up at all.
  assert.deepEqual(
    checkBoardCompatibility({ ...climb, brand: 'tension' }, board).problems,
    ['brand'],
  );
  assert.deepEqual(
    checkBoardCompatibility({ ...climb, layoutId: 8 }, board).problems,
    ['layout'],
  );

  // Size and angle are things an organizer can look at and accept.
  const resized = checkBoardCompatibility({ ...climb, size: '7x10' }, board);
  assert.equal(resized.compatible, true);
  assert.deepEqual(resized.warnings, ['size']);
  const tilted = checkBoardCompatibility({ ...climb, angle: 45 }, board);
  assert.equal(tilted.compatible, true);
  assert.deepEqual(tilted.warnings, ['angle']);

  assert.deepEqual(checkBoardCompatibility(climb, null).problems, ['no_board']);
});

test('the climb list refuses duplicates, placeholders and unlabelled entries', () => {
  const { climbs, errors } = buildClimbList([
    { uuid: REAL, label: 'Blue slab', angle: 40, points: 100, kind: 'catalogue' },
    { uuid: REAL, label: 'Blue slab again', angle: 40, kind: 'catalogue' },
    { uuid: '00000001-0000-4000-8000-000000000000', label: 'Fake', angle: 40 },
    { uuid: 'b6d0428e-1f75-4c93-a208-7e35d1b49c60', label: '', angle: 40 },
    { uuid: 'c8f24b06-3a91-4e57-b0d4-9c6153e8a2f7', label: 'No angle' },
    { uuid: 'nonsense', label: 'Nope', angle: 40 },
  ]);
  assert.deepEqual(climbs.map((c) => c.climb_uuid), [REAL]);
  assert.deepEqual(errors.map((e) => e.error), [
    'duplicate', 'placeholder', 'no_label', 'no_angle', 'not_a_climb',
  ]);
  assert.equal(climbs[0].id, 'c1');
  assert.equal(climbs[0].source, 'catalogue');
});

test('the climb list keeps the community address when there is one', () => {
  const { climbs } = buildClimbList([
    { uuid: REAL, label: 'Blue slab', angle: 40, kind: 'community', naddr: 'naddr1example' },
  ]);
  assert.equal(climbs[0].source, 'community');
  assert.equal(climbs[0].naddr, 'naddr1example');
});

test('a community climb is fetched by its own address, not by a search', () => {
  const filter = climbEventFilter({
    setterPubkey: SETTER, dTag: `cruxcoach:climb:${SETTER.slice(0, 8)}:${REAL}`,
  });
  assert.deepEqual(filter.kinds, [KIND]);
  assert.deepEqual(filter.authors, [SETTER]);
  assert.equal(filter.limit, 1);
});

test('normalising a uuid accepts what a climb id can be and nothing else', () => {
  assert.equal(normalizeUuid(`  ${REAL.toUpperCase()}  `), REAL);
  assert.equal(normalizeUuid('a'.repeat(32)), 'a'.repeat(32));
  assert.equal(normalizeUuid('a'.repeat(31)), null);
  assert.equal(normalizeUuid(''), null);
  assert.equal(normalizeUuid(undefined), null);
});

// ── the rule as the validator enforces it ──

function config(overrides = {}) {
  return {
    comp_id: 'aa00bb11cc22dd33',
    authority: '0'.repeat(64),
    authority_epoch: 1,
    title: 'Climb reference test',
    summary: 'x',
    description: 'x',
    organizer: { name: 'Test', contact: 'test@example.invalid' },
    visibility: 'public',
    status: 'draft',
    timezone: 'Europe/Berlin',
    registration_opens_at: 1789000000,
    registration_closes_at: 1789003600,
    checkin_opens_at: 1789003600,
    checkin_closes_at: 1789005400,
    starts_at: 1789005400,
    ends_at: 1789012600,
    capacity: 8,
    waitlist_enabled: true,
    venue: { kind: 'physical', name: 'Test wall', address: 'Loopback 1' },
    board: { brand: 'kilter', model: 'kilterboard-og', layout_id: 1, size: '12x12', angle: 40 },
    divisions: [{ id: 'open', label: 'Open' }],
    eligibility: 'x',
    waiver: 'x',
    waiver_required: false,
    participant_instructions: 'x',
    spectator_info: 'x',
    refund_policy: 'x',
    fee_msat: 0,
    prizes: [],
    rules: {
      climb_source: 'organizer_set',
      climb_count: 1,
      selection_uniqueness: 'none',
      progression: 'synchronous_rounds',
      attempts_per_climb: 3,
      turn_deadline_sec: 120,
      attempt_deadline_sec: 0,
      min_rest_sec: 0,
      defer_budget_per_round: 1,
      max_consecutive_defers: 1,
      defer_slots: 2,
      scoring: 'tops_then_attempts',
      tiebreaks: ['fewest_attempts'],
      late_entry_allowed: false,
    },
    climbs: [{ id: 'c1', climb_uuid: REAL, angle: 40, label: 'Blue slab', points: 100 }],
    relays: ['wss://relay.example.invalid'],
    created_at: 1789000000,
    revision: 1,
    ...overrides,
  };
}

test('a competition carrying a placeholder climb does not validate', () => {
  assert.equal(validateCompetitionConfig(config()).ok, true);

  const withPlaceholder = validateCompetitionConfig(config({
    climbs: [{
      id: 'c1',
      climb_uuid: '00000001-0000-4000-8000-000000000000',
      angle: 40,
      label: 'Qualifier 1',
      points: 100,
    }],
  }));
  assert.equal(withPlaceholder.ok, false);
  assert.ok(
    withPlaceholder.errors.some((e) => /placeholder/i.test(e.message || String(e))),
    JSON.stringify(withPlaceholder.errors),
  );
});

test('participant choice without a real pool does not validate', () => {
  const rules = {
    ...config().rules,
    climb_source: 'participant_choice',
    selection_uniqueness: 'unique_per_competition',
    climb_count: 1,
  };
  const noPool = validateCompetitionConfig(config({ rules, climbs: undefined }));
  assert.equal(noPool.ok, false);

  // A pool too small for everyone to get a full set is the race nobody can win.
  const tooSmall = validateCompetitionConfig(config({
    rules,
    climbs: undefined,
    capacity: 4,
    climb_pool: {
      source: 'organizer_list',
      options: [{ id: 'p1', climb_uuid: REAL, angle: 40, label: 'Blue slab', points: 100 }],
    },
  }));
  assert.equal(tooSmall.ok, false);

  const enough = validateCompetitionConfig(config({
    rules,
    climbs: undefined,
    capacity: 2,
    climb_pool: {
      source: 'organizer_list',
      options: [
        { id: 'p1', climb_uuid: REAL, angle: 40, label: 'Blue slab', points: 100 },
        { id: 'p2', climb_uuid: 'b6d0428e-1f75-4c93-a208-7e35d1b49c60', angle: 40, label: 'Red roof', points: 100 },
      ],
    },
  }));
  assert.equal(enough.ok, true, JSON.stringify(enough.errors));
});
