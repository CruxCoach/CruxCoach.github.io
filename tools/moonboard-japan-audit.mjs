#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALID_STATUSES = new Set([
  'pending', 'current', 'unverified', 'closed', 'private', 'ambiguous', 'mislocated',
]);
const EXCLUDED_STATUSES = new Set(['closed', 'mislocated']);

function normalize(value) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ja');
}

function key(row) {
  return `${Number(row.lat).toFixed(4)},${Number(row.lon).toFixed(4)}`;
}

export function mapInventory(geojson) {
  const venues = geojson.features.filter(feature => feature.properties.country === 'JP'
    && feature.properties.boards.some(board => board.board === 'moonboard'))
    .map(feature => ({
      name: feature.properties.name,
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0],
      board_rows: feature.properties.boards.filter(board => board.board === 'moonboard').length,
    }));
  return {
    venues,
    rawBoardRows: venues.reduce((total, venue) => total + venue.board_rows, 0),
  };
}

export function auditInventory(inventory, decisions, exclusions = []) {
  const validFields = new Set(['name', 'lat', 'lon', 'status', 'sources', 'note']);
  const malformed = [];
  const decisionKeys = new Map();

  decisions.forEach((row, index) => {
    if (!row || typeof row.name !== 'string' || !row.name.trim()
      || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)
      || !VALID_STATUSES.has(row.status)) {
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
    const rowKey = key(row);
    if (decisionKeys.has(rowKey)) malformed.push(`duplicate decision ${index}`);
    decisionKeys.set(rowKey, row);
  });

  const backedExclusions = new Set(exclusions
    .filter(row => EXCLUDED_STATUSES.has(row?.status))
    .map(row => `${key(row)}|${normalize(row.name)}|${row.status}`));
  const stale = decisions.filter(row => !inventory.venues.some(venue => key(venue) === key(row)
    && normalize(venue.name) === normalize(row.name))
    && !backedExclusions.has(`${key(row)}|${normalize(row.name)}|${row.status}`));
  const unknownMapVenues = inventory.venues.filter(venue => !decisions.some(row => key(venue) === key(row)
    && normalize(venue.name) === normalize(row.name)));
  const counts = Object.fromEntries([...VALID_STATUSES].map(status => [status, 0]));
  decisions.forEach(row => { if (VALID_STATUSES.has(row.status)) counts[row.status] += 1; });

  return {
    venues: inventory.venues.length,
    rawBoardRows: inventory.rawBoardRows,
    counts,
    malformed,
    stale,
    unknownMapVenues,
  };
}

if (process.argv[1]?.endsWith('moonboard-japan-audit.mjs')) {
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/moonboard-japan-decisions.json'), 'utf8'));
  const exclusions = JSON.parse(readFileSync(join(ROOT, 'tools/location-exclusions.json'), 'utf8'));
  const audit = auditInventory(mapInventory(geojson), decisions, exclusions);
  process.stdout.write(`Japanese MoonBoard production audit: ${audit.venues} venues; ${audit.rawBoardRows} board rows; ${audit.counts.current} current; ${audit.counts.pending} pending\n`);
  if (process.argv.includes('--json') || audit.malformed.length || audit.stale.length
    || audit.unknownMapVenues.length) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (audit.malformed.length || audit.stale.length || audit.unknownMapVenues.length) process.exitCode = 1;
}
