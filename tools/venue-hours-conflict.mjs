#!/usr/bin/env node
// Re-read the source of every published week and compare it against the two
// machine-readable weeks a site can also ship: a Squarespace business-hours
// setting and a schema.org openingHours block.
//
//   node tools/venue-hours-conflict.mjs                    # all published weeks
//   node tools/venue-hours-conflict.mjs 51.5074,-0.1278    # only these venues
//
// A difference is a finding to read, not a verdict. The text a visitor reads is
// the venue's statement; the other two are published once from a settings
// screen and left behind. See "When a page states the week twice" in
// tools/VENUE-HOURS.md for when a week is withdrawn.
//
// This is the one hours tool that makes network requests, so it is never part
// of scripts/check — run it by hand after a curation batch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOURS = join(REPO_ROOT, 'tools', 'venue-hours.json');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LONG = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const UA = 'cruxcoach-venue-hours-conflict/1.0 (+https://cruxcoach.org)';
const TIMEOUT_MS = 20000;

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const norm = (s) => String(s || '').replace(/\s+/g, '');

// Squarespace ships the site's business hours as JSON in the page source.
function squarespaceWeek(html) {
  const m = html.match(/"businessHours"\s*:\s*\{/);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length && i < start + 4000; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return null;
  let obj;
  try { obj = JSON.parse(html.slice(start, end)); } catch { return null; }
  const week = {};
  for (let d = 0; d < 7; d += 1) {
    const day = obj[LONG[d]];
    if (!day) return null;
    const ranges = (day.ranges || []).filter((r) => typeof r.from === 'number' && typeof r.to === 'number');
    week[DAYS[d]] = ranges.length ? ranges.map((r) => `${hhmm(r.from)}-${hhmm(r.to)}`).join(',') : 'closed';
  }
  return week;
}

// schema.org allows either the "Mo 09:00-22:00, Tu …" string form or a list of
// openingHoursSpecification objects.
function schemaWeek(html) {
  const week = {};
  let any = false;
  for (const m of html.matchAll(/"openingHours"\s*:\s*"([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().match(/^([A-Za-z]{2,9})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!t) continue;
      const d = SHORT.indexOf(t[1].slice(0, 2).toLowerCase());
      if (d < 0) continue;
      week[DAYS[d]] = `${t[2].padStart(5, '0')}-${t[3].padStart(5, '0')}`;
      any = true;
    }
  }
  const spec = /"dayOfWeek"\s*:\s*(\[[^\]]*\]|"[^"]*")[^}]*?"opens"\s*:\s*"(\d{1,2}:\d{2})[^"]*"[^}]*?"closes"\s*:\s*"(\d{1,2}:\d{2})/g;
  for (const m of html.matchAll(spec)) {
    for (const dm of m[1].matchAll(/([A-Za-z]{6,9})day/g)) {
      const d = LONG.indexOf(`${dm[1]}day`.toLowerCase());
      if (d < 0) continue;
      week[DAYS[d]] = `${m[2].padStart(5, '0')}-${m[3].padStart(5, '0')}`;
      any = true;
    }
  }
  return any ? week : null;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: controller.signal, redirect: 'follow' });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const only = new Set(process.argv.slice(2));
const records = JSON.parse(readFileSync(HOURS, 'utf-8'));
let read = 0;
let unreachable = 0;
let conflicts = 0;

for (const record of records) {
  const key = `${record.lat.toFixed(4)},${record.lon.toFixed(4)}`;
  if (only.size && !only.has(key)) continue;
  let html;
  try {
    html = await fetchHtml(record.source);
  } catch {
    unreachable += 1;
    console.log(`unreachable  ${key}  ${record.name}  ${record.source}`);
    continue;
  }
  read += 1;
  for (const [label, week] of [['squarespace', squarespaceWeek(html)], ['schema.org', schemaWeek(html)]]) {
    if (!week) continue;
    const differing = DAYS.filter((d) => week[d] !== undefined && norm(week[d]) !== norm(record.hours[d]));
    if (!differing.length) continue;
    conflicts += 1;
    const detail = differing.map((d) => `${d} page ${record.hours[d]} / ${label} ${week[d]}`).join('; ');
    console.log(`conflict     ${key}  ${record.name}  ${detail}  ${record.source}`);
  }
}

console.log(`\n${read} sources read, ${unreachable} unreachable, ${conflicts} carrying a machine-readable week that differs`);
