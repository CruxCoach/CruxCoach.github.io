import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { qrModules, __testing } from '../competitions/app/ui/dom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(
  fs.readFileSync(path.resolve(here, '../competitions/fixtures/qr-reference.json'), 'utf8'),
);

const { SIZE, CAPACITY_BYTES, EC_PER_BLOCK, BLOCKS, gfMul, reservedMap, maskAt, bchFormatInfo, bchVersionInfo } = __testing;

/**
 * The QR encoder is hand-written, so it is verified by decoding its output
 * rather than by trusting it.
 *
 * A QR nobody's phone can read is a control that does not work — worse than no
 * control, because the projector would look correct. The checks below are the
 * ones a scanner actually performs:
 *
 *   1. the function patterns are where the standard says (a scanner locates the
 *      symbol with them before reading a single data bit);
 *   2. the format and version areas decode to the level, mask and version we
 *      claim;
 *   3. every Reed-Solomon block has zero syndromes, i.e. it is a valid codeword
 *      — this is what makes the symbol survive damage, and it cannot be faked
 *      by a plausible-looking byte stream;
 *   4. the payload decodes back to exactly the text that went in, including
 *      multi-byte UTF-8 and the maximum length.
 *
 * Plus one check that only an outside opinion can give: the function areas are
 * compared module-for-module against an independent encoder. That check earned
 * its place — it caught a wrong BCH generator degree that left the format area
 * undecodable while the data still round-tripped perfectly through our own
 * reader, because the reader repeated the same mistake.
 *
 * The DATA region is deliberately not compared. Two conformant encoders differ
 * in padding policy after the terminator, which changes the error-correction
 * bytes and about half the modules, while both symbols scan to the same string.
 * Equality with one particular library is not the property worth asserting;
 * "a scanner gets the URL back" is.
 */

const ALIGNMENT = [6, 28, 50];

function decode(modules) {
  const reserved = reservedMap();

  // 1. read the declared format information back out
  let formatBits = 0;
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = modules[i][8];
    else if (i < 8) bit = modules[i + 1][8];
    else bit = modules[SIZE - 15 + i][8];
    formatBits |= bit << i;
  }
  const formatData = (formatBits ^ 0b101010000010010) >> 10;
  const ecLevel = (formatData >> 3) & 0b11;
  const mask = formatData & 0b111;

  let versionBits = 0;
  for (let i = 0; i < 18; i++) {
    versionBits |= modules[Math.floor(i / 3)][(i % 3) + SIZE - 8 - 3] << i;
  }

  // 2. walk the data region in placement order, undoing the declared mask
  const bits = [];
  let inc = -1;
  let row = SIZE - 1;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const column = col - c;
        if (reserved[row][column]) continue;
        let value = modules[row][column];
        if (mask === 0 && (row + column) % 2 === 0) value = value ? 0 : 1;
        bits.push(value);
      }
      row += inc;
      if (row < 0 || row >= SIZE) { row -= inc; inc = -inc; break; }
    }
  }
  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    stream.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  // 3. de-interleave into blocks, data first then error correction
  const dataBlocks = BLOCKS.map(() => []);
  let index = 0;
  const longest = Math.max(...BLOCKS);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < BLOCKS.length; b++) if (i < BLOCKS[b]) dataBlocks[b].push(stream[index++]);
  }
  const ecBlocks = BLOCKS.map(() => []);
  for (let i = 0; i < EC_PER_BLOCK; i++) {
    for (let b = 0; b < BLOCKS.length; b++) ecBlocks[b].push(stream[index++]);
  }

  // 4. parse the header from the concatenated data codewords
  const data = dataBlocks.flat();
  const dataBits = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
  const take = (count) => dataBits.splice(0, count).reduce((acc, bit) => (acc << 1) | bit, 0);
  const mode = take(4);
  const length = take(16);
  const payload = [];
  for (let i = 0; i < length; i++) payload.push(take(8));

  return {
    ecLevel,
    mask,
    version: versionBits >> 12,
    mode,
    length,
    text: new TextDecoder().decode(Uint8Array.from(payload)),
    dataBlocks,
    ecBlocks,
    consumed: index,
    streamLength: stream.length,
  };
}

/** Zero syndromes mean the block is a valid Reed-Solomon codeword. */
function syndromes(codeword) {
  const out = [];
  for (let i = 0; i < EC_PER_BLOCK; i++) {
    let value = 0;
    let alpha = 1;
    const root = gfMul(1, expOf(i));
    for (let j = codeword.length - 1; j >= 0; j--) {
      value ^= gfMul(codeword[j], alpha);
      alpha = gfMul(alpha, root);
    }
    out.push(value);
  }
  return out;
}

/** α^i in GF(256) with the QR primitive polynomial. */
function expOf(exponent) {
  let value = 1;
  for (let i = 0; i < exponent; i++) {
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  return value;
}

const SAMPLES = [
  'x',
  'https://cruxcoach.org/competitions/',
  'https://cruxcoach.org/comp/naddr1qq2kw6t9wgh8xmmrv93kketwvskkjmtsdaehgu3wwa5kuef0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7',
  'Kellerwand — Übung 🧗',
  'a'.repeat(CAPACITY_BYTES),
];

test('the symbol decodes back to exactly the text that went in', () => {
  for (const text of SAMPLES) {
    const decoded = decode(qrModules(text));
    assert.equal(decoded.mode, 0b0100, `${text.slice(0, 20)}: byte mode`);
    assert.equal(decoded.length, new TextEncoder().encode(text).length, `${text.slice(0, 20)}: length`);
    assert.equal(decoded.text, text, `${text.slice(0, 20)}: payload`);
  }
});

test('the format and version areas declare what we actually encoded', () => {
  const decoded = decode(qrModules('x'));
  assert.equal(decoded.ecLevel, 0b01, 'error correction level L');
  assert.equal(decoded.mask, 0, 'mask pattern 0');
  assert.equal(decoded.version, 10);
  // And the BCH helpers agree with the values the standard publishes.
  assert.equal(bchFormatInfo(0b01000), 0b111011111000100);
  assert.equal(bchVersionInfo(10), 0b001010010011010011);
});

test('every Reed-Solomon block is a valid codeword', () => {
  for (const text of SAMPLES) {
    const decoded = decode(qrModules(text));
    assert.equal(decoded.consumed, decoded.streamLength, `${text.slice(0, 12)}: every codeword is accounted for`);
    decoded.dataBlocks.forEach((block, i) => {
      const codeword = [...block, ...decoded.ecBlocks[i]];
      const bad = syndromes(codeword).filter((s) => s !== 0);
      assert.equal(bad.length, 0, `${text.slice(0, 12)}: block ${i} has non-zero syndromes`);
    });
  }
});

test('the function patterns are exactly where a scanner looks for them', () => {
  const modules = qrModules('x');
  const finder = [
    '1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111',
  ];
  for (const [originY, originX] of [[0, 0], [0, SIZE - 7], [SIZE - 7, 0]]) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        assert.equal(
          modules[originY + y][originX + x], Number(finder[y][x]),
          `finder at ${originY},${originX} cell ${y},${x}`,
        );
      }
    }
  }
  // Timing patterns alternate, starting dark.
  for (let i = 8; i < SIZE - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }
  // Alignment patterns: a 5x5 ring with a dark centre.
  for (const row of ALIGNMENT) {
    for (const col of ALIGNMENT) {
      if ((row === 6 && col === 6) || (row === 6 && col === 50) || (row === 50 && col === 6)) continue;
      assert.equal(modules[row][col], 1, `alignment centre ${row},${col}`);
      assert.equal(modules[row - 1][col], 0, `alignment ring ${row},${col}`);
      assert.equal(modules[row - 2][col], 1, `alignment outer ${row},${col}`);
    }
  }
  assert.equal(modules[SIZE - 8][8], 1, 'the always-dark module');
});

test('a payload that does not fit returns null rather than truncating', () => {
  assert.equal(qrModules('a'.repeat(CAPACITY_BYTES + 1)), null);
  // A multi-byte character counts in bytes, not characters.
  assert.equal(qrModules('🧗'.repeat(Math.ceil(CAPACITY_BYTES / 4) + 1)), null);
  assert.notEqual(qrModules('a'.repeat(CAPACITY_BYTES)), null);
});

test('a real join link fits with room to spare', () => {
  const link = 'https://cruxcoach.org/comp/naddr1'
    + 'qq2kw6t9wgh8xmmrv93kketwvskkjmtsdaehgu3wwa5kuef0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qgcwaehxw309a';
  assert.ok(new TextEncoder().encode(link).length < CAPACITY_BYTES);
  assert.equal(decode(qrModules(link)).text, link);
});

test('the matrix is square, binary, and the declared size', () => {
  const modules = qrModules('x');
  assert.equal(modules.length, SIZE);
  for (const row of modules) {
    assert.equal(row.length, SIZE);
    for (const cell of row) assert.ok(cell === 0 || cell === 1, 'every module is 0 or 1');
  }
});

test('the mask helper is the pattern the format area declares', () => {
  assert.equal(maskAt(0, 0), true);
  assert.equal(maskAt(0, 1), false);
  assert.equal(maskAt(1, 1), true);
});

test('the function areas match an independent encoder exactly', () => {
  // Finder, timing and alignment patterns plus the BCH-coded format and version
  // information — everything a scanner reads before it touches a data bit. The
  // data region is not compared on purpose: see the note in the fixture.
  const reserved = reservedMap();
  for (const [text, rows] of Object.entries(reference.matrices)) {
    const mine = qrModules(text);
    assert.ok(mine, `${text.slice(0, 16)}: should encode`);
    let differences = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!reserved[y][x]) continue;
        if (mine[y][x] !== Number(rows[y][x])) differences += 1;
      }
    }
    assert.equal(differences, 0, `${text.slice(0, 24)}: function areas differ from the reference`);
  }
});

test('the reference fixture is the configuration we actually encode', () => {
  assert.equal(reference.version, __testing.VERSION);
  assert.equal(reference.size, SIZE);
  assert.equal(reference.error_correction, 'L');
  assert.equal(reference.mask, 0);
  assert.ok(Object.keys(reference.matrices).length >= 4);
});
