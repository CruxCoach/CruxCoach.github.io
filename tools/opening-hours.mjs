// A deliberately bounded reader for the OpenStreetMap `opening_hours` tag.
//
// WHY NOT A REAL PARSER. The reference implementation (opening_hours.js)
// covers the whole specification — holidays, school holidays, sunrise/sunset,
// week and month selectors, year ranges, fallbacks — and is several hundred
// kilobytes of code plus a holiday database. Vendoring it would put a large
// third-party dependency into a repository whose whole point is not having
// any, and it would tempt the site into the one claim this feature must never
// make: "open now". Deciding whether a venue is open right now requires the
// venue's timezone, the local public-holiday calendar, school-holiday terms,
// seasonal rules and one-off closures to all be correct. They are not, so the
// site never says it.
//
// WHAT THIS DOES INSTEAD. It renders the straightforward weekly schedules —
// which is what the overwhelming majority of climbing gyms actually tag — and
// refuses everything else. A refusal is not a failure: the caller falls back
// to showing the unmodified OSM value and linking the exact OSM object, which
// is always correct even when it is not pretty.
//
// The supported subset, in full:
//
//   value     := rule ((';' | ',') rule)*
//   rule      := '24/7' | [selector] timespec
//   selector  := daygroup (',' daygroup)*
//   daygroup  := DAY | DAY '-' DAY | 'PH'
//   DAY       := Mo | Tu | We | Th | Fr | Sa | Su
//   timespec  := 'off' | 'closed' | timerange (',' timerange)*
//   timerange := H:MM '-' H:MM          (00:00 … 24:00)
//
// Anything else — month or date selectors, week numbers, SH (school
// holidays), sunrise/sunset, open-ended `18:00+`, nth-weekday `Mo[1]`,
// comments, `||` fallbacks — is reported as unsupported and shown raw.
//
// Everything user-facing is produced here, in both site languages, so that
// the map popup and the generated static directories cannot drift apart:
// they are handed finished strings and only place them into the page.

// OSM weekday abbreviations, Monday first — the order the tag itself uses.
export const DAY_TOKENS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_INDEX = Object.fromEntries(DAY_TOKENS.map((d, i) => [d.toLowerCase(), i]));

// ── Language tables ───────────────────────────────────────────────────────
// Shared chrome (heading, attribution, source link) lives in `STRINGS` and is
// written once into the sidecar; per-venue text is rendered per venue.
export const STRINGS = {
  en: {
    heading: 'Opening hours according to OpenStreetMap',
    attribution: 'Opening hours © OpenStreetMap contributors, ODbL 1.0',
    source: 'View or correct these hours on OpenStreetMap',
    rawLabel: 'Value as recorded in OpenStreetMap',
    unsupported: 'OpenStreetMap records these opening hours in a format this page does not translate. The unchanged value is shown here.',
  },
  de: {
    heading: 'Öffnungszeiten laut OpenStreetMap',
    attribution: 'Öffnungszeiten © OpenStreetMap-Mitwirkende, ODbL 1.0',
    source: 'Zeiten auf OpenStreetMap ansehen oder korrigieren',
    rawLabel: 'Wert wie in OpenStreetMap hinterlegt',
    unsupported: 'OpenStreetMap hinterlegt diese Öffnungszeiten in einem Format, das diese Seite nicht übersetzt. Hier steht der unveränderte Wert.',
  },
};

const LANG = {
  en: {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    dayRange: (a, b) => `${a}–${b}`,
    dayJoin: ', ',
    closed: 'Closed',
    everyDay: 'Every day',
    allDay: 'Open 24 hours',
    publicHolidays: 'Public holidays',
    timeJoin: ', ',
    timeRange: (a, b) => `${a}–${b}`,
    noteUnspecified: (days) => `OpenStreetMap records no hours for ${days}.`,
    noteOvernight: 'A range that ends earlier than it starts runs past midnight into the following day.',
    noteExceptions: 'Public holidays, school holidays, seasonal changes and one-off closures are not shown here.',
    freshnessChecked: (date) => `Hours last verified in OpenStreetMap on ${date}.`,
    freshnessEdited: (date) => `OpenStreetMap object last edited on ${date}.`,
    freshnessUnknown: 'OpenStreetMap does not record when these hours were last checked.',
  },
  de: {
    days: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    dayRange: (a, b) => `${a}–${b}`,
    dayJoin: ', ',
    closed: 'Geschlossen',
    everyDay: 'Täglich',
    allDay: 'Durchgehend geöffnet',
    publicHolidays: 'Feiertage',
    timeJoin: ', ',
    timeRange: (a, b) => `${a}–${b}`,
    noteUnspecified: (days) => `Für ${days} sind in OpenStreetMap keine Zeiten hinterlegt.`,
    noteOvernight: 'Endet eine Spanne früher als sie beginnt, reicht sie über Mitternacht in den Folgetag.',
    noteExceptions: 'Feiertage, Schulferien, saisonale Änderungen und einzelne Schließtage sind hier nicht abgebildet.',
    freshnessChecked: (date) => `Zeiten zuletzt in OpenStreetMap geprüft am ${date}.`,
    freshnessEdited: (date) => `OpenStreetMap-Objekt zuletzt bearbeitet am ${date}.`,
    freshnessUnknown: 'OpenStreetMap hält nicht fest, wann diese Zeiten zuletzt geprüft wurden.',
  },
};

export const LANGS = ['en', 'de'];

// ── Parsing ───────────────────────────────────────────────────────────────

// A trailing `off`/`closed`, or a trailing comma-separated list of HH:MM-HH:MM
// ranges. Anchored at the end so the part in front of it is the day selector.
const TIME_LIST_RE = /(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*$/;
const CLOSED_RE = /(?:^|\s)(?:off|closed)$/i;
const SINGLE_RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

function parseTime(hh, mm) {
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (m < 0 || m > 59) return null;
  // 24:00 is the legal way to write "until midnight"; anything past it is the
  // extended-time syntax (25:00 = 1 am the next day) which this reader does
  // not render, because a reader would have to be told what it means.
  if (h < 0 || h > 24) return null;
  if (h === 24 && m !== 0) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseTimeList(text) {
  const ranges = [];
  for (const piece of text.split(',')) {
    const m = piece.trim().match(SINGLE_RANGE_RE);
    if (!m) return null;
    const from = parseTime(m[1], m[2]);
    const to = parseTime(m[3], m[4]);
    if (from === null || to === null) return null;
    // `00:00-00:00` is used for "all day" by some editors and for "closed" by
    // others. Ambiguous input is refused rather than guessed at.
    if (from === to) return null;
    ranges.push({ from, to });
  }
  return ranges.length ? ranges : null;
}

// `,` is the specification's "additional rule" separator, and gyms use it
// interchangeably with `;` — `Mo-Fr 10:00-22:00, Sa-Su 09:00-19:00` is a
// common way to write a perfectly ordinary week. It is also the separator
// inside a day list (`Mo,Fr 09:30-20:00`) and inside a time list
// (`08:00-12:00,13:00-18:00`), so it may only be cut where both sides prove
// it is a rule boundary: what precedes it has to end a timespec, and what
// follows has to start a new day selector. Everything else stays inside its
// rule, where the selector and time parsers deal with it.
const ENDS_TIMESPEC_RE = /(?:\d{1,2}:\d{2}|off|closed)\s*$/i;
const STARTS_SELECTOR_RE = /^\s*(?:PH|Mo|Tu|We|Th|Fr|Sa|Su)\b/i;

function splitRules(value) {
  const rules = [];
  for (const chunk of value.split(';')) {
    const parts = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== ',') continue;
      const before = chunk.slice(start, i);
      const after = chunk.slice(i + 1);
      if (ENDS_TIMESPEC_RE.test(before) && STARTS_SELECTOR_RE.test(after)) {
        parts.push(before.trim());
        start = i + 1;
      }
    }
    parts.push(chunk.slice(start).trim());
    parts.forEach((text, index) => {
      if (text) rules.push({ text, additional: index > 0 });
    });
  }
  return rules;
}

// Day selector → { days: number[], ph: boolean } or null when unsupported.
function parseSelector(text) {
  const days = new Set();
  let ph = false;
  for (const rawToken of text.split(',')) {
    const token = rawToken.trim();
    if (!token) return null;
    if (/^ph$/i.test(token)) { ph = true; continue; }
    const range = token.split('-').map((t) => t.trim());
    if (range.length === 1) {
      const idx = DAY_INDEX[range[0].toLowerCase()];
      if (idx === undefined) return null;
      days.add(idx);
      continue;
    }
    if (range.length !== 2) return null;
    const from = DAY_INDEX[range[0].toLowerCase()];
    const to = DAY_INDEX[range[1].toLowerCase()];
    if (from === undefined || to === undefined) return null;
    // Ranges may wrap the week end: Fr-Mo is Fri, Sat, Sun, Mon.
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === to) break;
    }
  }
  if (!days.size && !ph) return null;
  return { days: [...days], ph };
}

/**
 * Parse an `opening_hours` value into a weekly table.
 *
 * @returns {{ok: true, week: Array, ph: any, allWeekAllDay: boolean, wrapsMidnight: boolean}
 *          | {ok: false, reason: string}}
 *   `week[i]` is `undefined` (no rule covers that day), `'closed'`, or an
 *   array of `{from, to}`. `ph` is `undefined`, `'closed'` or ranges.
 */
export function parseOpeningHours(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'not-a-string' };
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'empty' };
  // A tagged value this long is a seasonal timetable, not a weekly schedule.
  if (value.length > 250) return { ok: false, reason: 'too-long' };
  // Comments and `||` fallback rules change what the rest of the value means.
  if (/["|]/.test(value)) return { ok: false, reason: 'comment-or-fallback' };

  const week = new Array(7).fill(undefined);
  let ph;
  let sawRule = false;

  for (const { text: rule, additional } of splitRules(value)) {
    sawRule = true;

    if (/^24\/7$/i.test(rule)) {
      for (let i = 0; i < 7; i++) week[i] = [{ from: '00:00', to: '24:00' }];
      continue;
    }

    let selectorText;
    let times;
    const closed = rule.match(CLOSED_RE);
    if (closed) {
      selectorText = rule.slice(0, rule.length - closed[0].length).trim();
      times = 'closed';
    } else {
      const list = rule.match(TIME_LIST_RE);
      if (!list) return { ok: false, reason: 'unsupported-rule' };
      selectorText = rule.slice(0, list.index).trim();
      times = parseTimeList(list[0]);
      if (!times) return { ok: false, reason: 'unsupported-time' };
    }

    // No selector at all means "every day" (`09:00-18:00`). A bare `off`
    // without a selector is refused: it is a whole-object override whose
    // interaction with the preceding rules is not worth guessing.
    let selector;
    if (!selectorText) {
      if (times === 'closed') return { ok: false, reason: 'unsupported-rule' };
      selector = { days: [0, 1, 2, 3, 4, 5, 6], ph: false };
    } else {
      selector = parseSelector(selectorText);
      if (!selector) return { ok: false, reason: 'unsupported-selector' };
    }

    // A `;` rule overrides earlier rules for the days it names, which is why
    // `Mo-Su 09:00-22:00; We off` works. A `,` rule ADDS to them instead, and
    // adding two schedules to the same day means unioning two time sets —
    // refused here, because a union rendered as an override would quietly
    // hide half of a venue's hours.
    if (additional) {
      for (const d of selector.days) {
        if (week[d] !== undefined) return { ok: false, reason: 'overlapping-additional-rule' };
      }
      if (selector.ph && ph !== undefined) {
        return { ok: false, reason: 'overlapping-additional-rule' };
      }
    }
    for (const d of selector.days) week[d] = times;
    if (selector.ph) ph = times;
  }

  if (!sawRule) return { ok: false, reason: 'empty' };

  let wrapsMidnight = false;
  for (const entry of [...week, ph]) {
    if (!Array.isArray(entry)) continue;
    for (const r of entry) if (r.to < r.from) wrapsMidnight = true;
  }

  const allWeekAllDay = week.every(
    (d) => Array.isArray(d) && d.length === 1 && d[0].from === '00:00' && d[0].to === '24:00',
  );

  return { ok: true, week, ph, allWeekAllDay, wrapsMidnight };
}

// ── Rendering ─────────────────────────────────────────────────────────────

function signature(entry) {
  if (entry === undefined) return null;
  if (entry === 'closed') return 'closed';
  return entry.map((r) => `${r.from}-${r.to}`).join(',');
}

// Consecutive day indices → "Mon–Fri"; non-consecutive → "Mon, Wed, Fri".
function dayLabel(indices, L) {
  const sorted = [...indices].sort((a, b) => a - b);
  const runs = [];
  for (const i of sorted) {
    const last = runs[runs.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i);
    else runs.push([i]);
  }
  return runs
    .map((run) => (run.length === 1
      ? L.days[run[0]]
      : L.dayRange(L.days[run[0]], L.days[run[run.length - 1]])))
    .join(L.dayJoin);
}

function timesLabel(entry, L) {
  if (entry === 'closed') return L.closed;
  return entry.map((r) => L.timeRange(r.from, r.to)).join(L.timeJoin);
}

// Render one parsed schedule into finished lines + notes for one language.
function renderParsed(parsed, lang) {
  const L = LANG[lang];
  const lines = [];
  const notes = [];

  if (parsed.allWeekAllDay) {
    lines.push({ label: L.everyDay, value: L.allDay });
  } else {
    // Group days that share a schedule, ordered by their first day so the
    // output is stable no matter how the rules were written.
    const groups = new Map();
    for (let i = 0; i < 7; i++) {
      const sig = signature(parsed.week[i]);
      if (sig === null) continue;
      if (!groups.has(sig)) groups.set(sig, { entry: parsed.week[i], days: [] });
      groups.get(sig).days.push(i);
    }
    const ordered = [...groups.values()].sort((a, b) => a.days[0] - b.days[0]);
    for (const g of ordered) {
      lines.push({ label: dayLabel(g.days, L), value: timesLabel(g.entry, L) });
    }
  }

  if (parsed.ph !== undefined) {
    lines.push({ label: L.publicHolidays, value: timesLabel(parsed.ph, L) });
  }

  const unspecified = [];
  for (let i = 0; i < 7; i++) if (parsed.week[i] === undefined) unspecified.push(i);
  if (unspecified.length && !parsed.allWeekAllDay) {
    notes.push(L.noteUnspecified(dayLabel(unspecified, L)));
  }
  if (parsed.wrapsMidnight) notes.push(L.noteOvernight);
  // Always last, and always present: this page shows a weekly pattern, and a
  // weekly pattern is not a promise about any particular day.
  notes.push(L.noteExceptions);

  return { lines, notes };
}

/**
 * Render an `opening_hours` value for both site languages.
 *
 * @returns {{kind: 'schedule'|'raw', reason: string|null, raw: string,
 *            en: {lines: Array, notes: string[]}, de: {...}}}
 *   `kind: 'raw'` means the value is outside the supported subset: show
 *   `raw` unchanged and link the OSM object instead of interpreting it.
 */
export function renderOpeningHours(raw, { languages = LANGS } = {}) {
  const parsed = parseOpeningHours(raw);
  const out = {
    kind: parsed.ok ? 'schedule' : 'raw',
    reason: parsed.ok ? null : parsed.reason,
    raw: typeof raw === 'string' ? raw.trim() : '',
  };
  for (const lang of languages) {
    out[lang] = parsed.ok ? renderParsed(parsed, lang) : { lines: [], notes: [] };
  }
  return out;
}

// ── Freshness ─────────────────────────────────────────────────────────────

// Formatted by hand rather than through Intl: the output is committed to the
// repository, so it has to be identical on every machine that rebuilds it,
// regardless of the ICU data that machine happens to ship.
export function formatDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  return lang === 'de' ? `${d}.${mo}.${y}` : `${y}-${mo}-${d}`;
}

/**
 * One sentence per language saying how old the hours are.
 *
 * `check_date:opening_hours` is a mapper saying "I stood in front of this and
 * the hours were right on that day", which is a stronger statement than the
 * object's edit timestamp — so it wins when present, and the wording says
 * which of the two the reader is looking at.
 */
export function renderFreshness({ checkDate, timestamp }, { languages = LANGS } = {}) {
  const out = {};
  for (const lang of languages) {
    const L = LANG[lang];
    const checked = formatDate(checkDate, lang);
    if (checked) { out[lang] = L.freshnessChecked(checked); continue; }
    const edited = formatDate(timestamp, lang);
    out[lang] = edited ? L.freshnessEdited(edited) : L.freshnessUnknown;
  }
  return out;
}
