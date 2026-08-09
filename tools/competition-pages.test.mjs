import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { __testing as i18nTesting, LANGUAGES, createTranslator, describeRejection } from '../competitions/app/ui/i18n.mjs';
import { REJECTION_CODES } from '../competitions/app/protocol/reduce.mjs';
import { joinLink, parseCompetitionRef, DISCOVERY_RELAYS } from '../competitions/app/pages/common.mjs';
import { isAllowedRelayUrl } from '../competitions/app/protocol/relay-url.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const EN_PAGES = ['index.html', 'organizer.html', 'join.html', 'live.html'];
const readPage = (lang, name) => fs.readFileSync(
  path.join(root, lang === 'de' ? 'de/competitions' : 'competitions', name), 'utf8',
);

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}
const APP_FILES = walkJs(path.join(root, 'competitions/app'));

// ── the repository's own rules ──

test('every English page has a German mirror with the same structure', () => {
  for (const name of EN_PAGES) {
    const en = readPage('en', name);
    const de = readPage('de', name);
    assert.match(en, /<html lang="en">/);
    assert.match(de, /<html lang="de">/);
    // Same interactive skeleton, so the two cannot drift into different apps.
    for (const marker of ['id="main"', 'class="site-header"', 'id="live-status"', 'id="live-alerts"']) {
      assert.ok(en.includes(marker), `${name} (en) is missing ${marker}`);
      assert.ok(de.includes(marker), `${name} (de) is missing ${marker}`);
    }
    const script = en.match(/<script type="module" src="([^"]+)"><\/script>/);
    const deScript = de.match(/<script type="module" src="([^"]+)"><\/script>/);
    assert.equal(Boolean(script), Boolean(deScript), `${name}: one language has a script and the other does not`);
    if (script) assert.equal(script[1], deScript[1], `${name}: the two languages load different code`);
  }
});

test('both languages declare hreflang in both directions', () => {
  for (const name of EN_PAGES) {
    for (const lang of LANGUAGES) {
      const page = readPage(lang, name);
      assert.match(page, /hreflang="en"/, `${lang}/${name}`);
      assert.match(page, /hreflang="de"/, `${lang}/${name}`);
      assert.match(page, /hreflang="x-default"/, `${lang}/${name}`);
      assert.match(page, /rel="canonical"/, `${lang}/${name}`);
    }
  }
});

test('the two landing pages are in the sitemap and the app surfaces are not', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('https://cruxcoach.org/competitions/</loc>'));
  assert.ok(sitemap.includes('https://cruxcoach.org/de/competitions/</loc>'));
  for (const name of ['organizer.html', 'join.html', 'live.html']) {
    assert.equal(sitemap.includes(`competitions/${name}`), false,
      `${name} has nothing a crawler can index and must stay out of the sitemap`);
  }
});

test('the app surfaces are noindex and the landing pages are not', () => {
  for (const lang of LANGUAGES) {
    assert.equal(readPage(lang, 'index.html').includes('noindex'), false, `${lang} landing page`);
    for (const name of ['organizer.html', 'join.html', 'live.html']) {
      assert.match(readPage(lang, name), /content="noindex,follow"/, `${lang}/${name}`);
    }
  }
});

test('every page ships a content security policy that forbids inline script', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      const csp = page.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert.ok(csp, `${lang}/${name} has no CSP`);
      const policy = csp[1];
      assert.match(policy, /script-src 'self'/, `${lang}/${name}`);
      assert.equal(policy.includes("'unsafe-inline'"), false, `${lang}/${name} allows inline code`);
      assert.equal(policy.includes("'unsafe-eval'"), false, `${lang}/${name} allows eval`);
      assert.match(policy, /default-src 'none'/, `${lang}/${name}`);
      // Relays are the only outbound connections these pages make.
      assert.match(policy, /connect-src [^;]*wss:/, `${lang}/${name}`);
    }
  }
});

test('no competition page carries an inline script or style', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      // A <script> with content, rather than a src, would be blocked by our own
      // CSP — so this test fails before the browser does.
      assert.equal(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(page), false,
        `${lang}/${name} has an inline script`);
      assert.equal(/\sstyle="/.test(page), false, `${lang}/${name} has an inline style attribute`);
      assert.equal(/<style[\s>]/.test(page), false, `${lang}/${name} has an inline stylesheet`);
    }
  }
});

test('the competition pages send no analytics beacon', () => {
  // Deliberate, and recorded in DECISIONS-TO-REVIEW.md. The collector's
  // SITE_PATHS allowlist lives in another repository; an unlisted label is
  // answered with 400 and counts nothing, and `normalizePagePath` would file
  // these views under /404 and corrupt that metric instead. A page that can be
  // clicked but not counted breaks the numbers — so these pages carry no
  // counter at all rather than a broken one, and no install button either.
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      assert.equal(page.includes('anonymous-analytics'), false, `${lang}/${name}`);
      assert.equal(page.includes('data-apk-selector'), false, `${lang}/${name}`);
      assert.equal(page.includes('stats.cruxcoach.org'), false, `${lang}/${name}`);
    }
  }
});

test('the pages load only same-origin assets', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      for (const match of page.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
        // Links to our own canonical URLs are fine; a fetched asset is not.
        assert.ok(match[1].startsWith('https://cruxcoach.org/'),
          `${lang}/${name} references ${match[1]}`);
      }
    }
  }
});

/** Source with comments removed, so a rule can be *explained* in a comment. */
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('nothing in the app assigns innerHTML', () => {
  // Competition titles, display names and announcements all arrive from a
  // public relay. Everything reaches the DOM through textContent.
  for (const file of APP_FILES) {
    const source = code(file);
    for (const forbidden of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      assert.equal(source.includes(forbidden), false,
        `${path.relative(root, file)} uses ${forbidden}`);
    }
  }
});

test('nothing in the app uses eval or the Function constructor', () => {
  for (const file of APP_FILES) {
    const source = code(file);
    assert.equal(/\beval\s*\(/.test(source), false, `${path.relative(root, file)}`);
    assert.equal(/new Function\s*\(/.test(source), false, `${path.relative(root, file)}`);
  }
});

test('the protocol layer stays free of the DOM', () => {
  // The cross-client conformance argument only holds if the tests exercise the
  // code the site ships. A protocol module that touched `document` could not be
  // run under node --test, and the port would drift.
  const protocolFiles = APP_FILES.filter((f) => f.includes('/protocol/'));
  assert.ok(protocolFiles.length >= 5);
  for (const file of protocolFiles) {
    const source = code(file);
    for (const forbidden of ['document.', 'window.', 'localStorage', 'sessionStorage']) {
      assert.equal(source.includes(forbidden), false,
        `${path.relative(root, file)} reaches for ${forbidden}`);
    }
  }
});

// ── translations ──

test('English and German define exactly the same keys', () => {
  const en = Object.keys(i18nTesting.STRINGS.en).sort();
  const de = Object.keys(i18nTesting.STRINGS.de).sort();
  const missingInGerman = en.filter((key) => !de.includes(key));
  const extraInGerman = de.filter((key) => !en.includes(key));
  assert.deepEqual(missingInGerman, [], 'these strings have no German translation');
  assert.deepEqual(extraInGerman, [], 'these German strings have no English original');
});

test('no translation is left as the English text by accident', () => {
  const suspicious = [];
  for (const [key, english] of Object.entries(i18nTesting.STRINGS.en)) {
    const german = i18nTesting.STRINGS.de[key];
    // Identical strings are fine when there is nothing to translate ("Top").
    if (german === english && /\s/.test(english) && english.length > 12) suspicious.push(key);
  }
  assert.deepEqual(suspicious, [], 'these German strings are identical to the English ones');
});

test('every placeholder in an English string exists in the German one', () => {
  for (const [key, english] of Object.entries(i18nTesting.STRINGS.en)) {
    const german = i18nTesting.STRINGS.de[key];
    const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(placeholders(german), placeholders(english), `${key}: placeholders differ`);
  }
});

test('every rejection code has a sentence in both languages', () => {
  for (const lang of LANGUAGES) {
    const t = createTranslator(lang);
    for (const code of REJECTION_CODES) {
      const rendered = describeRejection(t, { seq: 7, op: 'checkin', code });
      assert.ok(rendered.includes('7'), `${lang}/${code}: the entry number is missing`);
      assert.equal(rendered.includes(`rejection.${code}`), false,
        `${lang}: rejection code "${code}" has no sentence`);
    }
  }
});

test('every lifecycle, registration, payment and check-in state has a label', () => {
  const states = {
    status: ['draft', 'published', 'registration_open', 'registration_closed', 'checkin_open',
      'running', 'paused', 'finished', 'cancelled'],
    reg: ['pending', 'accepted', 'waitlisted', 'rejected', 'withdrawn'],
    pay: ['not_required', 'pending', 'settled', 'failed', 'expired', 'refunded'],
    checkin: ['none', 'checked_in', 'no_show'],
  };
  for (const lang of LANGUAGES) {
    const t = createTranslator(lang);
    for (const [prefix, values] of Object.entries(states)) {
      for (const value of values) {
        const key = `${prefix}.${value}`;
        assert.notEqual(t(key), key, `${lang}: ${key} has no label`);
      }
    }
  }
});

// ── link handling ──

test('a join reference is recognised in every shape we hand out', () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(root, 'competitions/fixtures/vectors/protocol.json'), 'utf8'));
  const { naddr, organizer, comp_id: compId } = vectors.address;
  for (const input of [
    `https://cruxcoach.org/comp/${naddr}`,
    `https://cruxcoach.org/competitions/join.html#${naddr}`,
    `https://cruxcoach.org/de/competitions/join.html#${naddr}`,
    `nostr:${naddr}`,
    naddr,
    `  ${naddr}  `,
    naddr.toUpperCase(),
  ]) {
    const parsed = parseCompetitionRef(input);
    assert.equal(parsed.ok, true, `failed on: ${input.slice(0, 48)}`);
    assert.equal(parsed.organizerPubkey, organizer);
    assert.equal(parsed.compId, compId);
  }
});

test('a damaged link is reported differently from something that is not a link', () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(root, 'competitions/fixtures/vectors/protocol.json'), 'utf8'));
  const naddr = vectors.address.naddr;
  const corrupted = `${naddr.slice(0, -1)}${naddr.at(-1) === 'q' ? 'p' : 'q'}`;
  assert.equal(parseCompetitionRef(corrupted).error, 'damaged_link',
    'one mistyped character should say the link is damaged');
  assert.equal(parseCompetitionRef('hello').error, 'not_an_naddr');
});

test('rubbish and other people\'s links are refused, not half-loaded', () => {
  for (const input of ['', 'hello', 'https://example.invalid/', 'npub1qqqqq', 'note1qqqq',
    'https://cruxcoach.org/c/naddr1qqqq']) {
    const parsed = parseCompetitionRef(input);
    assert.equal(parsed.ok, false, `should refuse: ${input}`);
  }
});

test('the join link is the short canonical form', () => {
  const naddr = 'naddr1abc';
  assert.equal(joinLink(naddr, 'https://cruxcoach.org'), 'https://cruxcoach.org/comp/naddr1abc');
});

test('404.html routes a competition link to the participant page', () => {
  const source = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  assert.match(source, /\/\^\\\/comp\\\/\(naddr1\[a-z0-9\]\+\)/);
  assert.match(source, /location\.replace\('\/competitions\/join\.html#'/);
});

test('the discovery relays are the ones the app ships, and all are allowed', () => {
  assert.deepEqual(DISCOVERY_RELAYS, [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr-pub.wellorder.net',
    'wss://nostr.oxtr.dev',
  ]);
  for (const url of DISCOVERY_RELAYS) assert.equal(isAllowedRelayUrl(url), true, url);
});

test('the privacy page discloses what the competition pages do', () => {
  for (const [file, needles] of [
    ['privacy.html', ['/competitions/', 'WebSocket', 'no counter request', 'localStorage']],
    ['de/privacy.html', ['/de/competitions/', 'WebSocket', 'keinerlei Zählanfrage', 'localStorage']],
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${file} does not mention ${needle}`);
    }
  }
});
