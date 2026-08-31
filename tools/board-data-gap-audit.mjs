#!/usr/bin/env node
// Reproducible, read-only completeness audit for the committed Board Map data.
//
//   node tools/board-data-gap-audit.mjs
//   node tools/board-data-gap-audit.mjs --json
//
// This deliberately reports gaps instead of guessing how to fill them. Primary
// evidence and curator decisions continue to live in the source/overlay files.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classifyVenue, venueKey } from './venue-links.mjs';
import { RETRYABLE_HOURS, RETRYABLE_WEBSITE } from './venue-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const missing = value => value == null || value === '' || (Array.isArray(value) && value.length === 0);

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const value = String(row?.[field] ?? 'missing');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function summarizeBoard(id, rows) {
  const venues = new Set(rows.map(({ feature }) => {
    const [lon, lat] = feature.geometry.coordinates;
    return venueKey(lat, lon);
  }));
  const publicClass = { commercial: 0, unknown: 0, private: 0 };
  for (const { feature } of rows) publicClass[classifyVenue(feature.properties)]++;
  const out = {
    entries: rows.length,
    venues: venues.size,
    venue_class: publicClass,
    venue_fields: {
      country_missing: rows.filter(({ feature }) => missing(feature.properties.country)).length,
      city_exact: rows.filter(({ feature }) => !missing(feature.properties.city)).length,
      city_nearest_only: rows.filter(({ feature }) => missing(feature.properties.city) && !missing(feature.properties.city_nearest)).length,
      city_missing: rows.filter(({ feature }) => missing(feature.properties.city) && missing(feature.properties.city_nearest)).length,
      website_missing: rows.filter(({ feature }) => missing(feature.properties.website)).length,
      hours_missing: rows.filter(({ feature }) => missing(feature.properties.hours)).length,
      wellpass_unknown: rows.filter(({ feature }) => feature.properties.wellpass == null).length,
    },
  };
  if (id === 'kilter') {
    out.board_fields = {
      address_missing: rows.filter(({ board }) => missing(board.address)).length,
      walls_missing: rows.filter(({ board }) => missing(board.walls)).length,
      wall_records: rows.reduce((n, { board }) => n + (board.walls?.length ?? 0), 0),
    };
  } else if (id === 'moonboard') {
    out.board_fields = {
      variant_missing: rows.filter(({ board }) => missing(board.variant)).length,
      angle_missing: rows.filter(({ board }) => missing(board.angle)).length,
      commercial_true: rows.filter(({ board }) => board.commercial === true).length,
      commercial_false: rows.filter(({ board }) => board.commercial === false).length,
      led_true: rows.filter(({ board }) => board.led === true).length,
    };
  } else if (id === 'quantum') {
    out.board_fields = {
      address_missing: rows.filter(({ board }) => missing(board.address)).length,
      models_missing: rows.filter(({ board }) => missing(board.models)).length,
    };
  } else if (id !== '12climb') {
    out.board_fields = { username_missing: rows.filter(({ board }) => missing(board.username)).length };
  }
  return out;
}

export function buildAudit() {
  const geo = readJson('boards/data/boards.geojson');
  const meta = readJson('boards/data/boards.meta.json');
  const linkResearch = readJson('tools/venue-links-research.json');
  const hoursResearch = readJson('tools/venue-hours-research.json');
  const ledger = readJson('tools/venue-audit-ledger.json');
  const links = readJson('tools/venue-links.json');
  const hours = readJson('tools/venue-hours.json');
  const wellpass = readJson('tools/wellpass.json');
  const overrides = readJson('tools/overrides.json');
  const exclusions = readJson('tools/location-exclusions.json');

  const features = geo.features ?? [];
  const boardRows = new Map();
  for (const feature of features) {
    for (const board of feature.properties?.boards ?? []) {
      if (!boardRows.has(board.board)) boardRows.set(board.board, []);
      boardRows.get(board.board).push({ feature, board });
    }
  }
  const perBoard = {};
  for (const [id, rows] of [...boardRows].sort((a, b) => a[0].localeCompare(b[0]))) {
    perBoard[id] = summarizeBoard(id, rows);
  }

  const classes = countBy(features.map(f => ({ value: classifyVenue(f.properties) })), 'value');
  const invalidCoordinates = features.filter(f => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180;
  });
  const nullIsland = features.filter(f => {
    const [lon, lat] = f.geometry.coordinates;
    return lat === 0 && lon === 0;
  });
  const sameBoardAtVenue = features.filter(f => {
    const ids = (f.properties.boards ?? []).map(b => b.board);
    return new Set(ids).size !== ids.length;
  });

  const adverse = [...linkResearch, ...hoursResearch]
    .filter(r => r.status === 'closed' || r.status === 'duplicate' || r.status === 'mislocated');
  const adverseByKey = new Map();
  for (const row of adverse) {
    const key = venueKey(row.lat, row.lon);
    if (!adverseByKey.has(key) || row.status === 'duplicate' || row.status === 'mislocated') adverseByKey.set(key, row.status);
  }
  const staleMarkers = features.filter(f => {
    const [lon, lat] = f.geometry.coordinates;
    return adverseByKey.has(venueKey(lat, lon));
  }).map(f => {
    const [lon, lat] = f.geometry.coordinates;
    return { name: f.properties.name, country: f.properties.country ?? null, lat, lon,
      status: adverseByKey.get(venueKey(lat, lon)), boards: f.properties.boards.map(b => b.board) };
  });

  const retry = ledger.items.filter(row =>
    (row.website && RETRYABLE_WEBSITE.has(row.website.result))
    || (row.hours && RETRYABLE_HOURS.has(row.hours.result)));
  const pending = ledger.items.filter(row => row.website?.result === 'pending' || row.hours?.result === 'pending');

  const eligible = features.filter(f => classifyVenue(f.properties) !== 'private').length;

  return {
    audit: 'board-data-gap-audit',
    dataset_generated_at: meta.generated_at,
    totals: {
      venues: features.length,
      board_entries: Object.values(perBoard).reduce((n, row) => n + row.entries, 0),
      multi_board_venues: meta.venues_with_multiple_boards,
      venue_class: classes,
      country_missing: features.filter(f => missing(f.properties.country)).length,
      city_exact: features.filter(f => !missing(f.properties.city)).length,
      city_nearest_only: features.filter(f => missing(f.properties.city) && !missing(f.properties.city_nearest)).length,
      city_missing: features.filter(f => missing(f.properties.city) && missing(f.properties.city_nearest)).length,
    },
    per_board: perBoard,
    sources: meta.sources,
    overlays: {
      websites: { defined: links.length, eligible, applied: meta.venue_links?.applied ?? 0 },
      hours: { defined: hours.length, applied: meta.venue_hours?.applied ?? 0 },
      wellpass: { defined: wellpass.length, applied: meta.wellpass?.applied ?? 0 },
      overrides: { defined: overrides.length, applied: meta.overrides?.applied ?? 0 },
      exclusions: { defined: exclusions.length, ...meta.exclusions },
    },
    research: {
      website_outcomes: countBy(linkResearch, 'status'),
      hours_outcomes: countBy(hoursResearch, 'status'),
      ledger_items: ledger.items.length,
      retry_queue: retry.length,
      pending_items: pending.length,
      retry_by_country: countBy(retry, 'country'),
    },
    quality_findings: {
      invalid_coordinates: invalidCoordinates.length,
      null_island_markers: nullIsland.map(f => ({ name: f.properties.name, boards: f.properties.boards.length })),
      venues_with_repeated_board_type: sameBoardAtVenue.length,
      closed_or_duplicate_markers_still_published: staleMarkers,
    },
  };
}

function printText(audit) {
  const t = audit.totals;
  process.stdout.write(`Board Map gap audit (${audit.dataset_generated_at})\n`);
  process.stdout.write(`  venues ${t.venues}; board entries ${t.board_entries}; multi-board venues ${t.multi_board_venues}\n`);
  process.stdout.write(`  city exact ${t.city_exact}; nearest-only ${t.city_nearest_only}; missing ${t.city_missing}; country missing ${t.country_missing}\n`);
  process.stdout.write(`  ledger retry queue ${audit.research.retry_queue}; pending ${audit.research.pending_items}\n\n`);
  process.stdout.write('Per board\n');
  for (const [id, row] of Object.entries(audit.per_board)) {
    const details = row.board_fields ? `; detail gaps ${JSON.stringify(row.board_fields)}` : '';
    process.stdout.write(`  ${id.padEnd(12)} ${String(row.entries).padStart(4)} entries / ${String(row.venues).padStart(4)} venues${details}\n`);
  }
  process.stdout.write('\nQuality findings\n');
  process.stdout.write(`  null-island markers ${audit.quality_findings.null_island_markers.length}\n`);
  process.stdout.write(`  repeated-board-type venues ${audit.quality_findings.venues_with_repeated_board_type}\n`);
  process.stdout.write(`  closed/duplicate markers still published ${audit.quality_findings.closed_or_duplicate_markers_still_published.length}\n`);
  for (const row of audit.quality_findings.closed_or_duplicate_markers_still_published) {
    process.stdout.write(`    ${row.country ?? '??'} ${row.name} (${row.status}; ${row.lat},${row.lon})\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('board-data-gap-audit.mjs')) {
  const audit = buildAudit();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else printText(audit);
}
