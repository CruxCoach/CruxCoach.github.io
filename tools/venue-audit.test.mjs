import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHANNELS, HOURS_RESULTS, RETRYABLE_HOURS, RETRYABLE_WEBSITE, WEBSITE_RESULTS,
  computeWorklist, loadLedger, validateLedgerItem,
} from './venue-audit.mjs';
import { buildVenueIndex, classifyVenue, loadVenueLinks, nameSimilarity, resolveVenueRecord, venueKey } from './venue-links.mjs';
import { loadHoursResearch, loadVenueHours } from './venue-hours.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_FILE = join(REPO_ROOT, 'tools', 'venue-audit-ledger.json');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const LINKS_FILE = join(REPO_ROOT, 'tools', 'venue-links.json');
const LINKS_RESEARCH_FILE = join(REPO_ROOT, 'tools', 'venue-links-research.json');
const HOURS_FILE = join(REPO_ROOT, 'tools', 'venue-hours.json');
const HOURS_RESEARCH_FILE = join(REPO_ROOT, 'tools', 'venue-hours-research.json');
const EXCLUSIONS_FILE = join(REPO_ROOT, 'tools', 'location-exclusions.json');
const LIST_FILES = [
  join(REPO_ROOT, 'boards', 'list.html'),
  join(REPO_ROOT, 'de', 'boards', 'list.html'),
];
const PUBLISHED = [GEOJSON_FILE, ...LIST_FILES].filter(existsSync);

const readJson = f => JSON.parse(readFileSync(f, 'utf8'));

function item(overrides = {}) {
  return {
    lat: 48.1234, lon: 11.5678, name: 'Boulderwelt München Ost', country: 'DE',
    needs: ['website', 'hours'],
    website: { pass: '2026-08-23', result: 'accepted', channels: ['name-guess', 'apex'] },
    hours: { pass: '2026-08-23', result: 'seasonal' },
    ...overrides,
  };
}

// ── the ledger's own grammar ────────────────────────────────────────

test('a complete ledger row validates', () => {
  assert.deepEqual(validateLedgerItem(item()), []);
});

test('a row must carry an outcome for every field it needs', () => {
  const bad = item();
  delete bad.hours;
  assert.ok(validateLedgerItem(bad).some(p => /"hours" must be an object/.test(p)));
});

test('a row may not carry an outcome for a field it does not need', () => {
  const bad = item({ needs: ['website'] });
  assert.ok(validateLedgerItem(bad).some(p => /"hours" is recorded but not in "needs"/.test(p)));
});

test('only pending may be undated — every other outcome names the day it was reached', () => {
  assert.deepEqual(validateLedgerItem(item({ hours: { pass: null, result: 'pending' } })), []);
  assert.ok(validateLedgerItem(item({ hours: { pass: null, result: 'seasonal' } }))
    .some(p => /"hours\.pass" must be the UTC date/.test(p)));
});

test('results and channels come from a closed vocabulary', () => {
  assert.ok(validateLedgerItem(item({ hours: { pass: '2026-08-23', result: 'probably-fine' } })).length);
  assert.ok(validateLedgerItem(item({ website: { pass: '2026-08-23', result: 'accepted', channels: ['vibes'] } })).length);
  // The two fields do not share a vocabulary: a website is never "seasonal",
  // and hours are never "social-only".
  assert.ok(validateLedgerItem(item({ website: { pass: '2026-08-23', result: 'seasonal' } })).length);
  assert.ok(validateLedgerItem(item({ hours: { pass: '2026-08-23', result: 'social-only' } })).length);
});

test('the retryable sets stay inside the result vocabularies', () => {
  for (const r of RETRYABLE_WEBSITE) assert.ok(WEBSITE_RESULTS.has(r), `${r} is not a website result`);
  for (const r of RETRYABLE_HOURS) assert.ok(HOURS_RESULTS.has(r), `${r} is not an hours result`);
  assert.ok(RETRYABLE_WEBSITE.has('pending') && RETRYABLE_HOURS.has('pending'));
});

test('unknown fields are refused, in the row and in an outcome', () => {
  assert.ok(validateLedgerItem(item({ verdict: 'ok' })).some(p => /unknown field "verdict"/.test(p)));
  assert.ok(validateLedgerItem(item({ hours: { pass: '2026-08-23', result: 'seasonal', evidence: 'Mo 9-17' } }))
    .some(p => /unknown field "evidence"/.test(p)));
});

// ── the worklist is recomputed, never trusted ───────────────────────

test('the worklist is every public venue missing a link or accepted hours', () => {
  const features = [
    { geometry: { coordinates: [11.5678, 48.1234] }, properties: { name: 'Both', country: 'DE', boards: [{ board: 'kilter' }] } },
    { geometry: { coordinates: [11.6, 48.2] }, properties: { name: 'Linked', country: 'DE', boards: [{ board: 'kilter' }] } },
    { geometry: { coordinates: [11.7, 48.3] }, properties: { name: 'Done', country: 'DE', boards: [{ board: 'kilter' }] } },
    { geometry: { coordinates: [11.8, 48.4] }, properties: { name: 'Home wall', country: 'DE', boards: [{ board: 'moonboard', commercial: false }] } },
  ];
  const links = [{ lat: 48.2, lon: 11.6 }, { lat: 48.3, lon: 11.7 }];
  const hours = [{ lat: 48.3, lon: 11.7 }];
  const work = computeWorklist(features, links, hours);
  assert.deepEqual(work.map(w => [w.name, w.needs]), [
    ['Both', ['website', 'hours']],
    ['Linked', ['hours']],
  ]);
});

// ── the committed ledger ────────────────────────────────────────────

test('tools/venue-audit-ledger.json validates and names each venue once', () => {
  if (!existsSync(LEDGER_FILE) || !existsSync(GEOJSON_FILE)) return;
  const ledger = loadLedger(LEDGER_FILE);
  const problems = ledger.items.flatMap((it, i) => validateLedgerItem(it, i));
  assert.deepEqual(problems, []);

  const features = readJson(GEOJSON_FILE).features;
  const byKey = buildVenueIndex(features);
  const excluded = new Set(readJson(EXCLUSIONS_FILE).map(row => venueKey(row.lat, row.lon)));
  const seen = new Set();
  for (const [i, it] of ledger.items.entries()) {
    const r = resolveVenueRecord(it, `venue-audit-ledger[${i}] "${it.name}"`, byKey, features);
    if (r.status !== 'ok') {
      // A venue the shared resolver refuses is a finding, not a bad row: it can
      // hold no research record either, so the ledger is the only place its
      // outcome can live. It must sit on a real coordinate and say why.
      if (excluded.has(venueKey(it.lat, it.lon))) continue;
      if (it.lat === 0 && it.lon === 0
        && it.needs.every(field => typeof it[field]?.note === 'string' && it[field].note.trim())) continue;
      assert.ok(byKey.has(venueKey(it.lat, it.lon)), r.reason);
      for (const field of it.needs) {
        assert.ok(it[field]?.note, `"${it.name}" is unresolvable (${r.status}) and its ${field} outcome says nothing about it`);
      }
      continue;
    }
    const [lon, lat] = r.feature.geometry.coordinates;
    const k = venueKey(lat, lon);
    assert.ok(!seen.has(k), `two ledger rows for one venue: "${it.name}"`);
    seen.add(k);
    assert.notEqual(classifyVenue(r.feature.properties), 'private',
      `"${it.name}" is a private venue and does not belong in the worklist`);
  }
});

test('a name written in a non-Latin script still matches itself', () => {
  // The audit's worklist reaches Japan, China, Korea, Greece and Russia. Before
  // this held, normalizeName reduced those names to the empty string,
  // nameSimilarity(name, name) was 0, and resolveVenueRecord refused the venue —
  // so no link and no schedule could ever be attached to about two hundred rows.
  for (const n of ['闷头家的月亮板', 'ΟΑΛΠ', 'クライミングジム', '서울클라이밍', 'Скалодром']) {
    assert.equal(nameSimilarity(n, n), 1, `${n} does not match itself`);
  }
});

test('every decided outcome is backed by a record in the file it claims', () => {
  if (!existsSync(LEDGER_FILE) || !existsSync(GEOJSON_FILE)) return;
  const ledger = loadLedger(LEDGER_FILE);
  const keys = arr => new Set(arr.filter(e => typeof e?.lat === 'number').map(e => venueKey(e.lat, e.lon)));
  const byKeyOf = arr => new Map(arr.filter(e => typeof e?.lat === 'number').map(e => [venueKey(e.lat, e.lon), e]));

  const linked = keys(loadVenueLinks(LINKS_FILE).entries);
  const houred = keys(loadVenueHours(HOURS_FILE).entries);
  const linkResearch = byKeyOf(existsSync(LINKS_RESEARCH_FILE) ? readJson(LINKS_RESEARCH_FILE) : []);
  const hourResearch = byKeyOf(loadHoursResearch(HOURS_RESEARCH_FILE).entries);

  const features = readJson(GEOJSON_FILE).features;
  const byKey = buildVenueIndex(features);

  for (const it of ledger.items) {
    const k = venueKey(it.lat, it.lon);
    // Exempt for the reason above: neither research log will take a record for
    // a venue the resolver refuses, so the ledger row is the whole outcome.
    if (resolveVenueRecord(it, 'x', byKey, features).status !== 'ok') continue;
    for (const [field, accepted, research, file] of [
      ['website', linked, linkResearch, 'venue-links'],
      ['hours', houred, hourResearch, 'venue-hours'],
    ]) {
      const v = it[field];
      if (!v || v.result === 'pending') continue;
      if (v.result === 'accepted') {
        assert.ok(accepted.has(k), `"${it.name}" ${field}=accepted but ${file}.json has no record`);
        continue;
      }
      const r = research.get(k);
      assert.ok(r, `"${it.name}" ${field}=${v.result} but ${file}-research.json has no record`);
      assert.equal(r.status, v.result,
        `"${it.name}" ${field}=${v.result} but ${file}-research.json says ${r.status}`);
    }
  }
});

test('no venue on the worklist is missing from the ledger', () => {
  if (!existsSync(LEDGER_FILE) || !existsSync(GEOJSON_FILE)) return;
  const features = readJson(GEOJSON_FILE).features;
  const work = computeWorklist(features, loadVenueLinks(LINKS_FILE).entries, loadVenueHours(HOURS_FILE).entries);
  const rows = new Set(loadLedger(LEDGER_FILE).items.map(it => venueKey(it.lat, it.lon)));
  const missing = work.filter(w => !rows.has(w.key)).map(w => `${w.country} ${w.name}`);
  assert.deepEqual(missing, [], 'run node tools/venue-audit.mjs --init');
});

// ── the ledger is curation metadata and stays off the site ──────────

test('nothing a browser fetches carries the audit ledger', () => {
  if (!existsSync(LEDGER_FILE)) return;
  const ledger = loadLedger(LEDGER_FILE);
  for (const file of PUBLISHED) {
    const text = readFileSync(file, 'utf8');
    for (const key of ['"needs"', '"channels"', 'venue-audit-ledger', '"pass"']) {
      assert.ok(!text.includes(key), `${file} carries the audit field ${key}`);
    }
    for (const it of ledger.items) {
      for (const field of ['website', 'hours']) {
        const note = it[field]?.note;
        if (typeof note === 'string' && note.length >= 24) {
          assert.ok(!text.includes(note.slice(0, 24)),
            `${file} leaks an audit note written for "${it.name}"`);
        }
      }
    }
  }
});

test('the ledger is not referenced by anything the site serves', () => {
  for (const file of [...LIST_FILES, join(REPO_ROOT, 'boards', 'map.js'),
    join(REPO_ROOT, 'boards', 'index.html'), join(REPO_ROOT, 'sitemap.xml')].filter(existsSync)) {
    assert.ok(!readFileSync(file, 'utf8').includes('venue-audit'),
      `${file} references the audit ledger`);
  }
});

test('the channel vocabulary stays small enough to mean something', () => {
  // Not a style rule: a channel list that can absorb any new word stops being
  // evidence of which avenues were actually tried.
  assert.ok(CHANNELS.size <= 24, 'the channel vocabulary has grown past being a checklist');
  for (const c of ['apex', 'www', 'name-guess', 'osm-website-tag', 'web-search']) {
    assert.ok(CHANNELS.has(c), `${c} is one of the audit's standing channels`);
  }
});
