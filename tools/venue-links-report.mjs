#!/usr/bin/env node
// Validation and coverage report for the curated venue website links.
//
//   node tools/venue-links-report.mjs              # validate + summarize
//   node tools/venue-links-report.mjs --json       # same, machine-readable
//   node tools/venue-links-report.mjs --todo DE,AT # venues still without a link
//   node tools/venue-links-report.mjs --todo DE --limit 40 --with-address
//
// Exits non-zero when anything in tools/venue-links.json would be refused by
// the build, so this doubles as the pre-commit gate for a curation batch.
// Reads only files already in the repo — no network, no npm.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyVenueLinks, classifyVenue, loadVenueLinks, suspiciousParams, venueKey,
} from './venue-links.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const LINKS = join(REPO_ROOT, 'tools', 'venue-links.json');
const RESEARCH = join(REPO_ROOT, 'tools', 'venue-links-research.json');

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

// The street address the Kilter upstream carries, when it has one. Used only to
// give a curator something to verify against — never copied into the dataset.
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

  const { entries, errors, present } = loadVenueLinks(LINKS);
  // applyVenueLinks mutates the features it is handed; this is a throwaway copy
  // of the properties so the report can never leave a half-applied geojson
  // behind if someone pipes it somewhere.
  const scratch = features.map(f => ({
    type: f.type,
    geometry: f.geometry,
    properties: { ...f.properties },
  }));
  const { stats, problems, notes } = applyVenueLinks(scratch, entries);

  const research = existsSync(RESEARCH) ? readJson(RESEARCH) : [];
  const researchByStatus = {};
  for (const r of Array.isArray(research) ? research : []) {
    const s = typeof r?.status === 'string' ? r.status : 'malformed';
    researchByStatus[s] = (researchByStatus[s] ?? 0) + 1;
  }

  // Coverage per country, over venues that could legitimately carry a link.
  const coverage = new Map();
  for (const f of features) {
    const cls = classifyVenue(f.properties);
    if (cls === 'private') continue;
    const code = f.properties.country || '??';
    if (!coverage.has(code)) coverage.set(code, { code, eligible: 0, linked: 0 });
    coverage.get(code).eligible++;
  }
  const linkedKeys = new Set();
  for (const f of scratch) {
    if (!f.properties.website) continue;
    const [lon, lat] = f.geometry.coordinates;
    linkedKeys.add(venueKey(lat, lon));
    const code = f.properties.country || '??';
    if (coverage.has(code)) coverage.get(code).linked++;
  }

  const flagged = [];
  for (const e of entries) {
    if (typeof e?.website !== 'string') continue;
    const params = suspiciousParams(e.website);
    if (params.length) flagged.push({ name: e.name, website: e.website, params });
  }

  const hard = errors.length + problems.length;
  const rows = [...coverage.values()]
    .filter(r => r.linked > 0 || r.eligible > 0)
    .sort((a, b) => b.linked - a.linked || b.eligible - a.eligible || a.code.localeCompare(b.code));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      file_present: present,
      stats,
      errors,
      problems,
      notes,
      flagged_params: flagged,
      research: researchByStatus,
      coverage: rows,
    }, null, 2) + '\n');
    process.exit(hard ? 1 : 0);
  }

  const totalEligible = rows.reduce((n, r) => n + r.eligible, 0);
  const pct = totalEligible ? ((stats.applied / totalEligible) * 100).toFixed(1) : '0.0';

  process.stdout.write('venue website links\n');
  process.stdout.write(`  defined            ${stats.defined}\n`);
  process.stdout.write(`  applied            ${stats.applied} of ${totalEligible} eligible venues (${pct}%)\n`);
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
    process.stdout.write('\nresearch log (not published as data)\n');
    for (const [k, v] of Object.entries(researchByStatus).sort()) {
      process.stdout.write(`  ${k.padEnd(18)} ${v}\n`);
    }
  }

  process.stdout.write('\ncoverage by country (eligible = public/commercial venues)\n');
  for (const r of rows.slice(0, 25)) {
    if (r.linked === 0) continue;
    const share = ((r.linked / r.eligible) * 100).toFixed(0);
    process.stdout.write(`  ${r.code}  ${String(r.linked).padStart(4)} / ${String(r.eligible).padStart(4)}  ${share.padStart(3)}%  ${displayName('en', r.code)}\n`);
  }

  if (notes.length) {
    process.stdout.write('\nnotes\n');
    for (const n of notes) process.stdout.write(`  ${n}\n`);
  }
  if (flagged.length) {
    process.stdout.write('\nURLs with parameters worth a second look\n');
    for (const f of flagged) process.stdout.write(`  ${f.name}: ${f.website} (${f.params.join(', ')})\n`);
  }
  if (errors.length) {
    process.stdout.write('\nschema errors\n');
    for (const e of errors) process.stdout.write(`  ${e}\n`);
  }
  if (problems.length) {
    process.stdout.write('\nrefused records\n');
    for (const p of problems) process.stdout.write(`  ${p}\n`);
  }

  process.stdout.write(hard ? '\nFAILED — fix the records above before committing.\n' : '\nOK\n');
  process.exit(hard ? 1 : 0);
}

// Worklist for the next curation batch: public/commercial venues in the given
// countries that carry neither a curated link nor a research-log entry. Prints
// the upstream address when asked, because that is the second signal a curator
// checks the candidate page against.
function reportTodo(features, spec) {
  const wanted = new Set(spec.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const limit = Number(argValue('--limit') ?? 60);
  const withAddress = process.argv.includes('--with-address');

  const { entries } = loadVenueLinks(LINKS);
  const claimed = new Set(entries
    .filter(e => typeof e?.lat === 'number' && typeof e?.lon === 'number')
    .map(e => venueKey(e.lat, e.lon)));
  const research = existsSync(RESEARCH) ? readJson(RESEARCH) : [];
  for (const r of Array.isArray(research) ? research : []) {
    if (typeof r?.lat === 'number' && typeof r?.lon === 'number') claimed.add(venueKey(r.lat, r.lon));
  }

  const out = [];
  for (const f of features) {
    const p = f.properties;
    if (wanted.size && !wanted.has(p.country)) continue;
    const cls = classifyVenue(p);
    if (cls === 'private') continue;
    const [lon, lat] = f.geometry.coordinates;
    if (claimed.has(venueKey(lat, lon))) continue;
    out.push({
      lat, lon, name: p.name, country: p.country,
      city: p.city || (p.city_nearest ? `~${p.city_nearest}` : ''),
      cls,
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
  process.stdout.write(`${out.length} venues without a link or a research entry`
    + `${wanted.size ? ` in ${[...wanted].join(', ')}` : ''}; showing ${Math.min(limit, out.length)}\n\n`);
  for (const v of out.slice(0, limit)) {
    process.stdout.write(`${v.country}  ${v.lat.toFixed(5)},${v.lon.toFixed(5)}  ${v.name}`
      + `${v.city ? ` — ${v.city}` : ''}  [${v.boards}${v.cls === 'unknown' ? ' ?' : ''}]\n`);
    if (withAddress && v.address) process.stdout.write(`        ${v.address}\n`);
  }
}

main();
