import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import {
  buildBoardIndex,
  hasBoardWithin,
  haversineKm,
  indexExonyms,
  markAmbiguous,
  mergeAlternates,
  pickGermanName,
  normalizeText,
  parseAdmin1,
  parseAlternateLine,
  parseArgs,
  parseCityLine,
  readZipEntry,
  trimRow,
} from './build-cities-data.mjs';

// A GeoNames city row: 19 tab-separated columns, no header.
function cityLine(over = {}) {
  const cols = new Array(19).fill('');
  cols[0] = over.id ?? '2950159';
  cols[1] = over.name ?? 'Berlin';
  cols[2] = over.asciiName ?? 'Berlin';
  cols[3] = over.alternateNames ?? 'Berlino,Berlijn';
  cols[4] = over.lat ?? '52.52437';
  cols[5] = over.lon ?? '13.41053';
  cols[8] = over.country ?? 'DE';
  cols[10] = over.admin1 ?? '16';
  cols[14] = over.population ?? '3426354';
  return cols.join('\t');
}

test('parseCityLine reads the columns the index needs', () => {
  const city = parseCityLine(cityLine());
  assert.equal(city.name, 'Berlin');
  assert.equal(city.country, 'DE');
  assert.equal(city.admin1, '16');
  assert.equal(city.population, 3426354);
  assert.ok(Math.abs(city.lat - 52.52437) < 1e-9);
  assert.ok(Math.abs(city.lon - 13.41053) < 1e-9);
});

test('parseCityLine rejects rows that cannot be placed on a map', () => {
  assert.equal(parseCityLine('too\tshort'), null);
  assert.equal(parseCityLine(cityLine({ lat: 'not-a-number' })), null);
  assert.equal(parseCityLine(cityLine({ lat: '95.0' })), null, 'latitude out of range');
  assert.equal(parseCityLine(cityLine({ lon: '-181.0' })), null, 'longitude out of range');
  assert.equal(parseCityLine(cityLine({ name: '' })), null);
  assert.equal(parseCityLine(cityLine({ country: '' })), null);
});

test('parseCityLine tolerates a missing population', () => {
  assert.equal(parseCityLine(cityLine({ population: '' })).population, 0);
});

test('parseCityLine keeps the geonameid used to join the name dump', () => {
  assert.equal(parseCityLine(cityLine({ id: '2950159' })).id, '2950159');
});

// ── Language-tagged alternate names ─────────────────────────────────────
// alternateNamesV2 columns:
// id, geonameid, isolanguage, name, isPreferred, isShort, isColloquial,
// isHistoric, from, to
function altLine(over = {}) {
  const cols = new Array(10).fill('');
  cols[0] = over.id ?? '1';
  cols[1] = over.geonameid ?? '2867714';
  cols[2] = over.lang ?? 'de';
  cols[3] = over.name ?? 'München';
  cols[4] = over.preferred ?? '';
  cols[5] = over.short ?? '';
  cols[6] = over.colloquial ?? '';
  cols[7] = over.historic ?? '';
  return cols.join('\t');
}

test('parseAlternateLine keeps only the two site languages', () => {
  const ids = new Set(['2867714']);
  assert.equal(parseAlternateLine(altLine({ lang: 'de' }), ids).name, 'München');
  assert.equal(parseAlternateLine(altLine({ lang: 'en', name: 'Munich' }), ids).name, 'Munich');
  assert.equal(parseAlternateLine(altLine({ lang: 'fr', name: 'Munich' }), ids), null);
  assert.equal(parseAlternateLine(altLine({ lang: '' }), ids), null);
});

test('parseAlternateLine ignores cities outside the index', () => {
  assert.equal(parseAlternateLine(altLine(), new Set(['999'])), null);
  assert.ok(parseAlternateLine(altLine(), null), 'a null set means "keep everything"');
});

test('parseAlternateLine drops historic and colloquial forms', () => {
  const ids = new Set(['2867714']);
  assert.equal(parseAlternateLine(altLine({ historic: '1' }), ids), null);
  assert.equal(parseAlternateLine(altLine({ colloquial: '1' }), ids), null);
});

test('parseAlternateLine ranks preferred above short above plain', () => {
  const ids = new Set(['2867714']);
  assert.equal(parseAlternateLine(altLine({ preferred: '1' }), ids).rank, 0);
  assert.equal(parseAlternateLine(altLine({ short: '1' }), ids).rank, 1);
  assert.equal(parseAlternateLine(altLine(), ids).rank, 2);
});

test('parseAlternateLine survives truncated rows', () => {
  assert.equal(parseAlternateLine('', null), null);
  assert.equal(parseAlternateLine('1\t2', null), null);
  assert.equal(parseAlternateLine('1\t2\tde', null), null);
  assert.equal(parseAlternateLine('1\t2\tde\t   ', null), null, 'blank name');
});

test('mergeAlternates keeps the order it is given, curated first', () => {
  assert.deepEqual(mergeAlternates('Prague', ['Prag', 'Praha', 'Prague City']),
    ['Prag', 'Praha', 'Prague City']);
});

test('mergeAlternates drops spellings the primary name already covers', () => {
  // Diacritics are stripped on both sides of the search, so these add nothing.
  assert.deepEqual(mergeAlternates('Zürich', ['Zurich']), []);
  assert.deepEqual(mergeAlternates('Köln', ['Cologne']), ['Cologne']);
});

test('mergeAlternates skips anything already covered elsewhere', () => {
  // The German name lives in its own slot, so it must not be repeated here.
  assert.deepEqual(mergeAlternates('Munich', ['München', 'Munich City'], 3, ['München']),
    ['Munich City']);
});

test('mergeAlternates deduplicates and caps the list', () => {
  assert.deepEqual(mergeAlternates('Prague', ['Prag', 'Prag', 'Praha']), ['Prag', 'Praha']);
  assert.equal(mergeAlternates('X', ['a', 'b', 'c', 'd', 'e'], 2).length, 2);
});

test('mergeAlternates copes with an absent or empty candidate list', () => {
  assert.deepEqual(mergeAlternates('Berlin', null), []);
  assert.deepEqual(mergeAlternates('Berlin', []), []);
  assert.deepEqual(mergeAlternates('Vienna', [null, '', 'Wien']), ['Wien']);
});

test('pickGermanName only reports a German form that differs', () => {
  assert.equal(pickGermanName('Munich', { de: { name: 'München' } }), 'München');
  assert.equal(pickGermanName('Zürich', { de: { name: 'Zurich' } }), '', 'same after normalizing');
  assert.equal(pickGermanName('Berlin', { en: { name: 'Berlin' } }), '', 'no German entry');
  assert.equal(pickGermanName('Berlin', null), '');
});

test('trimRow drops empty trailing fields but never the four required ones', () => {
  assert.deepEqual(trimRow(['Berlin', 'DE', 52.52, 13.41, '', [], '']), ['Berlin', 'DE', 52.52, 13.41]);
  assert.deepEqual(trimRow(['Munich', 'DE', 48.14, 11.58, '', [], 'München']),
    ['Munich', 'DE', 48.14, 11.58, '', [], 'München']);
  assert.deepEqual(trimRow(['Berlin', 'US', 44.47, -71.19, 'New Hampshire', []]),
    ['Berlin', 'US', 44.47, -71.19, 'New Hampshire']);
});

test('normalizeText matches what the browser search compares against', () => {
  assert.equal(normalizeText('München'), 'munchen');
  assert.equal(normalizeText('Straße'), 'strasse');
  assert.equal(normalizeText('ZÜRICH'), 'zurich');
  assert.equal(normalizeText('Kraków'), 'krakow');
});

test('markAmbiguous flags only names that repeat inside one country', () => {
  const cities = [
    { name: 'Berlin', country: 'DE' },
    { name: 'Berlin', country: 'US' },
    { name: 'Springfield', country: 'US' },
    { name: 'Springfield', country: 'US' },
  ];
  markAmbiguous(cities);
  assert.equal(cities[0].ambiguous, false, 'same name in a different country is not ambiguous');
  assert.equal(cities[1].ambiguous, false);
  assert.equal(cities[2].ambiguous, true);
  assert.equal(cities[3].ambiguous, true);
});

test('markAmbiguous compares normalized names', () => {
  const cities = [{ name: 'Málaga', country: 'ES' }, { name: 'Malaga', country: 'ES' }];
  markAmbiguous(cities);
  assert.equal(cities[0].ambiguous, true);
});

test('parseAdmin1 maps the composite code to a region name', () => {
  const map = parseAdmin1('DE.02\tBavaria\tBavaria\t2951839\nUS.NH\tNew Hampshire\tNew Hampshire\t5090174\n');
  assert.equal(map.get('DE.02'), 'Bavaria');
  assert.equal(map.get('US.NH'), 'New Hampshire');
  assert.equal(map.get('XX.99'), undefined);
});

test('indexExonyms keys by normalized name and country', () => {
  const map = indexExonyms([{ name: 'Munich', country: 'DE', also: ['München'] }]);
  assert.deepEqual(map.get('munich|DE'), ['München']);
});

test('indexExonyms drops spellings the primary name already covers', () => {
  // The search normalizes diacritics on both sides, so "Dusseldorf" behind
  // "Düsseldorf" would be dead weight — but "Cologne" is a real addition.
  const map = indexExonyms([
    { name: 'Düsseldorf', country: 'DE', also: ['Dusseldorf'] },
    { name: 'Köln', country: 'DE', also: ['Köln', 'Cologne'] },
  ]);
  assert.equal(map.has('dusseldorf|DE'), false);
  assert.deepEqual(map.get('koln|DE'), ['Cologne']);
});

test('indexExonyms skips malformed entries instead of throwing', () => {
  const map = indexExonyms([
    null,
    { name: 'X' },
    { name: 'X', country: 'DE' },
    { name: 'X', country: 'DE', also: 'not-an-array' },
    { name: 'Vienna', country: 'AT', also: ['Wien'] },
  ]);
  assert.equal(map.size, 1);
});

test('haversineKm measures a known distance', () => {
  // Berlin → Munich is about 504 km great-circle.
  const km = haversineKm(52.52, 13.405, 48.137, 11.575);
  assert.ok(km > 500 && km < 510, `expected ~504 km, got ${km}`);
  assert.equal(haversineKm(52.52, 13.405, 52.52, 13.405), 0);
});

test('hasBoardWithin respects the radius', () => {
  const grid = buildBoardIndex([
    { geometry: { coordinates: [13.405, 52.52] } }, // Berlin
  ]);
  assert.equal(hasBoardWithin(grid, 52.53, 13.41, 10), true, 'a board next door counts');
  assert.equal(hasBoardWithin(grid, 48.137, 11.575, 100), false, 'Munich is out of a 100 km radius');
  assert.equal(hasBoardWithin(grid, 48.137, 11.575, 600), true, 'and inside a 600 km one');
});

test('hasBoardWithin searches across the cell grid, not just one cell', () => {
  // 51.999 and 52.001 fall in different 1° cells but are ~200 m apart; a
  // single-cell lookup would miss this.
  const grid = buildBoardIndex([{ geometry: { coordinates: [13.0, 51.999] } }]);
  assert.equal(hasBoardWithin(grid, 52.001, 13.0, 5), true);
});

test('hasBoardWithin copes with an empty or malformed board set', () => {
  const grid = buildBoardIndex([null, {}, { geometry: {} }, { geometry: { coordinates: ['a', 'b'] } }]);
  assert.equal(grid.size, 0);
  assert.equal(hasBoardWithin(grid, 52.52, 13.405, 500), false);
});

test('parseArgs defaults and overrides', () => {
  const def = parseArgs([]);
  assert.equal(def.dataset, 'cities15000');
  assert.equal(def.minPopulation, 15000);
  assert.equal(def.globalPopulation, 200000);
  assert.equal(def.radiusKm, 100);

  const custom = parseArgs(['--radius-km', '250', '--min-population', '5000', '--dataset', 'cities5000']);
  assert.equal(custom.radiusKm, 250);
  assert.equal(custom.minPopulation, 5000);
  assert.equal(custom.dataset, 'cities5000');
});

test('parseArgs rejects bad input rather than guessing', () => {
  assert.throws(() => parseArgs(['--radius-km', 'far']), /--radius-km/);
  assert.throws(() => parseArgs(['--min-population', '-5']), /--min-population/);
  assert.throws(() => parseArgs(['--dataset', 'cities99']), /--dataset/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

// ── ZIP reader ──────────────────────────────────────────────────────────
// Build a minimal single-entry archive in memory rather than committing a
// binary fixture, so the test states exactly which header layout it covers.
function makeZip(name, contents, { store = false } = {}) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(contents, 'utf8');
  const body = store ? data : deflateRawSync(data);
  const method = store ? 0 : 8;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const localRecord = Buffer.concat([local, nameBuf, body]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const centralRecord = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);  // entries on this disk
  eocd.writeUInt16LE(1, 10); // entries total
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);

  return Buffer.concat([localRecord, centralRecord, eocd]);
}

test('readZipEntry inflates a deflated entry', () => {
  const text = 'Berlin\tDE\t52.52\t13.41\n'.repeat(50);
  const zip = makeZip('cities15000.txt', text);
  assert.equal(readZipEntry(zip, 'cities15000.txt').toString('utf8'), text);
});

test('readZipEntry handles a stored (uncompressed) entry', () => {
  const zip = makeZip('a.txt', 'plain', { store: true });
  assert.equal(readZipEntry(zip, 'a.txt').toString('utf8'), 'plain');
});

test('readZipEntry fails loudly on a missing entry or a non-ZIP buffer', () => {
  const zip = makeZip('a.txt', 'x');
  assert.throws(() => readZipEntry(zip, 'b.txt'), /entry not found/);
  assert.throws(() => readZipEntry(Buffer.alloc(64), 'a.txt'), /not a ZIP archive/);
});
