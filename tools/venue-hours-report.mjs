#!/usr/bin/env node
// Validation and coverage report for the curated venue opening hours.
//
//   node tools/venue-hours-report.mjs               # validate + summarize
//   node tools/venue-hours-report.mjs --json        # same, machine-readable
//   node tools/venue-hours-report.mjs --todo DE,AT  # venues still to review
//   node tools/venue-hours-report.mjs --todo DE --limit 40 --unlinked
//
// Exits non-zero when anything in tools/venue-hours.json would be refused by the
// build, so this doubles as the pre-commit gate for a curation batch.
// Reads only files already in the repo — no network, no npm.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildVenueIndex, classifyVenue, resolveVenueRecord, venueKey,
} from './venue-links.mjs';
import {
  applyVenueHours, formatWeeklyHours, loadHoursResearch, loadVenueHours, toPublicWeek,
} from './venue-hours.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const HOURS = join(REPO_ROOT, 'tools', 'venue-hours.json');
const RESEARCH = join(REPO_ROOT, 'tools', 'venue-hours-research.json');
const LINKS = join(REPO_ROOT, 'tools', 'venue-links.json');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function displayName(lang, code) {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function venueAddress(props) {
  for (const b of props.boards ?? []) {
    if (typeof b.address === 'string' && b.address.trim()) return b.address.trim();
  }
  return '';
}

function main() {
  if (!existsSync(GEOJSON)) {
    process.stderr.write(`missing ${GEOJSON} — run node tools/build-boards-data.mjs first\n`);
    process.exit(2);
  }
  const features = readJson(GEOJSON).features ?? [];

  const todo = argValue('--todo');
  if (todo !== null) {
    reportTodo(features, todo);
    return;
  }

  const { entries, errors, present } = loadVenueHours(HOURS);
  // applyVenueHours mutates what it is handed; this is a throwaway copy of the
  // properties so the report can never leave a half-applied geojson behind.
  const scratch = features.map(f => ({
    type: f.type,
    geometry: f.geometry,
    properties: { ...f.properties },
  }));
  const { stats, problems, notes } = applyVenueHours(scratch, entries);

  const research = loadHoursResearch(RESEARCH);
  const researchByStatus = {};
  for (const r of research.entries) {
    const s = typeof r?.status === 'string' ? r.status : 'malformed';
    researchByStatus[s] = (researchByStatus[s] ?? 0) + 1;
  }

  // Coverage per country, over venues that could legitimately carry hours.
  const coverage = new Map();
  const eligibleKeys = new Set();
  for (const f of features) {
    if (classifyVenue(f.properties) === 'private') continue;
    const [lon, lat] = f.geometry.coordinates;
    eligibleKeys.add(venueKey(lat, lon));
    const code = f.properties.country || '??';
    if (!coverage.has(code)) coverage.set(code, { code, eligible: 0, published: 0, reviewed: 0 });
    coverage.get(code).eligible++;
  }
  for (const f of scratch) {
    if (!f.properties.hours) continue;
    const code = f.properties.country || '??';
    if (coverage.has(code)) coverage.get(code).published++;
  }
  // "Reviewed" counts every venue that has an outcome of any kind — published
  // hours or a recorded reason there are none. That is the number that says how
  // much of the map has actually been looked at, so it resolves each record the
  // way the build does rather than comparing raw coordinates: a record written
  // from a rounded coordinate still names one venue, and an outcome record that
  // no longer names any is a stale record worth surfacing.
  const byKey = buildVenueIndex(features);
  const stale = [];
  const reviewedKeys = new Set();
  for (const [i, e] of [...entries.entries()]) {
    const r = resolveVenueRecord(e, `venue-hours[${i}] "${e?.name}"`, byKey, features);
    if (r.status !== 'ok') continue;   // already reported as a refused record
    const [lon, lat] = r.feature.geometry.coordinates;
    reviewedKeys.add(venueKey(lat, lon));
  }
  for (const [i, e] of [...research.entries.entries()]) {
    const r = resolveVenueRecord(e, `venue-hours-research[${i}] "${e?.name}"`, byKey, features);
    if (r.status !== 'ok') {
      // A `private` outcome is the one refusal that is the point of the record.
      if (r.status !== 'private-venue') stale.push(r.reason);
      continue;
    }
    const [lon, lat] = r.feature.geometry.coordinates;
    reviewedKeys.add(venueKey(lat, lon));
  }
  for (const f of features) {
    if (classifyVenue(f.properties) === 'private') continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!reviewedKeys.has(venueKey(lat, lon))) continue;
    const code = f.properties.country || '??';
    if (coverage.has(code)) coverage.get(code).reviewed++;
  }

  // A venue can only be in one of the two files. Both saying something about
  // the same venue means one of them is stale.
  const conflicts = [];
  const hoursKeys = new Set(entries
    .filter(e => typeof e?.lat === 'number' && typeof e?.lon === 'number')
    .map(e => venueKey(e.lat, e.lon)));
  const seenResearch = new Set();
  for (const r of research.entries) {
    if (typeof r?.lat !== 'number' || typeof r?.lon !== 'number') continue;
    const k = venueKey(r.lat, r.lon);
    if (hoursKeys.has(k)) conflicts.push(`"${r.name}" is both curated and logged without hours — it can only be one`);
    if (seenResearch.has(k)) conflicts.push(`"${r.name}" has more than one outcome record`);
    seenResearch.add(k);
  }

  const hard = errors.length + problems.length + research.errors.length + conflicts.length + stale.length;
  const rows = [...coverage.values()]
    .sort((a, b) => b.published - a.published || b.eligible - a.eligible || a.code.localeCompare(b.code));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      file_present: present,
      stats,
      errors,
      problems,
      notes,
      research_errors: research.errors,
      stale_outcomes: stale,
      conflicts,
      research: researchByStatus,
      coverage: rows,
    }, null, 2) + '\n');
    process.exit(hard ? 1 : 0);
  }

  const totalEligible = rows.reduce((n, r) => n + r.eligible, 0);
  const totalReviewed = rows.reduce((n, r) => n + r.reviewed, 0);
  const pct = totalEligible ? ((stats.applied / totalEligible) * 100).toFixed(1) : '0.0';
  const reviewedPct = totalEligible ? ((totalReviewed / totalEligible) * 100).toFixed(1) : '0.0';

  process.stdout.write('venue opening hours\n');
  process.stdout.write(`  defined            ${stats.defined}\n`);
  process.stdout.write(`  published          ${stats.applied} of ${totalEligible} eligible venues (${pct}%)\n`);
  process.stdout.write(`  reviewed           ${totalReviewed} of ${totalEligible} eligible venues (${reviewedPct}%)\n`);
  process.stdout.write(`  countries covered  ${stats.countries}\n`);
  process.stdout.write(`  rematched by name  ${stats.matched_by_proximity}\n`);
  process.stdout.write(`  unmatched          ${stats.unmatched}\n`);
  process.stdout.write(`  ambiguous          ${stats.ambiguous}\n`);
  process.stdout.write(`  private refused    ${stats.private_refused}\n`);
  process.stdout.write(`  rejected           ${stats.rejected}\n`);
  for (const [k, v] of Object.entries(stats.by_provenance)) {
    process.stdout.write(`  ${k.padEnd(24)} ${v}\n`);
  }

  if (Object.keys(researchByStatus).length) {
    process.stdout.write('\noutcomes without hours (not published as data)\n');
    for (const [k, v] of Object.entries(researchByStatus).sort()) {
      process.stdout.write(`  ${k.padEnd(28)} ${v}\n`);
    }
  }

  process.stdout.write('\ncoverage by country (eligible = public/commercial venues)\n');
  for (const r of rows.slice(0, 30)) {
    if (r.reviewed === 0) continue;
    const share = ((r.published / r.eligible) * 100).toFixed(0);
    process.stdout.write(`  ${r.code}  ${String(r.published).padStart(4)} / ${String(r.eligible).padStart(4)}`
      + `  ${share.padStart(3)}%   reviewed ${String(r.reviewed).padStart(4)}  ${displayName('en', r.code)}\n`);
  }

  if (notes.length) {
    process.stdout.write('\nnotes\n');
    for (const n of notes) process.stdout.write(`  ${n}\n`);
  }
  if (errors.length) {
    process.stdout.write('\nschema errors\n');
    for (const e of errors) process.stdout.write(`  ${e}\n`);
  }
  if (research.errors.length) {
    process.stdout.write('\noutcome-log errors\n');
    for (const e of research.errors) process.stdout.write(`  ${e}\n`);
  }
  if (stale.length) {
    process.stdout.write('\noutcome records that no longer name a venue\n');
    for (const t of stale) process.stdout.write(`  ${t}\n`);
  }
  if (conflicts.length) {
    process.stdout.write('\nrecords fighting over one venue\n');
    for (const c of conflicts) process.stdout.write(`  ${c}\n`);
  }
  if (problems.length) {
    process.stdout.write('\nrefused records\n');
    for (const p of problems) process.stdout.write(`  ${p}\n`);
  }

  if (process.argv.includes('--show')) {
    process.stdout.write('\npublished schedules\n');
    for (const e of entries) {
      process.stdout.write(`  ${e.country}  ${e.name}\n      ${formatWeeklyHours(toPublicWeek(e.hours), 'en')}\n`);
    }
  }

  process.stdout.write(hard ? '\nFAILED — fix the records above before committing.\n' : '\nOK\n');
  process.exit(hard ? 1 : 0);
}

// Worklist for the next batch: public/commercial venues in the given countries
// with neither published hours nor a recorded outcome. Venues that already have
// a verified official website come first and carry it, because that page is
// where the schedule is read from; `--unlinked` shows the rest, which need a
// site found before hours can be.
function reportTodo(features, spec) {
  const wanted = new Set(spec.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const limit = Number(argValue('--limit') ?? 60);
  const unlinked = process.argv.includes('--unlinked');

  const { entries } = loadVenueHours(HOURS);
  const claimed = new Set(entries
    .filter(e => typeof e?.lat === 'number' && typeof e?.lon === 'number')
    .map(e => venueKey(e.lat, e.lon)));
  const research = loadHoursResearch(RESEARCH);
  for (const r of research.entries) {
    if (typeof r?.lat === 'number' && typeof r?.lon === 'number') claimed.add(venueKey(r.lat, r.lon));
  }

  const out = [];
  for (const f of features) {
    const p = f.properties;
    if (wanted.size && !wanted.has(p.country)) continue;
    if (classifyVenue(p) === 'private') continue;
    const [lon, lat] = f.geometry.coordinates;
    if (claimed.has(venueKey(lat, lon))) continue;
    const website = typeof p.website === 'string' ? p.website : '';
    if (unlinked ? website : !website) continue;
    out.push({
      lat, lon, name: p.name, country: p.country,
      city: p.city || (p.city_nearest ? `~${p.city_nearest}` : ''),
      website,
      address: venueAddress(p),
      boards: [...new Set((p.boards ?? []).map(b => b.board))].join('+'),
    });
  }
  out.sort((a, b) => (a.country || '').localeCompare(b.country || '')
    || (a.city || '').localeCompare(b.city || '')
    || a.name.localeCompare(b.name));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(out.slice(0, limit), null, 2) + '\n');
    return;
  }
  process.stdout.write(`${out.length} venues with no hours and no recorded outcome`
    + `${wanted.size ? ` in ${[...wanted].join(', ')}` : ''}`
    + `${unlinked ? ' (and no official website link yet)' : ''}; showing ${Math.min(limit, out.length)}\n\n`);
  for (const v of out.slice(0, limit)) {
    process.stdout.write(`${v.country}  ${v.lat.toFixed(5)},${v.lon.toFixed(5)}  ${v.name}`
      + `${v.city ? ` — ${v.city}` : ''}  [${v.boards}]\n`);
    if (v.website) process.stdout.write(`        ${v.website}\n`);
    if (v.address) process.stdout.write(`        ${v.address}\n`);
  }
}

main();
