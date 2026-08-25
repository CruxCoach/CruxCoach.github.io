#!/usr/bin/env node
// The completeness ledger for the venue website / opening-hours gap audit.
//
//   node tools/venue-audit.mjs                 # validate + status report
//   node tools/venue-audit.mjs --json
//   node tools/venue-audit.mjs --init          # seed/extend the worklist
//   node tools/venue-audit.mjs --queue DE,AT   # what is still open, per country
//   node tools/venue-audit.mjs --next 40 --country IT   # the next items to do
//
// Why this file exists, when four curated files already record outcomes:
// `tools/venue-links.json` and `tools/venue-hours.json` say what was accepted,
// and the two research logs say what was rejected — but neither can distinguish
// "looked at in this audit and found genuinely absent" from "nobody has looked
// since 2026-08-22", and neither has anywhere to put "tried, could not reach,
// retry". This ledger is the worklist itself: one row per venue that was
// missing a website or accepted hours when the audit opened, frozen at that
// moment so the denominator cannot drift, with a per-field outcome that must be
// backed by a real record in one of those four files.
//
// It is curation metadata. Nothing in it is published — the same rule the
// `checked` date and the `evidence` quote live under, and a test enforces it.
//
// Reads only files already in the repo — no network, no npm.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildVenueIndex, classifyVenue, loadVenueLinks, resolveVenueRecord, venueKey,
} from './venue-links.mjs';
import { loadVenueHours, loadHoursResearch } from './venue-hours.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const LINKS = join(REPO_ROOT, 'tools', 'venue-links.json');
const LINKS_RESEARCH = join(REPO_ROOT, 'tools', 'venue-links-research.json');
const HOURS = join(REPO_ROOT, 'tools', 'venue-hours.json');
const HOURS_RESEARCH = join(REPO_ROOT, 'tools', 'venue-hours-research.json');
export const LEDGER = join(REPO_ROOT, 'tools', 'venue-audit-ledger.json');

// The audit's own vocabulary. `accepted` means a record landed in the curated
// file; everything else mirrors the status the matching research log recorded,
// plus `pending`, which is the only value that keeps an item in the queue.
export const WEBSITE_RESULTS = new Set([
  'accepted', 'ambiguous', 'closed', 'private', 'duplicate', 'unavailable',
  'unverified', 'no-website', 'social-only', 'http-only', 'pending',
]);
export const HOURS_RESULTS = new Set([
  'accepted', 'private', 'closed', 'no-official-site', 'no-hours-on-official-site',
  'ambiguous', 'seasonal', 'appointment-only', 'inaccessible', 'pending',
]);

// Outcomes that are a fact about one moment rather than about the venue, so
// they stay in the retry queue even though they are recorded.
export const RETRYABLE_WEBSITE = new Set(['pending', 'unavailable', 'unverified']);
export const RETRYABLE_HOURS = new Set(['pending', 'inaccessible']);

// Discovery channels a curator may claim to have tried. Kept closed so the
// ledger cannot quietly acquire a channel nobody defined.
export const CHANNELS = new Set([
  'apex', 'www', 'redirect', 'canonical', 'path-probe', 'name-guess',
  'osm-website-tag', 'operator-index', 'co-located', 'web-search',
  'booking-page', 'imprint', 'social-profile', 'venue-link', 'previous-record',
  // A dated snapshot of the venue's own page. It may settle whose domain a
  // host is when the live one refuses or has gone; it may never supply hours.
  'archive',
  // The coordinate a page publishes about itself: a Google place link, an
  // embedded map's settings, a schema.org geo block. It is the venue's own
  // statement of where it is, which is a different thing from a gazetteer's.
  'map-block',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_KEYS = new Set(['pass', 'result', 'channels', 'note']);
const ITEM_KEYS = new Set(['lat', 'lon', 'name', 'country', 'needs', 'website', 'hours']);

const readJson = f => JSON.parse(readFileSync(f, 'utf-8'));
const argValue = flag => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
};

export function loadLedger(file = LEDGER) {
  if (!existsSync(file)) return { audit: null, started: null, items: [], present: false };
  const raw = readJson(file);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    throw new Error(`${file} must be an object with an "items" array`);
  }
  return { ...raw, present: true };
}

export function validateLedgerItem(item, index = 0) {
  const where = `venue-audit-ledger[${index}]${item && item.name ? ` "${item.name}"` : ''}`;
  const problems = [];
  const fail = m => problems.push(`${where}: ${m}`);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`${where}: not an object`];
  for (const k of Object.keys(item)) if (!ITEM_KEYS.has(k)) fail(`unknown field "${k}"`);
  if (typeof item.lat !== 'number' || !Number.isFinite(item.lat)) fail('"lat" must be a number');
  if (typeof item.lon !== 'number' || !Number.isFinite(item.lon)) fail('"lon" must be a number');
  if (typeof item.name !== 'string' || !item.name.trim()) fail('"name" must be a non-empty string');
  if (typeof item.country !== 'string' || !/^[A-Z]{2}$|^\?\?$/.test(item.country)) fail('"country" must be an ISO-3166-1 alpha-2 code');
  if (!Array.isArray(item.needs) || !item.needs.length
    || item.needs.some(n => n !== 'website' && n !== 'hours')) {
    fail('"needs" must be a non-empty subset of ["website","hours"]');
  }
  for (const field of ['website', 'hours']) {
    const needed = Array.isArray(item.needs) && item.needs.includes(field);
    const v = item[field];
    if (!needed) {
      if (v !== undefined) fail(`"${field}" is recorded but not in "needs"`);
      continue;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(`"${field}" must be an object`); continue; }
    for (const k of Object.keys(v)) if (!FIELD_KEYS.has(k)) fail(`"${field}" has unknown field "${k}"`);
    const allowed = field === 'website' ? WEBSITE_RESULTS : HOURS_RESULTS;
    if (typeof v.result !== 'string' || !allowed.has(v.result)) {
      fail(`"${field}.result" must be one of ${[...allowed].join(', ')}`);
    }
    if (v.result === 'pending') {
      if (v.pass !== null && v.pass !== undefined && !ISO_DATE.test(v.pass)) fail(`"${field}.pass" must be null or YYYY-MM-DD`);
    } else if (typeof v.pass !== 'string' || !ISO_DATE.test(v.pass)) {
      fail(`"${field}.pass" must be the UTC date this pass reached its outcome`);
    }
    if (v.channels !== undefined) {
      if (!Array.isArray(v.channels) || v.channels.some(c => !CHANNELS.has(c))) {
        fail(`"${field}.channels" must be a subset of ${[...CHANNELS].join(', ')}`);
      }
    }
    if (v.note !== undefined && (typeof v.note !== 'string' || !v.note.trim())) {
      fail(`"${field}.note" must be a non-empty string when present`);
    }
  }
  return problems;
}

// The worklist, recomputed from the data rather than trusted: every
// public/commercial venue that carries no accepted website link and/or no
// accepted opening-hours record.
export function computeWorklist(features, linkEntries, hoursEntries) {
  const linked = new Set(linkEntries.filter(e => typeof e?.lat === 'number').map(e => venueKey(e.lat, e.lon)));
  const houred = new Set(hoursEntries.filter(e => typeof e?.lat === 'number').map(e => venueKey(e.lat, e.lon)));
  const out = [];
  for (const f of features) {
    const p = f.properties;
    if (classifyVenue(p) === 'private') continue;
    const [lon, lat] = f.geometry.coordinates;
    const k = venueKey(lat, lon);
    const needs = [];
    if (!linked.has(k)) needs.push('website');
    if (!houred.has(k)) needs.push('hours');
    if (!needs.length) continue;
    out.push({
      key: k, lat, lon,
      name: String(p.name || '').replace(/^"+|"+$/g, '').trim() || String(p.name || ''),
      country: p.country || '??',
      needs,
    });
  }
  return out;
}

function main() {
  if (!existsSync(GEOJSON)) {
    process.stderr.write(`missing ${GEOJSON} — run node tools/build-boards-data.mjs first\n`);
    process.exit(2);
  }
  const features = readJson(GEOJSON).features ?? [];
  const links = loadVenueLinks(LINKS);
  const linksResearch = existsSync(LINKS_RESEARCH) ? readJson(LINKS_RESEARCH) : [];
  const hours = loadVenueHours(HOURS);
  const hoursResearch = loadHoursResearch(HOURS_RESEARCH);
  const worklist = computeWorklist(features, links.entries, hours.entries);

  if (process.argv.includes('--init')) {
    init(worklist);
    return;
  }

  const ledger = loadLedger();
  if (!ledger.present) {
    process.stderr.write('no tools/venue-audit-ledger.json — run node tools/venue-audit.mjs --init\n');
    process.exit(2);
  }

  const byKey = buildVenueIndex(features);
  const errors = [];
  ledger.items.forEach((it, i) => errors.push(...validateLedgerItem(it, i)));

  // Every ledger row must still name exactly one venue, and no venue twice.
  //
  // One class of row cannot pass that check and must not be dropped for it: a
  // venue the shared resolver itself refuses — the dataset has one entry with
  // no country at 0,0 — can never carry a research record either, because both
  // logs require a real country code. Those rows are held in their own bucket,
  // must carry a note saying why, and are exempt from the backing rule below.
  // The point of the audit is that nothing goes unreviewed in silence; an
  // unauditable venue is a finding, not an omission.
  const seen = new Map();
  const unresolvable = [];
  for (const [i, it] of ledger.items.entries()) {
    if (typeof it?.lat !== 'number' || typeof it?.lon !== 'number') continue;
    const r = resolveVenueRecord(it, `venue-audit-ledger[${i}] "${it.name}"`, byKey, features);
    if (r.status !== 'ok') {
      const k = venueKey(it.lat, it.lon);
      if (byKey.has(k)) {
        unresolvable.push({ item: it, reason: r.reason });
        for (const field of it.needs ?? []) {
          if (!it[field]?.note) errors.push(`venue-audit-ledger: "${it.name}" cannot be resolved (${r.status}) and its ${field} outcome carries no note saying so`);
        }
      } else {
        errors.push(r.reason);
      }
      continue;
    }
    const [lon, lat] = r.feature.geometry.coordinates;
    const k = venueKey(lat, lon);
    if (seen.has(k)) errors.push(`venue-audit-ledger: "${it.name}" and "${seen.get(k)}" are the same venue`);
    else seen.set(k, it.name);
  }
  const unresolvableKeys = new Set(unresolvable.map(u => venueKey(u.item.lat, u.item.lon)));

  // An outcome is only real if a record backs it. `accepted` means the curated
  // file carries the venue; anything else means the research log does, with the
  // same status. This is what stops the ledger becoming a list of assertions.
  const linkKeys = new Set(links.entries.filter(e => typeof e?.lat === 'number').map(e => venueKey(e.lat, e.lon)));
  const hourKeys = new Set(hours.entries.filter(e => typeof e?.lat === 'number').map(e => venueKey(e.lat, e.lon)));
  const linkResearchByKey = new Map();
  for (const r of Array.isArray(linksResearch) ? linksResearch : []) {
    if (typeof r?.lat === 'number') linkResearchByKey.set(venueKey(r.lat, r.lon), r);
  }
  const hourResearchByKey = new Map();
  for (const r of hoursResearch.entries) {
    if (typeof r?.lat === 'number') hourResearchByKey.set(venueKey(r.lat, r.lon), r);
  }

  const unbacked = [];
  for (const it of ledger.items) {
    const k = venueKey(it.lat, it.lon);
    if (unresolvableKeys.has(k)) continue;
    for (const [field, acceptedKeys, researchByKey, file] of [
      ['website', linkKeys, linkResearchByKey, 'tools/venue-links'],
      ['hours', hourKeys, hourResearchByKey, 'tools/venue-hours'],
    ]) {
      const v = it[field];
      if (!v || v.result === 'pending') continue;
      if (v.result === 'accepted') {
        if (!acceptedKeys.has(k)) unbacked.push(`"${it.name}" ${field} says accepted but ${file}.json has no record`);
        continue;
      }
      const r = researchByKey.get(k);
      if (!r) unbacked.push(`"${it.name}" ${field} says ${v.result} but ${file}-research.json has no record`);
      else if (r.status !== v.result) unbacked.push(`"${it.name}" ${field} says ${v.result}, ${file}-research.json says ${r.status}`);
    }
  }

  // Nothing may be silently unreviewed: every worklist item needs a row, and
  // every row a result for each field it needs.
  const ledgerKeys = new Set(ledger.items.map(it => venueKey(it.lat, it.lon)));
  const missingRows = worklist.filter(w => !ledgerKeys.has(w.key));

  const tally = { website: {}, hours: {} };
  const queue = [];
  const perCountry = new Map();
  for (const it of ledger.items) {
    const c = it.country || '??';
    if (!perCountry.has(c)) perCountry.set(c, { c, items: 0, open: 0, web_done: 0, web_need: 0, hrs_done: 0, hrs_need: 0 });
    const row = perCountry.get(c);
    row.items++;
    let open = false;
    for (const field of ['website', 'hours']) {
      const v = it[field];
      if (!v) continue;
      const res = v.result || 'pending';
      tally[field][res] = (tally[field][res] ?? 0) + 1;
      const retry = field === 'website' ? RETRYABLE_WEBSITE : RETRYABLE_HOURS;
      if (field === 'website') { row.web_need++; if (res !== 'pending') row.web_done++; }
      else { row.hrs_need++; if (res !== 'pending') row.hrs_done++; }
      if (retry.has(res)) { open = true; }
    }
    if (open) { row.open++; queue.push(it); }
  }

  const queueSpec = argValue('--queue');
  if (queueSpec !== null) {
    const wanted = new Set(queueSpec.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
    const rows = queue.filter(it => !wanted.size || wanted.has(it.country));
    process.stdout.write(`${rows.length} ledger items still open${wanted.size ? ` in ${[...wanted].join(', ')}` : ''}\n\n`);
    for (const it of rows.slice(0, Number(argValue('--limit') ?? 200))) {
      const bits = ['website', 'hours']
        .filter(f => it[f])
        .map(f => `${f}=${it[f].result}`);
      process.stdout.write(`${it.country}  ${it.lat.toFixed(5)},${it.lon.toFixed(5)}  ${it.name}  [${bits.join(' ')}]\n`);
    }
    return;
  }

  const nextN = argValue('--next');
  if (nextN !== null) {
    const cc = (argValue('--country') || '').toUpperCase();
    const rows = ledger.items.filter(it => (!cc || it.country === cc)
      && ['website', 'hours'].some(f => it[f] && it[f].result === 'pending'));
    process.stdout.write(JSON.stringify(rows.slice(0, Number(nextN) || 40), null, 1) + '\n');
    return;
  }

  const hard = errors.length + unbacked.length + missingRows.length;

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      audit: ledger.audit, started: ledger.started,
      items: ledger.items.length,
      worklist: worklist.length,
      tally, errors, unbacked,
      unresolvable: unresolvable.map(u => u.reason),
      missing_rows: missingRows.map(w => `${w.country} ${w.name}`),
      queue: queue.length,
      coverage: [...perCountry.values()].sort((a, b) => b.items - a.items),
    }, null, 2) + '\n');
    process.exit(hard ? 1 : 0);
  }

  process.stdout.write(`venue gap audit — ${ledger.audit ?? '(unnamed)'}, opened ${ledger.started ?? '?'}\n`);
  process.stdout.write(`  ledger items       ${ledger.items.length}\n`);
  process.stdout.write(`  worklist now       ${worklist.length} (venues still missing a field)\n`);
  for (const field of ['website', 'hours']) {
    const t = tally[field];
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    const done = total - (t.pending ?? 0);
    process.stdout.write(`\n  ${field}: ${done} / ${total} decided\n`);
    for (const [k, v] of Object.entries(t).sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`    ${k.padEnd(26)} ${String(v).padStart(5)}\n`);
    }
  }
  process.stdout.write(`\n  retry queue        ${queue.length} items still open\n`);
  if (unresolvable.length) {
    process.stdout.write(`  unauditable        ${unresolvable.length} (venue the shared resolver refuses — see the note on the row)\n`);
    for (const u of unresolvable) process.stdout.write(`    ${u.reason}\n`);
  }

  process.stdout.write('\nper country (decided / needed)\n');
  const rows = [...perCountry.values()].sort((a, b) => b.items - a.items);
  for (const r of rows) {
    process.stdout.write(`  ${r.c.padEnd(3)} items ${String(r.items).padStart(4)}`
      + `  website ${String(r.web_done).padStart(4)}/${String(r.web_need).padStart(4)}`
      + `  hours ${String(r.hrs_done).padStart(4)}/${String(r.hrs_need).padStart(4)}`
      + `  open ${String(r.open).padStart(4)}\n`);
  }

  if (missingRows.length) {
    process.stdout.write(`\nworklist venues with no ledger row (${missingRows.length}) — run --init\n`);
    for (const w of missingRows.slice(0, 30)) process.stdout.write(`  ${w.country} ${w.name}\n`);
  }
  if (unbacked.length) {
    process.stdout.write(`\noutcomes no record backs (${unbacked.length})\n`);
    for (const u of unbacked.slice(0, 40)) process.stdout.write(`  ${u}\n`);
  }
  if (errors.length) {
    process.stdout.write(`\nschema errors (${errors.length})\n`);
    for (const e of errors.slice(0, 40)) process.stdout.write(`  ${e}\n`);
  }
  process.stdout.write(hard ? '\nFAILED — fix the rows above before committing.\n' : '\nOK\n');
  process.exit(hard ? 1 : 0);
}

// Seed the ledger, or extend it with venues that have become eligible since.
// Never rewrites an outcome that is already recorded.
function init(worklist) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = loadLedger();
  const byKey = new Map(existing.items.map(it => [venueKey(it.lat, it.lon), it]));
  let added = 0;
  for (const w of worklist) {
    if (byKey.has(w.key)) continue;
    const item = { lat: w.lat, lon: w.lon, name: w.name, country: w.country, needs: w.needs };
    for (const f of w.needs) item[f] = { pass: null, result: 'pending' };
    byKey.set(w.key, item);
    added++;
  }
  const items = [...byKey.values()].sort((a, b) =>
    (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name) || a.lat - b.lat);
  const out = {
    audit: existing.audit ?? 'venue-gap-audit',
    started: existing.started ?? today,
    note: undefined,
    items,
  };
  delete out.note;
  writeFileSync(LEDGER, JSON.stringify(out, null, 1) + '\n');
  process.stdout.write(`ledger: ${items.length} items (${added} added)\n`);
}

if (process.argv[1] && process.argv[1].endsWith('venue-audit.mjs')) main();
