import test from 'node:test';
import assert from 'node:assert/strict';

import {
  outstandingClaims, freeClimbs, outstandingCount, registrationOrder,
} from '../competitions/app/protocol/claims.mjs';

/**
 * The rule that decides who gets which climb.
 *
 * These are the cases where a competition silently goes wrong: two people ask
 * for one climb, someone re-picks after losing, the organizer's two devices
 * receive the requests in opposite orders. Every one of them has to produce the
 * same answer, or two consoles publish contradictory grants and the reducer
 * starts rejecting entries at a wall full of people.
 */

const POOL = [
  { id: 'p1', climb_uuid: 'aaaaaaaa-1111-4111-8111-111111111111', label: 'Alpha', angle: 40, points: 100 },
  { id: 'p2', climb_uuid: 'bbbbbbbb-2222-4222-8222-222222222222', label: 'Bravo', angle: 40, points: 100 },
  { id: 'p3', climb_uuid: 'cccccccc-3333-4333-8333-333333333333', label: 'Charlie', angle: 40, points: 100 },
  { id: 'p4', climb_uuid: 'dddddddd-4444-4444-8444-444444444444', label: 'Delta', angle: 40, points: 100 },
];

function competition(overrides = {}) {
  return {
    climb_pool: { options: POOL },
    rules: {
      climb_source: 'participant_choice',
      climb_count: 2,
      selection_uniqueness: 'unique_per_competition',
      ...overrides.rules,
    },
    ...overrides,
  };
}

function participant(pubkey, overrides = {}) {
  return {
    pubkey, registration: 'accepted', selections: [], ...overrides,
  };
}

function state(participants, claims = {}, status = 'registration_open') {
  return { status, participants, claims };
}

test('the first accepted entrant gets the climb both asked for', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice'), participant('bob')]),
    requests: new Map([['alice', ['p1', 'p2']], ['bob', ['p1', 'p3']]]),
  });
  assert.deepEqual(owed, [
    { pubkey: 'alice', climbId: 'p1', decision: 'granted' },
    { pubkey: 'alice', climbId: 'p2', decision: 'granted' },
    { pubkey: 'bob', climbId: 'p1', decision: 'denied', reason: 'climb_already_claimed' },
    { pubkey: 'bob', climbId: 'p3', decision: 'granted' },
  ]);
});

test('the answer does not depend on the order the requests arrived in', () => {
  // The console's intent map is insertion-ordered; two relays deliver these in
  // opposite orders. Registration order in the log is what decides.
  const forwards = outstandingClaims({
    competition: competition(),
    state: state([participant('alice'), participant('bob')]),
    requests: new Map([['alice', ['p1']], ['bob', ['p1']]]),
  });
  const backwards = outstandingClaims({
    competition: competition(),
    state: state([participant('alice'), participant('bob')]),
    requests: new Map([['bob', ['p1']], ['alice', ['p1']]]),
  });
  assert.deepEqual(forwards, backwards);
  assert.equal(forwards[0].pubkey, 'alice');
  assert.equal(forwards[0].decision, 'granted');
});

test('a climb requested twice in one pass is only granted once', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice'), participant('bob'), participant('carol')]),
    requests: new Map([['alice', ['p1', 'p2']], ['bob', ['p1', 'p2']], ['carol', ['p1', 'p2']]]),
  });
  const grants = owed.filter((o) => o.decision === 'granted');
  assert.deepEqual(grants, [
    { pubkey: 'alice', climbId: 'p1', decision: 'granted' },
    { pubkey: 'alice', climbId: 'p2', decision: 'granted' },
  ]);
  assert.equal(owed.filter((o) => o.decision === 'denied').length, 4);
});

test('a decision already in the log is not published a second time', () => {
  const inputs = {
    competition: competition(),
    state: state([participant('alice', { selections: ['p1'] }), participant('bob')], { p1: 'alice' }),
    requests: new Map([['alice', ['p1']], ['bob', ['p1']]]),
  };
  const first = outstandingClaims(inputs);
  assert.deepEqual(first, [
    { pubkey: 'bob', climbId: 'p1', decision: 'denied', reason: 'climb_already_claimed' },
  ]);

  // Once that denial is in the log, a re-render must produce nothing. Denials
  // change no state, so without this the console would append one per render.
  const second = outstandingClaims({ ...inputs, answered: new Set(['bob:p1']) });
  assert.deepEqual(second, []);
});

test('a granted climb is not re-granted', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice', { selections: ['p1'] })], { p1: 'alice' }),
    requests: new Map([['alice', ['p1', 'p2']]]),
  });
  assert.deepEqual(owed, [{ pubkey: 'alice', climbId: 'p2', decision: 'granted' }]);
});

test('re-picking after a loss is granted from what is still free', () => {
  // Bob lost p1, was denied, and has now asked for p3 instead.
  const owed = outstandingClaims({
    competition: competition(),
    state: state(
      [participant('alice', { selections: ['p1', 'p2'] }), participant('bob')],
      { p1: 'alice', p2: 'alice' },
    ),
    requests: new Map([['alice', ['p1', 'p2']], ['bob', ['p3', 'p4']]]),
    answered: new Set(['bob:p1']),
  });
  assert.deepEqual(owed, [
    { pubkey: 'bob', climbId: 'p3', decision: 'granted' },
    { pubkey: 'bob', climbId: 'p4', decision: 'granted' },
  ]);
});

test('nobody holds more climbs than the competition uses', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice')]),
    requests: new Map([['alice', ['p1', 'p2', 'p3']]]),
  });
  assert.deepEqual(owed.filter((o) => o.decision === 'granted').map((o) => o.climbId), ['p1', 'p2']);
  assert.deepEqual(owed.at(-1), {
    pubkey: 'alice', climbId: 'p3', decision: 'denied', reason: 'selection_limit',
  });
});

test('a climb that is not in the pool is ignored, not granted', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice')]),
    requests: new Map([['alice', ['p1', 'not-in-the-pool']]]),
  });
  assert.deepEqual(owed, [{ pubkey: 'alice', climbId: 'p1', decision: 'granted' }]);
});

test('only accepted entrants hold climbs', () => {
  // A waitlisted entrant holding a climb they may never use would starve the
  // people who actually got in.
  const owed = outstandingClaims({
    competition: competition(),
    state: state([
      participant('alice', { registration: 'waitlisted' }),
      participant('bob', { registration: 'pending' }),
      participant('carol'),
    ]),
    requests: new Map([['alice', ['p1']], ['bob', ['p1']], ['carol', ['p1']]]),
  });
  assert.deepEqual(owed, [{ pubkey: 'carol', climbId: 'p1', decision: 'granted' }]);
});

test('no claims are decided for a competition that does not use them', () => {
  for (const rules of [{ climb_source: 'organizer_set' }, { selection_uniqueness: 'none' }]) {
    assert.deepEqual(outstandingClaims({
      competition: competition({ rules }),
      state: state([participant('alice')]),
      requests: new Map([['alice', ['p1']]]),
    }), []);
  }
});

test('a finished competition stops deciding claims', () => {
  for (const status of ['finished', 'cancelled']) {
    assert.deepEqual(outstandingClaims({
      competition: competition(),
      state: state([participant('alice')], {}, status),
      requests: new Map([['alice', ['p1']]]),
    }), []);
  }
});

test('requests may be a plain object as well as a Map', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice')]),
    requests: { alice: ['p1'] },
  });
  assert.deepEqual(owed, [{ pubkey: 'alice', climbId: 'p1', decision: 'granted' }]);
});

test('the free list is what a participant may still pick', () => {
  const comp = competition();
  assert.deepEqual(
    freeClimbs(comp, state([], { p1: 'alice', p3: 'bob' })).map((o) => o.id),
    ['p2', 'p4'],
  );
  // Without uniqueness every climb stays available to everybody.
  assert.equal(
    freeClimbs(competition({ rules: { selection_uniqueness: 'none' } }), state([], { p1: 'alice' })).length,
    4,
  );
});

test('the outstanding count is how many more to pick', () => {
  const comp = competition();
  assert.equal(outstandingCount(comp, participant('alice')), 2);
  assert.equal(outstandingCount(comp, participant('alice', { selections: ['p1'] })), 1);
  assert.equal(outstandingCount(comp, participant('alice', { selections: ['p1', 'p2'] })), 0);
  assert.equal(outstandingCount(comp, undefined), 2);
});

test('registration order decides the race, not pubkey order', () => {
  // The reduced state sorts participants by pubkey so every client hashes the
  // same bytes. Deciding a race in that order would mean whoever holds the
  // lowest key wins — and a key is cheap to grind until it is low.
  const sortedByPubkey = [participant('0000aaa'), participant('ffffbbb')];
  const owed = outstandingClaims({
    competition: competition(),
    state: state(sortedByPubkey),
    requests: new Map([['0000aaa', ['p1']], ['ffffbbb', ['p1']]]),
    order: ['ffffbbb', '0000aaa'],
  });
  assert.deepEqual(owed, [
    { pubkey: 'ffffbbb', climbId: 'p1', decision: 'granted' },
    { pubkey: '0000aaa', climbId: 'p1', decision: 'denied', reason: 'climb_already_claimed' },
  ]);
});

test('a participant missing from the order is still decided, last', () => {
  const owed = outstandingClaims({
    competition: competition(),
    state: state([participant('alice'), participant('bob')]),
    requests: new Map([['alice', ['p1']], ['bob', ['p1']]]),
    order: ['bob'],
  });
  assert.equal(owed[0].pubkey, 'bob');
  assert.equal(owed[0].decision, 'granted');
  assert.equal(owed[1].decision, 'denied');
});

test('registration order is read from the log, accepted entrants only', () => {
  const log = [
    { seq: 3, op: 'registration_decision', data: { pubkey: 'carol', decision: 'accepted' } },
    { seq: 1, op: 'registration_decision', data: { pubkey: 'alice', decision: 'accepted' } },
    { seq: 2, op: 'registration_decision', data: { pubkey: 'dan', decision: 'waitlisted' } },
    { seq: 4, op: 'checkin', data: { pubkey: 'bob' } },
    // Accepted off the waitlist later: their place in the order is when they
    // were accepted, not when they first asked.
    { seq: 5, op: 'registration_decision', data: { pubkey: 'dan', decision: 'accepted' } },
    { seq: 6, op: 'registration_decision', data: { pubkey: 'alice', decision: 'accepted' } },
  ];
  assert.deepEqual(registrationOrder(log), ['alice', 'carol', 'dan']);
  assert.deepEqual(registrationOrder([]), []);
});
