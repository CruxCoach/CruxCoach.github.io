import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSidecar, classifyOsmTags, indexSidecar, loadCuratedMatches, loadSidecar,
  osmObjectUrl, rerenderSidecar, SCHEMA_VERSION, STATUS, venueLooksPrivate,
} from './osm-hours.mjs';
import { venueKey } from './venue-key.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURATED_FILE = join(REPO_ROOT, 'tools', 'osm-venues.json');
const SIDECAR_FILE = join(REPO_ROOT, 'boards', 'data', 'osm-opening-hours.json');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');

// ── Fixtures ──────────────────────────────────────────────────────────────
// Deterministic stand-ins for the two live inputs. Nothing in this file
// touches the network: a test suite that needed OpenStreetMap to be up would
// be a test suite that fails for reasons having nothing to do with the code.

const GYM = {
  name: 'Fixture Boulder Hall',
  lat: 48.1372,
  lon: 11.5756,
  osm_type: 'way',
  osm_id: 123456,
};

function curatedEntry(over = {}) {
  return {
    name: GYM.name,
    lat: GYM.lat,
    lon: GYM.lon,
    status: 'accepted',
    venue: 'public',
    osm_type: GYM.osm_type,
    osm_id: GYM.osm_id,
    match_method: 'manual',
    verified_on: '2026-08-22',
    evidence: 'name, address and coordinates all compared by hand against the object',
    ...over,
  };
}

function feature(over = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [over.lon ?? GYM.lon, over.lat ?? GYM.lat] },
    properties: {
      name: over.name ?? GYM.name,
      country: over.country ?? 'DE',
      boards: over.boards ?? [{ board: 'kilter', address: 'Fixture Street 1', walls: [{ layout: 'Original' }] }],
    },
  };
}

function writeCurated(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'osm-hours-test-'));
  const file = join(dir, 'osm-venues.json');
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

function build(over = {}) {
  const key = venueKey(GYM.lat, GYM.lon);
  return buildSidecar({
    accepted: over.accepted ?? [{ ...curatedEntry(), key }],
    features: over.features ?? new Map([[key, feature()]]),
    fetched: over.fetched ?? new Map([[key, {
      status: STATUS.OK,
      kind: 'leisure=sports_centre',
      osm_name: 'Fixture Boulder Hall',
      opening_hours: 'Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00',
      check_date: '2026-06-01',
      timestamp: '2026-05-30T08:00:00Z',
      version: 7,
    }]]),
    refreshedAt: '2026-08-22T00:00:00.000Z',
  });
}

// ── The curated match file ────────────────────────────────────────────────

test('a well-formed curated file loads', () => {
  const { accepted, rejected } = loadCuratedMatches(writeCurated([curatedEntry()]));
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].osm_url, 'https://www.openstreetmap.org/way/123456');
  assert.equal(accepted[0].key, venueKey(GYM.lat, GYM.lon));
});

test('a missing file is not an error — it just means no venue is enriched', () => {
  const { accepted } = loadCuratedMatches(join(tmpdir(), 'definitely-absent-osm-venues.json'));
  assert.deepEqual(accepted, []);
});

test('an automatic match method is refused outright', () => {
  assert.throws(
    () => loadCuratedMatches(writeCurated([curatedEntry({ match_method: 'nearest' })])),
    /must be "manual"/,
  );
});

test('an accepted entry without an exact object id is refused', () => {
  for (const broken of [{ osm_type: 'place' }, { osm_id: 0 }, { osm_id: '123456' }, { osm_id: 1.5 }]) {
    assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry(broken)])),
      /osm_type|osm_id/, JSON.stringify(broken));
  }
});

test('an accepted entry without a verification date or evidence is refused', () => {
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry({ verified_on: 'last week' })])),
    /verified_on/);
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry({ evidence: 'looks right' })])),
    /evidence/);
});

test('an entry that does not assert a public venue is refused', () => {
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry({ venue: 'home' })])),
    /private and home setups/);
  const { venue: _drop, ...noVenue } = curatedEntry();
  assert.throws(() => loadCuratedMatches(writeCurated([noVenue])), /private and home setups/);
});

test('two decisions about the same venue are refused', () => {
  assert.throws(
    () => loadCuratedMatches(writeCurated([curatedEntry(), curatedEntry({ osm_id: 999 })])),
    /already claimed/,
  );
});

test('one OSM object claimed by two venues is refused as ambiguous', () => {
  const other = curatedEntry({ name: 'Neighbour Hall', lat: GYM.lat + 0.01 });
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry(), other])), /ambiguous/);
});

test('a rejection has to say why, and when it was looked at', () => {
  const rejection = { name: 'Nothing There', lat: 1, lon: 2, status: 'rejected' };
  assert.throws(() => loadCuratedMatches(writeCurated([rejection])), /needs a "reason"/);
  assert.throws(
    () => loadCuratedMatches(writeCurated([{ ...rejection, reason: 'no candidate object' }])),
    /reviewed_on/,
  );
  const { rejected } = loadCuratedMatches(writeCurated([
    { ...rejection, reason: 'no candidate object', reviewed_on: '2026-08-22' },
  ]));
  assert.equal(rejected.length, 1);
});

test('an unknown status is refused rather than treated as one of the two', () => {
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry({ status: 'maybe' })])), /status/);
});

// ── Guards ────────────────────────────────────────────────────────────────

test('only public sports venues classify, and the tag that made it pass is reported', () => {
  assert.deepEqual(classifyOsmTags({ leisure: 'sports_centre' }), { ok: true, kind: 'leisure=sports_centre' });
  assert.deepEqual(classifyOsmTags({ sport: 'climbing;fitness' }), { ok: true, kind: 'sport=climbing' });
  assert.equal(classifyOsmTags({ building: 'house' }).ok, false);
  assert.equal(classifyOsmTags({}).ok, false);
  assert.equal(classifyOsmTags(null).reason, 'no-tags');
});

test('an object the mapper marked private never classifies, whatever else it says', () => {
  assert.deepEqual(classifyOsmTags({ leisure: 'sports_centre', access: 'private' }),
    { ok: false, reason: 'access-restricted' });
  assert.equal(classifyOsmTags({ sport: 'climbing', access: 'no' }).ok, false);
});

test('a home wall is recognised as private and a commercial gym is not', () => {
  assert.equal(venueLooksPrivate(feature()).private, false);
  assert.equal(venueLooksPrivate(feature({
    boards: [{ board: 'moonboard', commercial: false }],
  })).private, true);
  assert.equal(venueLooksPrivate(feature({
    boards: [{ board: 'kilter', walls: [{ layout: 'Homewall' }] }],
  })).private, true);
  // A home MoonBoard inside a gym that also lists a commercial board is not
  // a home setup; the commercial signal wins.
  assert.equal(venueLooksPrivate(feature({
    boards: [{ board: 'moonboard', commercial: false }, { board: 'moonboard', commercial: true }],
  })).private, false);
});

test('building a sidecar for a private venue fails the build instead of publishing it', () => {
  const key = venueKey(GYM.lat, GYM.lon);
  assert.throws(() => build({
    features: new Map([[key, feature({ boards: [{ board: 'moonboard', commercial: false }] })]]),
  }), /private/);
});

// ── The sidecar ───────────────────────────────────────────────────────────

test('a fetched venue becomes an entry with provenance, licence and rendered text', () => {
  const sidecar = build();
  assert.equal(sidecar.schema_version, SCHEMA_VERSION);
  assert.match(sidecar.source.license, /ODbL/);
  assert.equal(sidecar.venues.length, 1);

  const entry = sidecar.venues[0];
  assert.equal(entry.osm_url, osmObjectUrl('way', 123456));
  assert.deepEqual(entry.match, { method: 'manual', verified_on: '2026-08-22' });
  assert.equal(entry.osm_timestamp, '2026-05-30T08:00:00Z');
  assert.equal(entry.check_date, '2026-06-01');
  assert.equal(entry.display.kind, 'schedule');
  assert.deepEqual(entry.display.en.lines[0], { label: 'Mon–Fri', value: '09:00–22:00' });
  assert.deepEqual(entry.display.de.lines[0], { label: 'Mo–Fr', value: '09:00–22:00' });
  assert.match(entry.display.freshness.en, /2026-06-01/);
});

test('the curator\'s evidence stays in the match file and is not shipped to visitors', () => {
  const entry = build().venues[0];
  assert.equal(JSON.stringify(entry).includes('compared by hand'), false);
});

test('a venue with no hours tagged is recorded but has nothing to display', () => {
  const key = venueKey(GYM.lat, GYM.lon);
  const sidecar = build({
    fetched: new Map([[key, { status: STATUS.NO_HOURS, kind: 'leisure=climbing', timestamp: '2026-01-01T00:00:00Z' }]]),
  });
  assert.equal(sidecar.venues[0].display, undefined);
  assert.equal(sidecar.stats.without_opening_hours, 1);
  assert.equal(indexSidecar(sidecar).size, 0);
});

test('a deleted or retagged object loses its hours — it does not keep the last good value', () => {
  const key = venueKey(GYM.lat, GYM.lon);
  for (const status of [STATUS.GONE, STATUS.NOT_PUBLIC]) {
    const sidecar = build({ fetched: new Map([[key, { status }]]) });
    assert.equal(sidecar.venues[0].status, status);
    assert.equal(sidecar.venues[0].opening_hours, undefined);
    assert.equal(indexSidecar(sidecar).size, 0);
  }
});

test('a curated match whose venue has vanished from the dataset is dropped, not invented', () => {
  const sidecar = build({ features: new Map() });
  assert.deepEqual(sidecar.venues, []);
  assert.equal(sidecar.stats.unmatched_venue, 1);
});

test('the same inputs produce the same bytes', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

test('re-rendering from the committed raw values reproduces the display block', () => {
  const sidecar = build();
  assert.deepEqual(rerenderSidecar(sidecar), sidecar);
});

test('indexSidecar only offers entries that actually have something to show', () => {
  const sidecar = build();
  const index = indexSidecar(sidecar);
  assert.equal(index.size, 1);
  assert.equal(index.get(venueKey(GYM.lat, GYM.lon)).opening_hours, 'Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00');
});

test('loadSidecar refuses a file from a different schema generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osm-hours-test-'));
  const file = join(dir, 'sidecar.json');
  writeFileSync(file, JSON.stringify({ schema_version: SCHEMA_VERSION + 1, venues: [] }));
  assert.throws(() => loadSidecar(file), /schema_version/);
});

// ── The committed files ───────────────────────────────────────────────────

test('the committed curated match file is valid', () => {
  const { accepted, rejected } = loadCuratedMatches(CURATED_FILE);
  assert.ok(accepted.length > 0, 'expected at least one accepted match');
  for (const entry of [...accepted, ...rejected]) {
    assert.ok(entry.name.trim().length > 0);
  }
});

test('the committed sidecar is what the renderer produces from its own raw values', () => {
  // Catches the drift that matters: someone edits the wording or the parser
  // and the map keeps serving yesterday's sentences. Re-render with
  // `node tools/refresh-osm-hours.mjs --offline`; no network needed.
  const committed = readFileSync(SIDECAR_FILE, 'utf-8');
  const rerendered = `${JSON.stringify(rerenderSidecar(loadSidecar(SIDECAR_FILE)), null, 2)}\n`;
  assert.equal(rerendered, committed,
    'boards/data/osm-opening-hours.json is stale — run: node tools/refresh-osm-hours.mjs --offline');
});

test('every venue in the committed sidecar carries its exact object and provenance', () => {
  const sidecar = loadSidecar(SIDECAR_FILE);
  for (const entry of sidecar.venues) {
    assert.ok(['node', 'way', 'relation'].includes(entry.osm_type), entry.name);
    assert.ok(Number.isInteger(entry.osm_id) && entry.osm_id > 0, entry.name);
    assert.equal(entry.osm_url, osmObjectUrl(entry.osm_type, entry.osm_id), entry.name);
    assert.equal(entry.match.method, 'manual', entry.name);
    assert.match(entry.match.verified_on, /^\d{4}-\d{2}-\d{2}$/, entry.name);
    if (entry.display) {
      assert.ok(entry.opening_hours, entry.name);
      assert.ok(entry.display.freshness.en && entry.display.freshness.de, entry.name);
    }
  }
});

test('the committed sidecar declares ODbL and names OpenStreetMap', () => {
  const sidecar = loadSidecar(SIDECAR_FILE);
  assert.match(sidecar.source.license, /Open Database License/);
  assert.equal(sidecar.source.license_url, 'https://opendatacommons.org/licenses/odbl/1-0/');
  assert.match(sidecar.source.attribution, /OpenStreetMap contributors/);
  for (const lang of ['en', 'de']) {
    assert.match(sidecar.strings[lang].attribution, /ODbL/);
    assert.match(sidecar.strings[lang].heading, /OpenStreetMap/);
  }
});

test('no OSM-derived value leaks into the CC-BY venue dataset', () => {
  // The licences differ. If opening hours ever appear in boards.geojson, the
  // whole file has to be relicensed or the declaration is wrong.
  const geojson = readFileSync(GEOJSON_FILE, 'utf-8');
  for (const forbidden of ['opening_hours', 'osm_id', 'osm_type', 'check_date']) {
    assert.equal(geojson.includes(forbidden), false, `${forbidden} must not be in boards.geojson`);
  }
});

test('every accepted match still points at a venue that exists, and none is private', () => {
  const { accepted } = loadCuratedMatches(CURATED_FILE);
  const features = new Map();
  for (const f of JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8')).features) {
    const [lon, lat] = f.geometry.coordinates;
    features.set(venueKey(lat, lon), f);
  }
  for (const match of accepted) {
    const f = features.get(match.key);
    if (!f) continue; // upstream can drop a venue; the refresh reports it
    const privacy = venueLooksPrivate(f);
    assert.equal(privacy.private, false, `${match.name}: ${privacy.reason}`);
  }
});

test('the sidecar entries agree with the venues the dataset actually has', () => {
  const sidecar = loadSidecar(SIDECAR_FILE);
  const names = new Map();
  for (const f of JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8')).features) {
    const [lon, lat] = f.geometry.coordinates;
    names.set(venueKey(lat, lon), f.properties.name);
  }
  for (const entry of sidecar.venues) {
    assert.equal(entry.key, venueKey(entry.lat, entry.lon), entry.name);
    assert.ok(names.has(entry.key), `${entry.name} is no longer a venue in boards.geojson`);
  }
});

test('the refresh command verifies the committed file without touching the network', () => {
  // --check is offline by construction: it returns before any fetch. Running
  // the real CLI keeps the guarantee honest instead of asserting it about a
  // code path the command might not take.
  const res = spawnSync(process.execPath, [join(REPO_ROOT, 'tools', 'refresh-osm-hours.mjs'), '--check'],
    { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /result: current/);
});

test('the refresh command rejects an unknown option instead of guessing', () => {
  const res = spawnSync(process.execPath, [join(REPO_ROOT, 'tools', 'refresh-osm-hours.mjs'), '--yolo'],
    { encoding: 'utf-8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown option/);
});
