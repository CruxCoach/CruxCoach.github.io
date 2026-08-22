import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSidecar, classifyOsmTags, DECISIONS, indexSidecar, loadCuratedMatches, loadSidecar,
  MATCH_METHODS, osmObjectUrl, PUBLIC_VENUE_TAGS, rerenderSidecar, SCHEMA_VERSION, STATUS,
  venueLooksPrivate,
} from './osm-hours.mjs';
import { NARROW_FILTERS } from './dev/osm-candidates.mjs';
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
  const { accepted, decisions, counts } = loadCuratedMatches(writeCurated([curatedEntry()]));
  assert.equal(accepted.length, 1);
  assert.equal(decisions.length, 1);
  assert.equal(counts.accepted, 1);
  assert.equal(accepted[0].osm_url, 'https://www.openstreetmap.org/way/123456');
  assert.equal(accepted[0].key, venueKey(GYM.lat, GYM.lon));
});

test('a missing file is not an error — it just means no venue is enriched', () => {
  const { accepted } = loadCuratedMatches(join(tmpdir(), 'definitely-absent-osm-venues.json'));
  assert.deepEqual(accepted, []);
});

test('an automatic match method is refused outright', () => {
  for (const method of ['nearest', 'auto', 'closest', 'fuzzy', '']) {
    assert.throws(
      () => loadCuratedMatches(writeCurated([curatedEntry({ match_method: method })])),
      /matched by proximity/, method,
    );
  }
  // The two allowed values differ only in how a person was shown the
  // candidate, never in whether a person decided.
  assert.deepEqual(MATCH_METHODS, ['manual', 'manual-exact-name']);
  for (const method of MATCH_METHODS) {
    assert.equal(loadCuratedMatches(writeCurated([curatedEntry({ match_method: method })])).accepted.length, 1);
  }
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
    /one venue, one outcome/,
  );
});

test('one OSM object claimed by two venues is refused', () => {
  const other = curatedEntry({ name: 'Neighbour Hall', lat: GYM.lat + 0.01 });
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry(), other])), /too far apart/);
});

test('a declared duplicate listing may share its object, but only a real one', () => {
  const primary = curatedEntry();
  const other = venueKey(GYM.lat + 0.0005, GYM.lon);
  // "Steil Boulderhalle" / "Steil Boulderhalle Karlsruhe": one gym, two rows.
  const second = curatedEntry({
    name: 'Fixture Boulder Hall Moonboard',
    lat: GYM.lat + 0.0005,
    duplicate_listing_of: venueKey(GYM.lat, GYM.lon),
  });
  assert.equal(loadCuratedMatches(writeCurated([primary, second])).accepted.length, 2);

  // Naming a venue that is not there is refused rather than ignored.
  assert.throws(() => loadCuratedMatches(writeCurated([
    { ...second, osm_id: 555, duplicate_listing_of: '1.0000|1.0000' },
  ])), /names no accepted venue/);

  // Pointing at a venue matched to a different object is refused too.
  assert.throws(() => loadCuratedMatches(writeCurated([
    primary, { ...second, osm_id: 555 },
  ])), /matched to a different OSM object/);

  // And no assertion reaches across the distance limit.
  assert.throws(() => loadCuratedMatches(writeCurated([
    primary, { ...second, lat: GYM.lat + 0.05 },
  ])), /too far apart/);

  // The assertion may point forwards as easily as backwards: three listings
  // of one gym, all linked to a primary that comes last in the file.
  const trio = [
    curatedEntry({ name: 'A', lat: GYM.lat + 0.0002, duplicate_listing_of: venueKey(GYM.lat, GYM.lon) }),
    curatedEntry({ name: 'B', lat: GYM.lat + 0.0004, duplicate_listing_of: venueKey(GYM.lat, GYM.lon) }),
    primary,
  ];
  assert.equal(loadCuratedMatches(writeCurated(trio)).accepted.length, 3);
  assert.ok(other);
});

test('the same venue listed twice may share its object; two venues may not', () => {
  // Upstream registers a few halls twice, metres apart, because two board
  // systems were submitted separately. Both rows are the same business.
  const twin = curatedEntry({ lat: GYM.lat + 0.0005 }); // ~55 m, identical name
  assert.equal(loadCuratedMatches(writeCurated([curatedEntry(), twin])).accepted.length, 2);

  // Same name but far apart is two gyms of a chain, not one listed twice.
  const faraway = curatedEntry({ lat: GYM.lat + 0.05 });
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry(), faraway])), /too far apart/);

  // Next door but differently named is the neighbouring hall — the case that
  // made "Boulderbar Hauptbahnhof Plus" a rejection in the first place.
  const neighbour = curatedEntry({ name: 'Fixture Boulder Hall Plus', lat: GYM.lat + 0.0005 });
  assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry(), neighbour])), /ambiguous/);
});

test('every non-accepted outcome has to say why, and when it was looked at', () => {
  for (const status of DECISIONS.filter((d) => d !== 'accepted')) {
    const entry = { name: 'Nothing There', lat: 1, lon: 2, status };
    assert.throws(() => loadCuratedMatches(writeCurated([entry])), /needs a "reason"/, status);
    assert.throws(
      () => loadCuratedMatches(writeCurated([{ ...entry, reason: 'documented check found nothing' }])),
      /reviewed_on/, status,
    );
    const { accepted, decisions, counts } = loadCuratedMatches(writeCurated([
      { ...entry, reason: 'documented check found nothing', reviewed_on: '2026-08-22' },
    ]));
    assert.equal(accepted.length, 0, status);
    assert.equal(decisions.length, 1, status);
    assert.equal(counts[status], 1, status);
  }
});

test('an unreachable venue stays in the queue; every other outcome settles it', () => {
  // The sweep skips settled venues. A venue whose discovery failed must come
  // back round, or a bad afternoon at Overpass turns into a permanent gap.
  const base = { name: 'Somewhere', lat: 1, lon: 2, reason: 'documented', reviewed_on: '2026-08-22' };
  const { settled: queued } = loadCuratedMatches(writeCurated([{ ...base, status: 'unreachable' }]));
  assert.equal(queued.size, 0);
  for (const status of ['private', 'no-object', 'ambiguous', 'closed']) {
    const { settled } = loadCuratedMatches(writeCurated([{ ...base, status }]));
    assert.equal(settled.size, 1, status);
  }
});

test('an unknown status is refused rather than treated as one of the known ones', () => {
  for (const status of ['maybe', 'rejected', 'todo', '']) {
    assert.throws(() => loadCuratedMatches(writeCurated([curatedEntry({ status })])), /status/, status);
  }
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
  const { accepted, decisions } = loadCuratedMatches(CURATED_FILE);
  assert.ok(accepted.length > 0, 'expected at least one accepted match');
  for (const entry of decisions) {
    assert.ok(entry.name.trim().length > 0);
    assert.ok(DECISIONS.includes(entry.status), entry.name);
  }
});

test('no venue recorded as private is enriched, and no accepted venue is private', () => {
  const { decisions } = loadCuratedMatches(CURATED_FILE);
  const features = new Map();
  for (const f of JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8')).features) {
    const [lon, lat] = f.geometry.coordinates;
    features.set(venueKey(lat, lon), f);
  }
  for (const decision of decisions) {
    if (decision.status !== 'private') continue;
    assert.equal(decision.osm_id, undefined, `${decision.name}: a private setup carries no OSM object`);
  }
  // The build refuses a private venue outright; this catches it in review.
  for (const decision of decisions.filter((d) => d.status === 'accepted')) {
    const f = features.get(decision.key);
    if (!f) continue;
    assert.equal(venueLooksPrivate(f).private, false, decision.name);
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
    assert.ok(MATCH_METHODS.includes(entry.match.method), `${entry.name}: ${entry.match.method}`);
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

test('the committed sidecar records that every venue on the map had an outcome', () => {
  // The number is recorded, not recomputed: it is a statement about the moment
  // the file was written, and upstream adds venues on its own schedule. A
  // refresh recomputes it, so a gap shows up there rather than failing an
  // unrelated contributor's `scripts/check`.
  const { stats } = loadSidecar(SIDECAR_FILE);
  assert.equal(stats.venues_without_decision, 0,
    `${stats.venues_without_decision} venue(s) had no outcome at the last refresh — `
    + 'sweep them: node tools/dev/osm-candidates.mjs --all');
  assert.equal(stats.venues_decided, stats.venues_on_map);
  assert.ok(stats.venues_on_map > 0);
});

test('every venue on the map carries exactly one outcome right now', () => {
  const { decisions } = loadCuratedMatches(CURATED_FILE);
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  const missing = [];
  for (const f of JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8')).features) {
    const [lon, lat] = f.geometry.coordinates;
    if (!byKey.has(venueKey(lat, lon))) missing.push(f.properties.name);
  }
  assert.deepEqual(missing.slice(0, 10), [],
    `${missing.length} venue(s) have no decision — sweep them: node tools/dev/osm-candidates.mjs --all`);
});

test('discovery asks for every tag the refresh is willing to accept', () => {
  // A venue can only ever get hours if the sweep finds its object AND
  // classifyOsmTags accepts it. Widening the acceptance list without widening
  // the sweep leaves venues undiscoverable and nobody any the wiser — which is
  // how `sport=bouldering` and `amenity=gym` sat unqueried through a full pass
  // over the map.
  const filters = NARROW_FILTERS.join(' ');
  for (const [key, values] of PUBLIC_VENUE_TAGS) {
    for (const value of values) {
      const asked = filters.includes(`"${key}"="${value}"`)
        || new RegExp(`"${key}"~"[^"]*\\b${value}`).test(filters)
        || new RegExp(`"${key}"~"[^"]*${value.slice(0, 6)}`).test(filters);
      assert.ok(asked, `tools/dev/osm-candidates.mjs never asks for ${key}=${value}`);
    }
  }
});
