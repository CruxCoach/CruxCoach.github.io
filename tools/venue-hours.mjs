// Curated venue-level opening hours.
//
// `tools/venue-hours.json` is a committed, hand-edited array in the same spirit
// as `tools/venue-links.json`: one record per *venue* (never per board — a gym
// with a Kilter and a MoonBoard opens its doors once), carrying the exact
// official page the schedule was read from, the schedule itself, the evidence
// quoted from that page, and the UTC date it was checked.
//
// This module is the single place that knows how such a record is validated,
// how a weekly schedule is written down, how it is projected into the public
// dataset and how it is formatted for a reader. `build-boards-data.mjs` applies
// it, `venue-hours-report.mjs` reports on it, `render-static.mjs` renders it and
// `venue-hours.test.mjs` tests all of that — against these same functions, so
// the rules cannot drift apart.
//
// Three properties matter more than convenience:
//
//   1. **Fail closed.** A schedule that is contradictory, partial, seasonal,
//      appointment-only or unreadable produces no hours at all — it produces a
//      recorded outcome in `tools/venue-hours-research.json`. Wrong hours are
//      worse than no hours: a visitor acts on them and finds a locked door.
//      This overlay exists because the previous, OpenStreetMap-derived one was
//      materially inaccurate and had to be withdrawn.
//   2. **Nothing is inferred.** Only what the official source states plainly is
//      recorded. Missing days are not filled in, "probably closed" is not a
//      thing, and no day is simplified into a neighbouring one. Every one of
//      the seven days must be stated by the source, or the record does not
//      exist.
//   3. **The verification metadata stays internal.** `checked`, `evidence`,
//      `signals` and `provenance` are curation evidence. They are never written
//      to boards.geojson, never rendered into a page, and never shipped in
//      anything a browser fetches. `toPublicHours()` is the only door between
//      the curated record and the public dataset, and it passes exactly two
//      things through: the schedule and the source URL.
//
// No DOM, no network, no filesystem beyond the explicit `readFileSync` in
// `loadVenueHours()` — so `node --test` can exercise all of it.

import { existsSync, readFileSync } from 'node:fs';

import {
  buildVenueIndex, classifyVenue, distanceMeters, isCanonicalVenueUrl,
  normalizeVenueUrl, resolveVenueRecord, venueKey,
} from './venue-links.mjs';

// ── The week ────────────────────────────────────────────────────────
//
// Monday-first, because the sources are overwhelmingly European and every one
// of them prints the week that way. The public projection is a 7-element array
// in this order, so a consumer never has to guess which end the week starts at.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// A day the source states as closed. Stored as this exact word in the curated
// file — an empty string there would be indistinguishable from a day someone
// forgot to fill in, and "forgot" must never render as "closed".
export const CLOSED = 'closed';

// Latest end-of-day the schema accepts, in minutes past that day's midnight.
// 24:00 is a normal European closing time; beyond it a gym that shuts at 01:00
// is written 25:00 and rendered as 01:00 the next day. 28:00 (04:00) is well
// past anything a climbing gym publishes and is where the grammar stops.
const MAX_END_MINUTES = 28 * 60;

const TIME_RE = /^([0-2][0-9]):([0-5][0-9])$/;

// "09:30" → 570. Throws with a curator-readable reason.
export function parseTime(s, { allowExtended = false } = {}) {
  const m = TIME_RE.exec(s);
  if (!m) throw new Error(`"${s}" is not a HH:MM time`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const total = hours * 60 + minutes;
  if (!allowExtended && total > 23 * 60 + 59) {
    throw new Error(`"${s}" is not a time of day (00:00–23:59)`);
  }
  if (total > MAX_END_MINUTES) {
    throw new Error(`"${s}" is later than the 28:00 the schema allows`);
  }
  return total;
}

export function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Parse one day's spec — "closed", "10:00-23:00", or "09:00-12:00,15:00-22:00"
// — into [{ start, end }] in minutes. Throws on anything ambiguous.
//
// The rules are deliberately strict, because every one of them is a way a
// schedule could be silently wrong:
//   - ranges must be in order and must not touch, so a "split" is a real split
//     and not a range someone cut in half by accident;
//   - a range must have positive length, so "10:00-10:00" cannot mean either
//     "closed" or "all day" depending on who reads it;
//   - only the end may run past midnight, and only up to 28:00.
export function parseDaySpec(spec) {
  if (typeof spec !== 'string') throw new Error('a day must be a string');
  if (spec !== spec.trim()) throw new Error(`"${spec}" has surrounding whitespace`);
  if (spec === CLOSED) return [];
  if (spec === '') throw new Error('a day must say "closed" rather than be empty');

  const ranges = [];
  const parts = spec.split(',');
  for (const part of parts) {
    if (part !== part.trim() || part === '') {
      throw new Error(`"${spec}" has an empty or padded range`);
    }
    const halves = part.split('-');
    if (halves.length !== 2) throw new Error(`"${part}" is not a HH:MM-HH:MM range`);
    const start = parseTime(halves[0]);
    const end = parseTime(halves[1], { allowExtended: true });
    if (end <= start) {
      throw new Error(`"${part}" does not end after it starts`
        + ' — a closing time past midnight is written 24:00–28:00');
    }
    ranges.push({ start, end });
  }
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start <= ranges[i - 1].end) {
      throw new Error(`"${spec}" has ranges that overlap or touch — merge them`);
    }
  }
  return ranges;
}

// The canonical spelling of a day spec. The curated file must store exactly
// this, so a review diff shows the schedule that ships rather than something
// the build quietly rewrote.
export function canonicalDaySpec(spec) {
  const ranges = parseDaySpec(spec);
  if (ranges.length === 0) return CLOSED;
  return ranges.map(r => `${formatTime(r.start)}-${formatTime(r.end)}`).join(',');
}

// True when a day is open around the clock, which reads better than "00:00–24:00".
export function isAllDay(spec) {
  return spec === '00:00-24:00';
}

// ── Public projection ───────────────────────────────────────────────
//
// The public form is a 7-element array of strings, Monday first, where a closed
// day is the empty string. Two reasons for the empty string rather than the
// word: it is the smallest thing that can mean "the source says closed" in a
// file the map downloads, and the curated file — the one a human edits and a
// diff is read from — keeps the unmissable word instead.

export function toPublicWeek(hours) {
  return DAY_KEYS.map(d => (hours[d] === CLOSED ? '' : hours[d]));
}

// Validate a 7-element public week exactly as strictly as the curated form, so
// a renderer can re-check its input instead of trusting the file it read.
export function isPublicWeek(week) {
  if (!Array.isArray(week) || week.length !== DAY_KEYS.length) return false;
  let stated = 0;
  for (const day of week) {
    if (typeof day !== 'string') return false;
    if (day === '') continue;                 // an explicit "the source says closed"
    if (day === CLOSED) return false;         // the public form spells that ""
    try {
      if (canonicalDaySpec(day) !== day) return false;
    } catch {
      return false;
    }
    stated++;
  }
  // Seven closed days is not a schedule, it is a closed venue.
  return stated > 0;
}

// Everything a visitor gets: the week and the page it came from. Nothing else
// from the record crosses this line.
export function toPublicHours(entry) {
  return { week: toPublicWeek(entry.hours), source: entry.source };
}

// ── Formatting ──────────────────────────────────────────────────────
//
// Grouping consecutive identical days is what turns seven lines into two, which
// is the difference between a schedule that fits in a map popup and one that
// does not. It is a pure function of the week, so the static directory, the map
// popup and the tests all agree on where the runs begin and end.

const DAY_LABELS = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
};

const HOURS_STRINGS = {
  en: { closed: 'Closed', allDay: '24 hours', nextDay: 'next day', dayRange: (a, b) => `${a}–${b}` },
  de: { closed: 'Geschlossen', allDay: '24 Stunden', nextDay: 'Folgetag', dayRange: (a, b) => `${a}–${b}` },
};

// One day's opening times as a reader sees them: "09:00–23:00",
// "09:00–12:00, 15:00–22:00", "24 hours", "Closed", and — for a gym that shuts
// after midnight — "20:00–01:00 (next day)".
export function formatDayHours(spec, lang = 'en') {
  const S = HOURS_STRINGS[lang] ?? HOURS_STRINGS.en;
  if (spec === '' || spec === CLOSED) return S.closed;
  if (isAllDay(spec)) return S.allDay;
  return parseDaySpec(spec).map(r => {
    const start = formatTime(r.start);
    if (r.end > 24 * 60) return `${start}–${formatTime(r.end - 24 * 60)} (${S.nextDay})`;
    return `${start}–${formatTime(r.end)}`;
  }).join(', ');
}

// The week as runs of identical days: [{ days: 'Mon–Fri', hours: '09:00–23:00' }].
export function formatWeeklyGroups(week, lang = 'en') {
  const S = HOURS_STRINGS[lang] ?? HOURS_STRINGS.en;
  const labels = DAY_LABELS[lang] ?? DAY_LABELS.en;
  const groups = [];
  let start = 0;
  for (let i = 1; i <= week.length; i++) {
    if (i < week.length && week[i] === week[start]) continue;
    const end = i - 1;
    groups.push({
      days: start === end ? labels[start] : S.dayRange(labels[start], labels[end]),
      hours: formatDayHours(week[start], lang),
    });
    start = i;
  }
  return groups;
}

// The same week on one line, for a directory entry that has room for a phrase
// and not for a table.
export function formatWeeklyHours(week, lang = 'en') {
  return formatWeeklyGroups(week, lang).map(g => `${g.days} ${g.hours}`).join(' · ');
}

// ── Evidence cross-check ────────────────────────────────────────────
//
// The `evidence` field quotes the schedule as the page states it, and the
// `hours` field is a human's transcription of that same quote. So every clock
// time in the transcription has to appear in the quote — if it does not,
// somebody typed 22:30 where the page said 22:00, and no amount of careful
// sourcing catches that.
//
// The comparison is deliberately loose about spelling, because pages write the
// same time as "10", "10:00", "10.00", "10h00" and "10 Uhr", and strict about
// the number, because the number is the thing that can be wrong. Returns the
// times the evidence does not account for; empty means the record checks out.
// True when `evidence` contains this time in any of the notations gyms use.
//
// Continental pages write 22:30, 22.30, 22h30 or "22 Uhr"; British, Irish and
// American ones write 10pm, 10.30pm or "10:30 PM". The number is what must be
// right, so the separator and the clock convention are both allowed to vary —
// and 12-hour forms are matched against the same 24-hour value, which is the
// step where a transcription actually goes wrong.
function evidenceMentionsTime(evidence, minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const mm = String(m).padStart(2, '0');
  // `h` and `u` are separators too, so a curator quoting a French page does not
  // have to transliterate 22h30, nor a Flemish one 9u30.
  const sep = '[:.hu]';
  // Case-insensitive throughout: French pages write both 08h30 and 08H30.
  const patterns = [
    m === 0
      // A whole hour may be written bare: "10", "10:00", "10.00", "10h", "18u".
      ? new RegExp(`(^|[^0-9])0?${h24}([^0-9:.hu]|${sep}00([^0-9]|$)|[hu]([^0-9]|$)|$)`, 'i')
      : new RegExp(`(^|[^0-9])0?${h24}${sep}${mm}([^0-9]|$)`, 'i'),
  ];
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const meridiem = h24 < 12 ? 'a' : 'p';
  // The `m` is optional because US gyms shorten it away — "M-F: 10A-11P" (The
  // Circuit), "4p-8p" (Boardworks), "mon-fri 6a-10p" (beargrass). The trailing
  // lookahead keeps that from swallowing a word: "9 pages" is not 9 p.m.
  const ampm = `${meridiem}\\.?m?\\.?(?![a-z])`;
  patterns.push(m === 0
    ? new RegExp(`(^|[^0-9])0?${h12}\\s*(${sep}00\\s*)?${ampm}`, 'i')
    : new RegExp(`(^|[^0-9])0?${h12}${sep}${mm}\\s*${ampm}`, 'i'));
  // "630AM" — the separator dropped as well. Only with a meridiem attached: a
  // bare 630 in running text is a number, not half past six.
  if (m !== 0) patterns.push(new RegExp(`(^|[^0-9])${h12}${mm}\\s*${ampm}`, 'i'));
  // A range may carry one meridiem for both ends: "2–8 pm", "10:30-6.30pm".
  // The marker sits on the closing time, so the opening time has to borrow it,
  // and which half of the day it borrows depends on the two numbers: in
  // "2-8 pm" the 2 is afternoon, but in "10-2 pm" the 10 is morning. So this
  // only fires when the pair reads in the same half as the time being checked.
  {
    const other = '(\\d{1,2})(?:[:.hu](\\d{2}))?';
    // The two ends may be joined by a dash or by the word for one: an American
    // gym writing "Monday-Friday 4 to 10 pm" (Inside Moves) means the same as
    // "4-10 pm". Only English words, and only with spaces around them, so a
    // "10to" in a code-like string cannot join two numbers by accident.
    const join = '(?:\\s*[-–—]\\s*|\\s+(?:to|till|til|until|through)\\s+)';
    const lead = new RegExp(`(^|[^0-9])0?${h12}(?:${sep}${mm})?${join}${other}\\s*(a|p)\\.?m?\\.?(?![a-z])`, 'gi');
    patterns.push({
      test(text) {
        for (const hit of String(text).matchAll(lead)) {
          if (m !== 0 && !hit[0].includes(String(mm))) continue;
          const close = Number(hit[2]);
          if (!Number.isFinite(close) || close < 1 || close > 12) continue;
          // The closing marker applies to the opening time only when the pair
          // does not cross noon: 2→8 stays in the afternoon, 10→2 does not.
          const sameHalf = h12 < close || (h12 === 12 && close === 12);
          const closeMeridiem = hit[4].toLowerCase();
          if (sameHalf && closeMeridiem === meridiem) return true;
          // Crossing noon: the opening time is in the other half, so a morning
          // time is confirmed by a pm marker on a smaller closing hour.
          if (!sameHalf && closeMeridiem !== meridiem && meridiem === 'a') return true;
        }
        return false;
      },
    });
  }
  // Words, for the two times that have them.
  if (minutes === 0 || minutes === 24 * 60) patterns.push(/midnight/i);
  if (minutes === 12 * 60) patterns.push(/noon|midday/i);
  return patterns.some(re => re.test(evidence));
}

export function timesMissingFromEvidence(entry) {
  const evidence = typeof entry?.evidence === 'string' ? entry.evidence : '';
  const missing = new Set();
  for (const day of DAY_KEYS) {
    const spec = entry?.hours?.[day];
    if (typeof spec !== 'string' || spec === CLOSED) continue;
    // "24 hours" is normally written as a word ("täglich geöffnet", "24/7"),
    // so its two boundary times are not expected to appear as digits.
    if (isAllDay(spec)) continue;
    let ranges;
    try { ranges = parseDaySpec(spec); } catch { continue; }
    for (const r of ranges) {
      for (const minutes of [r.start, r.end]) {
        if (!evidenceMentionsTime(evidence, minutes)) missing.add(formatTime(minutes));
      }
    }
  }
  return [...missing].sort();
}

// ── Record schema ───────────────────────────────────────────────────

export const PROVENANCE = new Set([
  // The venue's own site, and the page is specific to this location.
  'official-location-page',
  // The venue's own site; it has a single location, so its hours page is this
  // location's hours page.
  'official-site',
  // A chain site with no per-location page. Accepted only when the page itself
  // says which locations the hours apply to — see the `hours-scope` signal.
  'official-chain-page',
  // A booking, timetable or access page the venue itself runs. Same standard:
  // it has to be the venue's own, and it has to name this location.
  'official-booking-page',
]);

export const SIGNALS = new Set([
  'name',            // the venue name appears on the page
  'brand',           // the chain/brand name appears and the venue carries it
  'street-address',  // the street line matches the venue's upstream address
  'postal-code',     // postal code matches
  'city',            // city matches
  'location-page',   // the page is an explicit per-location page for this venue
  'coordinates',     // the page publishes coordinates within ~250 m
  'board-mention',   // the page names the board system the venue is listed for
  'venue-link',      // the already-verified venue-links record for this venue
  'hours-scope',     // the page states which location(s) these hours apply to
  // A venue-links record for the same venue sits within CO_LOCATED_LIMIT_M and
  // its name matches. The dataset lists some gyms twice — one entry per board,
  // or with a coordinate a few metres apart — and only one of the two carries
  // the verified link. This says "the hall next door is this hall", which is a
  // claim a test can check, and does the work `venue-link` does for the twin.
  'co-located',
]);

// How far apart two dataset entries may be and still be the same hall. A large
// gym is ~50 m across; 150 m allows for a coordinate taken at the car park.
export const CO_LOCATED_LIMIT_M = 150;

// Signals that restate one observation may not both count toward the minimum.
const REDUNDANT_SIGNAL_PAIRS = [['name', 'brand']];

export const MIN_SIGNALS = 2;

const MAX_EVIDENCE_LENGTH = 600;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function isValidIsoDate(s) {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const ALLOWED_KEYS = new Set([
  'lat', 'lon', 'name', 'country', 'source', 'checked', 'provenance',
  'signals', 'hours', 'evidence', 'note',
]);

// Validate one curated record. Returns an array of human-readable problems;
// empty means the record may be applied.
export function validateVenueHours(entry, index = 0) {
  const where = `venue-hours[${index}]${entry && entry.name ? ` "${entry.name}"` : ''}`;
  const problems = [];
  const fail = msg => problems.push(`${where}: ${msg}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where}: not an object`];
  }
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_KEYS.has(key)) fail(`unknown field "${key}"`);
  }

  if (typeof entry.lat !== 'number' || !Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) {
    fail('"lat" must be a number in [-90, 90]');
  }
  if (typeof entry.lon !== 'number' || !Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) {
    fail('"lon" must be a number in [-180, 180]');
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    fail('"name" must be a non-empty string');
  }
  if (typeof entry.country !== 'string' || !COUNTRY_RE.test(entry.country)) {
    fail('"country" must be an uppercase ISO-3166-1 alpha-2 code');
  }
  if (typeof entry.checked !== 'string' || !isValidIsoDate(entry.checked)) {
    fail('"checked" must be a real UTC date as YYYY-MM-DD');
  }
  if (typeof entry.provenance !== 'string' || !PROVENANCE.has(entry.provenance)) {
    fail(`"provenance" must be one of ${[...PROVENANCE].join(', ')}`);
  }
  if (typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
    fail('"evidence" must quote the schedule as the official page states it');
  } else if (entry.evidence.length > MAX_EVIDENCE_LENGTH) {
    fail(`"evidence" exceeds ${MAX_EVIDENCE_LENGTH} characters — quote the schedule, not the page`);
  }
  if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.trim() === '')) {
    fail('"note" must be a non-empty string when present');
  }

  if (typeof entry.source !== 'string') {
    fail('"source" must be a string');
  } else {
    try {
      const canonical = normalizeVenueUrl(entry.source);
      if (canonical !== entry.source) {
        fail(`"source" is not canonical — store ${JSON.stringify(canonical)}`);
      }
    } catch (err) {
      fail(`"source" ${err.message.replace(/^website /, '')}`);
    }
  }

  let signalSet = new Set();
  if (!Array.isArray(entry.signals)) {
    fail('"signals" must be an array');
  } else {
    for (const s of entry.signals) {
      if (typeof s !== 'string' || !SIGNALS.has(s)) {
        fail(`unknown signal ${JSON.stringify(s)}`);
        continue;
      }
      if (signalSet.has(s)) fail(`duplicate signal "${s}"`);
      signalSet.add(s);
    }
    let independent = signalSet.size;
    for (const [a, b] of REDUNDANT_SIGNAL_PAIRS) {
      if (signalSet.has(a) && signalSet.has(b)) independent--;
    }
    if (independent < MIN_SIGNALS) {
      fail(`needs at least ${MIN_SIGNALS} independent signals, has ${independent}`);
    }
    if (entry.provenance === 'official-chain-page' && !signalSet.has('hours-scope')) {
      fail('"official-chain-page" needs the "hours-scope" signal — one chain\'s hours may'
        + ' only be published for a branch when the page itself says they apply to it');
    }
    if (entry.provenance === 'official-chain-page'
      && !signalSet.has('street-address') && !signalSet.has('city')
      && !signalSet.has('location-page') && !signalSet.has('co-located')) {
      fail('"official-chain-page" requires street-address, city, location-page or co-located'
        + ' among its signals');
    }
  }

  if (!entry.hours || typeof entry.hours !== 'object' || Array.isArray(entry.hours)) {
    fail('"hours" must be an object with one entry per weekday');
  } else {
    for (const key of Object.keys(entry.hours)) {
      if (!DAY_KEYS.includes(key)) fail(`"hours" has an unknown day "${key}"`);
    }
    let stated = 0;
    for (const day of DAY_KEYS) {
      const spec = entry.hours[day];
      if (spec === undefined) {
        fail(`"hours.${day}" is missing — every day the source states must be written down,`
          + ' and a source that states fewer than seven publishes no schedule this file can carry');
        continue;
      }
      try {
        if (canonicalDaySpec(spec) !== spec) {
          fail(`"hours.${day}" is not canonical — store ${JSON.stringify(canonicalDaySpec(spec))}`);
        }
        if (spec !== CLOSED) stated++;
      } catch (err) {
        fail(`"hours.${day}": ${err.message}`);
      }
    }
    if (stated === 0) {
      fail('every day is closed — that is a closed venue, not a schedule');
    }
  }

  return problems;
}

// Read + validate the curated file. Throws on anything that makes the file as a
// whole unusable; per-record problems come back in `errors` so the report can
// show them all at once instead of one per run.
export function loadVenueHours(file) {
  if (!existsSync(file)) return { entries: [], errors: [], present: false };

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${file} must be a JSON array of venue-hours objects`);
  }

  const errors = [];
  raw.forEach((entry, i) => errors.push(...validateVenueHours(entry, i)));

  const byKey = new Map();
  raw.forEach((entry, i) => {
    if (!entry || typeof entry.lat !== 'number' || typeof entry.lon !== 'number') return;
    const k = venueKey(entry.lat, entry.lon);
    if (byKey.has(k)) {
      errors.push(`venue-hours[${i}] "${entry.name}": duplicate coordinate — already claimed by venue-hours[${byKey.get(k)}]`);
    } else {
      byKey.set(k, i);
    }
  });

  return { entries: raw, errors, present: true };
}

// ── Outcome log ─────────────────────────────────────────────────────
//
// `tools/venue-hours-research.json` records every venue that was reviewed and
// got no hours, with the reason. It is deliberately not production data:
// nothing in it reaches boards.geojson, the map or the directories.
//
// It exists so that "no hours" stops being indistinguishable from "nobody has
// looked yet" — and because most of these outcomes are worth re-reading later.
// A site that answered 503 today is not a fact about the venue.

export const RESEARCH_STATUS = new Set([
  'private',                   // home wall / not open to the public
  'closed',                    // venue is permanently closed
  'no-official-site',          // no official site to read hours from
  'no-hours-on-official-site', // the official site publishes no schedule
  'ambiguous',                 // contradictory, partial, or branch identity unclear
  'seasonal',                  // hours vary by season/term and no regular week is stated
  'appointment-only',          // access by booking, membership or arrangement only
  'inaccessible',              // the page could not be read (403, TLS, JS-only, …)
  'pending',                   // reviewed, undecided, deliberately queued
]);

const RESEARCH_KEYS = new Set([
  'lat', 'lon', 'name', 'country', 'status', 'checked', 'reason', 'source',
]);

// Validate one outcome record. Same shape discipline as an hours record, minus
// the URL policy: a `source` here is a page that did *not* yield usable hours,
// so it is only required to be a string and it is never rendered anywhere.
export function validateHoursResearchEntry(entry, index = 0) {
  const where = `venue-hours-research[${index}]${entry && entry.name ? ` "${entry.name}"` : ''}`;
  const problems = [];
  const fail = msg => problems.push(`${where}: ${msg}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where}: not an object`];
  }
  for (const key of Object.keys(entry)) {
    if (!RESEARCH_KEYS.has(key)) fail(`unknown field "${key}"`);
  }
  if (typeof entry.lat !== 'number' || !Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) {
    fail('"lat" must be a number in [-90, 90]');
  }
  if (typeof entry.lon !== 'number' || !Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) {
    fail('"lon" must be a number in [-180, 180]');
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') fail('"name" must be a non-empty string');
  if (typeof entry.country !== 'string' || !COUNTRY_RE.test(entry.country)) {
    fail('"country" must be an uppercase ISO-3166-1 alpha-2 code');
  }
  if (typeof entry.status !== 'string' || !RESEARCH_STATUS.has(entry.status)) {
    fail(`"status" must be one of ${[...RESEARCH_STATUS].join(', ')}`);
  }
  if (typeof entry.checked !== 'string' || !isValidIsoDate(entry.checked)) {
    fail('"checked" must be a real UTC date as YYYY-MM-DD');
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    fail('"reason" must say why this venue got no hours');
  }
  if (entry.source !== undefined && (typeof entry.source !== 'string' || entry.source.trim() === '')) {
    fail('"source" must be a non-empty string when present');
  }
  return problems;
}

export function loadHoursResearch(file) {
  if (!existsSync(file)) return { entries: [], errors: [], present: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${file} must be a JSON array of outcome objects`);
  }
  const errors = [];
  raw.forEach((entry, i) => errors.push(...validateHoursResearchEntry(entry, i)));
  return { entries: raw, errors, present: true };
}

// ── Matching ────────────────────────────────────────────────────────

// Properties this overlay owns. Cleared before every application so that
// deleting a record actually removes its hours, including in the overlay-only
// rebuild that starts from an already-populated boards.geojson.
// Same threshold and the same reasoning as the shared-URL advisory on venue
// links: two upstream entries for one gym sit metres apart, two of an
// operator's gyms do not.
export const SHARED_SOURCE_SITE_LIMIT_M = 1000;

export const MANAGED_PROPERTIES = ['hours', 'hours_src'];

export function clearVenueHoursProperties(features) {
  for (const f of features) {
    for (const key of MANAGED_PROPERTIES) delete f.properties[key];
  }
}

// Apply every curated record onto `features`, in place.
//
// Returns { stats, problems, notes }:
//   stats    — counts for boards.meta.json (no URLs, no names, no dates)
//   problems — one line per refused record, for stderr and the report
//   notes    — non-fatal observations (proximity rematches, shared sources)
export function applyVenueHours(features, entries) {
  const stats = {
    defined: entries.length,
    applied: 0,
    matched_by_proximity: 0,
    unmatched: 0,
    ambiguous: 0,
    private_refused: 0,
    rejected: 0,
    countries: 0,
    open_24h_days: 0,
    by_provenance: {},
  };
  const problems = [];
  const notes = [];

  clearVenueHoursProperties(features);

  const byKey = buildVenueIndex(features);

  // Pass 1 — validate and resolve, without writing anything.
  const resolved = [];
  entries.forEach((entry, i) => {
    const invalid = validateVenueHours(entry, i);
    if (invalid.length) {
      stats.rejected++;
      problems.push(...invalid);
      return;
    }
    const r = resolveVenueRecord(entry, `venue-hours[${i}] "${entry.name}"`, byKey, features);
    if (r.status !== 'ok') {
      if (r.status === 'unmatched') stats.unmatched++;
      else if (r.status === 'ambiguous') stats.ambiguous++;
      else if (r.status === 'private-venue') stats.private_refused++;
      else stats.rejected++;
      problems.push(r.reason);
      return;
    }
    resolved.push({ entry, index: i, ...r });
  });

  // Pass 2 — refuse collisions. Two records resolving onto one venue means at
  // least one of them is wrong, and nothing in the data says which, so both go.
  const claims = new Map();
  for (const r of resolved) {
    const [lon, lat] = r.feature.geometry.coordinates;
    const k = venueKey(lat, lon);
    if (!claims.has(k)) claims.set(k, []);
    claims.get(k).push(r);
  }
  const accepted = [];
  for (const [, group] of claims) {
    if (group.length > 1) {
      stats.ambiguous += group.length;
      problems.push(
        `venue-hours ${group.map(g => `[${g.index}] "${g.entry.name}"`).join(' and ')}: `
        + 'resolve onto the same venue — dropping all of them',
      );
      continue;
    }
    accepted.push(group[0]);
  }

  // Pass 3 — write. Exactly two properties, both from toPublicHours().
  const countries = new Set();
  const sourceUsers = new Map();
  for (const { entry, feature, how, similarity } of accepted) {
    const pub = toPublicHours(entry);
    feature.properties.hours = pub.week;
    feature.properties.hours_src = pub.source;
    stats.applied++;
    countries.add(entry.country);
    stats.by_provenance[entry.provenance] = (stats.by_provenance[entry.provenance] ?? 0) + 1;
    stats.open_24h_days += pub.week.filter(isAllDay).length;
    if (how === 'proximity') {
      stats.matched_by_proximity++;
      notes.push(`venue-hours "${entry.name}": coordinate drifted — rematched by name/proximity (similarity ${similarity.toFixed(2)})`);
    }
    const list = sourceUsers.get(entry.source) ?? [];
    list.push({ name: entry.name, lat: entry.lat, lon: entry.lon, provenance: entry.provenance });
    sourceUsers.set(entry.source, list);
  }
  stats.countries = countries.size;

  // One page giving hours for two venues is normal when upstream split one gym
  // into two entries metres apart. Kilometres apart it is two of an operator's
  // gyms, and then the page has to be the kind that says whose hours these are.
  for (const [source, users] of sourceUsers) {
    if (users.length < 2) continue;
    let apart = 0;
    for (const a of users) {
      for (const b of users) apart = Math.max(apart, distanceMeters(a.lat, a.lon, b.lat, b.lon));
    }
    if (apart <= SHARED_SOURCE_SITE_LIMIT_M) continue;
    const claiming = users.filter(u => u.provenance !== 'official-chain-page').map(u => u.name);
    if (claiming.length) {
      notes.push(`venue-hours: ${source} supplies hours for venues ${Math.round(apart)} m apart, but `
        + `${claiming.join(', ')} still claim a page of their own — confirm the page states which `
        + 'location these hours are for (use official-chain-page) or split the record');
    }
  }

  stats.by_provenance = Object.fromEntries(
    Object.entries(stats.by_provenance).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  return { stats, problems, notes };
}


// The guard every renderer runs before putting hours on a page. The values
// reached it through this module, which already refused anything malformed —
// but they arrived via a file on disk or a fetch, and a renderer that trusts its
// input is one bad merge away from printing nonsense on 2,800 directory lines.
export function safePublicHours(props) {
  const week = props?.hours;
  if (!isPublicWeek(week)) return null;
  const source = props?.hours_src;
  if (typeof source !== 'string' || !isCanonicalVenueUrl(source)) return null;
  return { week, source };
}

// True when the hours source is a different page from the venue's website link,
// and therefore worth its own link rather than being the link already on screen.
export function sourceIsDistinct(props) {
  return props?.hours_src !== props?.website;
}

export { classifyVenue, venueKey };
