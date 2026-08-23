import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyVenueHours, canonicalDaySpec, clearVenueHoursProperties, DAY_KEYS,
  formatDayHours, formatWeeklyGroups, formatWeeklyHours, isPublicWeek,
  loadHoursResearch, loadVenueHours, MANAGED_PROPERTIES, parseDaySpec,
  RESEARCH_STATUS, safePublicHours, sourceIsDistinct, timesMissingFromEvidence,
  toPublicHours, toPublicWeek, validateHoursResearchEntry, validateVenueHours, venueKey,
} from './venue-hours.mjs';
import { loadVenueLinks } from './venue-links.mjs';
import { renderListPage } from './render-static.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOURS_FILE = join(REPO_ROOT, 'tools', 'venue-hours.json');
const RESEARCH_FILE = join(REPO_ROOT, 'tools', 'venue-hours-research.json');
const LINKS_FILE = join(REPO_ROOT, 'tools', 'venue-links.json');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const LIST_FILES = [
  join(REPO_ROOT, 'boards', 'list.html'),
  join(REPO_ROOT, 'de', 'boards', 'list.html'),
];
const MAP_JS = join(REPO_ROOT, 'boards', 'map.js');

// ── fixtures ────────────────────────────────────────────────────────

const WEEKDAYS_9_23 = {
  mon: '09:00-23:00', tue: '09:00-23:00', wed: '09:00-23:00', thu: '09:00-23:00',
  fri: '09:00-23:00', sat: '10:00-22:00', sun: 'closed',
};

function feature(lat, lon, name, props = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name, country: 'DE', boards: [{ board: 'kilter', address: 'X 1' }], ...props },
  };
}

function record(overrides = {}) {
  return {
    lat: 48.1234,
    lon: 11.5678,
    name: 'Boulderwelt München Ost',
    country: 'DE',
    source: 'https://www.boulderwelt-muenchen-ost.de/oeffnungszeiten/',
    checked: '2026-08-23',
    provenance: 'official-location-page',
    signals: ['venue-link', 'street-address'],
    hours: { ...WEEKDAYS_9_23 },
    evidence: 'Mo–Fr 09:00–23:00, Sa 10:00–22:00, So geschlossen',
    ...overrides,
  };
}

// ── the day grammar ─────────────────────────────────────────────────

test('parseDaySpec reads plain, split and round-the-clock days', () => {
  assert.deepEqual(parseDaySpec('closed'), []);
  assert.deepEqual(parseDaySpec('09:00-23:00'), [{ start: 540, end: 1380 }]);
  assert.deepEqual(parseDaySpec('09:00-12:00,15:00-22:00'),
    [{ start: 540, end: 720 }, { start: 900, end: 1320 }]);
  assert.deepEqual(parseDaySpec('00:00-24:00'), [{ start: 0, end: 1440 }]);
  assert.deepEqual(parseDaySpec('20:00-25:30'), [{ start: 1200, end: 1530 }]);
});

test('parseDaySpec refuses everything a schedule could be silently wrong about', () => {
  const bad = [
    '',                       // an unfilled day is not "closed"
    'Closed',                 // one spelling only
    '9:00-23:00',             // not zero-padded
    '09:00 - 23:00',          // padded
    '09:00-09:00',            // zero length: neither closed nor all day
    '23:00-09:00',            // ends before it starts
    '09:00-12:00,11:00-14:00', // overlapping
    '09:00-12:00,12:00-18:00', // touching — that is one range, not a split
    '15:00-22:00,09:00-12:00', // out of order
    '09:00-29:00',            // past the 28:00 the grammar stops at
    '25:00-26:00',            // a day cannot start after midnight
    '09:00-23:60',            // not a minute
    '09:00-23:00,',           // empty trailing range
  ];
  for (const spec of bad) {
    assert.throws(() => parseDaySpec(spec), undefined, `accepted ${JSON.stringify(spec)}`);
  }
});

test('canonicalDaySpec is what the curated file must store', () => {
  assert.equal(canonicalDaySpec('09:00-23:00'), '09:00-23:00');
  assert.equal(canonicalDaySpec('closed'), 'closed');
  assert.equal(canonicalDaySpec('09:00-12:00,15:00-22:00'), '09:00-12:00,15:00-22:00');
});

// ── record schema ───────────────────────────────────────────────────

test('a complete record validates', () => {
  assert.deepEqual(validateVenueHours(record()), []);
});

test('every day the week has must be stated', () => {
  for (const day of DAY_KEYS) {
    const hours = { ...WEEKDAYS_9_23 };
    delete hours[day];
    const problems = validateVenueHours(record({ hours }));
    assert.equal(problems.length, 1, `${day} may not be left out silently`);
    assert.match(problems[0], new RegExp(`hours\\.${day}" is missing`));
  }
});

test('a week of closed days is a closed venue, not a schedule', () => {
  const hours = Object.fromEntries(DAY_KEYS.map(d => [d, 'closed']));
  assert.match(validateVenueHours(record({ hours }))[0], /closed venue/);
});

test('hours must be stored canonically so a diff shows what ships', () => {
  const problems = validateVenueHours(record({ hours: { ...WEEKDAYS_9_23, sat: '10:00-22:00,23:00-23:30' } }));
  assert.deepEqual(problems, []);
  assert.match(
    validateVenueHours(record({ hours: { ...WEEKDAYS_9_23, sat: '10:00-22:00,22:00-23:30' } }))[0],
    /overlap or touch/,
  );
});

test('the source must be a canonical https URL on a real host', () => {
  for (const bad of [
    'http://example.org/', 'https://www.facebook.com/gym/', 'https://example.org/x#hours',
    'https://user:pw@example.org/', 'https://192.168.0.4/', 'not a url',
  ]) {
    assert.ok(validateVenueHours(record({ source: bad })).length > 0, `accepted ${bad}`);
  }
});

test('two independent signals are the floor, and name+brand are one observation', () => {
  assert.match(validateVenueHours(record({ signals: ['name'] }))[0], /at least 2 independent signals/);
  assert.match(validateVenueHours(record({ signals: ['name', 'brand'] }))[0], /at least 2 independent signals/);
  assert.deepEqual(validateVenueHours(record({ signals: ['name', 'city'] })), []);
});

test('a chain page may only speak for a branch when it says it does', () => {
  const chain = record({ provenance: 'official-chain-page', signals: ['brand', 'city'] });
  assert.match(validateVenueHours(chain).join('\n'), /hours-scope/);
  assert.deepEqual(
    validateVenueHours(record({ provenance: 'official-chain-page', signals: ['brand', 'city', 'hours-scope'] })),
    [],
  );
  // ...and it still has to name the location, exactly like a website link does.
  assert.match(
    validateVenueHours(record({ provenance: 'official-chain-page', signals: ['brand', 'hours-scope'] })).join('\n'),
    /street-address, city or location-page/,
  );
});

test('the evidence quote is required, and stays a quote', () => {
  assert.match(validateVenueHours(record({ evidence: '' }))[0], /must quote the schedule/);
  assert.match(validateVenueHours(record({ evidence: 'x'.repeat(601) }))[0], /exceeds 600/);
});

test('unknown fields and bad dates are refused', () => {
  assert.match(validateVenueHours(record({ open_now: true }))[0], /unknown field "open_now"/);
  assert.match(validateVenueHours(record({ checked: '2026-02-30' }))[0], /real UTC date/);
  assert.match(validateVenueHours(record({ provenance: 'a-friend-told-me' }))[0], /"provenance" must be one of/);
  assert.match(validateVenueHours(record({ signals: ['name', 'vibes'] }))[0], /unknown signal/);
});

// ── the public projection ───────────────────────────────────────────

test('toPublicHours passes exactly the schedule and the source, and nothing else', () => {
  const pub = toPublicHours(record());
  assert.deepEqual(Object.keys(pub).sort(), ['source', 'week']);
  assert.deepEqual(pub.week,
    ['09:00-23:00', '09:00-23:00', '09:00-23:00', '09:00-23:00', '09:00-23:00', '10:00-22:00', '']);
  const serialized = JSON.stringify(pub);
  for (const internal of ['2026-08-23', 'checked', 'evidence', 'signals', 'provenance', 'geschlossen']) {
    assert.ok(!serialized.includes(internal), `the public projection leaked ${internal}`);
  }
});

test('isPublicWeek is as strict as the curated form', () => {
  assert.ok(isPublicWeek(toPublicWeek(WEEKDAYS_9_23)));
  assert.ok(!isPublicWeek(['', '', '', '', '', '', '']), 'seven closed days is not a schedule');
  assert.ok(!isPublicWeek(['09:00-23:00']), 'a week has seven days');
  assert.ok(!isPublicWeek(['closed', '', '', '', '', '', '']), 'the public form spells closed as ""');
  assert.ok(!isPublicWeek(['9:00-23:00', '', '', '', '', '', '']));
  assert.ok(!isPublicWeek(null));
});

test('safePublicHours refuses hours that arrive without a usable source', () => {
  const week = toPublicWeek(WEEKDAYS_9_23);
  assert.ok(safePublicHours({ hours: week, hours_src: 'https://example.org/hours' }));
  assert.equal(safePublicHours({ hours: week, hours_src: 'http://example.org/' }), null);
  assert.equal(safePublicHours({ hours: week }), null);
  assert.equal(safePublicHours({ hours: ['x', '', '', '', '', '', ''], hours_src: 'https://example.org/' }), null);
});

// ── formatting ──────────────────────────────────────────────────────

test('a week reads as runs of identical days', () => {
  const week = toPublicWeek(WEEKDAYS_9_23);
  assert.equal(formatWeeklyHours(week, 'en'), 'Mon–Fri 09:00–23:00 · Sat 10:00–22:00 · Sun Closed');
  assert.equal(formatWeeklyHours(week, 'de'), 'Mo–Fr 09:00–23:00 · Sa 10:00–22:00 · So Geschlossen');
  assert.deepEqual(formatWeeklyGroups(week, 'en')[0], { days: 'Mon–Fri', hours: '09:00–23:00' });
});

test('round-the-clock, split and after-midnight days each read as themselves', () => {
  assert.equal(formatDayHours('00:00-24:00', 'en'), '24 hours');
  assert.equal(formatDayHours('00:00-24:00', 'de'), '24 Stunden');
  assert.equal(formatDayHours('09:00-12:00,15:00-22:00', 'en'), '09:00–12:00, 15:00–22:00');
  assert.equal(formatDayHours('20:00-25:00', 'en'), '20:00–01:00 (next day)');
  assert.equal(formatDayHours('20:00-25:00', 'de'), '20:00–01:00 (Folgetag)');
  assert.equal(formatDayHours('', 'en'), 'Closed');
});

// ── matching ────────────────────────────────────────────────────────

test('applyVenueHours writes the schedule onto the venue at that coordinate', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const { stats, problems } = applyVenueHours(features, [record()]);
  assert.deepEqual(problems, []);
  assert.equal(stats.applied, 1);
  assert.deepEqual(features[0].properties.hours, toPublicWeek(WEEKDAYS_9_23));
  assert.equal(features[0].properties.hours_src,
    'https://www.boulderwelt-muenchen-ost.de/oeffnungszeiten/');
});

test('applyVenueHours writes nothing but the two properties it owns', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const before = new Set(Object.keys(features[0].properties));
  applyVenueHours(features, [record()]);
  const added = Object.keys(features[0].properties).filter(k => !before.has(k));
  assert.deepEqual(added.sort(), [...MANAGED_PROPERTIES].sort());
});

test('a curated website link is untouched by the hours overlay', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost',
    { website: 'https://www.boulderwelt-muenchen-ost.de/' })];
  applyVenueHours(features, [record()]);
  assert.equal(features[0].properties.website, 'https://www.boulderwelt-muenchen-ost.de/');
  clearVenueHoursProperties(features);
  assert.equal(features[0].properties.website, 'https://www.boulderwelt-muenchen-ost.de/',
    'clearing hours must not clear the link overlay');
  assert.equal(features[0].properties.hours, undefined);
});

test('a drifted coordinate is rematched by name and proximity', () => {
  const features = [feature(48.1236, 11.5681, 'Boulderwelt München Ost GmbH')];
  const { stats, notes } = applyVenueHours(features, [record()]);
  assert.equal(stats.applied, 1);
  assert.equal(stats.matched_by_proximity, 1);
  assert.match(notes.join('\n'), /rematched by name\/proximity/);
});

test('hours are refused wherever the venue identity is not certain', () => {
  const cases = [
    { features: [feature(48.1234, 11.5678, 'Kletterzentrum Irgendwo')], expect: /refusing to attach/ },
    { features: [feature(48.1234, 11.5678, 'Boulderwelt München Ost', { country: 'AT' })], expect: /record says DE/ },
    { features: [feature(49.0, 12.0, 'Boulderwelt München Ost')], expect: /no venue within/ },
    {
      features: [feature(48.1234, 11.5678, 'Boulderwelt München Ost', {
        boards: [{ board: 'moonboard', commercial: false }],
      })],
      expect: /non-commercial home setup/,
    },
  ];
  for (const c of cases) {
    const { stats, problems } = applyVenueHours(c.features, [record()]);
    assert.equal(stats.applied, 0);
    assert.match(problems.join('\n'), c.expect);
    assert.equal(c.features[0].properties.hours, undefined);
  }
});

test('two records fighting over one venue take each other down', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const { stats, problems } = applyVenueHours(features, [
    record(),
    record({ lat: 48.1235, lon: 11.5679, hours: { ...WEEKDAYS_9_23, sun: '10:00-18:00' } }),
  ]);
  assert.equal(stats.applied, 0);
  assert.match(problems.join('\n'), /resolve onto the same venue/);
  assert.equal(features[0].properties.hours, undefined);
});

test('deleting a record removes its hours from an already-populated dataset', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  applyVenueHours(features, [record()]);
  applyVenueHours(features, []);
  assert.equal(features[0].properties.hours, undefined);
  assert.equal(features[0].properties.hours_src, undefined);
});

test('one page covering venues kilometres apart is flagged, not silently accepted', () => {
  const features = [
    feature(48.1234, 11.5678, 'Boulderwelt München Ost'),
    feature(48.1600, 11.5678, 'Boulderwelt München West'),
  ];
  const { notes } = applyVenueHours(features, [
    record(),
    record({ lat: 48.16, lon: 11.5678, name: 'Boulderwelt München West' }),
  ]);
  assert.match(notes.join('\n'), /supplies hours for venues \d+ m apart/);
});

// ── the static directory ────────────────────────────────────────────

const META = { venue_features: 1, per_board: { kilter: 1 } };

function renderOne(props, lang = 'en') {
  return renderListPage([feature(48.1234, 11.5678, props.name || 'Test Gym', props)], META, lang);
}

test('the directory prints the schedule, labelled and caveated, in both languages', () => {
  const props = {
    name: 'Test Gym',
    hours: toPublicWeek(WEEKDAYS_9_23),
    hours_src: 'https://example.org/hours',
  };
  const en = renderOne(props, 'en');
  assert.match(en, /Opening hours:<\/span> Mon–Fri 09:00–23:00 · Sat 10:00–22:00 · Sun Closed/);
  assert.match(en, /as published by the venue itself/);
  assert.match(en, /Public holidays and short-notice changes may differ/);
  const de = renderOne(props, 'de');
  assert.match(de, /Öffnungszeiten:<\/span> Mo–Fr 09:00–23:00 · Sa 10:00–22:00 · So Geschlossen/);
  assert.match(de, /Feiertage und kurzfristige Änderungen können abweichen/);
});

test('the directory links the source only when it is a page of its own', () => {
  const week = toPublicWeek(WEEKDAYS_9_23);
  const separate = renderOne({
    name: 'Test Gym', website: 'https://example.org/', hours: week,
    hours_src: 'https://example.org/opening-hours/',
  });
  assert.match(separate, /class="vhours-src" href="https:\/\/example\.org\/opening-hours\/"/);
  const same = renderOne({
    name: 'Test Gym', website: 'https://example.org/', hours: week, hours_src: 'https://example.org/',
  });
  assert.doesNotMatch(same, /class="vhours-src"/,
    'the website link on the same line is already the source');
});

test('the directory refuses hours it cannot re-validate', () => {
  const week = toPublicWeek(WEEKDAYS_9_23);
  const rendered = /<span class="vhours">/;
  assert.doesNotMatch(renderOne({ name: 'Test Gym', hours: week }), rendered, 'no source, no hours');
  assert.doesNotMatch(
    renderOne({ name: 'Test Gym', hours: week, hours_src: 'javascript:alert(1)' }), rendered);
  assert.doesNotMatch(renderOne({
    name: 'Test Gym', hours: ['9-23', '', '', '', '', '', ''], hours_src: 'https://example.org/',
  }), rendered);
});

test('the directory escapes a venue name into the source link label', () => {
  const html = renderOne({
    name: '<img src=x onerror=alert(1)>', hours: toPublicWeek(WEEKDAYS_9_23),
    hours_src: 'https://example.org/hours',
  });
  assert.ok(!html.includes('<img src=x'), 'an upstream name reached the page unescaped');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; — official page/);
});

// ── the map popup ───────────────────────────────────────────────────

const mapSource = readFileSync(MAP_JS, 'utf8');

function liftFunction(name) {
  const re = new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}}`);
  const src = mapSource.match(re)?.[0];
  assert.ok(src, `could not lift ${name}() out of boards/map.js`);
  return src;
}

const MAP_T = {
  en: {
    hoursLabel: 'Opening hours',
    hoursNote: 'As published by the venue; public holidays and short-notice changes may differ.',
    hoursSource: 'Official source',
    hoursClosed: 'Closed',
    hoursAllDay: '24 hours',
    hoursNextDay: 'next day',
    hoursDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  de: {
    hoursLabel: 'Öffnungszeiten',
    hoursNote: 'Wie von der Halle veröffentlicht; Feiertage und kurzfristige Änderungen können abweichen.',
    hoursSource: 'Offizielle Quelle',
    hoursClosed: 'Geschlossen',
    hoursAllDay: '24 Stunden',
    hoursNextDay: 'Folgetag',
    hoursDays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  },
};

function callMapFn(name, args, lang = 'en') {
  const body = [
    liftFunction('escapeHtml'),
    liftFunction('safeSiteUrl'),
    liftFunction('parseHoursDay'),
    liftFunction('safeHoursWeek'),
    liftFunction('pad2'),
    liftFunction('formatHoursDay'),
    liftFunction('formatHoursGroups'),
    liftFunction('renderHoursSection'),
  ].join('\n');
  const fn = new Function('T', 'args', `${body}; return ${name}.apply(null, args);`);
  return fn(MAP_T[lang], args);
}

test('the popup and the build group the week identically, in both languages', () => {
  const weeks = [
    toPublicWeek(WEEKDAYS_9_23),
    ['00:00-24:00', '00:00-24:00', '00:00-24:00', '00:00-24:00', '00:00-24:00', '00:00-24:00', '00:00-24:00'],
    ['09:00-12:00,15:00-22:00', '', '10:00-20:00', '10:00-20:00', '10:00-20:00', '20:00-25:00', ''],
    ['', '', '', '', '', '', '10:00-18:00'],
  ];
  for (const lang of ['en', 'de']) {
    for (const week of weeks) {
      assert.deepEqual(callMapFn('formatHoursGroups', [week], lang), formatWeeklyGroups(week, lang),
        `boards/map.js and tools/venue-hours.mjs disagree about ${JSON.stringify(week)} (${lang})`);
    }
  }
});

test('the popup guard refuses the same weeks the build does', () => {
  assert.ok(callMapFn('safeHoursWeek', [toPublicWeek(WEEKDAYS_9_23)]));
  for (const bad of [
    ['', '', '', '', '', '', ''], ['09:00-23:00'], null, 'Mon-Fri 9-11',
    ['closed', '', '', '', '', '', ''], ['09:00-12:00,12:00-18:00', '', '', '', '', '', ''],
    ['23:00-09:00', '', '', '', '', '', ''], [1, '', '', '', '', '', ''],
  ]) {
    assert.equal(callMapFn('safeHoursWeek', [bad]), null, `popup accepted ${JSON.stringify(bad)}`);
  }
});

test('the popup renders the schedule and never the curation metadata', () => {
  const html = callMapFn('renderHoursSection', [{
    name: 'Test Gym',
    hours: toPublicWeek(WEEKDAYS_9_23),
    hours_src: 'https://example.org/opening-hours/',
    website: 'https://example.org/',
    checked: '2026-08-23',
    evidence: 'Mo–Fr 09:00–23:00',
  }]);
  assert.match(html, /Opening hours/);
  assert.match(html, /Mon–Fri/);
  assert.match(html, /09:00–23:00/);
  assert.match(html, /href="https:\/\/example\.org\/opening-hours\/"/);
  assert.match(html, /public holidays and short-notice changes may differ/);
  assert.ok(!html.includes('2026-08-23'), 'the popup leaked an internal verification date');
  assert.ok(!/evidence/i.test(html), 'the popup leaked curator evidence');
});

test('the popup omits a source link that would repeat the website link above it', () => {
  const props = {
    hours: toPublicWeek(WEEKDAYS_9_23),
    hours_src: 'https://example.org/',
    website: 'https://example.org/',
  };
  assert.ok(!callMapFn('renderHoursSection', [props]).includes('<a href='));
  assert.ok(callMapFn('renderHoursSection', [{ ...props, website: 'https://example.org/gym/' }])
    .includes('<a href='));
});

test('the popup renders nothing at all for hours it cannot re-validate', () => {
  const week = toPublicWeek(WEEKDAYS_9_23);
  assert.equal(callMapFn('renderHoursSection', [{ hours: week }]), '');
  assert.equal(callMapFn('renderHoursSection', [{ hours: week, hours_src: 'http://example.org/' }]), '');
  assert.equal(callMapFn('renderHoursSection', [{ hours: ['x'], hours_src: 'https://example.org/' }]), '');
  assert.equal(callMapFn('renderHoursSection', [{}]), '');
});

// ── the committed files ─────────────────────────────────────────────

test('tools/venue-hours.json validates and claims each venue once', () => {
  const { entries, errors } = loadVenueHours(HOURS_FILE);
  assert.deepEqual(errors, []);
  const seen = new Set();
  for (const e of entries) {
    const k = venueKey(e.lat, e.lon);
    assert.ok(!seen.has(k), `duplicate hours record for ${e.name}`);
    seen.add(k);
  }
});

test('tools/venue-hours-research.json validates and stays out of production', () => {
  const { entries, errors } = loadHoursResearch(RESEARCH_FILE);
  assert.deepEqual(errors, []);
  const seen = new Set();
  for (const e of entries) {
    const k = venueKey(e.lat, e.lon);
    assert.ok(!seen.has(k), `duplicate outcome record for ${e.name}`);
    seen.add(k);
  }
  const { entries: hours } = loadVenueHours(HOURS_FILE);
  for (const e of hours) {
    assert.ok(!seen.has(venueKey(e.lat, e.lon)),
      `"${e.name}" both publishes hours and is logged as having none — it can only be one`);
  }
  for (const status of entries.map(e => e.status)) {
    assert.ok(RESEARCH_STATUS.has(status));
  }
});

test('the committed geojson carries only hours the curation would still accept', () => {
  if (!existsSync(GEOJSON_FILE)) return;
  const features = JSON.parse(readFileSync(GEOJSON_FILE, 'utf8')).features;
  const { entries } = loadVenueHours(HOURS_FILE);
  const scratch = features.map(f => ({
    type: f.type, geometry: f.geometry, properties: { ...f.properties },
  }));
  const { stats } = applyVenueHours(scratch, entries);

  let found = 0;
  for (const f of features) {
    if (f.properties.hours === undefined) continue;
    found++;
    assert.ok(safePublicHours(f.properties),
      `${f.properties.name} carries hours the renderers would refuse`);
  }
  assert.equal(found, stats.applied,
    'boards.geojson and tools/venue-hours.json disagree — rerun node tools/build-boards-data.mjs --overlays-only');
});

test('nothing a browser fetches carries the internal verification metadata', () => {
  const { entries } = loadVenueHours(HOURS_FILE);
  if (entries.length === 0) return;
  const published = [GEOJSON_FILE, ...LIST_FILES].filter(existsSync);

  for (const file of published) {
    const text = readFileSync(file, 'utf8');
    for (const key of ['"checked"', '"evidence"', '"signals"', '"provenance"', 'hours_checked']) {
      assert.ok(!text.includes(key), `${file} carries the internal field ${key}`);
    }
    for (const e of entries) {
      assert.ok(!text.includes(e.checked),
        `${file} leaks the internal verification date ${e.checked} (from "${e.name}")`);
      const quote = e.evidence.slice(0, 24);
      assert.ok(!text.includes(quote),
        `${file} leaks curator evidence quoted from "${e.name}"`);
    }
  }
});

test('the evidence cross-check finds a mistyped time and forgives spelling', () => {
  assert.deepEqual(timesMissingFromEvidence(record()), [],
    'every time in the fixture appears in its own evidence');
  // The page says 22:00; the schedule says 22:30.
  assert.deepEqual(
    timesMissingFromEvidence(record({
      hours: { ...WEEKDAYS_9_23, sat: '10:00-22:30' },
      evidence: 'Mo–Fr 09:00–23:00, Sa 10:00–22:00, So geschlossen',
    })),
    ['22:30'],
  );
  // The same times, written the four ways German gyms actually write them.
  for (const evidence of [
    'Mo-Fr 9-23 Uhr, Sa 10-22 Uhr, So geschlossen',
    'Mo–Fr 09.00 bis 23.00 Uhr | Sa 10.00 – 22.00 | So geschlossen',
    'Montag bis Freitag von 9:00 bis 23:00, Samstag 10:00-22:00',
    'Mo-Fr 09:00-23:00 · Sa 10:00-22:00',
  ]) {
    assert.deepEqual(timesMissingFromEvidence(record({ evidence })), [], evidence);
  }
  // Round-the-clock days are usually words, not digits, so they are exempt.
  assert.deepEqual(timesMissingFromEvidence(record({
    hours: Object.fromEntries(DAY_KEYS.map(d => [d, '00:00-24:00'])),
    evidence: 'Rund um die Uhr geöffnet',
  })), []);
  // A half-hour must be spelled out; the bare hour does not cover it.
  assert.deepEqual(timesMissingFromEvidence(record({
    hours: { ...WEEKDAYS_9_23, mon: '09:30-23:00' },
    evidence: 'Mo 9 - 23 Uhr, Di-Fr 09:00–23:00, Sa 10:00–22:00',
  })), ['09:30']);
});

test('every committed schedule is traceable to its own evidence quote', () => {
  const { entries } = loadVenueHours(HOURS_FILE);
  for (const e of entries) {
    assert.deepEqual(timesMissingFromEvidence(e), [],
      `"${e.name}" records a time its evidence quote does not contain`);
  }
});

// Two URLs belong to the same site when they share a host, or when one host is
// a subdomain of the other: an operator that verifies its apex as a venue's
// official website routinely publishes that venue's hours on
// `<location>.operator.tld`, and that is the same claim, not a different one.
function sameSite(a, b) {
  const ha = new URL(a).hostname;
  const hb = new URL(b).hostname;
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

test('sameSite accepts a location subdomain and refuses a different operator', () => {
  assert.ok(sameSite('https://darmstadt.studiobloc.de/zeiten/', 'https://studiobloc.de/'));
  assert.ok(sameSite('https://studiobloc.de/', 'https://darmstadt.studiobloc.de/'));
  assert.ok(!sameSite('https://studiobloc.de/', 'https://studiobloc.com/'));
  assert.ok(!sameSite('https://notstudiobloc.de/', 'https://studiobloc.de/'));
});

test('the curated hours never contradict the curated website links', () => {
  const { entries: hours } = loadVenueHours(HOURS_FILE);
  const { entries: links } = loadVenueLinks(LINKS_FILE);
  const byKey = new Map(links.map(l => [venueKey(l.lat, l.lon), l]));
  for (const e of hours) {
    const link = byKey.get(venueKey(e.lat, e.lon));
    if (!link) continue;
    assert.ok(sameSite(e.source, link.website),
      `"${e.name}" reads hours from a different site than its verified official website`);
    assert.ok(sourceIsDistinct({ hours_src: e.source, website: link.website })
      || e.source === link.website);
  }
});

// The `venue-link` signal is a claim about another file: that a human already
// established this domain is this venue's. It is the signal most often used as
// one of the two, so it is the one worth checking mechanically — a record may
// not lean on a link record that does not exist or points somewhere else.
test('every record claiming the venue-link signal has the link it claims', () => {
  const { entries: hours } = loadVenueHours(HOURS_FILE);
  const { entries: links } = loadVenueLinks(LINKS_FILE);
  const byKey = new Map(links.map(l => [venueKey(l.lat, l.lon), l]));
  for (const e of hours) {
    if (!e.signals?.includes('venue-link')) continue;
    const link = byKey.get(venueKey(e.lat, e.lon));
    assert.ok(link, `"${e.name}" claims the venue-link signal but has no venue-links record`);
    assert.ok(sameSite(e.source, link.website),
      `"${e.name}" claims the venue-link signal for a different site than the link it points at`);
  }
});
