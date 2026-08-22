import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDate, parseOpeningHours, renderFreshness, renderOpeningHours, STRINGS,
} from './opening-hours.mjs';

// Rendered lines as "label: value", which is how they read on the page.
function lines(value, lang = 'en') {
  const r = renderOpeningHours(value);
  assert.equal(r.kind, 'schedule', `expected ${JSON.stringify(value)} to render, got ${r.reason}`);
  return r[lang].lines.map((l) => `${l.label}: ${l.value}`);
}

function reason(value) {
  const r = renderOpeningHours(value);
  assert.equal(r.kind, 'raw', `expected ${JSON.stringify(value)} to be refused`);
  return r.reason;
}

// ── The supported subset ──────────────────────────────────────────────────

test('a plain weekday split renders in both languages', () => {
  assert.deepEqual(lines('Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00'), [
    'Mon–Fri: 09:00–22:00',
    'Sat–Sun: 10:00–20:00',
  ]);
  assert.deepEqual(lines('Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00', 'de'), [
    'Mo–Fr: 09:00–22:00',
    'Sa–So: 10:00–20:00',
  ]);
});

test('days that share a schedule are grouped, consecutive ones as a range', () => {
  assert.deepEqual(lines('Mo,We,Fr 10:00-23:00; Tu,Th 07:00-23:00'), [
    'Mon, Wed, Fri: 10:00–23:00',
    'Tue, Thu: 07:00–23:00',
  ]);
});

test('output order follows the week, not the order the rules were written in', () => {
  assert.deepEqual(lines('Sa,Su 08:00-23:00; Mo-Fr 07:00-23:00'), [
    'Mon–Fri: 07:00–23:00',
    'Sat–Sun: 08:00–23:00',
  ]);
});

test('a later rule overrides an earlier one for the days it names', () => {
  // The two open runs share a schedule, so they share a line — the reader
  // sees one statement per distinct schedule, not one per calendar run.
  assert.deepEqual(lines('Mo-Su 10:00-22:00; We off'), [
    'Mon–Tue, Thu–Sun: 10:00–22:00',
    'Wed: Closed',
  ]);
});

test('a day range may wrap the end of the week', () => {
  assert.deepEqual(lines('Fr-Mo 10:00-18:00'), ['Mon, Fri–Sun: 10:00–18:00']);
});

test('a time list inside one rule stays one line', () => {
  assert.deepEqual(lines('Mo-Fr 08:00-12:00,13:00-18:00'), [
    'Mon–Fri: 08:00–12:00, 13:00–18:00',
  ]);
});

test('a rule without a selector applies to the whole week', () => {
  assert.deepEqual(lines('10:00-23:00'), ['Mon–Sun: 10:00–23:00']);
});

test('24/7 and a full-week 00:00-24:00 both read as open around the clock', () => {
  assert.deepEqual(lines('24/7'), ['Every day: Open 24 hours']);
  assert.deepEqual(lines('Mo-Su 00:00-24:00'), ['Every day: Open 24 hours']);
  assert.deepEqual(lines('24/7', 'de'), ['Täglich: Durchgehend geöffnet']);
});

test('public holidays get their own line, never merged into a weekday', () => {
  assert.deepEqual(lines('Mo-Fr 07:00-23:00; Sa,Su,PH 08:00-23:00'), [
    'Mon–Fri: 07:00–23:00',
    'Sat–Sun: 08:00–23:00',
    'Public holidays: 08:00–23:00',
  ]);
  assert.deepEqual(lines('Mo-Fr 09:00-22:00; PH off').at(-1), 'Public holidays: Closed');
});

test('single-digit hours are padded so the column lines up', () => {
  assert.deepEqual(lines('Mo-Fr 9:00-17:30'), ['Mon–Fri: 09:00–17:30']);
});

test('midnight is accepted as 24:00 at the end of a range', () => {
  assert.deepEqual(lines('Fr 10:00-24:00'), ['Fri: 10:00–24:00']);
});

// ── The comma rule separator ──────────────────────────────────────────────

test('a comma between rules is a rule boundary', () => {
  assert.deepEqual(lines('Mo-Fr 10:00-22:00, Sa-Su 09:00-19:00'), [
    'Mon–Fri: 10:00–22:00',
    'Sat–Sun: 09:00–19:00',
  ]);
});

test('a comma inside a day list is not a rule boundary', () => {
  assert.deepEqual(lines('Mo,Fr 09:30-20:00, Tu,Th 10:30-14:00, We Off'), [
    'Mon, Fri: 09:30–20:00',
    'Tue, Thu: 10:30–14:00',
    'Wed: Closed',
  ]);
});

test('a comma inside a time list is not a rule boundary either', () => {
  // The dangerous case: cutting here would turn the afternoon into a rule
  // with no selector, i.e. "every day 13:00-18:00".
  const r = renderOpeningHours('Mo-Fr 08:00-12:00,13:00-18:00');
  assert.equal(r.en.lines.length, 1);
});

test('two comma rules covering the same day are refused, not silently merged', () => {
  assert.equal(reason('Mo-Su 10:00-22:00, Mo-Su 23:00-23:30'), 'overlapping-additional-rule');
});

// ── What it refuses ───────────────────────────────────────────────────────

test('school holidays, months and week selectors are refused', () => {
  assert.equal(reason('Mo-Fr 10:00-22:00; SH 10:00-22:00'), 'unsupported-selector');
  assert.equal(reason('Apr-Oct Mo-Fr 09:00-18:00'), 'unsupported-selector');
  assert.equal(reason('week 1-53 Mo-Fr 09:00-18:00'), 'unsupported-selector');
  assert.equal(reason('Su[1] 10:00-14:00'), 'unsupported-selector');
});

test('comments and fallback rules are refused before anything is interpreted', () => {
  assert.equal(reason('Mo-Fr 09:00-18:00 "by appointment"'), 'comment-or-fallback');
  assert.equal(reason('Mo-Fr 09:00-18:00 || "call us"'), 'comment-or-fallback');
});

test('sunrise/sunset and open-ended times are refused', () => {
  assert.equal(reason('Mo-Fr sunrise-sunset'), 'unsupported-rule');
  assert.equal(reason('Mo-Fr 18:00+'), 'unsupported-rule');
});

test('an intersection of PH with weekdays is refused rather than guessed at', () => {
  assert.equal(reason('PH Mo-Fr 09:00-23:00'), 'unsupported-selector');
});

test('extended times past midnight are refused', () => {
  assert.equal(reason('Mo 09:00-26:00'), 'unsupported-time');
  assert.equal(reason('Mo 24:30-25:00'), 'unsupported-time');
});

test('an ambiguous 00:00-00:00 is refused instead of being read as all day', () => {
  assert.equal(reason('Mo 00:00-00:00'), 'unsupported-time');
});

test('empty and non-string values are refused', () => {
  assert.equal(reason(''), 'empty');
  assert.equal(reason('   '), 'empty');
  assert.equal(reason(null), 'not-a-string');
  assert.equal(reason(';;;'), 'empty');
});

test('a refused value keeps the original text for the page to show unchanged', () => {
  const raw = 'Mo-Fr 10:00-22:00; SH 10:00-22:00';
  const r = renderOpeningHours(raw);
  assert.equal(r.raw, raw);
  assert.deepEqual(r.en.lines, []);
  assert.deepEqual(r.de.lines, []);
});

// ── Notes ─────────────────────────────────────────────────────────────────

test('the exceptions caveat lives in the shared strings, not in every venue', () => {
  // It is true of every schedule on the site, so it is stated once and the
  // consumers append it. Repeating it per venue would be a quarter of a
  // megabyte of one sentence.
  for (const lang of ['en', 'de']) {
    assert.match(STRINGS[lang].noteExceptions, lang === 'de' ? /Feiertage/ : /Public holidays/);
    assert.match(STRINGS[lang].noteOvernight, lang === 'de' ? /Mitternacht/ : /past midnight/);
  }
  const r = renderOpeningHours('Mo-Su 10:00-22:00');
  assert.deepEqual(r.en.notes, [], 'nothing venue-specific to say about a full week');
  assert.equal(r.flags.overnight, false);
});

test('days with no rule are reported as unknown, never as closed', () => {
  const r = renderOpeningHours('Mo-Fr 09:00-22:00');
  assert.ok(r.en.notes.some((n) => n.includes('Sat–Sun')), r.en.notes.join(' | '));
  assert.ok(!r.en.lines.some((l) => l.value === 'Closed'));
  const de = renderOpeningHours('Mo-Fr 09:00-22:00').de.notes;
  assert.ok(de.some((n) => n.includes('Sa–So')), de.join(' | '));
});

test('a range crossing midnight is flagged rather than reordered', () => {
  const r = renderOpeningHours('Mo-Fr 22:00-02:00');
  assert.deepEqual(r.en.lines, [{ label: 'Mon–Fri', value: '22:00–02:00' }]);
  assert.equal(r.flags.overnight, true);
  assert.equal(renderOpeningHours('Mo-Fr 09:00-22:00').flags.overnight, false);
});

// ── Freshness ─────────────────────────────────────────────────────────────

test('a check date beats the edit timestamp and says so', () => {
  const f = renderFreshness({ checkDate: '2026-04-25', timestamp: '2020-01-02T03:04:05Z' });
  assert.match(f.en, /verified in OpenStreetMap on 2026-04-25/);
  assert.match(f.de, /geprüft am 25\.04\.2026/);
});

test('without a check date the wording switches to "last edited"', () => {
  const f = renderFreshness({ timestamp: '2023-10-20T01:13:20Z' });
  assert.match(f.en, /last edited on 2023-10-20/);
  assert.match(f.de, /bearbeitet am 20\.10\.2023/);
});

test('with neither, freshness is stated as unknown instead of invented', () => {
  const f = renderFreshness({});
  assert.match(f.en, /does not record/);
  assert.match(f.de, /nicht fest/);
});

test('dates are formatted without Intl so every machine renders the same bytes', () => {
  assert.equal(formatDate('2026-01-02T10:00:00Z', 'en'), '2026-01-02');
  assert.equal(formatDate('2026-01-02', 'de'), '02.01.2026');
  assert.equal(formatDate('not a date', 'en'), null);
  assert.equal(formatDate(undefined, 'de'), null);
});

// ── The promise the site makes ────────────────────────────────────────────

test('nothing in the language tables claims a venue is open now', () => {
  const all = JSON.stringify(STRINGS) + JSON.stringify(renderOpeningHours('Mo-Su 10:00-22:00'));
  for (const forbidden of [/open now/i, /jetzt geöffnet/i, /currently open/i, /geöffnet jetzt/i]) {
    assert.ok(!forbidden.test(all), `"${forbidden}" must never appear`);
  }
});

test('parseOpeningHours reports the week without deciding anything about today', () => {
  const parsed = parseOpeningHours('Mo-Fr 09:00-22:00');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.week[5], undefined, 'Saturday is unspecified, not closed');
  assert.deepEqual(parsed.week[0], [{ from: '09:00', to: '22:00' }]);
});

test('an end time of 00:00 is midnight, not the next day', () => {
  // `18:00-00:00` and `18:00-24:00` are the same statement; only a genuine
  // wrap continues into the following day.
  assert.equal(renderOpeningHours('Mo-Fr 09:00-00:00').flags.overnight, false);
  assert.equal(renderOpeningHours('Mo-Fr 09:00-24:00').flags.overnight, false);
  assert.equal(renderOpeningHours('Mo-Fr 22:00-02:00').flags.overnight, true);
  // The value still reads exactly as OpenStreetMap wrote it.
  assert.deepEqual(renderOpeningHours('Mo-Fr 09:00-00:00').en.lines,
    [{ label: 'Mon–Fri', value: '09:00–00:00' }]);
});
