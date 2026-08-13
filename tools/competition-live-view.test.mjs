import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deferAvailability, personalCue, queuePreview, rotationPreview, syncHealth, tiedAt,
} from '../competitions/app/ui/live-view.mjs';

const participants = ['a', 'b', 'c', 'd', 'e'].map((pubkey) => ({
  pubkey, display: pubkey.toUpperCase(), selections: ['one', 'two'], climbs: [],
  defers_used_this_round: 0, consecutive_defers: 0,
}));

const running = {
  status: 'running', paused: false, order: participants.map((p) => p.pubkey), cursor: 1,
  current_climb_id: 'one', round: 2,
};

const competition = {
  rules: {
    climb_source: 'organizer_set', defer_budget_per_round: 2,
    max_consecutive_defers: 1,
  },
  climbs: [
    { id: 'one', label: 'Boulder 1', angle: 40 },
    { id: 'two', label: 'Boulder 2', angle: 40 },
    { id: 'three', label: 'Boulder 3', angle: 40 },
  ],
};

test('personal cues cover lifecycle and every queue relation without local state', () => {
  assert.deepEqual(personalCue({ ...running, status: 'draft' }, 'b').kind, 'waiting');
  assert.deepEqual(personalCue({ ...running, status: 'published' }, 'b').kind, 'waiting');
  assert.deepEqual(personalCue({ ...running, status: 'registration_open' }, 'b').kind, 'waiting');
  assert.deepEqual(personalCue({ ...running, status: 'registration_closed' }, 'b').kind, 'waiting');
  assert.deepEqual(personalCue({ ...running, status: 'checkin_open' }, 'b').kind, 'waiting');
  assert.deepEqual(personalCue(running, 'b'), { kind: 'current', ahead: 0, index: 1 });
  assert.deepEqual(personalCue(running, 'c'), { kind: 'next', ahead: 1, index: 2 });
  assert.deepEqual(personalCue(running, 'e'), { kind: 'queued', ahead: 3, index: 4 });
  assert.equal(personalCue(running, 'missing').kind, 'not_queued');
  assert.equal(personalCue({ ...running, status: 'paused' }, 'b').kind, 'paused');
  assert.equal(personalCue({ ...running, status: 'finished' }, 'b').kind, 'finished');
  assert.equal(personalCue({ ...running, status: 'cancelled' }, 'b').kind, 'cancelled');
  assert.equal(personalCue(running, '').kind, 'spectator');
});

test('projection queues are bounded and keep current and next semantics', () => {
  const preview = queuePreview(running, participants, 2);
  assert.deepEqual(preview.entries.map((entry) => entry.pubkey), ['b', 'c']);
  assert.equal(preview.entries[0].current, true);
  assert.equal(preview.entries[1].next, true);
  assert.equal(preview.hidden, 2);
});

test('rotation starts at the event current climb and wraps predictably', () => {
  const preview = rotationPreview(competition, { ...running, current_climb_id: 'two' }, participants[1], 3);
  assert.deepEqual(preview.entries.map((climb) => climb.id), ['two', 'three', 'one']);
  assert.equal(preview.entries[0].current, true);
  assert.equal(preview.entries[1].next, true);

  const asynchronous = rotationPreview({
    ...competition,
    rules: { ...competition.rules, progression: 'asynchronous_turns' },
  }, running, { ...participants[1], climbs: [{ climb_id: 'one', outcome: 'top' }] }, 4);
  assert.deepEqual(asynchronous.entries.map((climb) => climb.id), ['two', 'three']);
  assert.equal(asynchronous.entries[0].next, true);

  const personal = rotationPreview({
    ...competition,
    rules: { ...competition.rules, climb_source: 'participant_choice' },
    climb_pool: { options: competition.climbs },
  }, running, { ...participants[1], climbs: [{ climb_id: 'one', outcome: 'top' }] }, 4);
  assert.deepEqual(personal.entries.map((climb) => climb.id), ['two']);
});

test('defer policy exposes a visible reason for every disabled state', () => {
  const me = participants[1];
  assert.equal(deferAvailability(running, competition, me, 'b').allowed, true);
  assert.equal(deferAvailability({ ...running, status: 'paused' }, competition, me, 'b').reason, 'paused');
  assert.equal(deferAvailability(running, competition, me, 'c').reason, 'not_your_turn');
  assert.equal(deferAvailability(running, competition, { ...me, defers_used_this_round: 2 }, 'b').reason, 'budget');
  assert.equal(deferAvailability(running, competition, { ...me, consecutive_defers: 1 }, 'b').reason, 'consecutive');
});

test('transport health never rewrites retained event truth', () => {
  assert.equal(syncHealth({ state: running, connectedRelays: 2, lastSyncedAt: 100 }, 300).kind, 'live');
  assert.equal(syncHealth({ state: running, connectedRelays: 0, lastSyncedAt: 290 }, 300).kind, 'offline');
  assert.equal(syncHealth({ state: running, connectedRelays: 0, lastSyncedAt: 100 }, 300).kind, 'stale');
  assert.equal(syncHealth({ state: null, connectedRelays: 0, lastSyncedAt: 0 }, 300).kind, 'connecting');
});

test('ties are labelled even when tied rows are not adjacent', () => {
  const standings = [{ rank: 1 }, { rank: 3 }, { rank: 1 }];
  assert.equal(tiedAt(standings, 0), true);
  assert.equal(tiedAt(standings, 1), false);
});
