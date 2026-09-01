#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://gist.githubusercontent.com/joel0807/7efe3cbe275e6f6b8c707fa0738b2bb5/raw/moon_year.csv';

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCandidates(text) {
  const rows = csvRows(text);
  if (rows[0]?.map(value => value.trim()).join('|') !== '지역|상호명|네이버지도링크|연도') {
    throw new Error('unexpected Korean MoonBoard CSV header');
  }
  return rows.slice(1).filter(row => row.some(Boolean)).map((row, index) => {
    if (row.length !== 4) throw new Error(`candidate row ${index + 2} has ${row.length} fields`);
    const region = row[0].normalize('NFKC').trim();
    const name = row[1].normalize('NFKC').replace(/\s+/g, ' ').trim();
    const generation = Number(row[3]);
    if (!region || !name || ![2016, 2017, 2024].includes(generation)) {
      throw new Error(`candidate row ${index + 2} is malformed`);
    }
    // Deliberately discard the commercial-map URL. This file is discovery
    // inventory only; coordinates must come from an independently acceptable
    // source before a venue can be published.
    return { region, name, generation };
  });
}

function key(row) { return `${row.region}\u0000${row.name}\u0000${row.generation}`; }
function normalize(value) { return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko'); }

export function auditCandidates(candidates, decisions, mapVenues = []) {
  const validStatuses = new Set(['pending', 'published', 'unverified', 'social-only', 'closed', 'ambiguous']);
  const validFields = new Set([
    'region', 'name', 'generation', 'status', 'sources', 'note',
    'map_name', 'lat', 'lon',
  ]);
  const malformed = [];
  const decisionKeys = new Map();
  decisions.forEach((row, index) => {
    if (!row || typeof row.region !== 'string' || typeof row.name !== 'string'
      || ![2016, 2017, 2024].includes(row.generation) || !validStatuses.has(row.status)) {
      malformed.push(`decision ${index} is malformed`);
      return;
    }
    for (const field of Object.keys(row)) {
      if (!validFields.has(field)) malformed.push(`decision ${index} has unknown field ${field}`);
    }
    if (row.status === 'pending') {
      if (row.sources !== undefined || row.note !== undefined) {
        malformed.push(`pending decision ${index} must not claim evidence`);
      }
    } else {
      if (!Array.isArray(row.sources) || !row.sources.length
        || row.sources.some(source => typeof source !== 'string' || !source.startsWith('https://'))) {
        malformed.push(`decided decision ${index} needs HTTPS sources`);
      }
      if (typeof row.note !== 'string' || !row.note.trim()) {
        malformed.push(`decided decision ${index} needs a note`);
      }
    }
    if (row.status === 'published' && (!Number.isFinite(row.lat) || !Number.isFinite(row.lon))) {
      malformed.push(`published decision ${index} has no coordinate`);
    }
    const rowKey = key(row);
    if (decisionKeys.has(rowKey)) malformed.push(`duplicate decision ${index}`);
    decisionKeys.set(rowKey, row);
  });

  const sourceKeys = new Set(candidates.map(key));
  const missing = candidates.filter(row => !decisionKeys.has(key(row)));
  const stale = decisions.filter(row => !sourceKeys.has(key(row)));
  const counts = Object.fromEntries([...validStatuses].map(status => [status, 0]));
  decisions.forEach(row => { if (validStatuses.has(row.status)) counts[row.status] += 1; });

  const missingPublished = [];
  const accidentallyPublished = [];
  for (const decision of decisions) {
    const mapName = decision.map_name ?? decision.name;
    const mapped = mapVenues.find(row => normalize(row.name) === normalize(mapName));
    if (decision.status === 'published' && !mapped) missingPublished.push(decision);
    if (decision.status !== 'published' && mapped) accidentallyPublished.push({ ...decision, map_name: mapped.name });
  }
  const unknownMapVenues = mapVenues.filter(venue => !decisions.some(decision => {
    const mapName = decision.map_name ?? decision.name;
    return decision.status === 'published' && normalize(mapName) === normalize(venue.name);
  }));
  return { rows: candidates.length, counts, malformed, missing, stale, missingPublished, accidentallyPublished, unknownMapVenues };
}

function mapVenues() {
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  return geojson.features.filter(feature => feature.properties.country === 'KR'
    && feature.properties.boards.some(row => row.board === 'moonboard'))
    .map(feature => ({ name: feature.properties.name, lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0] }));
}

function hasIssues(audit) {
  return audit.malformed.length || audit.missing.length || audit.stale.length
    || audit.missingPublished.length || audit.accidentallyPublished.length;
}

if (process.argv[1]?.endsWith('moonboard-korea-audit.mjs')) {
  const inputIndex = process.argv.indexOf('--input');
  let source;
  if (inputIndex !== -1) source = readFileSync(process.argv[inputIndex + 1], 'utf8');
  else {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Korean MoonBoard CSV answered HTTP ${response.status}`);
    source = await response.text();
  }
  const candidates = parseCandidates(source);
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/moonboard-korea-decisions.json'), 'utf8'));
  const audit = auditCandidates(candidates, decisions, mapVenues());
  process.stdout.write(`Korean MoonBoard candidate audit: ${audit.rows} boards; ${new Set(candidates.map(row => row.name)).size} named venues; ${audit.counts.published} reconciled as published; ${audit.counts.pending} pending; ${audit.unknownMapVenues.length} production rows not yet reconciled\n`);
  if (process.argv.includes('--json') || hasIssues(audit)) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (hasIssues(audit)) process.exitCode = 1;
}
