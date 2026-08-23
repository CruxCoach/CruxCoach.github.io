import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// boards/map.js is browser code with no module boundary, so the two hash
// helpers are lifted out of the source and evaluated here. That keeps the
// shareable-link format under test without introducing a bundler or a DOM.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'boards', 'map.js'), 'utf8');

const READ_HASH = source.match(/ {2}function readHash\(\)[\s\S]*?\n {2}}/)?.[0];
const WRITE_HASH = source.match(/ {2}function writeHash\(\)[\s\S]*?\n {2}}/)?.[0];

const BOARD_IDS = ['kilter', 'tension', 'moonboard', 'grasshopper', 'decoy',
  'soill', 'touchstone', 'aurora', '12climb'];
const COLOR = Object.fromEntries(BOARD_IDS.map((id) => [id, '#000']));
const BOARDS = BOARD_IDS.map((id) => ({ id }));

function readHash(hash) {
  const fn = new Function('location', 'COLOR', `${READ_HASH}; return readHash();`);
  return fn({ hash }, COLOR);
}

function writeHash(selected, center = { lat: 48.137432, lng: 11.575494 }, zoom = 12) {
  let written = null;
  const fn = new Function('map', 'history', 'location', 'activeBoards', 'BOARDS',
    `${WRITE_HASH}; writeHash();`);
  fn(
    { getCenter: () => center, getZoom: () => zoom },
    { replaceState: (_s, _t, url) => { written = url; } },
    { hash: '', pathname: '/boards/', search: '' },
    new Set(selected),
    BOARDS,
  );
  return written;
}

test('the hash helpers are still present in map.js', () => {
  assert.ok(READ_HASH, 'readHash() not found — the shareable-link format may have moved');
  assert.ok(WRITE_HASH, 'writeHash() not found');
});

test('readHash parses centre and zoom', () => {
  assert.deepEqual(readHash('#48.1374,11.5755,12'),
    { lat: 48.1374, lon: 11.5755, zoom: 12, boards: null });
});

test('readHash parses an explicit board filter', () => {
  assert.deepEqual(readHash('#48.1374,11.5755,12&b=kilter,tension').boards,
    ['kilter', 'tension']);
});

test('readHash preserves an explicit empty board selection', () => {
  assert.deepEqual(readHash('#48.1374,11.5755,12&b=').boards, []);
});

test('readHash drops unknown board ids instead of filtering everything away', () => {
  // A typo or a board we retired must not blank the map.
  assert.deepEqual(readHash('#48.1374,11.5755,12&b=kilter,bogus').boards, ['kilter']);
  assert.equal(readHash('#48.1374,11.5755,12&b=bogus').boards, null,
    'all-unknown falls back to the stored selection');
});

test('readHash rejects anything it cannot trust', () => {
  assert.equal(readHash(''), null, 'no hash');
  assert.equal(readHash('#'), null, 'empty hash');
  assert.equal(readHash('#nonsense'), null);
  assert.equal(readHash('#48.1374'), null, 'missing lon and zoom');
  assert.equal(readHash('#91,11,12'), null, 'latitude out of range');
  assert.equal(readHash('#-91,11,12'), null);
  assert.equal(readHash('#48,181,12'), null, 'longitude out of range');
  assert.equal(readHash('#48,11,99'), null, 'zoom out of range');
  assert.equal(readHash('#48,11,-1'), null);
});

test('writeHash omits the board filter when everything is selected', () => {
  assert.equal(writeHash(BOARD_IDS), '/boards/#48.1374,11.5755,12');
});

test('writeHash spells out a narrowed selection in board order', () => {
  assert.equal(writeHash(['moonboard', 'kilter']), '/boards/#48.1374,11.5755,12&b=kilter,moonboard');
  assert.equal(writeHash(['tension']), '/boards/#48.1374,11.5755,12&b=tension');
});

test('writeHash encodes an empty selection instead of silently dropping it', () => {
  assert.equal(writeHash([]), '/boards/#48.1374,11.5755,12&b=');
});

test('writeHash rounds coordinates to about ten metres', () => {
  const url = writeHash(BOARD_IDS, { lat: 48.13743298, lng: 11.57549412 }, 15);
  assert.equal(url, '/boards/#48.1374,11.5755,15');
});

test('a written hash reads back to the same state', () => {
  const url = writeHash(['kilter', 'tension'], { lat: -33.8688, lng: 151.2093 }, 11);
  const parsed = readHash(url.slice(url.indexOf('#')));
  assert.deepEqual(parsed, { lat: -33.8688, lon: 151.2093, zoom: 11, boards: ['kilter', 'tension'] });
});
