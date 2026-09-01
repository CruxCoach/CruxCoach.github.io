#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { haversineKm } from './build-cities-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://www.google.com/maps/d/kml?mid=193vm5XWh8uVnqQS71aVd130TNV2JkDnA&forcekml=1';
const MAP_RADIUS_KM = 0.1;

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(
      code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10),
    ))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFKC').replace(/\s+/g, ' ').trim()
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
}

export function parseKml(xml) {
  const rows = [];
  for (const match of xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const block = match[1];
    const name = block.match(/<name>([\s\S]*?)<\/name>/);
    const coordinate = block.match(/<coordinates>\s*([-+\d.]+),([-+\d.]+)/);
    if (!name || !coordinate) continue;
    const lon = Number(coordinate[1]);
    const lat = Number(coordinate[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    rows.push({ name: decodeXml(name[1]), lat, lon });
  }
  return rows;
}

function normalizeName(value) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').toLocaleLowerCase('en');
}

function closest(point, rows) {
  let answer = null;
  for (const row of rows) {
    const km = haversineKm(point.lat, point.lon, row.lat, row.lon);
    if (!answer || km < answer.km) answer = { row, km };
  }
  return answer;
}

export function auditLocations(pins, decisions, mapVenues = []) {
  const validStatuses = new Set(['published', 'non-public', 'unverified']);
  const errors = [];
  decisions.forEach((row, index) => {
    if (!row || typeof row.name !== 'string' || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)
      || !validStatuses.has(row.status)) errors.push(`decision ${index} is malformed`);
  });
  const live = [];
  const changed = [];
  const unmatchedDecisions = new Set(decisions);
  for (const pin of pins) {
    const nearby = closest(pin, decisions);
    if (!nearby || nearby.km > 0.002) {
      live.push({ ...pin, status: 'new' });
      continue;
    }
    unmatchedDecisions.delete(nearby.row);
    if (normalizeName(pin.name) !== normalizeName(nearby.row.name)) {
      changed.push({ ...pin, previous_name: nearby.row.name, status: nearby.row.status });
      continue;
    }
    live.push({ ...pin, status: nearby.row.status });
  }

  const accidentallyPublished = [];
  const missingPublished = [];
  for (const row of decisions) {
    const mapped = closest(row, mapVenues);
    const onMap = Boolean(mapped && mapped.km <= MAP_RADIUS_KM);
    if (row.status === 'published' && !onMap) missingPublished.push(row);
    if (row.status !== 'published' && onMap) accidentallyPublished.push({ ...row, map_name: mapped.row.name });
  }
  const counts = { published: 0, 'non-public': 0, unverified: 0, new: 0 };
  live.forEach(row => { counts[row.status] = (counts[row.status] ?? 0) + 1; });
  return {
    counts,
    rows: pins.length,
    malformed_decisions: errors,
    changed,
    new: live.filter(row => row.status === 'new'),
    missing: [...unmatchedDecisions],
    missing_published: missingPublished,
    accidentally_published: accidentallyPublished,
  };
}

function mapVenues() {
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  return geojson.features.filter(feature => feature.properties.boards.some(row => row.board === '12climb'))
    .map(feature => ({ name: feature.properties.name, lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0] }));
}

async function sourceText(argv) {
  const index = argv.indexOf('--input');
  if (index !== -1) {
    if (!argv[index + 1]) throw new Error('--input needs a KML file');
    return readFileSync(argv[index + 1], 'utf8');
  }
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`12Climb KML answered HTTP ${response.status}`);
  return response.text();
}

function hasIssues(audit) {
  return audit.malformed_decisions.length || audit.changed.length || audit.new.length
    || audit.missing.length || audit.missing_published.length || audit.accidentally_published.length;
}

if (process.argv[1] && process.argv[1].endsWith('12climb-locations-audit.mjs')) {
  const pins = parseKml(await sourceText(process.argv.slice(2)));
  if (!pins.length) throw new Error('12Climb KML contains no readable placemarks');
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/12climb-location-decisions.json'), 'utf8'));
  const audit = auditLocations(pins, decisions, mapVenues());
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else {
    process.stdout.write(`12Climb manufacturer KML audit: ${audit.rows} rows; ${audit.counts.published} published, ${audit.counts['non-public']} non-public, ${audit.counts.unverified} unverified, ${audit.counts.new} new\n`);
    if (hasIssues(audit)) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  }
  if (hasIssues(audit)) process.exitCode = 1;
}
