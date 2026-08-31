// Fail-closed removal of upstream venue rows that primary-source research has
// established as closed, duplicate, non-public, announced-but-not-current, or materially mislocated. The evidence remains in
// venue-links-research.json; this file only selects which backed decisions are
// strong enough to keep out of every future rebuild.

import { readFileSync } from 'node:fs';

import { venueKey } from './venue-links.mjs';

const ALLOWED = new Set(['closed', 'duplicate', 'mislocated', 'non-public', 'announced']);

export function loadLocationExclusions(file, researchFile) {
  let rows;
  let research;
  try { rows = JSON.parse(readFileSync(file, 'utf8')); }
  catch (err) { return { entries: [], errors: [`location exclusions: ${err.message}`] }; }
  try { research = JSON.parse(readFileSync(researchFile, 'utf8')); }
  catch (err) { return { entries: [], errors: [`location exclusion research: ${err.message}`] }; }
  if (!Array.isArray(rows)) return { entries: [], errors: ['location-exclusions.json must be an array'] };
  if (!Array.isArray(research)) return { entries: [], errors: ['venue-links-research.json must be an array'] };

  const backing = new Map(research
    .filter(row => typeof row?.lat === 'number' && typeof row?.lon === 'number')
    .map(row => [venueKey(row.lat, row.lon), row]));
  const entries = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const where = `location-exclusions[${i}]${row?.name ? ` "${row.name}"` : ''}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${where}: must be an object`); return;
    }
    const known = new Set(['lat', 'lon', 'name', 'status']);
    for (const key of Object.keys(row)) if (!known.has(key)) errors.push(`${where}: unknown field "${key}"`);
    if (typeof row.lat !== 'number' || !Number.isFinite(row.lat)
      || typeof row.lon !== 'number' || !Number.isFinite(row.lon)) {
      errors.push(`${where}: lat/lon must be finite numbers`); return;
    }
    if (typeof row.name !== 'string' || !row.name.trim()) errors.push(`${where}: name must be non-empty`);
    if (!ALLOWED.has(row.status)) errors.push(`${where}: status must be closed, duplicate, mislocated, non-public or announced`);
    const key = venueKey(row.lat, row.lon);
    if (seen.has(key)) errors.push(`${where}: duplicate exclusion coordinate ${key}`);
    seen.add(key);
    const proof = backing.get(key);
    if (!proof) errors.push(`${where}: no backing venue-links-research.json record`);
    else {
      if (proof.status !== row.status) errors.push(`${where}: says ${row.status}, research says ${proof.status}`);
      if (proof.name !== row.name) errors.push(`${where}: name differs from research record "${proof.name}"`);
      if (typeof proof.checked !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(proof.checked)) {
        errors.push(`${where}: backing research has no valid checked date`);
      }
      if (typeof proof.reason !== 'string' || proof.reason.trim().length < 24) {
        errors.push(`${where}: backing research has no substantive reason`);
      }
    }
    entries.push(row);
  });
  return { entries, errors };
}

export function applyLocationExclusions(entries, exclusions) {
  const byKey = new Map(exclusions.map(row => [venueKey(row.lat, row.lon), row]));
  const matched = new Map(exclusions.map(row => [venueKey(row.lat, row.lon), 0]));
  const kept = [];
  const problems = [];
  for (const entry of entries) {
    const key = venueKey(entry.lat, entry.lon);
    if (!byKey.has(key)) { kept.push(entry); continue; }
    matched.set(key, matched.get(key) + 1);
  }
  for (const exclusion of exclusions) {
    const key = venueKey(exclusion.lat, exclusion.lon);
    if (matched.get(key) === 0) problems.push(`location exclusion "${exclusion.name}" no longer matches an upstream entry`);
  }
  return {
    entries: kept,
    stats: {
      defined: exclusions.length,
      matched_venues: [...matched.values()].filter(n => n > 0).length,
      excluded_entries: [...matched.values()].reduce((a, b) => a + b, 0),
      unmatched: [...matched.values()].filter(n => n === 0).length,
    },
    problems,
  };
}
