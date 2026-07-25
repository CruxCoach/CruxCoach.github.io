#!/usr/bin/env node
// Builds boards/data/cities.json — the offline place index behind the board
// map's location search.
//
// Why this exists: the map's venue search filters the board dataset by text,
// so it can only find a city that some venue actually carries in its `city`
// field. Barely a third of the venues do, which means searching "New York"
// used to surface 2 of the 18 boards standing within 15 km of it. A place
// index fixes that from the other end — you jump the map to the place, and
// the clustering plus the "boards in view" list answer what is nearby, using
// geometry instead of patchy text fields.
//
// It stays a build-time script on purpose. Querying a live geocoder would
// send every keystroke and the visitor's IP to a third party, which the
// repository's "no external dependencies at runtime" rule forbids. A static
// JSON shipped from our own origin keeps that rule intact and works offline.
//
// Source: GeoNames (https://www.geonames.org/), CC BY 4.0. Attribution is
// required and lives in humans.txt, the privacy page, and cities.meta.json.
//
//   node tools/build-cities-data.mjs
//   node tools/build-cities-data.mjs --radius-km 250 --min-population 5000
//   node tools/build-cities-data.mjs --dataset cities5000
//
// Size is the whole design problem here. Every GeoNames city above 15k
// inhabitants is 34k places and 665 KiB gzipped — five times the board
// dataset itself, for a site whose colophon promises no build step and no
// weight. Three decisions bring that to roughly a quarter:
//
//   1. Prune by proximity. The index exists to find boards, so it only needs
//      fine resolution where boards stand. Small towns within RADIUS_KM of a
//      board are kept; elsewhere only cities above GLOBAL_POPULATION are, so
//      a visitor far from any board still lands somewhere sensible.
//   2. Two decimals of coordinate (~1.1 km). A place jump lands at zoom 11;
//      a kilometre of centroid error is invisible there.
//   3. No population column. Rows are written largest-first, so list order
//      already encodes the ranking the search needs.
//
// Output is a pure function of its inputs: no timestamp inside cities.json,
// so a rebuild that changes nothing produces no diff. Build provenance goes
// to cities.meta.json instead, exactly like the boards pipeline splits
// boards.geojson from boards.meta.json.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_BOARDS = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const OUT_CITIES = join(REPO_ROOT, 'boards', 'data', 'cities.json');
const OUT_META = join(REPO_ROOT, 'boards', 'data', 'cities.meta.json');
const DOWNLOAD_CACHE = join(tmpdir(), 'cruxcoach-build-deps', 'geonames');

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';
const ATTRIBUTION = 'GeoNames (https://www.geonames.org/), CC BY 4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

// Alternate spellings come from two places, merged. The bulk is the
// language-tagged alternateNamesV2 dump, which is the only GeoNames file that
// says *which* language a name belongs to — the per-city `alternatenames`
// column is unordered and untagged, so its first entries are airport codes and
// transliterations ("BJS", "Gaa Ding") rather than "Peking".
//
// On top sits this hand-curated overlay, in the same spirit as
// `overrides.json` and `wellpass.json`. It is applied first so it can correct
// the dump, and entries matching no city are reported, so an upstream rename
// surfaces as a warning instead of silently doing nothing.
//
// Both matter because GeoNames is inconsistent about which form is primary: it
// stores "Munich", "Vienna" and "Prague" in English but "Köln", "Zürich" and
// "Sevilla" locally.
const EXONYMS_FILE = join(REPO_ROOT, 'tools', 'city-exonyms.json');

// ── ZIP reading ─────────────────────────────────────────────────────────
// GeoNames ships .zip and Node has no zip reader, but a ZIP is just a
// central directory pointing at deflate streams, and zlib gives us those.
// Shelling out to `unzip` would add a system dependency the boards pipeline
// does not have; ~40 lines of header parsing keeps the script portable.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

function findEndOfCentralDirectory(buf) {
  // The EOCD sits at the very end, after an optional comment of up to 64 KiB.
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record');
}

export function readZipEntry(buf, wantedName) {
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error(`corrupt ZIP: bad central directory header at ${pos}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    if (name === wantedName) {
      // The local header repeats the name/extra lengths, and its extra field
      // may differ in length from the central one — always re-read it here.
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.subarray(start, start + compressedSize);
      if (method === 0) return raw;                 // stored
      if (method === 8) return inflateRawSync(raw); // deflate
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found in ZIP: ${wantedName}`);
}

// ── Streaming ZIP reading ───────────────────────────────────────────────
// The language-tagged name dump is 193 MB compressed and roughly a gigabyte
// unpacked, so it cannot go through readZipEntry() — that materialises the
// whole entry as a Buffer. Instead we read only the central directory to find
// where the entry's bytes start, then stream that byte range through inflate
// and hand out lines. Memory stays flat regardless of dump size.

async function locateZipEntry(path, wantedName) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record');

    const entryCount = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);

    let pos = 0;
    for (let i = 0; i < entryCount; i++) {
      if (cd.readUInt32LE(pos) !== SIG_CENTRAL) {
        throw new Error(`corrupt ZIP: bad central directory header at ${pos}`);
      }
      const method = cd.readUInt16LE(pos + 10);
      const compressedSize = cd.readUInt32LE(pos + 20);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const localOffset = cd.readUInt32LE(pos + 42);
      const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen);

      if (name === wantedName) {
        const lh = Buffer.alloc(30);
        await fh.read(lh, 0, 30, localOffset);
        const start = localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        return { start, end: start + compressedSize - 1, method };
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`entry not found in ZIP: ${wantedName}`);
  } finally {
    await fh.close();
  }
}

async function eachZipLine(path, entryName, onLine) {
  const { start, end, method } = await locateZipEntry(path, entryName);
  if (method !== 0 && method !== 8) {
    throw new Error(`unsupported ZIP compression method ${method}`);
  }
  const raw = createReadStream(path, { start, end });
  const input = method === 8 ? raw.pipe(createInflateRaw()) : raw;
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

// ── Download ────────────────────────────────────────────────────────────

async function fetchCached(fileName) {
  const cached = join(DOWNLOAD_CACHE, fileName);
  if (existsSync(cached)) {
    process.stderr.write(`[cities] using cached ${fileName}\n`);
    return readFileSync(cached);
  }
  const url = `${GEONAMES_BASE}/${fileName}`;
  process.stderr.write(`[cities] downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(DOWNLOAD_CACHE, { recursive: true });
  writeFileSync(cached, buf);
  return buf;
}

// Same cache, but never holds the payload in memory — used for the 193 MB
// name dump, where an arrayBuffer() would be a needless 193 MB allocation.
async function fetchCachedToDisk(fileName) {
  const cached = join(DOWNLOAD_CACHE, fileName);
  if (existsSync(cached)) {
    process.stderr.write(`[cities] using cached ${fileName}\n`);
    return cached;
  }
  const url = `${GEONAMES_BASE}/${fileName}`;
  process.stderr.write(`[cities] downloading ${url} (large, cached for later runs)\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  mkdirSync(DOWNLOAD_CACHE, { recursive: true });
  const partial = `${cached}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
  // Rename only once complete, so an interrupted run cannot leave a truncated
  // file that later runs would happily treat as cached.
  const { rename } = await import('node:fs/promises');
  await rename(partial, cached);
  return cached;
}

// ── Parsing ─────────────────────────────────────────────────────────────

// Same normalization the map's search uses, so what we filter here matches
// what the browser compares against: lowercase, diacritics stripped, ß→ss.
export function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

// GeoNames dumps are tab-separated with a fixed column order and no header.
const COL = {
  id: 0, name: 1, asciiName: 2, lat: 4, lon: 5,
  country: 8, admin1: 10, population: 14,
};

export function parseCityLine(line) {
  const c = line.split('\t');
  if (c.length < 15) return null;
  const name = c[COL.name].trim();
  const country = c[COL.country].trim();
  const lat = Number(c[COL.lat]);
  const lon = Number(c[COL.lon]);
  if (!name || !country) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    id: c[COL.id].trim(),
    name,
    asciiName: c[COL.asciiName].trim(),
    country,
    admin1: c[COL.admin1].trim(),
    lat,
    lon,
    population: Number(c[COL.population]) || 0,
  };
}

// Index the curated overlay by the same name+country key the cities carry,
// dropping spellings the primary name already covers (an entry listing
// "Dusseldorf" behind "Düsseldorf" is redundant — the search normalizes
// diacritics on both sides anyway).
export function indexExonyms(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.name || !entry.country || !Array.isArray(entry.also)) continue;
    const key = `${normalizeText(entry.name)}|${entry.country}`;
    const seen = new Set([normalizeText(entry.name)]);
    const also = [];
    for (const alt of entry.also) {
      const norm = normalizeText(alt);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      also.push(alt);
    }
    if (also.length) map.set(key, also);
  }
  return map;
}

// ── Language-tagged alternate names ─────────────────────────────────────
// This is what makes every city findable in both site languages, not just
// the ~90 in the curated overlay. GeoNames' per-city `alternatenames` column
// is unusable for it (unordered, untagged — the first entries are airport
// codes), but alternateNamesV2 carries an ISO language column, so we can ask
// for exactly "the German name" and "the English name" of each city.
//
// The dump covers every GeoNames feature, ~16 million rows, so the hot path
// matters: slice out the language field by tab offsets and bail before
// splitting the row when it is not one of ours. That skips ~95% of the file
// without allocating.
const ALT_LANGS = ['de', 'en'];

// Preference inside one language: GeoNames' own "preferred" flag wins, then
// the short form, then whatever came first.
function altRank(isPreferred, isShort) {
  if (isPreferred === '1') return 0;
  if (isShort === '1') return 1;
  return 2;
}

export function parseAlternateLine(line, wantedIds) {
  const t1 = line.indexOf('\t');
  if (t1 < 0) return null;
  const t2 = line.indexOf('\t', t1 + 1);
  if (t2 < 0) return null;
  const t3 = line.indexOf('\t', t2 + 1);
  if (t3 < 0) return null;

  const lang = line.slice(t2 + 1, t3);
  if (lang !== 'de' && lang !== 'en') return null;

  const id = line.slice(t1 + 1, t2);
  if (wantedIds && !wantedIds.has(id)) return null;

  const rest = line.slice(t3 + 1).split('\t');
  const name = (rest[0] || '').trim();
  if (!name) return null;
  // rest: [name, isPreferredName, isShortName, isColloquial, isHistoric, ...]
  if (rest[3] === '1') return null; // colloquial
  if (rest[4] === '1') return null; // historic
  return { id, lang, name, rank: altRank(rest[1], rest[2]) };
}

async function collectAlternateNames(zipPath, wantedIds) {
  const best = new Map(); // geonameid → { de?: {name, rank}, en?: {name, rank} }
  let scanned = 0;
  await eachZipLine(zipPath, 'alternateNamesV2.txt', (line) => {
    scanned++;
    const row = parseAlternateLine(line, wantedIds);
    if (!row) return;
    let entry = best.get(row.id);
    if (!entry) { entry = {}; best.set(row.id, entry); }
    const current = entry[row.lang];
    if (!current || row.rank < current.rank) {
      entry[row.lang] = { name: row.name, rank: row.rank };
    }
  });
  return { best, scanned };
}

// The German form gets a slot of its own rather than being thrown in with the
// search aliases, because the /de/ pages have to *display* it: a venue near
// Munich must read "bei München" there, not "bei Munich". Returns '' when
// German agrees with the primary name, which is the common case.
export function pickGermanName(primaryName, fromDump) {
  const de = fromDump && fromDump.de && fromDump.de.name;
  if (!de) return '';
  return normalizeText(de) === normalizeText(primaryName) ? '' : de;
}

// Fold the remaining spellings into one search-alias list. Anything that
// normalizes to a form already covered is dropped — the search strips
// diacritics on both sides, so "Muenchen" behind "München" would be dead
// weight, and the German name is already carried separately.
export function mergeAlternates(primaryName, candidates, limit = 3, covered = []) {
  const seen = new Set([normalizeText(primaryName)]);
  for (const name of covered) {
    if (name) seen.add(normalizeText(name));
  }
  const out = [];
  for (const name of candidates || []) {
    if (out.length >= limit) break;
    if (!name) continue;
    const norm = normalizeText(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

// Positional rows keep the file small, so drop optional trailing fields that
// carry nothing rather than writing '' and [] on every line.
export function trimRow(row) {
  const out = row.slice();
  while (out.length > 4) {
    const last = out[out.length - 1];
    const empty = last === '' || last == null || (Array.isArray(last) && last.length === 0);
    if (!empty) break;
    out.pop();
  }
  return out;
}

// A region label is only useful where it resolves an ambiguity: "Berlin, US"
// is unhelpful, "Berlin, New Hampshire" is not. Tagging every city with its
// admin1 name would inflate the file to say "Bavaria" behind a München that
// nothing collides with, so we attach the label only to names that repeat
// within their country.
export function markAmbiguous(cities) {
  const counts = new Map();
  for (const c of cities) {
    const key = `${normalizeText(c.name)}|${c.country}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const c of cities) {
    c.ambiguous = counts.get(`${normalizeText(c.name)}|${c.country}`) > 1;
  }
  return cities;
}

export function parseAdmin1(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 2) continue;
    map.set(c[0], c[1].trim()); // "DE.02" → "Bavaria"
  }
  return map;
}

// ── Proximity pruning ───────────────────────────────────────────────────

export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// A 1° cell index over the board coordinates. Checking 34k cities against
// 2.8k boards is 95M haversines brute-force; bucketing makes it a handful of
// cells per city and the whole build finishes in about a second.
export function buildBoardIndex(features) {
  const grid = new Map();
  for (const f of features) {
    const coords = f && f.geometry && f.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${Math.floor(lat)}:${Math.floor(lon)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([lat, lon]);
  }
  return grid;
}

export function hasBoardWithin(grid, lat, lon, km) {
  // One degree of latitude is ~111 km; one of longitude is never more. Widen
  // the cell window by that ratio and let the exact haversine decide.
  const span = Math.ceil(km / 111) + 1;
  const baseLat = Math.floor(lat);
  const baseLon = Math.floor(lon);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const cell = grid.get(`${baseLat + dy}:${baseLon + dx}`);
      if (!cell) continue;
      for (const [blat, blon] of cell) {
        if (haversineKm(lat, lon, blat, blon) <= km) return true;
      }
    }
  }
  return false;
}

// ── Build ───────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    minPopulation: 15000,
    globalPopulation: 200000,
    radiusKm: 100,
    dataset: 'cities15000',
    alternates: true,
  };
  const number = (raw, flag) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${flag} needs a non-negative number`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-population') {
      opts.minPopulation = number(argv[++i], '--min-population');
    } else if (argv[i] === '--global-population') {
      opts.globalPopulation = number(argv[++i], '--global-population');
    } else if (argv[i] === '--radius-km') {
      opts.radiusKm = number(argv[++i], '--radius-km');
    } else if (argv[i] === '--no-alternates') {
      opts.alternates = false;
    } else if (argv[i] === '--dataset') {
      const v = String(argv[++i] || '');
      if (!/^cities(500|1000|5000|15000)$/.test(v)) {
        throw new Error('--dataset must be one of cities500, cities1000, cities5000, cities15000');
      }
      opts.dataset = v;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(IN_BOARDS)) {
    throw new Error(`missing ${IN_BOARDS} — run tools/build-boards-data.mjs first`);
  }
  const boards = JSON.parse(readFileSync(IN_BOARDS, 'utf8'));
  const boardGrid = buildBoardIndex(boards.features || []);

  const cityZip = await fetchCached(`${opts.dataset}.zip`);
  const cityText = readZipEntry(cityZip, `${opts.dataset}.txt`).toString('utf8');
  // Unlike the city dumps, this one is served as a plain .txt.
  const admin1 = parseAdmin1((await fetchCached('admin1CodesASCII.txt')).toString('utf8'));

  const cities = [];
  let skipped = 0;
  let nearBoard = 0;
  for (const line of cityText.split('\n')) {
    if (!line.trim()) continue;
    const city = parseCityLine(line);
    if (!city) { skipped++; continue; }
    if (city.population < opts.minPopulation) continue;
    const near = hasBoardWithin(boardGrid, city.lat, city.lon, opts.radiusKm);
    if (!near && city.population < opts.globalPopulation) continue;
    if (near) nearBoard++;
    cities.push(city);
  }
  markAmbiguous(cities);

  // Largest first: the search ranks by list order within equal match
  // quality, so "berlin" offers Berlin, DE before Berlin, New Hampshire.
  cities.sort((a, b) =>
    b.population - a.population ||
    a.name.localeCompare(b.name) ||
    a.country.localeCompare(b.country));

  const exonyms = indexExonyms(JSON.parse(readFileSync(EXONYMS_FILE, 'utf8')));
  const usedExonyms = new Set();

  // Pull the German and English name of every city that survived pruning.
  let dumpNames = new Map();
  let dumpScanned = 0;
  if (opts.alternates) {
    const wantedIds = new Set(cities.map((c) => c.id));
    const zipPath = await fetchCachedToDisk('alternateNamesV2.zip');
    process.stderr.write(`[cities] scanning alternate names for ${wantedIds.size} cities…\n`);
    const collected = await collectAlternateNames(zipPath, wantedIds);
    dumpNames = collected.best;
    dumpScanned = collected.scanned;
    process.stderr.write(`[cities] scanned ${dumpScanned.toLocaleString('en')} rows, matched ${dumpNames.size} cities\n`);
  } else {
    process.stderr.write('[cities] WARNING --no-alternates: output will carry only the curated exonyms\n');
  }

  let withRegion = 0;
  let withAlternates = 0;
  let withGerman = 0;
  const rows = cities.map((c) => {
    const region = c.ambiguous ? (admin1.get(`${c.country}.${c.admin1}`) || '') : '';
    const exonymKey = `${normalizeText(c.name)}|${c.country}`;
    const curated = exonyms.get(exonymKey);
    if (curated) usedExonyms.add(exonymKey);

    const dump = dumpNames.get(c.id);
    const germanName = pickGermanName(c.name, dump);
    const candidates = (curated || []).concat(dump && dump.en ? [dump.en.name] : []);
    const alternates = mergeAlternates(c.name, candidates, 3, [germanName]);

    if (region) withRegion++;
    if (alternates.length) withAlternates++;
    if (germanName) withGerman++;

    return trimRow([
      c.name, c.country,
      Number(c.lat.toFixed(2)), Number(c.lon.toFixed(2)),
      region, alternates, germanName,
    ]);
  });

  // One row per line: readable diffs in review, and still valid JSON.
  const body = rows.map((r) => '    ' + JSON.stringify(r)).join(',\n');
  const json = '{\n' +
    `  "fields": ${JSON.stringify(['name', 'country', 'lat', 'lon', 'region?', 'alternates?', 'name_de?'])},\n` +
    `  "attribution": ${JSON.stringify(ATTRIBUTION)},\n` +
    `  "license": ${JSON.stringify(LICENSE_URL)},\n` +
    '  "cities": [\n' + body + '\n  ]\n}\n';
  writeFileSync(OUT_CITIES, json);

  // A curated entry that matches nothing is almost always an upstream
  // rename, not a typo we want to keep shipping silently.
  const unmatched = [...exonyms.keys()].filter((k) => !usedExonyms.has(k));
  for (const key of unmatched) {
    process.stderr.write(`[cities] warning: no city matches exonym entry ${key}\n`);
  }

  const meta = {
    generated_at: new Date().toISOString(),
    source: `${GEONAMES_BASE}/${opts.dataset}.zip`,
    attribution: ATTRIBUTION,
    license: LICENSE_URL,
    dataset: opts.dataset,
    min_population: opts.minPopulation,
    global_population: opts.globalPopulation,
    radius_km: opts.radiusKm,
    alternates_from_dump: opts.alternates,
    alternate_rows_scanned: dumpScanned,
    alternate_cities_matched: dumpNames.size,
    exonym_entries: exonyms.size,
    exonym_entries_unmatched: unmatched,
    cities: rows.length,
    cities_near_a_board: nearBoard,
    cities_with_region: withRegion,
    cities_with_alternates: withAlternates,
    cities_with_german_name: withGerman,
    malformed_lines_skipped: skipped,
    bytes: Buffer.byteLength(json),
  };
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

  process.stderr.write(
    `[cities] ${rows.length} places → ${(meta.bytes / 1024).toFixed(0)} KiB uncompressed ` +
    `(${nearBoard} within ${opts.radiusKm} km of a board, ${withRegion} disambiguated, ` +
    `${withAlternates} with alternate names, ${skipped} malformed lines skipped)\n`);
}

// Only run when invoked directly, so the unit tests can import the helpers.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[cities] ${err.message}\n`);
    process.exit(1);
  });
}
