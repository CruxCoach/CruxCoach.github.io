import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCESS_VALUES,
  BOARDS,
  CATEGORIES,
  CATEGORIES_REQUIRING_BOARD,
  CATEGORIES_REQUIRING_PROPOSAL,
  DEV_ENDPOINT,
  LIMITS,
  LOCALES,
  PRODUCTION_ENDPOINT,
  PROPOSAL_FIELDS_BY_CATEGORY,
  STRINGS,
  boardChoices,
  buildSubmission,
  describeFailure,
  looksLikeNpub,
  looksLikeUrl,
  newSubmissionId,
  resolveEndpoint,
  validateForm,
} from '../boards/report-core.mjs';
import { window as domShim } from './dev/mini-dom.mjs';

/**
 * The report form is the one place on this site where a visitor sends us
 * something. Two things are tested here and they are different:
 *
 *   * `report-core.mjs` — the taxonomy, the checks and the request body, driven
 *     directly because it has no DOM.
 *   * `report.js` — the dialog itself, *driven* under the shim rather than
 *     pattern-matched, because a form that hard-codes half its contract still
 *     passes every source scan.
 */

// The contract file is committed byte-identically in cruxcoach-dashboard
// (packages/shared/contracts/). Both repos pin this digest, so a change in one
// that is not mirrored in the other fails a test rather than producing a site
// that posts a body the API rejects.
const CONTRACT_SHA256 = '8230bdb3ca4e182bad81d138b501310f8a65f122359139dc3dbf405b62567326';

const contractRaw = readFileSync(new URL('./venue-report-contract.v1.json', import.meta.url));
const contract = JSON.parse(contractRaw.toString('utf8'));

const VENUE = {
  id: 'v1_2f1a9c7d4b60',
  name: 'Boulderwelt München Ost',
  lat: 48.112341,
  lon: 11.634561,
  country: 'DE',
};

function form(overrides = {}) {
  return {
    venue: VENUE,
    category: 'closed',
    detail: 'The gym closed permanently at the end of July; the sign says so.',
    ...overrides,
  };
}

test('the wire contract has not drifted from the API', () => {
  assert.equal(createHash('sha256').update(contractRaw).digest('hex'), CONTRACT_SHA256);
});

test('the form enforces exactly the taxonomy the contract states', () => {
  assert.deepEqual(contract.categories, CATEGORIES);
  assert.deepEqual(contract.accessValues, ACCESS_VALUES);
  assert.deepEqual(contract.boards, BOARDS);
  assert.deepEqual(contract.locales, LOCALES);
  assert.deepEqual(contract.limits, LIMITS);
  assert.deepEqual(contract.categoriesRequiringProposal, CATEGORIES_REQUIRING_PROPOSAL);
  assert.deepEqual(contract.proposalFieldsByCategory, PROPOSAL_FIELDS_BY_CATEGORY);
});

// ── Localization ────────────────────────────────────────────────────

test('both languages carry every string', () => {
  const walk = (value, path, seen) => {
    for (const [key, child] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (child && typeof child === 'object') walk(child, here, seen);
      else seen.add(here);
    }
  };
  const en = new Set();
  const de = new Set();
  walk(STRINGS.en, '', en);
  walk(STRINGS.de, '', de);

  // A key present in one language renders as `undefined` in the other, inside a
  // dialog somebody is trying to use.
  assert.deepEqual([...en].sort(), [...de].sort());
  assert.ok(en.size > 40, 'the string table looks truncated');
});

test('no localized string is empty, and none was left in English under de', () => {
  for (const [key, value] of Object.entries(STRINGS.de.errors)) {
    assert.notEqual(value.trim(), '', `de.errors.${key} is empty`);
    assert.notEqual(value, STRINGS.en.errors[key], `de.errors.${key} is untranslated`);
  }
  for (const category of CATEGORIES) {
    assert.notEqual(STRINGS.de.categories[category], STRINGS.en.categories[category], category);
  }
});

test('validation messages come back in the form language', () => {
  const en = validateForm(form({ detail: 'no' }), 'en');
  const de = validateForm(form({ detail: 'no' }), 'de');
  assert.match(en.errors.detail, /at least 10 characters/);
  assert.match(de.errors.detail, /mindestens 10 Zeichen/);
});

// ── Validation ──────────────────────────────────────────────────────

test('a complete report passes', () => {
  assert.equal(validateForm(form()).ok, true);
});

test('a category must be chosen before anything else is judged', () => {
  const result = validateForm(form({ category: '' }));
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors), ['category']);
});

test('the detail field is bounded at both ends, in code points', () => {
  assert.match(validateForm(form({ detail: 'too short' })).errors.detail, /at least/);
  assert.equal(validateForm(form({ detail: '🧗'.repeat(1000) })).ok, true);
  assert.match(validateForm(form({ detail: '🧗'.repeat(1001) })).errors.detail, /shorten/);
});

test('each category asks for exactly the proposal it needs', () => {
  for (const category of CATEGORIES_REQUIRING_PROPOSAL) {
    const base = form({ category });
    if (CATEGORIES_REQUIRING_BOARD.includes(category)) base.boardInstanceId = 'b1_9d3e07af1c25';
    const result = validateForm(base);
    assert.equal(result.ok, false, `${category} accepted an empty proposal`);
  }

  assert.equal(validateForm(form({ category: 'website', website: 'https://example.org/' })).ok, true);
  assert.equal(validateForm(form({ category: 'hours', hours: 'Mo–Fr 10–23' })).ok, true);
  assert.equal(validateForm(form({ category: 'access', access: 'restricted' })).ok, true);
  assert.equal(validateForm(form({ category: 'coordinates', lat: '48.1', lon: '11.6' })).ok, true);
  assert.equal(validateForm(form({ category: 'board_added', board: 'kilter' })).ok, true);
  assert.equal(
    validateForm(form({ category: 'duplicate', duplicateOfVenueId: 'v1_aaaaaaaaaaaa' })).ok,
    true,
  );
});

test('a proposed website must be https, an evidence link need not be', () => {
  assert.match(
    validateForm(form({ category: 'website', website: 'http://example.org/' })).errors.website,
    /https:\/\//,
  );
  assert.equal(validateForm(form({ evidenceUrl: 'http://example.org/news' })).ok, true);
});

test('hostile URLs are refused before they are ever sent', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'data:text/html,<script>',
    'file:///etc/passwd',
    'https://user:pass@example.org/',
    'http://127.0.0.1:8080/admin',
    'http://localhost/',
    'https://exa mple.org/',
  ]) {
    assert.equal(looksLikeUrl(hostile), false, hostile);
    assert.equal(validateForm(form({ evidenceUrl: hostile })).ok, false, hostile);
  }
  assert.equal(looksLikeUrl('https://www.instagram.com/p/abc/'), true);
});

test('coordinates must be on the planet', () => {
  assert.match(validateForm(form({ category: 'coordinates', lat: '91', lon: '11' })).errors.lat, /-90/);
  assert.match(
    validateForm(form({ category: 'coordinates', lat: '48.1', lon: '' })).errors.lat,
    /both/,
  );
});

test('a board-specific category needs a board', () => {
  for (const category of CATEGORIES_REQUIRING_BOARD) {
    assert.equal(validateForm(form({ category })).ok, false, category);
    const complete = form({ category, boardInstanceId: 'b1_9d3e07af1c25' });
    // `board_removed` additionally asks which system; `board_details` does not.
    if (PROPOSAL_FIELDS_BY_CATEGORY[category].includes('board')) complete.board = 'kilter';
    assert.equal(validateForm(complete).ok, true, category);
  }

  // A malformed instance id is refused rather than sent for the server to
  // reject — the reporter would have no idea what went wrong.
  assert.equal(
    validateForm(form({ category: 'board_details', boardInstanceId: 'b1_nothex' })).ok,
    false,
  );
});

test('a venue cannot be reported as a duplicate of itself', () => {
  const result = validateForm(form({ category: 'duplicate', duplicateOfVenueId: VENUE.id }));
  assert.match(result.errors.duplicateOfVenueId, /own ID/);
});

test('anonymous is the default and an npub is optional but checked', () => {
  assert.equal(validateForm(form()).ok, true);
  assert.equal(validateForm(form({ npub: '' })).ok, true);
  assert.equal(validateForm(form({ npub: 'npub1nope' })).ok, false);
  assert.equal(looksLikeNpub('npub1' + 'q'.repeat(58)), true);
});

// ── The request body ────────────────────────────────────────────────

test('the submission body matches the contract shape', () => {
  const body = buildSubmission(
    form({ category: 'access', access: 'restricted', npub: `npub1${'q'.repeat(58)}` }),
    { ticket: 'v1.abc', submissionId: '11111111-1111-4111-8111-111111111111', lang: 'de' },
  );

  assert.equal(body.contract, contract.contract);
  assert.equal(body.version, contract.version);
  assert.equal(body.locale, 'de');
  assert.equal(body.venue.id, VENUE.id);
  assert.deepEqual(body.proposed, { access: 'restricted' });
  assert.equal(body.board, null);
  assert.equal(body.evidenceUrl, null);
  assert.equal(body.reporter.npub, `npub1${'q'.repeat(58)}`);
  assert.match(body.clientSubmissionId, new RegExp(contract.identifiers.submissionIdPattern));
});

test('an anonymous report carries no reporter object at all', () => {
  const body = buildSubmission(form(), { ticket: 't', submissionId: 'x', lang: 'en' });
  assert.equal(body.reporter, null);
});

test('coordinates are rounded to the contract precision, not sent raw', () => {
  const body = buildSubmission(
    form({ venue: { ...VENUE, lat: 48.1123412345678, lon: 11.6345612345678 } }),
    { ticket: 't', submissionId: 'x', lang: 'en' },
  );
  assert.equal(body.venue.lat, 48.112341);
  assert.equal(body.venue.lon, 11.634561);
});

test('a submission id is a v4 uuid', () => {
  const id = newSubmissionId({ randomUUID: () => '11111111-1111-4111-8111-111111111111' });
  assert.match(id, new RegExp(contract.identifiers.submissionIdPattern));
  // And the fallback path, for a browser without randomUUID.
  const fallback = newSubmissionId({
    getRandomValues: (bytes) => {
      bytes.fill(0xab);
      return bytes;
    },
  });
  assert.match(fallback, new RegExp(contract.identifiers.submissionIdPattern));
});

// ── Endpoint ────────────────────────────────────────────────────────

test('reports go to the first-party endpoint, and to loopback in development', () => {
  assert.equal(resolveEndpoint({ hostname: 'cruxcoach.org' }), PRODUCTION_ENDPOINT);
  assert.equal(resolveEndpoint({ hostname: 'mirror.cruxcoach.org' }), PRODUCTION_ENDPOINT);
  assert.equal(resolveEndpoint({ hostname: 'localhost' }), DEV_ENDPOINT);
  assert.equal(resolveEndpoint({ hostname: '127.0.0.1' }), DEV_ENDPOINT);
});

test('the endpoint cannot be redirected by a link', () => {
  // A URL-configurable endpoint would let any link decide where a stranger's
  // report is sent. Only the hostname decides.
  assert.equal(
    resolveEndpoint({ hostname: 'cruxcoach.org', search: '?endpoint=https://evil.example' }),
    PRODUCTION_ENDPOINT,
  );
  assert.equal(
    resolveEndpoint({ hostname: 'cruxcoach.org', hash: '#https://evil.example' }),
    PRODUCTION_ENDPOINT,
  );
});

test('server failures become an answer a person can act on', () => {
  assert.match(describeFailure(429, {}, 'en'), /Too many/);
  assert.match(describeFailure(403, { error: 'ticket_rejected' }, 'en'), /sat open too long/);
  assert.match(describeFailure(400, { field: 'detail' }, 'en'), /check the fields/);
  assert.match(describeFailure(500, null, 'de'), /nicht gesendet/);
  // The server's field/reason codes are for logs, not for a visitor who has
  // already been told what the form needs.
  assert.doesNotMatch(describeFailure(400, { field: 'detail', reason: 'too_short' }, 'en'), /too_short/);
});

// ── Board choices ───────────────────────────────────────────────────

test('every installation at a venue becomes its own choice', () => {
  const choices = boardChoices({
    boards: [
      {
        board: 'kilter',
        instance_id: 'b1_000000000001',
        walls: [
          { instance_id: 'b1_000000000002', wall_name: 'Main', size_label: '12x12' },
          { instance_id: 'b1_000000000003', wall_name: 'Small', size_label: '8x12' },
        ],
      },
      { board: 'moonboard', instance_id: 'b1_000000000004', variant: '2019' },
      { board: 'decoy', instance_id: 'b1_000000000005', username: 'somegym' },
    ],
  });

  assert.deepEqual(choices.map((c) => c.instanceId), [
    'b1_000000000002',
    'b1_000000000003',
    'b1_000000000004',
    'b1_000000000005',
  ]);
  assert.equal(choices[0].board, 'kilter');
  assert.match(choices[0].label, /Main/);
  assert.match(choices[2].label, /2019/);
});

test('a board with no id offers no choice, because a report could not name it', () => {
  const choices = boardChoices({ boards: [{ board: 'kilter', walls: [{ wall_name: 'Main' }] }] });
  assert.deepEqual(choices, []);
});

// ── The dialog, driven ──────────────────────────────────────────────

async function withDialog(lang, run, { fetchImpl } = {}) {
  const restore = domShim.install();
  const previousFetch = globalThis.fetch;
  const previousNavigator = globalThis.navigator;
  const calls = [];

  globalThis.document.documentElement.lang = lang;
  globalThis.window.location = { hostname: 'cruxcoach.org' };
  // `navigator` is a getter-only global in Node, so it has to be redefined
  // rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (fetchImpl) return fetchImpl(url, init, calls);
    if (String(url).endsWith('/v1/reports/ticket')) {
      return { ok: true, status: 200, json: async () => ({ ticket: 'v1.ticket.1.mac' }) };
    }
    return { ok: true, status: 202, json: async () => ({ status: 'received', reportId: 'r_1' }) };
  };

  // Fresh module instance per case: the module reads `document.documentElement.lang`
  // once at import time, which is exactly the behaviour under test.
  const module = await import(`../boards/report.js?case=${encodeURIComponent(`${lang}-${Math.random()}`)}`);

  try {
    await run({ module, calls, document: globalThis.document });
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: previousNavigator,
      configurable: true,
      writable: true,
    });
    restore();
  }
}

const VENUE_PROPERTIES = {
  venue_id: VENUE.id,
  name: VENUE.name,
  country: 'DE',
  boards: [
    {
      board: 'kilter',
      instance_id: 'b1_000000000001',
      walls: [{ instance_id: 'b1_000000000002', wall_name: 'Main', size_label: '12x12' }],
    },
  ],
};

function byId(document, id) {
  return document.getElementById(id);
}

test('the dialog opens with the venue it was asked about', async () => {
  await withDialog('en', ({ module, document }) => {
    assert.equal(module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null), true);
    assert.match(document.querySelector('.vr-venue').textContent, /Boulderwelt München Ost/);
    assert.match(document.querySelector('.vr-venue').textContent, /v1_2f1a9c7d4b60/);
    assert.equal(document.querySelector('.vr-dialog').open, true);
  });
});

test('a venue with no stable id gets no dialog at all', async () => {
  await withDialog('en', ({ module }) => {
    // Without an id there is nothing a report could be filed against, so
    // opening the form would only waste somebody's time.
    assert.equal(module.open({ name: 'Nowhere', boards: [] }, 1, 2, null), false);
  });
});

test('the German dialog is German', async () => {
  await withDialog('de', ({ module, document }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    assert.equal(byId(document, 'vr-title').textContent, 'Korrektur melden');
    assert.match(byId(document, 'vr-detail-hint').textContent, /Mindestens 10 Zeichen/);
    const categories = byId(document, 'vr-category').options.map((o) => o.textContent);
    assert.ok(categories.includes('Dieser Ort ist geschlossen'));
  });
});

test('every board installation is offered as a target', async () => {
  await withDialog('en', ({ module, document }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    const values = byId(document, 'vr-board-instance').options.map((o) => o.getAttribute('value'));
    assert.deepEqual(values, ['', 'b1_000000000002']);
  });
});

test('conditional fields appear and leave the tab order when they do not apply', async () => {
  await withDialog('en', ({ module, document }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    const category = byId(document, 'vr-category');
    const websiteField = byId(document, 'vr-website').parentNode;
    const website = byId(document, 'vr-website');

    assert.equal(websiteField.hidden, true, 'website should start hidden');
    assert.equal(website.disabled, true, 'a hidden control must leave the tab order');

    category.value = 'website';
    category.dispatch('change');

    assert.equal(websiteField.hidden, false);
    assert.equal(website.disabled, false);

    category.value = 'closed';
    category.dispatch('change');
    assert.equal(websiteField.hidden, true);
    assert.equal(website.disabled, true);
  });
});

test('an invalid submission is refused before anything is sent, and says why', async () => {
  await withDialog('en', async ({ module, document, calls }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    byId(document, 'vr-category').value = 'closed';
    byId(document, 'vr-category').dispatch('change');
    byId(document, 'vr-detail').value = 'no';

    document.querySelector('.vr-form').dispatch('submit');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 0, 'nothing may leave the browser');
    const error = byId(document, 'vr-detail-error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /at least 10 characters/);
    assert.equal(byId(document, 'vr-detail').getAttribute('aria-invalid'), 'true');
    assert.equal(byId(document, 'vr-detail').getAttribute('aria-describedby'), 'vr-detail-error');
    assert.equal(document.activeElement, byId(document, 'vr-detail'), 'focus moves to the problem');
  });
});

test('a valid submission fetches a ticket and posts the contract body', async () => {
  await withDialog('en', async ({ module, document, calls }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    byId(document, 'vr-category').value = 'website';
    byId(document, 'vr-category').dispatch('change');
    byId(document, 'vr-website').value = 'https://boulderwelt-muenchen-ost.de/';
    byId(document, 'vr-detail').value = 'The linked site is the wrong Boulderwelt location.';
    byId(document, 'vr-board-instance').value = 'b1_000000000002';

    document.querySelector('.vr-form').dispatch('submit');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(calls.length, 2);
    assert.match(String(calls[0].url), /\/v1\/reports\/ticket$/);
    assert.match(String(calls[1].url), /\/v1\/reports$/);

    const body = JSON.parse(calls[1].init.body);
    assert.equal(body.contract, 'cruxcoach.venue-report');
    assert.equal(body.category, 'website');
    assert.equal(body.venue.id, VENUE.id);
    assert.equal(body.board.instanceId, 'b1_000000000002');
    assert.equal(body.board.board, 'kilter');
    assert.deepEqual(body.proposed, { website: 'https://boulderwelt-muenchen-ost.de/' });
    assert.equal(body.reporter, null);
    assert.equal(body.ticket, 'v1.ticket.1.mac');

    // No cookies, no referrer, no cache.
    assert.equal(calls[1].init.credentials, 'omit');
    assert.equal(calls[1].init.referrerPolicy, 'no-referrer');
    assert.equal(calls[1].init.cache, 'no-store');
  });
});

test('the form is replaced by a thank-you rather than left ready to resend', async () => {
  await withDialog('en', async ({ module, document }) => {
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    byId(document, 'vr-category').value = 'closed';
    byId(document, 'vr-category').dispatch('change');
    byId(document, 'vr-detail').value = 'This venue closed permanently in July.';

    document.querySelector('.vr-form').dispatch('submit');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(byId(document, 'vr-detail'), null, 'the filled form must be gone');
    assert.match(document.querySelector('.vr-done').textContent, /Thank you/);
  });
});

test('a rejected report is reported honestly and the form is kept', async () => {
  await withDialog(
    'en',
    async ({ module, document }) => {
      module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
      byId(document, 'vr-category').value = 'closed';
      byId(document, 'vr-category').dispatch('change');
      byId(document, 'vr-detail').value = 'This venue closed permanently in July.';

      document.querySelector('.vr-form').dispatch('submit');
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.match(document.querySelector('.vr-status').textContent, /Too many reports/);
      assert.ok(byId(document, 'vr-detail'), 'the report must not be lost on a refusal');
      assert.equal(byId(document, 'vr-detail').value, 'This venue closed permanently in July.');
    },
    {
      fetchImpl: async (url) => {
        if (String(url).endsWith('/ticket')) {
          return { ok: true, status: 200, json: async () => ({ ticket: 'v1.t.1.m' }) };
        }
        return { ok: false, status: 429, json: async () => ({ error: 'rate_limited' }) };
      },
    },
  );
});

test('offline fails loudly instead of queueing a report on the device', async () => {
  await withDialog('en', async ({ module, document, calls }) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });
    module.open(VENUE_PROPERTIES, VENUE.lat, VENUE.lon, null);
    byId(document, 'vr-category').value = 'closed';
    byId(document, 'vr-category').dispatch('change');
    byId(document, 'vr-detail').value = 'This venue closed permanently in July.';

    document.querySelector('.vr-form').dispatch('submit');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(calls.length, 0);
    assert.match(document.querySelector('.vr-status').textContent, /offline/i);
    assert.match(document.querySelector('.vr-status').textContent, /not saved on your device/);
  });
});

test('the report module never persists anything', () => {
  // A draft in localStorage would be exactly the kind of plaintext persistence
  // this feature promises not to do — and a device somebody else can pick up is
  // the threat that makes it matter.
  // Comments stripped first: both files *talk* about not persisting anything,
  // and a scan that cannot tell a promise from a call proves nothing.
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const source = stripComments(readFileSync(new URL('../boards/report.js', import.meta.url), 'utf8'));
  const core = stripComments(readFileSync(new URL('../boards/report-core.mjs', import.meta.url), 'utf8'));
  for (const [name, text] of [['report.js', source], ['report-core.mjs', core]]) {
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie/, name);
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML/, name);
  }
});

test('the report path is never wired into the analytics beacon', () => {
  // A page that can be clicked but not counted breaks the numbers — but the
  // opposite is worse here: a report category in an analytics dimension would
  // tell the collector what somebody reported.
  const source = readFileSync(new URL('../boards/report.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /stats\.cruxcoach\.org|anonymous-analytics|sendBeacon/);
});

test('the map only offers the button when a venue can be named', () => {
  const map = readFileSync(new URL('../boards/map.js', import.meta.url), 'utf8');
  assert.match(map, /typeof props\.venue_id !== 'string'/);
  assert.match(map, /data-venue-report/);
  // And it removes the control rather than leaving a dead one if the module
  // never loaded.
  assert.match(map, /reportButton\.remove\(\)/);
});
