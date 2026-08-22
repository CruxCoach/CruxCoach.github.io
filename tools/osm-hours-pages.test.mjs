import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indexSidecar, loadSidecar } from './osm-hours.mjs';
import { renderListPage } from './render-static.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf-8');

const SIDECAR = loadSidecar(join(REPO_ROOT, 'boards', 'data', 'osm-opening-hours.json'));
const INDEX = indexSidecar(SIDECAR);

const LIST_PAGES = [
  { lang: 'en', file: 'boards/list.html' },
  { lang: 'de', file: 'de/boards/list.html' },
];
const MAP_PAGES = ['boards/index.html', 'de/boards/index.html'];

// A venue that is in the committed sidecar with a rendered schedule, so the
// assertions below are about real committed output rather than a fixture.
const SAMPLE = [...INDEX.values()].find((v) => v.display.kind === 'schedule');
const SAMPLE_RAW = [...INDEX.values()].find((v) => v.display.kind === 'raw');

test('the sidecar has at least one of each kind to assert against', () => {
  assert.ok(SAMPLE, 'no rendered schedule in the committed sidecar');
  assert.ok(SAMPLE_RAW, 'no raw fallback in the committed sidecar — the fallback path is untested');
});

// ── The generated directories ─────────────────────────────────────────────

test('both directories show the rendered schedule in their own language', () => {
  for (const { lang, file } of LIST_PAGES) {
    const html = read(file);
    const line = SAMPLE.display[lang].lines[0];
    assert.ok(html.includes(`<dt>${line.label}</dt><dd>${line.value}</dd>`),
      `${file}: missing "${line.label}: ${line.value}" for ${SAMPLE.name}`);
    assert.ok(html.includes(SAMPLE.display[lang].notes.at(-1)),
      `${file}: the exceptions caveat is missing`);
    assert.ok(html.includes(SIDECAR.strings[lang].heading), `${file}: missing heading`);
  }
});

test('both directories link the exact OSM object, not a coordinate or a search', () => {
  for (const { file } of LIST_PAGES) {
    const html = read(file);
    assert.ok(html.includes(`href="${SAMPLE.osm_url}"`), `${file}: missing ${SAMPLE.osm_url}`);
    assert.match(SAMPLE.osm_url, /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);
  }
});

test('both directories show freshness next to the hours', () => {
  for (const { lang, file } of LIST_PAGES) {
    assert.ok(read(file).includes(SAMPLE.display.freshness[lang]), `${file}: missing freshness line`);
  }
});

test('an unrenderable value reaches the page unchanged, with no schedule around it', () => {
  for (const { lang, file } of LIST_PAGES) {
    const html = read(file);
    const escaped = SAMPLE_RAW.display.raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(html.includes(`<code>${escaped}</code>`), `${file}: raw value missing`);
    assert.ok(html.includes(SIDECAR.strings[lang].unsupported), `${file}: missing the "not translated" note`);
  }
});

test('both directories carry the ODbL attribution for the hours', () => {
  for (const { lang, file } of LIST_PAGES) {
    const html = read(file);
    assert.ok(html.includes(SIDECAR.strings[lang].attribution), `${file}: missing ODbL attribution`);
    assert.ok(html.includes('https://www.openstreetmap.org/copyright'), `${file}: missing copyright link`);
  }
});

test('the directories show hours for exactly the venues the sidecar offers', () => {
  for (const { file } of LIST_PAGES) {
    const html = read(file);
    const blocks = html.match(/<details class="oh">/g) ?? [];
    assert.equal(blocks.length, INDEX.size, `${file}: ${blocks.length} blocks for ${INDEX.size} venues`);
  }
});

test('re-rendering a directory from unchanged inputs produces identical bytes', () => {
  // The nightly cron keys change detection on the data, so a build that is
  // not a pure function of its inputs would commit noise every night.
  const features = JSON.parse(read('boards/data/boards.geojson')).features;
  const meta = JSON.parse(read('boards/data/boards.meta.json'));
  const hours = { index: INDEX, strings: SIDECAR.strings, source: SIDECAR.source };
  for (const { lang, file } of LIST_PAGES) {
    const once = renderListPage(features, meta, lang, hours);
    assert.equal(renderListPage(features, meta, lang, hours), once, `${file} is not deterministic`);
    assert.equal(once, read(file), `${file} is stale — run: node tools/build-boards-data.mjs --static-only`);
  }
});

test('a directory renders without a sidecar at all', () => {
  const features = JSON.parse(read('boards/data/boards.geojson')).features.slice(0, 20);
  const meta = JSON.parse(read('boards/data/boards.meta.json'));
  const html = renderListPage(features, meta, 'en', null);
  assert.ok(!html.includes('<details class="oh">'));
  assert.ok(html.includes('<h1>'), 'the page still renders');
});

// ── The map pages ─────────────────────────────────────────────────────────

test('both map pages disclose the source and its licence in prose', () => {
  for (const file of MAP_PAGES) {
    const html = read(file);
    assert.ok(html.includes('https://opendatacommons.org/licenses/odbl/1-0/'), `${file}: no ODbL link`);
    assert.ok(html.includes('/boards/data/osm-opening-hours.json'), `${file}: sidecar not named`);
  }
});

test('both map pages declare the hours as their own ODbL dataset in JSON-LD', () => {
  for (const file of MAP_PAGES) {
    const graphs = [...read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]));
    const nodes = graphs.flatMap((g) => g['@graph'] ?? [g]);
    const hoursDataset = nodes.find((n) => String(n['@id'] ?? '').endsWith('#opening-hours'));
    assert.ok(hoursDataset, `${file}: no #opening-hours dataset`);
    assert.equal(hoursDataset['@type'], 'Dataset');
    assert.equal(hoursDataset.license, 'https://opendatacommons.org/licenses/odbl/1-0/');

    const venues = nodes.find((n) => String(n['@id'] ?? '').endsWith('#dataset'));
    assert.equal(venues.license, 'https://creativecommons.org/licenses/by/4.0/',
      `${file}: the venue dataset must keep its own licence`);
  }
});

// ── The map script ────────────────────────────────────────────────────────

const MAP_JS = read('boards/map.js');

// Comments explain what the code deliberately does NOT do, so they are
// stripped before scanning for the things the code must never do.
const MAP_JS_CODE = MAP_JS
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the map reads the hours from this origin and asks OpenStreetMap nothing', () => {
  assert.ok(MAP_JS.includes("fetch('/boards/data/osm-opening-hours.json')"),
    'the sidecar is not fetched from our own origin');
  // The only openstreetmap.org strings in the map are the tile layer and the
  // attribution link; per-venue data must never be fetched from there.
  for (const forbidden of ['api.openstreetmap.org', 'overpass', 'nominatim']) {
    assert.equal(MAP_JS_CODE.includes(forbidden), false, `map.js must not contain ${forbidden}`);
  }
});

test('a missing or broken sidecar cannot take the map down', () => {
  const load = MAP_JS.slice(MAP_JS.indexOf('── Data load'));
  assert.match(load, /osm-opening-hours\.json'\)\s*\n\s*\.then\(function \(res\) \{ return res\.ok \? res\.json\(\) : null; \}\)/);
  assert.match(load, /\.catch\(function \(\) \{ return null; \}\)/);
});

test('the popup places rendered text and never decides whether a venue is open now', () => {
  assert.ok(MAP_JS.includes('renderOpeningHours(lat, lon)'), 'popups do not render hours');
  for (const forbidden of [/open now/i, /isOpen/, /new Date\(\)[^\n]*opening/i, /geöffnet/i]) {
    assert.ok(!forbidden.test(MAP_JS_CODE), `map.js must not contain ${forbidden}`);
  }
});

test('everything the popup shows is escaped before it reaches the DOM', () => {
  const fn = MAP_JS.slice(MAP_JS.indexOf('function renderOpeningHours'),
    MAP_JS.indexOf('function buildPopupHtml'));
  // Every interpolation in the block is wrapped in escapeHtml(...).
  const interpolations = fn.match(/'\s*\+\s*([A-Za-z][\w.[\]]*)/g) ?? [];
  for (const hit of interpolations) {
    assert.ok(/escapeHtml|parts\.join|S\.|d\./.test(hit), `unescaped interpolation: ${hit}`);
  }
  assert.equal((fn.match(/escapeHtml\(/g) ?? []).length >= 6, true);
});

// ── The popup, actually executed ──────────────────────────────────────────
// boards/map.js is browser code with no module boundary, so the popup
// renderer is lifted out of the source and run here — the same trick
// map-url-state.test.mjs uses. Asserting on the HTML the browser would build
// beats asserting that the file contains some substrings.

function popupRenderer(sidecar, lang) {
  const escapeHtml = MAP_JS.match(/ {2}function escapeHtml\([\s\S]*?\n {2}}/)[0];
  const setOpeningHours = MAP_JS.match(/ {2}function setOpeningHours\([\s\S]*?\n {2}}/)[0];
  const venueKeyFn = MAP_JS.match(/ {2}function venueKey\([\s\S]*?\n {2}}/)[0];
  const render = MAP_JS.match(/ {2}function renderOpeningHours\([\s\S]*?\n {2}}/)[0];
  assert.ok(escapeHtml && setOpeningHours && venueKeyFn && render,
    'the popup renderer has moved — this test needs updating');
  // eslint-disable-next-line no-new-func
  return new Function('LANG', 'sidecar', `
    var openingHours = null;
    ${escapeHtml}
    ${setOpeningHours}
    ${venueKeyFn}
    ${render}
    setOpeningHours(sidecar);
    return function (lat, lon) { return renderOpeningHours(lat, lon); };
  `)(lang, sidecar);
}

test('the popup builds the schedule the sidecar describes, in the page language', () => {
  for (const lang of ['en', 'de']) {
    const html = popupRenderer(SIDECAR, lang)(SAMPLE.lat, SAMPLE.lon);
    assert.ok(html.includes(SIDECAR.strings[lang].heading), `${lang}: no heading`);
    for (const line of SAMPLE.display[lang].lines) {
      assert.ok(html.includes(`>${line.label}</span>`), `${lang}: missing ${line.label}`);
      assert.ok(html.includes(`>${line.value}</span>`), `${lang}: missing ${line.value}`);
    }
    assert.ok(html.includes(SAMPLE.display.freshness[lang]), `${lang}: no freshness`);
    assert.ok(html.includes(SIDECAR.strings[lang].attribution), `${lang}: no ODbL attribution`);
    assert.ok(html.includes(`href="${SAMPLE.osm_url}"`), `${lang}: no link to the exact object`);
  }
});

test('the popup shows an unrenderable value verbatim and offers the object instead', () => {
  const html = popupRenderer(SIDECAR, 'en')(SAMPLE_RAW.lat, SAMPLE_RAW.lon);
  assert.ok(html.includes(SIDECAR.strings.en.unsupported));
  assert.ok(html.includes('<code>'));
  assert.ok(!html.includes('popup-oh-row'), 'a refused value must not be laid out as a schedule');
  assert.ok(html.includes(`href="${SAMPLE_RAW.osm_url}"`));
});

test('a venue with no matched object gets no block at all', () => {
  assert.equal(popupRenderer(SIDECAR, 'en')(0, 0), '');
});

test('the popup is empty rather than broken when the sidecar never arrives', () => {
  assert.equal(popupRenderer(null, 'en')(SAMPLE.lat, SAMPLE.lon), '');
  assert.equal(popupRenderer({ venues: [] }, 'en')(SAMPLE.lat, SAMPLE.lon), '');
});

test('hostile text from a relay-fed field cannot inject markup into the popup', () => {
  const evil = {
    ...SIDECAR,
    venues: [{
      key: '0.0000|0.0000',
      lat: 0,
      lon: 0,
      name: 'Injection Test',
      osm_url: 'https://www.openstreetmap.org/node/1"><script>alert(1)</script>',
      opening_hours: 'x',
      display: {
        kind: 'raw',
        raw: '<img src=x onerror=alert(1)>',
        en: { lines: [], notes: [] },
        de: { lines: [], notes: [] },
        freshness: { en: '<b>nope</b>', de: '<b>nope</b>' },
      },
    }],
  };
  const html = popupRenderer(evil, 'en')(0, 0);
  assert.ok(!html.includes('<script>'), html);
  assert.ok(!html.includes('<img src=x'), html);
  assert.ok(!html.includes('<b>nope</b>'), html);
  assert.ok(html.includes('&lt;img src=x'), html);
});
