/**
 * DOM helpers.
 *
 * Every one of these sets `textContent`. Nothing in this feature ever assigns
 * `innerHTML`, because a competition title, a display name and an announcement
 * are all attacker-supplied strings that arrive from a public relay. The rule is
 * enforced by a test that greps the shipped files rather than by remembering.
 */

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { text, className, attrs, on, ...rest } = options;
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (attrs) for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  if (on) for (const [name, handler] of Object.entries(on)) node.addEventListener(name, handler);
  for (const [name, value] of Object.entries(rest)) node[name] = value;
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

export function replace(node, ...children) {
  clear(node);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const byId = (id) => document.getElementById(id);

/**
 * Announce something to assistive technology without moving focus.
 *
 * A live competition changes under the user constantly; a screen reader that
 * gets no announcement simply never learns that it is now their turn.
 */
export function announce(message, { assertive = false } = {}) {
  const region = byId(assertive ? 'live-alerts' : 'live-status');
  if (!region) return;
  // Clearing first makes a repeated identical message announce again, which
  // matters when the same "your turn" fires twice.
  region.textContent = '';
  region.textContent = message;
}

/** A short, stable identity label. Never the full key, which nobody reads. */
export function shortKey(pubkey) {
  if (typeof pubkey !== 'string' || pubkey.length < 12) return pubkey || '';
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

export function displayName(participant) {
  if (!participant) return '';
  return participant.display?.trim() || shortKey(participant.pubkey);
}

/** `m:ss`, or `—` when there is no deadline. */
export function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatDateTime(epochSeconds, language, timeZone) {
  if (!epochSeconds) return '';
  try {
    return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'short', timeZone,
    }).format(new Date(epochSeconds * 1000));
  } catch {
    // An invalid IANA zone in a competition document must not blank the page.
    return new Date(epochSeconds * 1000).toISOString().replace('T', ' ').slice(0, 16);
  }
}

export function formatSats(msat) {
  if (!msat) return '';
  const sats = Math.round(msat / 1000);
  return `${sats.toLocaleString('en-GB')} sat`;
}

/**
 * Copy to the clipboard and best-effort clear it later.
 *
 * "Best-effort" is the honest word: another page can read the clipboard first,
 * and clearing needs this tab to still be focused. The UI says so rather than
 * implying the secret is gone.
 */
export async function copyWithExpiry(text, { clearAfterMs = 60000 } = {}) {
  await navigator.clipboard.writeText(text);
  if (!clearAfterMs) return;
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => { /* not focused, or refused */ });
  }, clearAfterMs);
}

/**
 * A QR code, rendered as SVG with no dependency.
 *
 * Byte mode, fixed version 10 with error correction L, which comfortably holds
 * a join URL of up to 271 bytes — an naddr link is about 160. Anything longer
 * falls back to the plain link, because a QR that silently truncates is worse
 * than no QR.
 */
export function qrSvg(text, { size = 240, title = 'QR code' } = {}) {
  const modules = qrModules(text);
  if (!modules) return null;
  const count = modules.length;
  const quiet = 4;
  const total = count + quiet * 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', '#ffffff');
  svg.append(background);
  let path = '';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (modules[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const dark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dark.setAttribute('d', path);
  dark.setAttribute('fill', '#000000');
  svg.append(dark);
  return svg;
}

// ── QR encoding (byte mode, version 10, EC level L) ──
//
// Implemented locally rather than vendored: it is a fixed-configuration
// encoder, and it is not cryptography. It IS, however, easy to get subtly
// wrong in a way that produces a pretty square nobody's phone can read — so it
// is verified module-for-module against an independent reference encoder
// (`segno`), whose output is committed as fixtures. A QR that does not scan is
// a control that does not work, which is worse than no control at all.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function generatorPolynomial(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data, ecLength) {
  const generator = generatorPolynomial(ecLength);
  const remainder = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i++) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
}

// BCH codes for the format and version areas.
//
// The format area is a (15, 5) BCH code, so its GENERATOR has degree 10 — it is
// eleven bits, not fifteen. Getting that wrong leaves the remainder unreduced,
// which produces a symbol whose data decodes perfectly and whose format area a
// real scanner cannot read at all. The round-trip test cannot catch it (our own
// reader makes the same mistake and stays self-consistent); comparing the
// format bits against an independent encoder can, and does.
const G15 = 0b10100110111;
const G15_MASK = 0b101010000010010;
/** The version area is an (18, 6) BCH code: generator degree 12. */
const G18 = 0b1111100100101;

const bchDigit = (value) => {
  let digit = 0;
  let rest = value;
  while (rest !== 0) { digit += 1; rest >>>= 1; }
  return digit;
};

function bchFormatInfo(data) {
  let value = data << 10;
  while (bchDigit(value) - bchDigit(G15) >= 0) {
    value ^= (G15 << (bchDigit(value) - bchDigit(G15)));
  }
  return ((data << 10) | value) ^ G15_MASK;
}

function bchVersionInfo(version) {
  let value = version << 12;
  while (bchDigit(value) - bchDigit(G18) >= 0) {
    value ^= (G18 << (bchDigit(value) - bchDigit(G18)));
  }
  return (version << 12) | value;
}

// Version 10-L: 57x57 modules, 346 total codewords in 4 blocks — two of
// (86, 68) and two of (87, 69), i.e. 18 error-correction codewords each and 274
// data codewords. Twenty of those bits are the mode indicator and the 16-bit
// length, leaving 271 bytes of payload.
const VERSION = 10;
const SIZE = 57;
const EC_PER_BLOCK = 18;
/** DATA codewords per block, not total block size. */
const BLOCKS = [68, 68, 69, 69];
const CAPACITY_BYTES = 271;
const ALIGNMENT = [6, 28, 50];
/** Error-correction level L, as the two bits the format area carries. */
const EC_LEVEL_BITS = 0b01;
const MASK_PATTERN = 0;

const maskAt = (row, col) => (row + col) % 2 === 0;

function setFunctionPatterns(modules) {
  const place = (rowOffset, colOffset) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = rowOffset + r;
        const col = colOffset + c;
        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
        modules[row][col] = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  };
  place(0, 0);
  place(0, SIZE - 7);
  place(SIZE - 7, 0);

  for (const row of ALIGNMENT) {
    for (const col of ALIGNMENT) {
      if (modules[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          modules[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }

  for (let i = 8; i < SIZE - 8; i++) {
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
  }
}

function setFormatInfo(modules) {
  const bits = bchFormatInfo((EC_LEVEL_BITS << 3) | MASK_PATTERN);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[SIZE - 15 + i][8] = bit;

    if (i < 8) modules[8][SIZE - i - 1] = bit;
    else if (i < 9) modules[8][15 - i - 1 + 1] = bit;
    else modules[8][15 - i - 1] = bit;
  }
  modules[SIZE - 8][8] = true; // the always-dark module
}

function setVersionInfo(modules) {
  const bits = bchVersionInfo(VERSION);
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    modules[Math.floor(i / 3)][(i % 3) + SIZE - 8 - 3] = bit;
    modules[(i % 3) + SIZE - 8 - 3][Math.floor(i / 3)] = bit;
  }
}

function encodePayload(bytes) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);            // byte mode
  push(bytes.length, 16);     // 16-bit length for version 10
  for (const byte of bytes) push(byte, 8);

  const totalData = BLOCKS.reduce((sum, size) => sum + size, 0);
  const capacityBits = totalData * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const padBytes = [0xec, 0x11];
  while (data.length < totalData) data.push(padBytes[(data.length - bits.length / 8) % 2]);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const dataLength of BLOCKS) {
    const block = data.slice(offset, offset + dataLength);
    offset += dataLength;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomon(block, EC_PER_BLOCK));
  }

  const interleaved = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < EC_PER_BLOCK; i++) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }
  return interleaved;
}

function placeData(modules, data) {
  let inc = -1;
  let row = SIZE - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (modules[row][col - c] !== null) continue;
        let dark = false;
        if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
        if (maskAt(row, col - c)) dark = !dark;
        modules[row][col - c] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) { byteIndex += 1; bitIndex = 7; }
      }
      row += inc;
      if (row < 0 || row >= SIZE) { row -= inc; inc = -inc; break; }
    }
  }
}

/**
 * @returns {number[][]|null} a 57x57 matrix of 0/1, or null when the text does
 *   not fit. Callers must handle null by showing the link instead — a QR that
 *   silently truncated its payload is worse than no QR.
 */
export function qrModules(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > CAPACITY_BYTES) return null;

  const modules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  setFunctionPatterns(modules);
  setVersionInfo(modules);
  setFormatInfo(modules);
  placeData(modules, encodePayload(bytes));
  return modules.map((row) => row.map((cell) => (cell ? 1 : 0)));
}

/** The function-pattern/format/version map, for verification against a reference. */
function reservedMap() {
  const modules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  setFunctionPatterns(modules);
  setVersionInfo(modules);
  setFormatInfo(modules);
  return modules.map((row) => row.map((cell) => cell !== null));
}

export const __testing = {
  VERSION, SIZE, CAPACITY_BYTES, EC_PER_BLOCK, BLOCKS,
  reedSolomon, gfMul, bchFormatInfo, bchVersionInfo, encodePayload, reservedMap, maskAt,
};
