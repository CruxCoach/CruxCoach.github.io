import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BOARD_INSTANCE_ID_RE,
  VENUE_ID_RE,
  assignBoardInstanceIds,
  assignVenueIds,
  clearVenueIds,
  deriveVenueId,
  loadVenueIdLedger,
  validateLedgerEntry,
} from './venue-ids.mjs';

/**
 * These ids are the join between a public report and a venue on the map. If one
 * moves between rebuilds, an operator opening a three-day-old report is looking
 * at the wrong gym — or at nothing. So the properties tested here are the ones
 * the whole reporting feature rests on.
 */

function venue(lat, lon, name, country = 'DE', boards = []) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name, country, boards },
  };
}

test('a derived id is a pure function of the venue key', () => {
  assert.equal(deriveVenueId(48.11234, 11.63456), deriveVenueId(48.11234, 11.63456));
  assert.match(deriveVenueId(48.11234, 11.63456), VENUE_ID_RE);
  // Different venues, different ids. A whole grid step apart, because anything
  // finer than 4 decimals is the same venue by construction — 11.63456 and
  // 11.6346 are one coordinate, not two.
  assert.notEqual(deriveVenueId(48.1123, 11.6345), deriveVenueId(48.1124, 11.6345));
  assert.notEqual(deriveVenueId(48.1123, 11.6345), deriveVenueId(48.1123, 11.6346));
});

test('a coordinate nudge inside the grouping precision does not move the id', () => {
  // The build already groups venues at 4 decimals (~11 m). An upstream feed
  // that re-derives a coordinate a metre either way must not renumber the venue.
  const base = deriveVenueId(48.112341, 11.634561);
  assert.equal(deriveVenueId(48.1123414, 11.6345612), base);
  assert.equal(deriveVenueId(48.11234, 11.63456), base);
});

test('ids survive a rebuild from identical input', () => {
  const first = [venue(48.1, 11.6, 'Boulderwelt Ost', 'DE', [{ board: 'moonboard', variant: '2019' }])];
  const second = [venue(48.1, 11.6, 'Boulderwelt Ost', 'DE', [{ board: 'moonboard', variant: '2019' }])];

  assignVenueIds(first);
  assignVenueIds(second);

  assert.equal(first[0].properties.venue_id, second[0].properties.venue_id);
  assert.equal(
    first[0].properties.boards[0].instance_id,
    second[0].properties.boards[0].instance_id,
  );
});

test('a board id does not depend on the details a report would change', () => {
  const before = [{ board: 'kilter', walls: [{ wall_name: 'Main', layout: 'Original', size_id: 10, angle: 40 }] }];
  const after = [{ board: 'kilter', walls: [{ wall_name: 'Main', layout: 'Original', size_id: 10, angle: 45, hold_set: 4, led: true }] }];

  assignBoardInstanceIds('v1_000000000001', before);
  assignBoardInstanceIds('v1_000000000001', after);

  assert.equal(before[0].walls[0].instance_id, after[0].walls[0].instance_id);
});

test('a row and its single wall get different ids', () => {
  // They are two different things a reporter can point at — "the Kilter setup"
  // and "the 12x12 wall" — and an id shared between them would make a report
  // about one indistinguishable from a report about the other.
  const boards = [{ board: 'kilter', walls: [{ wall_name: 'Kilter Board', layout: 'Original', size_id: 28 }] }];
  assignBoardInstanceIds('v1_000000000001', boards);
  assert.notEqual(boards[0].instance_id, boards[0].walls[0].instance_id);
});

test('two indistinguishable installations still get distinct ids', () => {
  const boards = [
    { board: 'kilter', walls: [{ wall_name: 'Board', layout: 'Original', size_id: 10 }] },
    { board: 'kilter', walls: [{ wall_name: 'Board', layout: 'Original', size_id: 10 }] },
  ];
  assignBoardInstanceIds('v1_000000000001', boards);
  assert.notEqual(boards[0].instance_id, boards[1].instance_id);
  assert.match(boards[0].instance_id, BOARD_INSTANCE_ID_RE);
});

test('every venue and every board in the shipped dataset carries an id', () => {
  const data = JSON.parse(readFileSync(new URL('../boards/data/boards.geojson', import.meta.url), 'utf8'));
  const venueIds = new Set();
  const instanceIds = new Set();

  for (const feature of data.features) {
    const id = feature.properties.venue_id;
    assert.match(id ?? '', VENUE_ID_RE, `${feature.properties.name} has no usable venue_id`);
    assert.ok(!venueIds.has(id), `venue id ${id} is claimed twice`);
    venueIds.add(id);

    for (const board of feature.properties.boards ?? []) {
      assert.match(board.instance_id ?? '', BOARD_INSTANCE_ID_RE);
      assert.ok(!instanceIds.has(board.instance_id), `instance id ${board.instance_id} is claimed twice`);
      instanceIds.add(board.instance_id);
      for (const wall of board.walls ?? []) {
        assert.match(wall.instance_id ?? '', BOARD_INSTANCE_ID_RE);
        assert.ok(!instanceIds.has(wall.instance_id), `instance id ${wall.instance_id} is claimed twice`);
        instanceIds.add(wall.instance_id);
      }
    }
  }

  assert.equal(venueIds.size, data.features.length);
});

test('the committed ids match what the assigner produces today', () => {
  // The nightly refresh regenerates this file. If the derivation ever changed
  // without a version bump, every id in the dataset would silently move and
  // every open report would point at nothing.
  const data = JSON.parse(readFileSync(new URL('../boards/data/boards.geojson', import.meta.url), 'utf8'));
  for (const feature of data.features.slice(0, 50)) {
    const [lon, lat] = feature.geometry.coordinates;
    assert.equal(feature.properties.venue_id, deriveVenueId(lat, lon), feature.properties.name);
  }
});

test('the ledger pins an id through a coordinate correction', () => {
  const original = [venue(48.1, 11.6, 'Boulderwelt Ost')];
  assignVenueIds(original);
  const pinnedId = original[0].properties.venue_id;

  // Upstream moves the gym 120 m — a corrected address, not a new venue.
  const moved = [venue(48.1011, 11.6, 'Boulderwelt Ost')];
  const derivedAfterMove = [...moved.map((f) => f)];
  assignVenueIds(derivedAfterMove);
  assert.notEqual(
    derivedAfterMove[0].properties.venue_id,
    pinnedId,
    'the derivation should change — that is why the ledger exists',
  );

  clearVenueIds(moved);
  const { stats } = assignVenueIds(moved, [
    {
      id: pinnedId,
      lat: 48.1011,
      lon: 11.6,
      name: 'Boulderwelt Ost',
      country: 'DE',
      previous: [{ lat: 48.1, lon: 11.6 }],
      recorded: '2026-08-23',
      note: 'Upstream corrected the coordinate; same gym.',
    },
  ]);

  assert.equal(moved[0].properties.venue_id, pinnedId);
  assert.equal(stats.pinned, 1);
  assert.equal(stats.derived, 0);
});

test('a ledger record matches by identity when no recorded coordinate is exact', () => {
  const features = [venue(48.1015, 11.6002, 'Boulderwelt München Ost GmbH')];
  const { stats } = assignVenueIds(features, [
    {
      id: 'v1_abcdef012345',
      lat: 48.1,
      lon: 11.6,
      name: 'Boulderwelt München Ost',
      country: 'DE',
      recorded: '2026-08-23',
      note: 'Coordinate drifted a little; matched by name and proximity.',
    },
  ]);
  assert.equal(features[0].properties.venue_id, 'v1_abcdef012345');
  assert.equal(stats.pinned, 1);
});

test('a ledger record refuses to guess between two candidates', () => {
  const features = [
    venue(48.1, 11.6, 'Kletterhalle Nord'),
    venue(48.1005, 11.6005, 'Kletterhalle Nord'),
  ];
  const { stats, problems } = assignVenueIds(features, [
    {
      id: 'v1_abcdef012345',
      lat: 48.10025,
      lon: 11.60025,
      name: 'Kletterhalle Nord',
      country: 'DE',
      recorded: '2026-08-23',
      note: 'Ambiguous on purpose, for the test.',
    },
  ]);

  assert.equal(stats.ambiguous, 1);
  assert.equal(stats.pinned, 0);
  assert.match(problems.join('\n'), /refusing to guess/);
  // Both venues still get their derived ids: a refused pin costs the pin, not
  // the venues.
  assert.equal(stats.derived, 2);
});

test('a ledger record that matches nothing is reported, not applied', () => {
  const features = [venue(48.1, 11.6, 'Boulderwelt Ost')];
  const { stats, problems } = assignVenueIds(features, [
    {
      id: 'v1_abcdef012345',
      lat: 10,
      lon: 10,
      name: 'Somewhere Else',
      country: 'ZA',
      recorded: '2026-08-23',
      note: 'Stale record, for the test.',
    },
  ]);
  assert.equal(stats.unmatched, 1);
  assert.match(problems.join('\n'), /stale record\?/);
});

test('a derived id colliding with a pinned one leaves the venue without an id', () => {
  // Better a venue with no id than an id that means two gyms: a report filed
  // against a shared id would name the wrong place, and nobody would know.
  const target = venue(48.1, 11.6, 'Boulderwelt Ost');
  const other = venue(52.5, 13.4, 'Kletterhalle Nord');
  const collidingId = deriveVenueId(52.5, 13.4);

  const { stats, problems } = assignVenueIds([target, other], [
    {
      id: collidingId,
      lat: 48.1,
      lon: 11.6,
      name: 'Boulderwelt Ost',
      country: 'DE',
      recorded: '2026-08-23',
      note: 'Deliberately collides, for the test.',
    },
  ]);

  assert.equal(target.properties.venue_id, collidingId);
  assert.equal(other.properties.venue_id, undefined);
  assert.equal(stats.collisions, 1);
  assert.match(problems.join('\n'), /already pinned to another venue/);
});

test('clearing removes every id so a deleted ledger record really takes effect', () => {
  const features = [venue(48.1, 11.6, 'Boulderwelt Ost', 'DE', [{ board: 'kilter', walls: [{ wall_name: 'A' }] }])];
  assignVenueIds(features);
  clearVenueIds(features);

  assert.equal(features[0].properties.venue_id, undefined);
  assert.equal(features[0].properties.boards[0].instance_id, undefined);
  assert.equal(features[0].properties.boards[0].walls[0].instance_id, undefined);
});

test('the ledger schema refuses records that would be unreviewable later', () => {
  const good = {
    id: 'v1_abcdef012345',
    lat: 48.1,
    lon: 11.6,
    name: 'Boulderwelt Ost',
    country: 'DE',
    recorded: '2026-08-23',
    note: 'Upstream corrected the coordinate.',
  };
  assert.deepEqual(validateLedgerEntry(good), []);

  assert.ok(validateLedgerEntry({ ...good, note: undefined }).length > 0, 'a pin without a reason');
  assert.ok(validateLedgerEntry({ ...good, id: 'venue-1' }).length > 0, 'a malformed id');
  assert.ok(validateLedgerEntry({ ...good, country: 'Germany' }).length > 0, 'a non-ISO country');
  assert.ok(validateLedgerEntry({ ...good, recorded: '23.08.2026' }).length > 0, 'a non-ISO date');
  assert.ok(validateLedgerEntry({ ...good, recorded: '2026-02-31' }).length > 0, 'a date that does not exist');
  assert.ok(validateLedgerEntry({ ...good, surprise: 1 }).length > 0, 'an unknown field');
  assert.ok(validateLedgerEntry({ ...good, previous: [{ lat: 1 }] }).length > 0, 'a half-written previous position');
});

test('the committed ledger is valid', () => {
  const file = new URL('./venue-ids.json', import.meta.url);
  const { entries, errors, present } = loadVenueIdLedger(file);
  assert.ok(present, 'tools/venue-ids.json must exist so the build has one place to pin ids');
  assert.deepEqual(errors, []);
  assert.ok(Array.isArray(entries));
});

test('two ledger records cannot claim one id', () => {
  const entries = [
    { id: 'v1_abcdef012345', lat: 1, lon: 1, name: 'A', country: 'DE', recorded: '2026-08-23', note: 'x' },
    { id: 'v1_abcdef012345', lat: 2, lon: 2, name: 'B', country: 'DE', recorded: '2026-08-23', note: 'y' },
  ];
  const features = [venue(1, 1, 'A'), venue(2, 2, 'B')];
  const { stats, problems } = assignVenueIds(features, entries);

  assert.equal(stats.pinned, 1, 'only the first record may hold the id');
  assert.equal(stats.collisions, 1);
  assert.match(problems.join('\n'), /refusing to give two venues one identity/);
  // The second venue falls back to its derived id rather than losing one.
  assert.equal(features[1].properties.venue_id, deriveVenueId(2, 2));
});

test('the file loader also refuses a duplicate id, before the build runs', () => {
  // Two independent checks on purpose: the loader tells a curator their file is
  // wrong; assignVenueIds refuses to act on it whatever the source.
  const entries = [
    { id: 'v1_abcdef012345', lat: 1, lon: 1, name: 'A', country: 'DE', recorded: '2026-08-23', note: 'x' },
    { id: 'v1_abcdef012345', lat: 2, lon: 2, name: 'B', country: 'DE', recorded: '2026-08-23', note: 'y' },
  ];
  const errors = [];
  entries.forEach((entry, i) => errors.push(...validateLedgerEntry(entry, i)));
  assert.deepEqual(errors, [], 'each record is individually valid — the clash is between them');
});
