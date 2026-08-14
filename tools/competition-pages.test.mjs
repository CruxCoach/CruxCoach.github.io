import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { __testing as i18nTesting, LANGUAGES, createTranslator, describeRejection } from '../competitions/app/ui/i18n.mjs';
import { REJECTION_CODES } from '../competitions/app/protocol/reduce.mjs';
import { joinLink, parseCompetitionRef, DISCOVERY_RELAYS } from '../competitions/app/pages/common.mjs';
import { isAllowedRelayUrl } from '../competitions/app/protocol/relay-url.mjs';
import {
  CLIMB_SOURCES, UNIQUENESS, PROGRESSIONS, SCORINGS,
} from '../competitions/app/protocol/competition.mjs';

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

test('the host edit flow publishes an audited log revision at every sequence', () => {
  const organizer = fs.readFileSync(path.join(root, 'competitions/app/pages/organizer.mjs'), 'utf8');
  assert.match(organizer, /writer\.updateConfig\(patch, reason\.value\.trim\(\)\)/);
  assert.match(organizer, /configPatchImpact\(patch\)/);
  assert.doesNotMatch(organizer, /state\.seq === 0 \? el\('button',[\s\S]{0,300}org\.edit\.action/);
  assert.match(organizer, /org\.edit\.reason_hint/);
});

test('competition entry points version their release assets', () => {
  for (const lang of ['en', 'de']) {
    const page = readPage(lang, 'organizer.html');
    assert.match(page, /competitions\.css\?v=\d{8}-\d+/);
    assert.match(page, /organizer\.mjs\?v=\d{8}-\d+/);
  }
});

test('the service worker never serves a stale competition release while online', () => {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(source, /url\.pathname\.indexOf\('\/competitions\/'\) === 0/);
  const competitionBranch = source.slice(
    source.indexOf("if (url.pathname === '/competitions'"),
    source.indexOf('event.respondWith(\n    caches.open(CACHE)', source.indexOf("if (url.pathname === '/competitions'")),
  );
  assert.ok(competitionBranch.indexOf('return fetch(req)') < competitionBranch.indexOf('return cache.match(req)'),
    'competition requests must try the network before their offline cache');
});

test('the competition front door and host workspace keep their distinct visual structure', () => {
  for (const lang of ['en', 'de']) {
    const home = readPage(lang, 'index.html');
    const organizer = readPage(lang, 'organizer.html');
    for (const marker of ['competition-hero', 'hero-board-stage', 'action-grid', 'trust-band']) {
      assert.ok(home.includes(marker), `${lang} home is missing ${marker}`);
    }
    assert.ok(organizer.includes('workspace-intro'), `${lang} organizer has no workspace introduction`);
  }
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');
  assert.match(css, /\.competition-wizard\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.competition-wizard \.board-preview\s*\{[^}]*position: sticky/s);
});

test('host setup, entrants and live operations are focused restorable destinations', () => {
  const organizer = fs.readFileSync(path.join(root, 'competitions/app/pages/organizer.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');

  assert.match(organizer, /HOST_DESTINATIONS = new Set\(\['setup', 'entrants', 'live'\]\)/);
  assert.match(organizer, /HOST_HISTORY_KEY/);
  assert.match(organizer, /window\.addEventListener\('popstate'/);
  assert.match(organizer, /function hostDestinationNav\(active\)/);
  assert.match(organizer, /function hostDestinationContent\(snapshot, destination\)/);
  assert.match(organizer, /requestsPanel\(snapshot, \['withdraw', 'checkin_request'\]\)/);
  assert.match(organizer, /requestsPanel\(snapshot, \['defer_request', 'attempt_report'\]\)/);
  assert.match(css, /\.host-destination-nav\s*\{/);
  assert.match(css, /button\[aria-current="page"\]/);
});

test('projection and participant live views expose the shared event hierarchy', () => {
  const live = fs.readFileSync(path.join(root, 'competitions/app/pages/live.mjs'), 'utf8');
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  const policy = fs.readFileSync(path.join(root, 'competitions/app/ui/live-view.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');

  for (const marker of [
    'projection-hero', 'projection-queue', 'projection-rotation', 'projection-ranking',
    'projection-announcement', 'projection-fullscreen',
  ]) assert.ok(live.includes(marker), `projection is missing ${marker}`);
  for (const marker of [
    'participant-live-hero', 'participant-queue', 'participant-rotation', 'participant-actions',
  ]) assert.ok(join.includes(marker), `participant view is missing ${marker}`);
  for (const derivation of ['queuePreview', 'rotationPreview', 'personalCue', 'syncHealth', 'tiedAt']) {
    assert.ok(policy.includes(`function ${derivation}`), `live policy is missing ${derivation}`);
  }
  assert.match(css, /:fullscreen \.site-header/);
  assert.match(css, /\.participant-actions\s*\{[^}]*position: sticky/s);
  assert.match(css, /\.projector \.now\s*\{[^}]*min-height:/s,
    'ticker text needs a reserved line box to avoid layout jumps');
});

test('live host, participant and projection surfaces keep state-specific action hierarchy', () => {
  const organizer = fs.readFileSync(path.join(root, 'competitions/app/pages/organizer.mjs'), 'utf8');
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  const live = fs.readFileSync(path.join(root, 'competitions/app/pages/live.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');

  for (const marker of [
    'host-overview', 'host-console-primary', 'host-run-card', 'host-turn-hero',
    'host-next-strip', 'host-result-actions', 'host-danger-menu', 'host-sync-state',
  ]) assert.ok(organizer.includes(marker), `host console is missing ${marker}`);
  assert.match(organizer, /id: 'host-deadline'/, 'the host needs the same live countdown as the wall');
  assert.match(organizer, /completeTurn\(current, climbId, outcome, attemptNo/,
    'recording a result and opening the next turn must be one authority operation');
  assert.match(organizer, /secondsToDeadline\(\) === 0[\s\S]*completeTurn\(current, climbId, 'timeout'/,
    'time up is offered only after the signed turn deadline expires');
  assert.match(organizer, /seedAndOpen\(order\)/,
    'seeding must automatically assign the first participant');
  assert.doesNotMatch(organizer, /reported\?\.climb_id[\s\S]{0,120}own\[0\]/,
    'participant choice must never fall back to the first remaining boulder');
  assert.match(organizer, /nextClimberWraps\(\)[\s\S]*live\.next_round_short/,
    'the host must see who follows at the next-round boundary');
  assert.match(live, /function chosenClimb\([\s\S]*remainingClimbs/,
    'the projector must reject exhausted participant choices');
  assert.match(live, /followIntents\([\s\S]*intent\.op !== 'climb_choice'/,
    'the public live screen must follow the same participant choice as the host');
  assert.match(organizer, /state\.status === 'paused'[\s\S]*org\.paused\.hint/,
    'pause must replace scoring actions with an explicit locked state');
  assert.match(css, /\.host-result-actions\s*\{[^}]*position: sticky/s,
    'attempt controls must remain reachable on a small wall-side phone');

  assert.match(join, /competitionRunning\([\s\S]*participant-actions/,
    'participant controls must be gated by the scheduled running window');
  assert.match(join, /participant-actions participant-actions-status/,
    'paused and terminal participants need a status surface, not disabled controls');
  assert.match(join, /className: 'button primary'[\s\S]*live\.prepare_board/,
    'preparing the next boulder is the one dominant queued action');
  assert.match(live, /!terminal && el\('div', \{ className: 'projection-middle'/,
    'a final projection must not keep presenting an active queue or rotation');
  assert.match(live, /competitionRunning\(snapshot\.competition, snapshot\.state\.status, now\)/,
    'the projection must derive running state from its scheduled window');
  assert.match(live, /status !== lastEffectiveStatus[\s\S]*render\(\)/,
    'the projection must cross scheduled phase boundaries without a relay event');
  assert.match(organizer, /effectiveStatus === 'running'[\s\S]*secondsToDeadline/,
    'the host countdown must tick for an automatically started competition');
});

test('all five participant jobs are focused history-backed destinations', () => {
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');

  assert.match(join, /function participantScreen\(snapshot\)/);
  assert.match(join, /return 'live'/);
  assert.match(join, /mine\?\.registration === 'accepted'\) return 'checkin'/);
  assert.match(join, /PARTICIPANT_DESTINATIONS = new Set\(\['registration', 'checkin', 'live', 'chooser', 'leaderboard'\]\)/);
  assert.match(join, /PARTICIPANT_HISTORY_KEY/);
  assert.match(join, /window\.addEventListener\('popstate'/);
  assert.match(join, /destination === 'registration'[\s\S]*registrationPanel\(snapshot\)[\s\S]*destination === 'checkin'[\s\S]*checkinPanel\(snapshot\)[\s\S]*destination === 'live'[\s\S]*livePanel\(snapshot\)[\s\S]*destination === 'chooser'[\s\S]*nextClimbChooser\(snapshot, me\(\)\)[\s\S]*leaderboard\(snapshot\)/);
  assert.match(join, /climb_source === 'participant_choice'[\s\S]*available\.add\('chooser'\)/,
    'organizer-set competitions must not expose a participant choice writer the protocol rejects');
  assert.match(join, /className: 'participant-phases'/);
  assert.match(join, /className: 'participant-destination-nav'/);
  assert.match(join, /data-screen': screen/);
  assert.match(join, /'data-destination': destination/);
  assert.match(css, /\.participant-phase-intro\s*\{/);
  assert.match(css, /\.participant-checkin-card\s*\{/);
  assert.match(css, /\.participant-destination-nav\s*\{/);
});

test('live ranking fails closed on an incomplete or forked record', () => {
  const live = fs.readFileSync(path.join(root, 'competitions/app/pages/live.mjs'), 'utf8');
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  assert.match(live, /!snapshot\.state\.chain_complete \|\| snapshot\.state\.fork_detected/);
  assert.match(join, /!store\.trustworthy/);
});

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

test('the beta area is absent from the public sitemap', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes('/competitions/'), false);
});

test('every competition page is visibly beta and excluded from indexing', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      assert.match(page, /content="noindex,nofollow"/, `${lang}/${name}`);
      assert.match(page, /class="beta-badge"[^>]*>Beta</, `${lang}/${name}`);
      assert.match(page, /class="beta-notice"/, `${lang}/${name}`);
    }
  }
});

test('ordinary site pages do not link into the isolated competition beta', () => {
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        if (relative === 'competitions' || relative === 'de/competitions' || relative.startsWith('.git')) continue;
        visit(full);
      } else if (entry.name.endsWith('.html')) {
        const page = fs.readFileSync(full, 'utf8');
        assert.equal(/href=["'][^"']*\/competitions\//.test(page), false,
          `${relative} links into the competition beta`);
      }
    }
  };
  visit(root);
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
  // counter at all rather than a broken one. The download CTA is a plain,
  // direct link and deliberately carries none of the tracked-site hooks.
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      assert.equal(page.includes('anonymous-analytics'), false, `${lang}/${name}`);
      assert.equal(page.includes('data-apk-selector'), false, `${lang}/${name}`);
      assert.equal(page.includes('stats.cruxcoach.org'), false, `${lang}/${name}`);
    }
  }
});

test('every competition header links home and offers an untracked app download', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      const home = lang === 'de' ? '/de/' : '/';
      assert.match(page, new RegExp('<a class="site-brand" href="' + home + '"'),
        lang + '/' + name + ' has no linked brand');
      assert.match(page,
        /<a class="header-download" href="https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\/[^"]+\.apk"/,
        lang + '/' + name + ' has no direct app download');
      assert.equal(page.includes('data-apk-selector'), false,
        lang + '/' + name + ' tracks its download');
    }
  }
});

test('the pages load only same-origin assets', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      const fetchedAssets = [
        ...page.matchAll(/<(?:script|img|source)[^>]+src="(https?:\/\/[^"]+)"/g),
        ...page.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"/g),
      ];
      for (const match of fetchedAssets) {
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

test('every module a page loads resolves, transitively', async () => {
  // A typo in an import path produces a completely blank page and no error
  // anywhere a test would normally look. Walking the graph from each entry
  // point catches it here instead.
  const entries = new Set();
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const match = readPage(lang, name).match(/<script type="module" src="([^"]+)"><\/script>/);
      if (match) entries.add(path.join(root, new URL(match[1], 'https://cruxcoach.org').pathname.replace(/^\//, '')));
    }
  }
  assert.ok(entries.size >= 3, 'expected the organizer, join and live entry points');

  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(fs.existsSync(file), `missing module: ${path.relative(root, file)}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      visit(path.resolve(path.dirname(file), specifier.split('?')[0]));
    }
    for (const match of source.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      visit(path.resolve(path.dirname(file), match[1].split('?')[0]));
    }
  };
  for (const entry of entries) visit(entry);

  // The vendored crypto has to be reachable from a page, not only from a test.
  assert.ok(
    [...seen].some((f) => f.includes('assets/vendor/nostr-crypto/secp256k1')),
    'the pages never reach the vendored signing code',
  );
  assert.ok(seen.size >= 12, `only ${seen.size} modules were reachable, which looks wrong`);
});

test('every page references a stylesheet that exists', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const match = readPage(lang, name).match(/<link rel="stylesheet" href="([^"]+)">/);
      assert.ok(match, `${lang}/${name} has no stylesheet`);
      const pathname = new URL(match[1], 'https://cruxcoach.org').pathname.replace(/^\//, '');
      assert.ok(fs.existsSync(path.join(root, pathname)), match[1]);
    }
  }
});

test('the relay override is loopback-only and never replaces the competition relays', async () => {
  const { resolveRelays } = await import('../competitions/app/pages/common.mjs');
  const storage = new Map();
  const originalLocation = globalThis.location;
  const originalSession = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
  };
  const withSearch = (search) => { globalThis.location = { search, origin: 'https://cruxcoach.org' }; };
  try {
    // A link from a stranger cannot point a viewer at a relay of their
    // choosing. Such a relay could not forge anything, but it could serve a
    // truncated prefix of the log, which reduces cleanly and looks like a
    // competition that has simply not progressed.
    withSearch('?relay=wss://attacker.example.invalid');
    let resolved = resolveRelays(['wss://organiser.example.invalid']);
    assert.equal(resolved.includes('wss://attacker.example.invalid'), false);
    assert.ok(resolved.includes('wss://organiser.example.invalid'));

    withSearch('?relay=ws://evil.example.invalid:7447');
    assert.equal(resolveRelays([]).includes('ws://evil.example.invalid:7447'), false);

    // Loopback is accepted, and is ADDITIVE: the competition's own relays stay
    // in the set, so an override cannot hide entries the real relays serve.
    storage.clear();
    withSearch('?relay=ws://127.0.0.1:7447');
    resolved = resolveRelays(['wss://organiser.example.invalid']);
    assert.equal(resolved[0], 'ws://127.0.0.1:7447');
    assert.ok(resolved.includes('wss://organiser.example.invalid'));

    // With no override the competition's own relays come first, then discovery.
    storage.clear();
    withSearch('');
    resolved = resolveRelays(['wss://organiser.example.invalid']);
    assert.equal(resolved[0], 'wss://organiser.example.invalid');
    assert.ok(resolved.includes('wss://relay.damus.io'));
  } finally {
    globalThis.location = originalLocation;
    globalThis.sessionStorage = originalSession;
  }
});

test('every page has one h1, a skip link, and a labelled main landmark', () => {
  for (const lang of LANGUAGES) {
    for (const name of EN_PAGES) {
      const page = readPage(lang, name);
      assert.match(page, /<a class="skip-link" href="#main">/, `${lang}/${name}: no skip link`);
      assert.match(page, /<main id="main"/, `${lang}/${name}: no main landmark`);
      assert.match(page, /<nav aria-label="/, `${lang}/${name}: unlabelled nav`);
      // The two live regions every screen needs: polite for state, assertive
      // for "your turn" and errors.
      assert.match(page, /id="live-status"[^>]*aria-live="polite"/, `${lang}/${name}`);
      assert.match(page, /id="live-alerts"[^>]*aria-live="assertive"/, `${lang}/${name}`);
      // The landing page owns its h1 in markup; the app surfaces render theirs.
      if (name === 'index.html') {
        assert.equal((page.match(/<h1>/g) || []).length, 1, `${lang}/${name}: expected exactly one h1`);
      }
    }
  }
});

test('the stylesheet honours reduced motion, high contrast and focus visibility', () => {
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /color-scheme: dark/);
  // Touch targets: these get pressed at a wall, with chalk on.
  assert.match(css, /min-height: 2\.75rem/);
  // Wide content scrolls inside its own container rather than the page body.
  assert.match(css, /\.table-scroll \{ overflow-x: auto; \}/);
});

test('the organizer form offers every mode the protocol defines', () => {
  // A mode the reducer understands and the form cannot set is a mode nobody
  // can use. This is the check that the first version of this form failed:
  // it hard-coded organizer_set with no uniqueness and shipped green.
  const form = fs.readFileSync(
    path.join(root, 'competitions/app/pages/organizer-form.mjs'),
    'utf8',
  );
  const axes = {
    CLIMB_SOURCES,
    UNIQUENESS,
    PROGRESSIONS,
    SCORINGS,
  };
  for (const [name, values] of Object.entries(axes)) {
    for (const value of values) {
      assert.ok(
        form.includes(`'${value}'`) || form.includes(`"${value}"`),
        `the organizer form cannot set ${name} = ${value}`,
      );
    }
  }
});

test('every mode the form offers has a label in both languages', () => {
  // An option rendered with a missing key shows the key itself, which reads as
  // a bug to the organizer and is one.
  const { STRINGS } = i18nTesting;
  const modes = [...CLIMB_SOURCES, ...UNIQUENESS, ...PROGRESSIONS, ...SCORINGS];
  for (const value of modes) {
    const key = `org.mode.${value}`;
    for (const language of LANGUAGES) {
      assert.ok(STRINGS[language][key], `${key} is missing in ${language}`);
    }
  }
});

test('participant choice happens live, never during registration', () => {
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  assert.match(join, /selections: \[\]/, 'registration must not preselect climbs');
  assert.match(join, /rules\.climb_source === 'participant_choice'[\s\S]*available\.add\('chooser'\)/,
    'the focused chooser must exist for participant-choice competitions');
  assert.ok(join.includes('remainingClimbs'), 'live flow cannot choose from the remaining pool');
  assert.ok(join.includes('entrant.chooseClimb(climbId)'), 'the prepared choice must be visible to the host');
});

test('every page that can open a competition offers somewhere to paste it', async () => {
  // The live screen told people to paste a join link while rendering no input
  // at all, because it wrote its own empty state instead of using the form the
  // participant page already had. One form used by both is what keeps the
  // instruction and the page from drifting apart again.
  for (const name of ['live.mjs', 'join.mjs']) {
    const source = fs.readFileSync(path.join(root, 'competitions/app/pages', name), 'utf8');
    assert.ok(source.includes('openCompetitionForm'), `${name} builds its own way in`);
  }

  const { openCompetitionForm } = await import('../competitions/app/pages/common.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const card = openCompetitionForm((key) => key, () => {});
    assert.ok(card.querySelector('#comp-ref'), 'nothing to paste a link into');
    assert.ok(card.querySelector('button'), 'no way to submit what was pasted');
  } finally {
    restore();
  }
});

test('the organizer board picker is guided, visual, and keeps layout ids internal', async () => {
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const form = createCompetitionForm({
      t: createTranslator('en'),
      pool: null,
      signerPubkey: 'a'.repeat(64),
      defaultDisplayName: '',
      defaultLud16: '',
      relays: ['wss://relay.example.invalid'],
    });
    const brand = form.node.querySelector('#f-brand');
    const model = form.node.querySelector('#f-board');
    const layout = form.node.querySelector('#f-layout');
    const size = form.node.querySelector('#f-size');
    const angle = form.node.querySelector('#f-angle');

    assert.equal(model.tagName, 'SELECT');
    assert.equal(size.tagName, 'SELECT');
    assert.equal(angle.tagName, 'SELECT');
    assert.equal(layout.getAttribute('type'), 'hidden');
    assert.ok(form.node.querySelector('.board-preview')?.querySelector('img'), 'the selected wall has no visual preview');
    assert.equal(form.node.textContent.includes('org.field.layout'), false, 'layout id leaked into the UI');

    brand.value = 'moonboard';
    brand.dispatch('change');
    assert.equal(model.value, 'moonboard-2016');
    assert.equal(layout.value, '2');
    assert.deepEqual(size.options.map((option) => option.value), ['11x18']);
    assert.deepEqual(angle.options.map((option) => option.value), ['25', '40']);

    model.value = 'mini-moonboard-2020';
    model.dispatch('change');
    assert.equal(layout.value, '6');
    assert.deepEqual(size.options.map((option) => option.value), ['11x12']);
    assert.deepEqual(angle.options.map((option) => option.value), ['40']);
  } finally {
    restore();
  }
});

test('the time zone is a picker whose choices always show the start-date UTC relation', async () => {
  const { createCompetitionForm, timeZoneUtcRelation, zonedLocalToEpoch } = await import(
    '../competitions/app/pages/organizer-form.mjs'
  );
  assert.equal(timeZoneUtcRelation('Europe/Berlin', new Date('2026-01-15T12:00:00Z')), 'UTC+01:00');
  assert.equal(timeZoneUtcRelation('Europe/Berlin', new Date('2026-07-15T12:00:00Z')), 'UTC+02:00');
  assert.equal(
    new Date(zonedLocalToEpoch('2026-07-15T12:00', 'Europe/Berlin') * 1000).toISOString(),
    '2026-07-15T10:00:00.000Z',
    'datetime-local must be interpreted in the chosen zone rather than the browser zone',
  );

  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: { query: async () => ({ events: [] }) },
      signerPubkey: 'aa'.repeat(32), defaultDisplayName: 'Host', defaultLud16: '', relays: ['wss://nos.lol'],
    });
    const picker = form.node.querySelector('#f-timezone');
    assert.equal(picker.tagName, 'SELECT');
    assert.ok(picker.options.length > 300, 'modern browsers should receive the full IANA zone list');
    for (const option of picker.options) {
      assert.match(option.textContent, / \(UTC[+-]\d{2}:\d{2}\)$/);
    }
    picker.value = 'Europe/Berlin';
    const starts = form.node.querySelector('#f-start');
    starts.value = '2026-07-15T12:00';
    starts.dispatch('input');
    assert.match(
      picker.options.find((option) => option.value === 'Europe/Berlin').textContent,
      /\(UTC\+02:00\)$/,
    );
  } finally {
    restore();
  }
});

test('venue suggestions use the board-map catalogue without preventing a custom venue', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const { venueEntries } = await import('../competitions/app/data/venue-catalogue.mjs');
    const venues = venueEntries({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {
          name: 'Bloc Garten', city: 'Berlin', country: 'DE',
          boards: [{
            board: 'kilter', address: 'Testweg 7, Berlin', walls: [{
              layout: 'Homewall', size_id: 17, size_label: 'A translated map label',
              adjustable: true, angle: 30,
            }],
          }],
        },
      }, {
        type: 'Feature', properties: {
          name: 'Unspecified Moon Gym', city: 'Funchal', country: 'PT',
          boards: [{ board: 'moonboard', commercial: true, led: true, variant: null, angle: null }],
        },
      }, {
        type: 'Feature', properties: {
          name: 'Madeira Climbing Center', city: 'Funchal', country: 'PT',
          boards: [{ board: 'moonboard', commercial: true, led: true, variant: 'mb2019-masters', angle: null }],
        },
      }],
    });
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: { query: async () => ({ events: [] }) },
      signerPubkey: '33'.repeat(32), defaultDisplayName: 'Host', defaultLud16: '', relays: ['wss://nos.lol'],
      venueLoader: async () => venues,
    });
    const venue = form.node.querySelector('#f-venue');
    assert.equal(venue.getAttribute('role'), 'combobox');
    venue.value = 'bloc';
    venue.dispatch('input');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const suggestion = form.node.querySelector('.venue-suggestion');
    assert.equal(suggestion.textContent.includes('Bloc Garten'), true);
    suggestion.dispatch('click');
    assert.equal(venue.value, 'Bloc Garten');
    assert.equal(form.node.querySelector('#f-address').value, 'Testweg 7, Berlin');
    assert.equal(form.node.querySelector('#f-brand').value, 'kilter-homewall');
    assert.equal(form.node.querySelector('#f-board').value, 'kilterboard-homewall');
    assert.equal(form.node.querySelector('#f-size').value, 'Homewall 10x7 — Full Ride');
    assert.equal(form.node.querySelector('#f-angle').value, '30');
    assert.equal(form.node.querySelector('#f-layout').value, '8');
    assert.match(form.node.querySelector('#venue-suggestion-status').textContent, /also matched the board/);

    venue.value = 'My private training room';
    assert.equal(venue.value, 'My private training room', 'free text must remain valid');

    venue.value = 'unspecified';
    venue.dispatch('input');
    await new Promise((resolve) => setTimeout(resolve, 0));
    form.node.querySelector('.venue-suggestion').dispatch('click');
    assert.equal(form.node.querySelector('#f-brand').value, 'moonboard');
    assert.equal(form.node.querySelector('#f-board').value, '', 'a missing variant must never silently become 2016');
    assert.match(form.node.querySelector('.board-selection-summary').textContent, /does not say which version/);

    venue.value = 'madeira';
    venue.dispatch('input');
    await new Promise((resolve) => setTimeout(resolve, 0));
    form.node.querySelector('.venue-suggestion').dispatch('click');
    assert.equal(form.node.querySelector('#f-board').value, 'moonboard-masters-2019');
    const selectedMoon = [...form.node.querySelectorAll('.board-choice')]
      .find((choice) => choice.textContent.includes('MoonBoard Masters 2019'));
    assert.equal(selectedMoon?.getAttribute('aria-pressed'), 'true', 'the 2019 choice must be visibly selected');
    assert.equal(form.node.querySelector('#f-angle').value, '', 'an unknown angle must not silently become 40°');
    assert.match(form.node.querySelector('.board-selection-summary').textContent, /wall angle is unknown/);
  } finally {
    cleanup();
  }
});

test('competition creation is a guided wizard with a final review', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const historySteps = [];
    let backCalls = 0;
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: { query: async () => ({ events: [] }) },
      signerPubkey: '11'.repeat(32), defaultDisplayName: 'Host', defaultLud16: '', relays: ['wss://nos.lol'],
      onStepChange: (step) => historySteps.push(step),
      onStepBack: () => { backCalls += 1; },
    });
    assert.equal(form.stepCount, 8);
    assert.equal(form.currentStep, 0);
    let scrollCalls = 0;
    form.node.scrollIntoView = () => { scrollCalls += 1; };
    assert.equal(form.node.querySelectorAll('.wizard-panel').filter((step) => !step.getAttribute('hidden')).length, 1);
    const venueKind = form.node.querySelector('#f-venue-kind');
    const venue = form.node.querySelector('#f-venue');
    assert.equal(venue.getAttribute('required'), 'required');
    venueKind.value = 'online';
    venueKind.dispatch('change');
    assert.equal(venue.getAttribute('required'), null, 'an online event must not require a physical venue name');
    assert.match(venue.parentNode.textContent, /Optional/);
    form.showStep(7);
    assert.equal(form.currentStep, 7);
    assert.equal(scrollCalls, 1, 'each real step change should return to the top of the wizard');
    assert.deepEqual(historySteps, [7]);
    form.node.querySelector('.wizard-navigation').querySelector('button').dispatch('click');
    assert.equal(backCalls, 1, 'the visible Back control should use browser history');
    form.showStep(6, { recordHistory: false });
    assert.deepEqual(historySteps, [7], 'popstate must not create another history entry');
    assert.match(form.node.querySelector('.review-grid').textContent, /Kilter|Original/i);
    assert.equal(form.node.getAttribute('data-ready'), 'false');
  } finally {
    cleanup();
  }
});

test('an unpublished competition draft returns with its values and current step', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    let saved = null;
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: { query: async () => ({ events: [] }) },
      signerPubkey: '22'.repeat(32), defaultDisplayName: 'Host', defaultLud16: '', relays: ['wss://nos.lol'],
      initialDraft: {
        fields: {
          title: 'Friday Finals', organizerName: 'Boulder Crew', venueKind: 'online', venue: '',
          brand: 'moonboard', model: 'mini-moonboard-2020', size: '11x12', angle: '40', waitlist: false,
        },
        divisions: ['Open', 'Youth'],
        prizes: [],
        climbs: [{
          uuid: '11111111-1111-1111-1111-111111111111', kind: 'catalogue',
          label: 'Warm-up', angle: 40, points: 100,
        }],
        currentStep: 2,
      },
      onDraftChange: (draft) => { saved = draft; },
    });
    assert.equal(form.currentStep, 2);
    assert.equal(form.node.querySelector('#f-title').value, 'Friday Finals');
    assert.equal(form.node.querySelector('#f-board').value, 'mini-moonboard-2020');
    assert.equal(form.climbs.entries()[0].label, 'Warm-up');
    assert.equal(saved.currentStep, 2);
    form.node.querySelector('#f-title').value = 'Saturday Finals';
    // The production event bubbles from the input. The intentionally tiny DOM
    // shim has no bubbling, so deliver it at the form surface here.
    form.node.dispatch('input');
    assert.equal(saved.fields.title, 'Saturday Finals');
  } finally {
    cleanup();
  }
});

test('host editing is prefilled from the effective competition including nested organizer data', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { competitionToFormDraft, createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const competition = {
      title: 'Demo Comp', summary: 'Current summary', description: 'Current description',
      organizer: { name: 'Madeira Climbing Center', contact: 'host@example.org' },
      visibility: 'public', timezone: 'UTC', registration_opens_at: 1786665600,
      registration_closes_at: 1786737600, checkin_opens_at: 1786665600,
      checkin_closes_at: 1786737600, starts_at: 1786665600, ends_at: 1786737600,
      venue: { kind: 'physical', name: 'Madeira Climbing Center', address: 'Funchal' },
      board: { brand: 'moonboard', model: 'moonboard-masters-2019', layout_id: 5, size: '11x18', angle: 40 },
      rules: { climb_source: 'participant_choice', counted_climb_count: 4, attempts_per_climb: 3,
        scoring: 'tops_then_attempts', progression: 'synchronous_rounds', turn_deadline_sec: 120 },
      climb_pool: { options: [{
        id: 'c1', climb_uuid: '11111111-1111-1111-1111-111111111111',
        label: 'THE WARM UP PROBLEM', angle: 40, points: 100, source: 'catalogue', zone_hold: 7,
      }] }, capacity: 0, waitlist_enabled: true, fee_msat: 0,
      divisions: [{ id: 'open', label: 'Open' }], prizes: [], relays: [],
    };
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '22'.repeat(32),
      defaultDisplayName: '', defaultLud16: '', relays: [], persistDraft: false,
      initialDraft: competitionToFormDraft(competition), catalogueLoader: async () => ({ climbs: [] }),
    });
    assert.equal(form.node.querySelector('#f-title').value, 'Demo Comp');
    assert.equal(form.node.querySelector('#f-org').value, 'Madeira Climbing Center');
    assert.equal(form.node.querySelector('#f-contact').value, 'host@example.org');
    assert.equal(form.node.querySelector('#f-venue').value, 'Madeira Climbing Center');
    assert.equal(form.node.querySelector('#f-capacity-unlimited').checked, true);
    assert.deepEqual(form.climbs.entries().map((climb) => ({
      uuid: climb.uuid, label: climb.label, angle: climb.angle, zoneHold: climb.zoneHold,
    })), [{
      uuid: '11111111-1111-1111-1111-111111111111',
      label: 'THE WARM UP PROBLEM', angle: 40, zoneHold: 7,
    }]);
  } finally {
    cleanup();
  }
});

test('an unlimited entry capacity is shown as infinity in the review', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '22'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      initialDraft: { fields: { capacity: '0' } },
      catalogueLoader: async () => ({ climbs: [] }),
    });
    assert.equal(form.node.querySelector('#f-capacity-unlimited').checked, true);
    assert.equal(form.node.querySelector('#f-capacity').disabled, true);
    form.showStep(7, { recordHistory: false });
    assert.match(form.node.querySelector('.review-grid').textContent, /Up to ∞ entrants/);
    assert.doesNotMatch(form.node.querySelector('.review-grid').textContent, /Up to 0 entrants/);
  } finally {
    cleanup();
  }
});

test('unlimited capacity is an explicit bilingual choice instead of a protocol zero', () => {
  const { STRINGS } = i18nTesting;
  assert.match(STRINGS.en['org.field.capacity.unlimited'], /∞/);
  assert.match(STRINGS.de['org.field.capacity.unlimited'], /∞/);
  assert.doesNotMatch(STRINGS.en['org.field.capacity.info'], /\b0\b/);
  assert.doesNotMatch(STRINGS.de['org.field.capacity.info'], /\b0\b/);
});

test('the unlimited capacity choice disables the numeric limit and publishes protocol zero', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '22'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      catalogueLoader: async () => ({ climbs: [] }),
    });
    const toggle = form.node.querySelector('#f-capacity-unlimited');
    const capacity = form.node.querySelector('#f-capacity');
    assert.equal(capacity.value, '20');
    assert.equal(capacity.disabled, false);

    toggle.checked = true;
    toggle.dispatch('change');
    assert.equal(capacity.disabled, true);
    assert.equal(form.build().capacity, 0);

    toggle.checked = false;
    toggle.dispatch('change');
    assert.equal(capacity.disabled, false);
    assert.equal(form.build().capacity, 20);
  } finally {
    cleanup();
  }
});

test('restored catalogue climbs regain their verified holds after reload', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const uuid = '1110ca02-7d4f-54f6-a7b8-34492c4c98a5';
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '22'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      initialDraft: {
        fields: {
          brand: 'moonboard', model: 'moonboard-masters-2019', size: '11x18', angle: '40',
          scoring: 'tops_then_attempts',
        },
        climbs: [{ uuid, kind: 'catalogue', label: '!!!!', angle: 40, points: 100, zoneHold: 57 }],
      },
      catalogueLoader: async () => ({ climbs: [{
        uuid, label: '!!!!', setter: 'Moon setter', brand: 'moonboard',
        boardLabel: 'MoonBoard Masters 2019', layoutId: 5, productSizeId: null, angle: 40,
        holds: [[25, 42, 2, 2], [57, 43, 1, 5], [193, 44, 5, 17]],
        difficulty: 20, quality: 3, ascents: 100,
      }] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [row] = form.climbs.rows;
    assert.equal(row.described?.brand, 'moonboard');
    assert.deepEqual(row.zoneCandidates.map((hold) => hold[0]), [57]);
    assert.equal(row.zoneInput.value, '57', 'the saved zone survives sign-out, sign-in and catalogue hydration');
    assert.equal(form.climbs.entries()[0].zoneHold, 57);
    assert.doesNotMatch(form.node.textContent, /no verified intermediate hand holds/i);
  } finally {
    cleanup();
  }
});

test('the climb picker pages the catalogue and keeps selection guidance beside it', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const climbs = Array.from({ length: 25 }, (_, index) => ({
      uuid: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      label: `Climb ${index + 1}`, brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40,
      holds: [[1, 12, 12, 12], [2, 13, 72, 78], [3, 14, 132, 144]],
      difficulty: index, quality: 3, ascents: 25 - index,
    }));
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '22'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      catalogueLoader: async () => ({ climbs }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(form.node.querySelector('.climb-picker-workspace'));
    assert.ok(form.node.querySelector('.climb-selection-pane'));
    const results = form.node.querySelector('.climb-browser-results');
    assert.equal(results.querySelectorAll('.climb-result-card').length, 6);
    assert.match(form.node.querySelector('.climb-selection-task').textContent, /add 4 more/i);
    const more = form.node.querySelector('.climb-browser-more');
    assert.match(more.textContent, /6 more/);
    more.dispatch('click');
    assert.equal(results.querySelectorAll('.climb-result-card').length, 12);
  } finally {
    cleanup();
  }
});

test('conditional controls cannot be made visible by the shared button display rule', () => {
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('the selected-climb editor never overrides exact board preview geometry', () => {
  const css = fs.readFileSync(path.join(root, 'competitions/app/competitions.css'), 'utf8');
  const selectedPreviewRule = css.match(/\.climb-selection-pane \.climb-card-preview\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(selectedPreviewRule, /aspect-ratio|(?:^|;)\s*height\s*:/,
    'the canvas intrinsic ratio must define the same rectangle used by the board image');
});

test('the wizard progressively reveals only choices that apply', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: { query: async () => ({ events: [] }) },
      signerPubkey: '11'.repeat(32), defaultDisplayName: 'Host', defaultLud16: '', relays: ['wss://nos.lol'],
    });
    const fee = form.node.querySelector('#f-fee');
    const lnurl = form.node.querySelector('#f-lnurl');
    assert.equal(lnurl.getAttribute('required'), null, 'free events do not ask for payment details');
    fee.value = '250';
    fee.dispatch('input');
    assert.equal(lnurl.getAttribute('required'), 'required', 'paid events require a payment destination');

    const venueKind = form.node.querySelector('#f-venue-kind');
    venueKind.value = 'online';
    venueKind.dispatch('change');
    assert.equal(form.node.querySelector('#f-venue').getAttribute('required'), null);
    assert.equal(form.node.querySelector('#f-address').parentNode.getAttribute('hidden'), 'hidden');

    const climbSource = form.node.querySelector('#f-climb-source');
    climbSource.value = 'participant_choice';
    climbSource.dispatch('change');
    assert.equal(form.node.querySelector('#f-scoring').value, 'tops_then_attempts');
    assert.equal(form.node.querySelector('#f-scoring').parentNode.getAttribute('hidden'), null);
    assert.equal(form.node.querySelector('#f-uniqueness').parentNode.getAttribute('hidden'), 'hidden');
    assert.equal(form.node.querySelector('#f-uniqueness').value, 'none', 'shared choices are the safe default');

    climbSource.value = 'organizer_set';
    climbSource.dispatch('change');
    const scoring = form.node.querySelector('#f-scoring');
    scoring.value = 'achievement_points';
    scoring.dispatch('change');
    assert.equal(form.node.querySelector('#f-zone-points').parentNode.parentNode.getAttribute('hidden'), null);
    assert.match(form.node.querySelector('.scoring-preview').textContent, /Zone = 10.*Top = 25.*Flash = 30/);

    assert.equal(form.node.querySelector('#div-id-0'), null, 'protocol ids are never exposed to hosts');
    assert.equal(form.build().waiver, '', 'a waiver is opt-in, never silently prefilled');
    assert.ok(form.reviewActions, 'the create action belongs inside the final review');
  } finally {
    cleanup();
  }
});

test('selected-climb controls follow scoring and make zone choices accessible', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '11'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [], catalogueLoader: async () => ({ climbs: [] }),
    });
    form.climbs.addCatalogue({
      uuid: '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061', label: 'Blue slab', setter: 'Ada',
      brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40,
      holds: [[1, 12, 12, 12], [2, 13, 72, 78], [3, 14, 132, 144]],
    });
    const scoring = form.node.querySelector('#f-scoring');
    assert.equal(form.node.querySelector('#climb-points-0'), null, 'standard scoring has no per-climb points field');
    assert.ok(form.node.querySelector('.zone-hold-options'));
    assert.equal(form.node.querySelector('.zone-hold-options').querySelectorAll('input').length, 1);

    scoring.value = 'achievement_points'; scoring.dispatch('change');
    const zonePoints = form.node.querySelector('#f-zone-points');
    zonePoints.value = '0'; zonePoints.dispatch('input');
    assert.equal(form.node.querySelector('.zone-hold-options'), null, 'zero zone points remove zone UI');
    assert.equal(form.node.querySelector('#climb-points-0'), null);

    scoring.value = 'points_sum'; scoring.dispatch('change');
    assert.ok(form.node.querySelector('#climb-points-0'));
    assert.equal(form.node.querySelector('#climb-points-0').getAttribute('required'), 'required');
    assert.equal(form.node.querySelector('.zone-hold-options'), null);
  } finally {
    cleanup();
  }
});

test('the disabled climb-step Continue explains the live remaining count', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '11'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [], catalogueLoader: async () => ({ climbs: [] }),
    });
    for (let index = 1; index <= 3; index += 1) {
      form.climbs.addCatalogue({
        uuid: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, label: `Climb ${index}`,
        brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40,
        holds: [[index, 13, 72, 78]],
      });
    }
    form.showStep(4);
    const next = form.node.querySelector('.wizard-navigation').querySelector('.primary');
    assert.equal(next.disabled, true);
    assert.equal(form.node.querySelector('.wizard-step-status').textContent, 'Choose 1 more climb(s) before continuing.');
    assert.match(form.node.querySelector('.selection-count').textContent, /3 climbs available.*best 4 count/);
    form.node.querySelector('#f-climbs').value = '5';
    form.node.querySelector('#f-climbs').dispatch('input');
    assert.equal(form.node.querySelector('.wizard-step-status').textContent, 'Choose 2 more climb(s) before continuing.');
    assert.match(form.node.querySelector('.selection-count').textContent, /3 climbs available.*best 5 count/);
  } finally {
    cleanup();
  }
});

test('shared and exclusive pools have different format-specific climb blockers', async () => {
  const { window } = await import('./dev/mini-dom.mjs');
  const cleanup = window.install();
  try {
    const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: '11'.repeat(32),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [], catalogueLoader: async () => ({ climbs: [] }),
    });
    form.climbs.addCatalogue({
      uuid: '31c93f57-6e28-4b04-9d75-2f8a1e63c0b9', label: 'One',
      brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40, holds: [[1, 13, 72, 78]],
    });
    const source = form.node.querySelector('#f-climb-source');
    source.value = 'participant_choice'; source.dispatch('change');
    const count = form.node.querySelector('#f-climbs');
    count.value = '2'; count.dispatch('input');
    const capacity = form.node.querySelector('#f-capacity');
    capacity.value = '3'; capacity.dispatch('input');
    form.showStep(4);
    assert.equal(form.node.querySelector('.wizard-step-status').textContent,
      'Choose 1 more climb(s) before continuing.', 'shared pool needs only N options');

    const uniqueness = form.node.querySelector('#f-uniqueness');
    uniqueness.value = 'unique_per_competition'; uniqueness.dispatch('change');
    assert.equal(form.node.querySelector('.wizard-step-status').textContent,
      'Choose 5 more climb(s) before continuing.', 'exclusive pool needs N × capacity options');
  } finally {
    cleanup();
  }
});

test('the embedded browser admits only namespaced climbs with exact board metadata', async () => {
  const { isBrowsableClimbEvent } = await import('../competitions/app/pages/organizer-form.mjs');
  const pubkey = 'ab'.repeat(32);
  const uuid = '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061';
  const event = { pubkey, tags: [['d', `cruxcoach:climb:${pubkey.slice(0, 8)}:${uuid}`]] };
  const board = { brand: 'kilter', layout_id: 1, size: '12x12', angle: 40 };
  const described = { uuid, label: 'Blue slab', brand: 'kilter', layoutId: 1, size: '12x12', angle: 40 };
  assert.equal(isBrowsableClimbEvent(event, described, board), true);
  assert.equal(isBrowsableClimbEvent({ ...event, tags: [['d', `other-app:${uuid}`]] }, described, board), false);
  assert.equal(isBrowsableClimbEvent(event, { ...described, brand: '' }, board), false);
  assert.equal(isBrowsableClimbEvent(event, { ...described, layoutId: Number.NaN }, board), false);
  assert.equal(isBrowsableClimbEvent(event, { ...described, layoutId: 9 }, board), false);
  assert.equal(isBrowsableClimbEvent(event, { ...described, angle: 45 }, board), false);
  assert.equal(isBrowsableClimbEvent(event, { ...described, size: '8x12' }, board), false);
  assert.equal(isBrowsableClimbEvent(event, {
    ...described, uuid: '4f8a1c24-5b6d-4e71-9a03-2c7d8e4f5062',
  }, board), false, 'the signed address and payload must identify the same climb');
});

test('catalogue filters combine search, difficulty, sends and sort deterministically', async () => {
  const {
    filterCatalogue, gradeFilterOptions, gradeLabel, selectionReadiness,
  } = await import('../competitions/app/ui/climb-card.mjs');
  const rows = [
    { described: { uuid: 'a', label: 'Blue slab', setter: 'Ada', difficulty: 10, ascents: 25, quality: 3, createdAt: 100, holds: [1, 2] } },
    { described: { uuid: 'b', label: 'Red roof', setter: 'Bob', difficulty: 18, ascents: 4, quality: 4, createdAt: 300, holds: [1, 2, 3, 4] } },
    { described: { uuid: 'c', label: 'Green wall', setter: 'Cat', difficulty: 15, ascents: 10, quality: 2, createdAt: 200, holds: [1] } },
  ];
  assert.deepEqual(filterCatalogue(rows, {
    query: 'ada', minDifficulty: '8', maxDifficulty: '12', minAscents: '10', sort: 'hardest',
  }), [rows[0]]);
  assert.deepEqual(filterCatalogue(rows, { sort: 'quality' }), [rows[1], rows[0], rows[2]]);
  assert.deepEqual(filterCatalogue(rows, { sort: 'newest' }), [rows[1], rows[2], rows[0]]);
  assert.deepEqual(filterCatalogue(rows, { sort: 'quality_sends' }), [rows[0], rows[2], rows[1]]);
  assert.deepEqual(filterCatalogue(rows, { sort: 'most_moves' }), [rows[1], rows[0], rows[2]]);
  assert.deepEqual(filterCatalogue(rows, { sort: 'fewest_moves' }), [rows[2], rows[0], rows[1]]);
  const shuffled = filterCatalogue(rows, { sort: 'random', randomSeed: 42 });
  assert.deepEqual(filterCatalogue(rows, { sort: 'random', randomSeed: 42 }), shuffled,
    'pagination must retain one random ordering');
  assert.notDeepEqual(filterCatalogue(rows, { sort: 'random', randomSeed: 43 }), shuffled,
    'choosing Random again should reshuffle');
  assert.equal(gradeLabel(20, 'v'), 'V5');
  assert.equal(gradeLabel(20, 'font'), '6c');
  assert.deepEqual(gradeFilterOptions('v', 'max').find(({ label }) => label === 'V0'), {
    label: 'V0', value: '12',
  }, 'a maximum V0 filter must include every difficulty displayed as V0');
  assert.deepEqual(gradeFilterOptions('font', 'min').slice(0, 3), [
    { label: '4a', value: '10' }, { label: '4b', value: '11' }, { label: '4c', value: '12' },
  ]);
  assert.deepEqual(selectionReadiness({ catalogueState: 'loading', chosen: 1, needed: 1 }), {
    ready: false, reason: 'catalogue',
  });
  assert.deepEqual(selectionReadiness({ catalogueState: 'ready', chosen: 1, needed: 2 }), {
    ready: false, reason: 'missing', count: 1,
  });
  assert.deepEqual(selectionReadiness({ catalogueState: 'ready', chosen: 2, needed: 2 }), {
    ready: true, reason: 'complete', count: 0,
  });
});

test('scoring policy exposes only fields that can affect that leaderboard', async () => {
  const { scoringFieldPolicy } = await import('../competitions/app/pages/organizer-form.mjs');
  assert.deepEqual(scoringFieldPolicy('tops_then_attempts'), { points: false, zone: true });
  assert.deepEqual(scoringFieldPolicy('achievement_points', 10), { points: false, zone: true });
  assert.deepEqual(scoringFieldPolicy('achievement_points', 0), { points: false, zone: false });
  assert.deepEqual(scoringFieldPolicy('points_sum'), { points: true, zone: false });
  assert.deepEqual(scoringFieldPolicy('hardest_n'), { points: true, zone: false });
});

test('participant scoring copy explains best N from the actual organizer list', async () => {
  const { scoringExplanation } = await import('../competitions/app/ui/scoring-copy.mjs');
  const t = createTranslator('en');
  const climbs = Array.from({ length: 12 }, (_, index) => ({ id: `c${index + 1}` }));
  const competition = {
    climbs,
    rules: {
      climb_source: 'organizer_set', climb_count: 5, counted_climb_count: 5,
      scoring: 'tops_then_attempts',
    },
  };
  assert.match(scoringExplanation(t, competition), /best 5 of 12 results count/i);
  assert.doesNotMatch(scoringExplanation(t, {
    ...competition, climbs: climbs.slice(0, 5), rules: { ...competition.rules, counted_climb_count: undefined },
  }), /Only the best/i, 'legacy N=M competitions keep their existing explanation');
});

test('zone candidates include only semantic intermediate handholds for every board family', async () => {
  const { zoneCandidateHolds } = await import('../competitions/app/ui/climb-card.mjs');
  const holds = [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 42, 43, 44, 45]
    .map((role, index) => [index + 1, role, index, index]);
  assert.deepEqual(zoneCandidateHolds(holds).map((hold) => hold[1]), [2, 6, 13, 43]);
});

test('a zone can be selected directly on the board image and only a route handhold is hittable', async () => {
  const { climbCard } = await import('../competitions/app/ui/climb-card.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    let selected = null;
    const card = climbCard({
      climb: {
        label: 'Tap target', brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40,
        holds: [[1, 12, 12, 12], [2, 13, 72, 78], [3, 14, 132, 144]],
      },
      board: {
        brand: 'kilter', model: 'kilterboard-og', layout_id: 1,
        size: '12x12, with Kickboard', angle: 40,
      },
      t: createTranslator('en'), zoneSelectable: true, onZone: (hold) => { selected = hold; },
    });
    const canvas = card.querySelector('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    canvas.dispatch('click', { clientX: 50, clientY: 50 });
    assert.equal(selected, 2);
    assert.match(canvas.getAttribute('aria-label'), /selected as the zone/);
    selected = null;
    canvas.dispatch('click', { clientX: 8, clientY: 92 });
    assert.equal(selected, null, 'a start hold must not become a zone');
  } finally {
    restore();
  }
});

test('board previews share the image geometry and open an accessible large view', async () => {
  const { climbCard, previewTransform } = await import('../competitions/app/ui/climb-card.mjs');
  const moonBoard = {
    brand: 'moonboard', model: 'moonboard-masters-2019', layout_id: 5, size: '11x18', angle: 40,
  };
  const moon = previewTransform({ bounds: [0, 10, 0, 17] }, moonBoard);
  assert.equal(moon.aspect, 0.6497);
  assert.equal(moon.point(0, 0), null, 'MoonBoard points must come from the measured asset map');
  const kilterBoard = {
    brand: 'kilter', model: 'kilterboard-og', layout_id: 1,
    size: '12x12, with Kickboard', angle: 40,
  };
  const kilter = previewTransform({ bounds: [24, 120, 0, 156] }, kilterBoard);
  assert.deepEqual(kilter.point(0, 0), [0, 1]);
  assert.deepEqual(kilter.point(144, 156), [1, 0]);

  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const card = climbCard({
      climb: { label: 'Test climb', holds: [[1, 42, 0, 0]], bounds: [0, 10, 0, 17] },
      board: moonBoard,
      t: createTranslator('en'),
    });
    document.body.append(card);
    const trigger = card.querySelector('.climb-card-preview');
    assert.equal(trigger.tagName, 'BUTTON');
    assert.match(trigger.getAttribute('aria-label'), /Enlarge board preview/);
    trigger.dispatch('click');
    const dialog = document.body.querySelector('.climb-preview-dialog');
    assert.ok(dialog);
    assert.ok(dialog.querySelector('.climb-preview-close'));
    dialog.querySelector('.climb-preview-close').dispatch('click');
    assert.equal(document.body.querySelector('.climb-preview-dialog'), null);
  } finally {
    restore();
  }
});

test('measured MoonBoard preview data covers every supported variant', () => {
  return import('../competitions/app/protocol/board-catalog.mjs').then(({ BOARD_TYPES, boardRenderGeometry }) => {
  const geometry = JSON.parse(fs.readFileSync(
    path.join(root, 'competitions/data/moonboard-preview-geometry.json'), 'utf8',
  ));
  assert.equal(geometry.v, 1);
  assert.deepEqual(Object.keys(geometry.layouts), ['1', '2', '3', '4', '5', '6', '7']);
  for (const [layout, entry] of Object.entries(geometry.layouts)) {
    assert.equal(Number.isFinite(entry.aspect) && entry.aspect > 0, true, `layout ${layout} aspect`);
    assert.equal(Object.keys(entry.holds).length, ['6', '7'].includes(layout) ? 132 : 198);
    assert.equal(Object.values(entry.holds).every((point) => point.length === 2
      && point.every((value) => value >= 0 && value <= 1)), true);
    const model = BOARD_TYPES.find(({ brand }) => brand === 'moonboard').models
      .find(({ layoutId }) => layoutId === Number(layout));
    assert.equal(boardRenderGeometry({
      brand: 'moonboard', model: model.value, layout_id: model.layoutId,
      size: model.sizes[0].value, angle: model.defaultAngle,
    }).aspect, entry.aspect, `layout ${layout} Android asset aspect`);
  }
  });
});

test('the participant catalogue is live-only and registration has no hidden picker', () => {
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  assert.doesNotMatch(join, /function claimStatus|repickButton|sel-\$\{option\.id\}/);
  assert.doesNotMatch(join, /false &&/);
  assert.match(join, /function nextClimbChooser/);
  assert.match(join, /hydrateCatalogue\(store\.competition\)/);
  assert.match(join, /function fixedClimbsPanel/);
});

test('the organizer catalogue loads automatically and only exposes retry after failure', async () => {
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    let loads = 0;
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null,
      signerPubkey: 'a'.repeat(64), defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      catalogueLoader: async () => { loads += 1; return { climbs: [] }; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loads, 1, 'a complete default board should start loading without a click');
    assert.equal(form.node.textContent.includes('Load app catalogue'), false);
    const retry = form.node.querySelectorAll('button')
      .find((button) => button.textContent === 'Try loading again');
    assert.equal(retry?.getAttribute('hidden'), 'hidden',
      'retry must stay hidden after a successful automatic load');
    for (const id of ['#f-climb-min-grade', '#f-climb-max-grade', '#f-climb-min-ascents', '#f-climb-sort']) {
      const control = form.node.querySelector(id);
      assert.equal(control.tagName, 'SELECT', `${id} should use the same compact dropdown control`);
      assert.equal(control.getAttribute('required'), null, `${id} is a filter, not a required form field`);
      assert.equal(control.parentNode.querySelector('.field-marker'), null);
    }
    assert.equal(form.node.querySelector('#f-climb-min-ascents').value, '0');
  } finally {
    restore();
  }
});

test('a pending Kilter response cannot populate a newly selected MoonBoard catalogue', async () => {
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { catalogueBoardKey } = await import('../competitions/app/protocol/board-catalog.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const pending = new Map();
    const calls = [];
    const catalogueLoader = (board) => new Promise((resolve) => {
      const key = catalogueBoardKey(board);
      calls.push(key);
      pending.set(key, resolve);
    });
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: 'a'.repeat(64),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [], catalogueLoader,
    });
    assert.equal(calls[0], 'kilter:1:10:40');
    const brand = form.node.querySelector('#f-brand');
    const model = form.node.querySelector('#f-board');
    brand.value = 'moonboard'; brand.dispatch('change');
    model.value = 'moonboard-masters-2019'; model.dispatch('change');
    const moonKey = 'moonboard:5:layout:40';
    assert.ok(calls.includes(moonKey));

    pending.get('kilter:1:10:40')({ climbs: [{
      uuid: '11111111-1111-1111-1111-111111111111', label: 'STALE KILTER',
      brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40, holds: [[1, 13, 0, 0]],
    }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(form.node.textContent.includes('STALE KILTER'), false);

    pending.get(moonKey)({ climbs: [{
      uuid: '22222222-2222-2222-2222-222222222222', label: 'REAL MOON 2019',
      brand: 'moonboard', layoutId: 5, productSizeId: null, angle: 40,
      holds: [[25, 42, 2, 2], [57, 43, 1, 5], [193, 44, 5, 17]],
    }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(form.node.textContent.includes('REAL MOON 2019'), true);
    assert.equal(form.node.textContent.includes('STALE KILTER'), false);
  } finally {
    restore();
  }
});

test('draft restoration starts only the restored MoonBoard 2019 catalogue', async () => {
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { catalogueBoardKey } = await import('../competitions/app/protocol/board-catalog.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const calls = [];
    createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: 'a'.repeat(64),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      initialDraft: { fields: {
        brand: 'moonboard', model: 'moonboard-masters-2019', size: '11x18', angle: '40',
      } },
      catalogueLoader: async (board) => { calls.push(catalogueBoardKey(board)); return { climbs: [] }; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['moonboard:5:layout:40']);
  } finally {
    restore();
  }
});

test('a stale or wrong-brand loader payload fails closed before cards render', async () => {
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const form = createCompetitionForm({
      t: createTranslator('en'), pool: null, signerPubkey: 'a'.repeat(64),
      defaultDisplayName: 'Host', defaultLud16: '', relays: [],
      initialDraft: { fields: {
        brand: 'moonboard', model: 'moonboard-masters-2019', size: '11x18', angle: '40',
      } },
      catalogueLoader: async () => ({ climbs: [{
        uuid: '11111111-1111-1111-1111-111111111111', label: 'WRONG BRAND',
        brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40, holds: [[1, 13, 0, 0]],
      }] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(form.node.textContent.includes('WRONG BRAND'), false);
    assert.match(form.node.querySelector('.climb-browser-results').textContent, /^$/);
    assert.match(form.node.textContent, /did not match this exact board/);
  } finally {
    restore();
  }
});

test('the organizer form builds a competition every validator accepts', async () => {
  // The form is DOM code, so this drives `build()` through a minimal document
  // rather than asserting on its source. What it proves is the thing a source
  // scan cannot: that what the form produces actually validates.
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { validateCompetitionConfig, newCompId } = await import('../competitions/app/protocol/competition.mjs');

  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const form = createCompetitionForm({
      t: createTranslator('en'),
      pool: null,
      signerPubkey: 'a'.repeat(64),
      defaultDisplayName: 'Kellerwand',
      defaultLud16: '',
      relays: ['wss://relay.example.invalid'],
    });
    // The three things a form cannot invent for somebody: what the competition
    // is called, where it is, and which board it runs on.
    const fill = (id, value) => { form.node.querySelector(`#${id}`).value = value; };
    fill('f-title', 'Kellerwand Winter Session');
    fill('f-venue', 'Kellerwand Boulderhalle');
    fill('f-board', 'kilterboard-og');
    fill('f-climbs', '1');
    fill('f-fee', '321');
    fill('f-lnurl', 'organizer@example.invalid');

    // And at least one real climb, which is the point of the whole exercise:
    // this is a catalogue uuid, so nothing is fetched and the organizer names
    // it themselves.
    const added = await form.climbs.add('3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061');
    assert.equal(added, true, 'a real catalogue uuid must be accepted');
    assert.equal(
      await form.climbs.add('11111111-1111-4111-8111-111111111111'),
      false,
      'a placeholder must be refused by the form, not only by the validator',
    );
    form.node.querySelector('#climb-label-0').value = 'Blue slab';
    form.node.querySelector('#f-scoring').value = 'points_sum';

    const config = form.build(newCompId(), Math.floor(Date.UTC(2026, 7, 9) / 1000));
    assert.equal(config.fee_msat, 321000, 'the sats UI must convert exactly at the protocol boundary');
    const result = validateCompetitionConfig(config);
    assert.equal(result.ok, true, JSON.stringify(result.errors));

    // The fixed-set format derives M from the actual list and keeps best N
    // independent. This is the representative 12-available / best-5 product case.
    fill('f-climbs', '5');
    for (let index = 0; index < 11; index += 1) {
      const uuid = `3f8a1c24-5b6d-4e71-9a03-${String(index + 1).padStart(12, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await form.climbs.add(uuid), true);
      form.node.querySelector(`#climb-label-${index + 1}`).value = `Final ${index + 2}`;
    }
    const bestFive = form.build();
    assert.equal(bestFive.climbs.length, 12);
    assert.equal(bestFive.rules.climb_count, 5);
    assert.equal(bestFive.rules.counted_climb_count, 5);
    assert.equal(validateCompetitionConfig(bestFive).ok, true);
    assert.match(form.node.querySelector('.results-example').textContent, /12.*5/);
  } finally {
    restore();
  }
});

test('the organizer form builds a participant-choice competition too', async () => {
  // The mode the first version of this form could not express at all. Driving
  // it rather than reading the source is what makes that claim checkable.
  const { createCompetitionForm } = await import('../competitions/app/pages/organizer-form.mjs');
  const { validateCompetitionConfig, newCompId } = await import('../competitions/app/protocol/competition.mjs');
  const { window } = await import('./dev/mini-dom.mjs');

  const restore = window.install();
  try {
    const form = createCompetitionForm({
      t: (key) => key,
      pool: null,
      signerPubkey: 'a'.repeat(64),
      defaultDisplayName: 'Kellerwand',
      defaultLud16: '',
      relays: ['wss://relay.example.invalid'],
    });
    const set = (id, value) => { form.node.querySelector(`#${id}`).value = value; };
    set('f-title', 'Pick your own');
    set('f-venue', 'Kellerwand Boulderhalle');
    set('f-board', 'kilterboard-og');
    set('f-climb-source', 'participant_choice');
    set('f-uniqueness', 'unique_per_competition');
    set('f-progression', 'asynchronous_turns');
    set('f-climbs', '1');
    set('f-capacity', '2');

    // With unique claims the pool has to hold enough for everyone.
    for (const uuid of [
      '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061',
      '7b2e9d15-4c8a-4f36-8d52-1e9a3b7c4d08',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await form.climbs.add(uuid), true, uuid);
    }
    form.node.querySelector('#climb-label-0').value = 'Blue slab';
    form.node.querySelector('#climb-label-1').value = 'Red roof';
    form.node.querySelector('#f-scoring').value = 'achievement_points';
    form.node.querySelector('#f-zone-points').value = '0';
    form.node.querySelector('#f-top-points').value = '10';

    const config = form.build(newCompId(), Math.floor(Date.UTC(2026, 7, 9) / 1000));
    assert.equal(config.rules.climb_source, 'participant_choice');
    assert.equal(config.rules.selection_uniqueness, 'none');
    assert.equal(config.rules.progression, 'asynchronous_turns');
    assert.equal(config.climbs, undefined, 'a chosen-climbs competition carries a pool, not a list');
    assert.equal(config.climb_pool.options.length, 2);
    assert.equal(config.rules.climb_count, 2, 'available M is the complete pool');
    assert.equal(config.rules.counted_climb_count, 1, 'best N is independent of pool size');

    const result = validateCompetitionConfig(config);
    assert.equal(result.ok, true, JSON.stringify(result.errors));

    // Shared choice never multiplies by capacity: the same one-climb pool is
    // valid even when hundreds of entrants may choose that climb.
    set('f-uniqueness', 'none');
    set('f-capacity', '500');
    const shared = form.build();
    assert.ok(shared.climb_pool.options.length >= shared.rules.climb_count);
    assert.equal(shared.rules.counted_climb_count, 1);
    assert.equal(shared.rules.climb_count, shared.climb_pool.options.length);
    assert.equal(validateCompetitionConfig(shared).ok, true);
  } finally {
    restore();
  }
});

test('every participant state a person can act on has the control to leave it', () => {
  // The defect class this catches: a screen that renders a state and offers no
  // way out of it. Paid entry on Android was exactly that for a whole release —
  // `payment == pending` with no button — and the same shape hid in two more
  // places.
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');

  // A payment the organizer recorded as failed or expired must be retryable,
  // not merely displayed.
  assert.ok(
    /PAYABLE_STATES = new Set\(\['pending', 'failed', 'expired'\]\)/.test(join),
    'a failed or expired payment must still offer a way to pay',
  );

  // Withdrawing must not be a door that locks behind you.
  assert.ok(join.includes("'withdrawn', 'rejected'"), 'no way back in after withdrawing');
  assert.ok(join.includes('reg.again'), 'no control to ask again');

  // Being accepted but not checked in must offer the check-in request the app
  // has had all along.
  assert.ok(join.includes('entrant.requestCheckIn()'), 'no way to ask to be checked in');
});

test('the two clients offer the same participant actions', () => {
  // Not a style rule: a capability the browser has and the phone does not is
  // the exact gap that shipped twice. Each entry is (web call, Android method).
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');
  const androidViewModel = fs.readFileSync(
    path.join(root, '../cruxcoach-0.2.3-competitions/androidApp/src/main/java/com/cruxcoach/android/ui/competition/CompetitionDetailViewModel.kt'),
    'utf8',
  );
  const pairs = [
    ['entrant.register(', 'fun register('],
    ['entrant.withdraw()', 'fun withdraw()'],
    ['entrant.requestCheckIn()', 'fun requestCheckIn()'],
    ['entrant.requestDefer(', 'fun requestDefer()'],
    ['entrant.reportAttempt(', 'fun reportAttempt('],
    ['requestInvoice(', 'fun requestInvoice()'],
  ];
  for (const [web, android] of pairs) {
    assert.ok(join.includes(web), `the website is missing ${web}`);
    assert.ok(androidViewModel.includes(android), `the app is missing ${android}`);
  }
});

test('the organizer console handles every participant intent it subscribes to', () => {
  const organizer = fs.readFileSync(path.join(root, 'competitions/app/pages/organizer.mjs'), 'utf8');
  for (const op of [
    'register', 'withdraw', 'checkin_request', 'defer_request', 'attempt_report',
    'prize_claim', 'prize_receipt',
  ]) {
    assert.match(organizer, new RegExp(`['\"]${op}['\"]`), `${op} has no organizer surface`);
  }
  assert.match(organizer, /intents\.get\(`\$\{current\}:climb_choice`\)/,
    'the current participant choice must drive the host surface');
  assert.match(organizer, /decideRegistration\(intent\.pubkey,\s*'withdrawn'/,
    'withdrawal must become an authority decision');
  assert.match(organizer, /intentId:\s*intent\.eventId/,
    'authority decisions must name the exact replaceable intent they answer');
  assert.match(organizer, /decideRegistration\(intent\.pubkey,\s*'rejected'/,
    'registration requests need a reject action');
  assert.match(organizer, /confirm\(t\('org\.skip_turn\.confirm'\)\)/,
    'skipping a turn must explain and confirm its effect');
  assert.match(organizer, /confirm\(t\('org\.finish\.confirm'\)\)/,
    'finishing must explain and confirm its terminal effect');
  assert.match(organizer, /confirm\(t\('org\.cancel_comp\.confirm'\)\)/,
    'cancellation must explain that relay deletion follows and is best effort');
  assert.match(organizer, /\['prize_claim', 'prize_receipt'\]\.includes/,
    'each prize request needs its own replaceable inbox lane');

  const authority = fs.readFileSync(path.join(root, 'competitions/app/authority.mjs'), 'utf8');
  assert.match(authority, /nonceScope: `prize_claim:\$\{prizeId\}`/,
    'claiming a second prize must not replace the first claim');
  assert.match(authority, /nonceScope: `prize_receipt:\$\{prizeId\}`/,
    'acknowledging a second prize must not replace the first receipt');
});

test('the nsec import path is masked, session-only and explicitly warned', () => {
  const shell = fs.readFileSync(path.join(root, 'competitions/app/ui/shell.mjs'), 'utf8');
  assert.match(shell, /type:\s*'password'.*id:\s*'import-nsec'/s);
  assert.match(shell, /new KeyVaultSession\(\{ storage: null \}\)/);
  assert.match(shell, /signin\.import\.warning/);
});

test('sign-in starts with two human choices, then separates registration from login', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const mount = document.createElement('div');
    const first = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    first.render();
    const choices = mount.querySelectorAll('.signin-choice');
    assert.equal(choices.length, 2);
    assert.ok(mount.textContent.includes('signin.choice.new'));
    assert.ok(mount.textContent.includes('signin.choice.existing'));
    assert.equal(mount.textContent.includes('signin.extension'), false);

    choices[0].dispatch('click');
    assert.ok(mount.textContent.includes('signin.local.action'));
    assert.ok(mount.textContent.includes('signin.new.signer.action'));
    assert.equal(mount.textContent.includes('signin.extension'), false,
      'the first new-identity screen should present two clear storage paths');
    mount.querySelectorAll('button').find(
      (button) => button.textContent === 'signin.new.signer.action',
    ).dispatch('click');
    assert.ok(mount.textContent.includes('signin.extension'));
    assert.ok(mount.textContent.includes('signin.bunker'));
    assert.ok(mount.querySelector('#bunker-save-pass'));
    assert.ok(mount.querySelector('#bunker-save-repeat'));
    assert.equal(mount.textContent.includes('signin.import'), false,
      'the signer path should not mix in raw browser-key import');
    assert.equal(mount.querySelectorAll('a').length, 3,
      'the signer path should offer nos2x, nos2x-fox and Amber');
    first.session.dispose();
    first.remoteSession.dispose();

    const second = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    second.render();
    mount.querySelectorAll('.signin-choice')[1].dispatch('click');
    assert.ok(mount.textContent.includes('signin.extension'));
    assert.ok(mount.textContent.includes('signin.bunker'));
    assert.ok(mount.textContent.includes('signin.import'));
    assert.equal(mount.textContent.includes('signin.local.action'), false);
    second.session.dispose();
    second.remoteSession.dispose();
  } finally {
    restore();
  }
});

test('Android sign-in hands a client-initiated connection directly to Amber', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let signIn;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' },
    });
    const mount = document.createElement('div');
    signIn = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    signIn.navigate('signer');
    const amber = mount.querySelectorAll('a').find(
      (link) => link.textContent === 'signin.bunker.open_amber',
    );
    assert.ok(amber, 'Android must get a direct Amber action');
    assert.match(amber.getAttribute('href'), /^nostrconnect:\/\//);
    assert.ok(mount.textContent.includes('signin.bunker.save_hint'),
      'the reusable encrypted pairing must be explained before the one-time hand-off');
    const shell = fs.readFileSync(path.join(root, 'competitions/app/ui/shell.mjs'), 'utf8');
    assert.match(shell, /finishRemotePairing\(signer, '', \{ persist: false \}\)/,
      'direct Amber sign-in must stay tab-scoped and require no browser passphrase');
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    restore();
  }
});

test('new bunker pairings are persisted before the signer session is used', () => {
  const shell = fs.readFileSync(path.join(root, 'competitions/app/ui/shell.mjs'), 'utf8');
  assert.match(shell, /await this\.remoteSession\.persist\(connection, passphrase\)/);
  assert.match(shell, /await this\.use\(signer, 'nip46'\)/);
  assert.ok(shell.indexOf('await this.remoteSession.persist(connection, passphrase)')
    < shell.indexOf("await this.use(signer, 'nip46')"));
});

test('browser Back moves through sign-in before it leaves the participant page', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  let signIn;
  try {
    const mount = document.createElement('div');
    signIn = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    signIn.render();
    mount.querySelectorAll('.signin-choice')[0].dispatch('click');
    assert.ok(mount.textContent.includes('signin.new.title'));
    assert.equal(globalThis.window.history.length, 2);

    globalThis.window.history.back();
    assert.ok(mount.textContent.includes('signin.choice.title'));
    assert.equal(signIn.entryMode, null);

    globalThis.window.history.forward();
    signIn.pendingKey = signIn.session.generate();
    signIn.renderBackup();
    globalThis.window.history.back();
    assert.equal(signIn.pendingKey, null, 'Back must wipe an unpublished generated identity');
    assert.ok(mount.textContent.includes('signin.choice.title'));
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    restore();
  }
});

test('browser and visible Back visit every generated-key backup step in order', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  let signIn;
  try {
    const mount = document.createElement('div');
    signIn = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    signIn.navigate('new');
    signIn.pendingKey = signIn.session.generate();
    signIn.navigate('new-backup-choice');
    assert.ok(mount.textContent.includes('key.choice.title'));

    mount.querySelectorAll('button')[0].dispatch('click');
    assert.ok(mount.querySelector('#new-pass'), 'protected choice must open its passphrase step');
    signIn.session.createNcryptsec = async () => 'ncryptsec1encrypted';
    mount.querySelector('#new-pass').value = 'a strong passphrase';
    mount.querySelector('#repeat-pass').value = 'a strong passphrase';
    mount.querySelector('.primary').dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(mount.textContent.includes('key.encrypted.ready.title'));

    globalThis.window.history.back();
    assert.ok(mount.querySelector('#new-pass'), 'Back from download must return to the passphrase step');
    mount.querySelector('.backup-back').dispatch('click');
    assert.ok(mount.textContent.includes('key.choice.title'), 'visible Back must return to backup choice');
    mount.querySelector('.backup-back').dispatch('click');
    assert.ok(mount.textContent.includes('signin.local.action'), 'Back from backup choice must return to identity creation');
    assert.equal(signIn.pendingKey, null, 'leaving backup must wipe the unpublished identity');

    signIn.pendingKey = signIn.session.generate();
    signIn.navigate('new-backup-choice');
    mount.querySelectorAll('button')[1].dispatch('click');
    assert.ok(mount.textContent.includes('key.raw.title'));
    globalThis.window.history.back();
    assert.ok(mount.textContent.includes('key.choice.title'), 'raw backup must not be skipped either');
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    restore();
  }
});

test('the raw backup is an explicit choice and stays masked until revealed', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  try {
    const mount = document.createElement('div');
    const signIn = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    signIn.pendingKey = signIn.session.generate();
    const nsec = signIn.pendingKey.nsec;
    signIn.renderBackup();
    assert.ok(mount.textContent.includes('key.choice.encrypted'));
    assert.ok(mount.textContent.includes('key.choice.raw'));
    mount.querySelectorAll('button')[1].dispatch('click');
    assert.equal(mount.querySelector('.secret').textContent.includes(nsec), false);
    assert.equal(mount.querySelectorAll('#nsec-warning').length, 1,
      'the recovery warning should be concise rather than repeated');
    assert.ok(mount.textContent.includes('key.practice.password_manager'));
    assert.ok(mount.textContent.includes('key.practice.private'));
    assert.equal(mount.textContent.includes('key.practice.verify'), false);
    assert.equal(mount.textContent.includes('key.signer'), false);
    assert.equal(mount.querySelectorAll('a').length, 0,
      'browser-key recovery should not introduce a second signer decision');
    assert.ok(mount.textContent.includes('key.backup.continue'));
    const eye = mount.querySelector('.secret-reveal');
    assert.equal(eye.getAttribute('aria-pressed'), 'false');
    eye.dispatch('click');
    assert.equal(mount.querySelector('.secret').textContent, nsec);
    assert.equal(eye.getAttribute('aria-pressed'), 'true');
    eye.dispatch('click');
    assert.equal(mount.querySelector('.secret').textContent.includes(nsec), false);
    signIn.session.dispose();
    signIn.remoteSession.dispose();
  } finally {
    restore();
  }
});

test('an encrypted ncryptsec backup is saved once and continues directly into the session', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  let signIn;
  try {
    const mount = document.createElement('div');
    let signedIn;
    let resolveChanged;
    const changed = new Promise((resolve) => { resolveChanged = resolve; });
    signIn = new SignIn({
      t: (key) => key,
      mount,
      onChange: (signer) => { signedIn = signer; resolveChanged(); },
    });
    // A real browser has localStorage. The mini DOM deliberately does not, so
    // make the test exercise the encrypted-save branch explicitly.
    signIn.session.storage = { getItem: () => null, setItem() {}, removeItem() {} };
    signIn.pendingKey = signIn.session.generate();
    signIn.session.createNcryptsec = async () => 'ncryptsec1encrypted';
    let saved;
    signIn.session.saveNcryptsec = (value) => { saved = value; return true; };
    signIn.renderBackup();
    mount.querySelectorAll('button')[0].dispatch('click');
    assert.ok(mount.querySelector('#new-pass'));
    mount.querySelector('#new-pass').value = 'a strong passphrase';
    mount.querySelector('#repeat-pass').value = 'a strong passphrase';
    mount.querySelector('.primary').dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(mount.textContent.includes('key.encrypted.download'));
    mount.querySelector('#backup-confirm').checked = true;
    mount.querySelector('.backup-continue').dispatch('click');
    await changed;
    // `onChange` is invoked inside `run()`; allow its final busy=false render
    // to finish before uninstalling the DOM shim.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(signedIn?.kind, 'local');
    assert.equal(saved, 'ncryptsec1encrypted');
    assert.equal(mount.textContent.includes('signin.local.action'), false);
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    restore();
  }
});

test('a ready identity is one human profile bar with technical details collapsed', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  let signIn;
  try {
    const mount = document.createElement('div');
    signIn = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    await signIn.use({ kind: 'local', pubkey: 'e7ff1e23'.padEnd(64, 'a'), close() {} }, 'local');
    assert.equal(mount.querySelectorAll('.session-bar').length, 1);
    assert.ok(mount.textContent.includes('account.manage'));
    assert.equal(mount.textContent.includes('signin.as'), false);
    assert.equal(mount.textContent.includes('local'), false, 'raw signer kinds are implementation details');
    assert.ok(mount.querySelector('.identity-details'));
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    restore();
  }
});

test('forgetting a browser key explains the local scope before removing it', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  let signIn;
  try {
    const mount = document.createElement('div');
    const removed = [];
    signIn = new SignIn({ t: createTranslator('en'), mount, onChange: () => {} });
    signIn.session.forget = () => removed.push('removed');
    signIn.showForgetKeyDialog();
    const dialog = mount.querySelector('.key-forget-dialog');
    assert.ok(dialog);
    assert.match(dialog.textContent, /only this browser’s encrypted key copy/);
    assert.match(dialog.textContent, /Competition drafts and form entries stay saved/);
    assert.match(dialog.textContent, /does not delete your Nostr identity/);
    assert.equal(removed.length, 0, 'opening the explanation must not remove anything');
    dialog.querySelector('.danger').dispatch('click');
    assert.deepEqual(removed, ['removed']);
    assert.equal(mount.querySelector('.key-forget-dialog'), null);
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    restore();
  }
});

test('forgetting a key leaves organizer and registration drafts untouched', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  const previousStorage = globalThis.localStorage;
  const values = new Map([
    ['cruxcoach:competitions:key:v1', JSON.stringify({ v: 1, pubkey: '11'.repeat(32) })],
    ['cruxcoach:competitions:method:v1', 'local'],
    [`cruxcoach:competitions:create-draft:v1:${'11'.repeat(32)}`, '{"title":"Finals"}'],
    [`cruxcoach:competitions:registration-draft:v1:${'11'.repeat(32)}:host:event`, '{"division":"open"}'],
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  let signIn;
  try {
    signIn = new SignIn({ t: (key) => key, mount: document.createElement('div'), onChange: () => {} });
    signIn.forgetKey();
    assert.equal(values.has('cruxcoach:competitions:key:v1'), false);
    assert.equal(values.has(`cruxcoach:competitions:create-draft:v1:${'11'.repeat(32)}`), true);
    assert.equal(values.has(`cruxcoach:competitions:registration-draft:v1:${'11'.repeat(32)}:host:event`), true);
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    globalThis.localStorage = previousStorage;
    restore();
  }
});

test('signing back in can recreate the encrypted remembered browser session', async () => {
  const { SignIn, nsecEncode } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  let signIn;
  let returning;
  try {
    const mount = document.createElement('div');
    let resolveChanged;
    const changed = new Promise((resolve) => { resolveChanged = resolve; });
    signIn = new SignIn({ t: (key) => key, mount, onChange: () => resolveChanged() });
    signIn.entryMode = 'existing';
    signIn.render();
    mount.querySelector('#import-nsec').value = nsecEncode(new Uint8Array(32).fill(1));
    mount.querySelector('#import-pass').value = 'remember me safely';
    mount.querySelector('#import-remember').checked = true;
    [...mount.querySelectorAll('button')]
      .find((button) => button.textContent === 'signin.import.action').dispatch('click');
    await changed;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(values.has('cruxcoach:competitions:key:v1'), 'the re-imported key must be stored encrypted');
    assert.equal(values.get('cruxcoach:competitions:method:v1'), 'local');

    const returningMount = document.createElement('div');
    returning = new SignIn({ t: (key) => key, mount: returningMount, onChange: () => {} });
    await returning.restore();
    assert.ok(returningMount.querySelector('#unlock-pass'));
  } finally {
    signIn?.session.dispose();
    signIn?.remoteSession.dispose();
    returning?.session.dispose();
    returning?.remoteSession.dispose();
    globalThis.localStorage = previousStorage;
    restore();
  }
});

test('reload returns a saved local identity directly to its unlock screen', async () => {
  const { SignIn } = await import('../competitions/app/ui/shell.mjs');
  const { window } = await import('./dev/mini-dom.mjs');
  const restore = window.install();
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  let first;
  let returning;
  try {
    first = new SignIn({ t: (key) => key, mount: document.createElement('div'), onChange: () => {} });
    first.session.generate();
    await first.session.persist('a strong passphrase');
    first.rememberMethod('local');

    const mount = document.createElement('div');
    returning = new SignIn({ t: (key) => key, mount, onChange: () => {} });
    await returning.restore();
    assert.ok(mount.querySelector('#unlock-pass'));
    assert.equal(mount.querySelector('.signin-choice-grid'), null);
    assert.ok(mount.textContent.includes('signin.local.saved'));
  } finally {
    first?.session.lock();
    returning?.session.lock();
    globalThis.localStorage = previousStorage;
    restore();
  }
});

test('the app catalogue is hash-verified and filtered to the selected wall', async () => {
  const { loadCatalogueClimbs } = await import('../competitions/app/data/climb-catalogue.mjs');
  const lines = [
    JSON.stringify({ v: 1, brand: 'kilter', layout: 1, rows: 2, snapshot_at: 42 }),
    JSON.stringify(['11111111-1111-1111-1111-111111111111', 'Fits', 'Setter', [10], [[40, 5, 4, 12]]]),
    JSON.stringify(['22222222-2222-2222-2222-222222222222', 'Wrong size', 'Setter', [8], [[40, 5, 4, 9]]]),
  ].join('\n');
  const packed = gzipSync(lines);
  const digest = createHash('sha256').update(packed).digest('hex');
  const manifest = { v: 1, indexes: [{
    brand: 'kilter', layout: 1, rows: 2, file: 'kilter-1.ndjson.gz', bytes: packed.length, sha256: digest,
  }] };
  const fetchImpl = async (url) => url.endsWith('manifest.json')
    ? new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
    : new Response(packed, { headers: { 'content-length': String(packed.length) } });
  const result = await loadCatalogueClimbs({
    brand: 'kilter', layoutId: 1, modelLabel: 'Kilter Board Original', productSizeId: 10, angle: 40,
  }, { fetchImpl });
  assert.deepEqual(result.climbs.map((climb) => climb.label), ['Fits']);

  const tamperedFetch = async (url) => url.endsWith('manifest.json')
    ? new Response(JSON.stringify(manifest)) : new Response(Buffer.from(packed).fill(0, 0, 1));
  await assert.rejects(() => loadCatalogueClimbs({
    brand: 'kilter', layoutId: 1, modelLabel: 'Kilter Board Original', productSizeId: 10, angle: 40,
  }, { fetchImpl: tamperedFetch }), /catalogue_invalid/);

  const wrongBrandPacked = gzipSync([
    JSON.stringify({ v: 2, brand: 'kilter', layout: 1, rows: 0, snapshot_at: 42 }), '',
  ].join('\n'));
  const wrongBrandManifest = { v: 1, indexes: [{
    brand: 'moonboard', layout: 5, rows: 0, file: 'moonboard-5.ndjson.gz',
    bytes: wrongBrandPacked.length,
    sha256: createHash('sha256').update(wrongBrandPacked).digest('hex'),
  }] };
  await assert.rejects(() => loadCatalogueClimbs({
    brand: 'moonboard', layoutId: 5, modelLabel: 'MoonBoard Masters 2019',
    productSizeId: null, angle: 40,
  }, { fetchImpl: async (url) => url.endsWith('manifest.json')
    ? new Response(JSON.stringify(wrongBrandManifest)) : new Response(wrongBrandPacked) }), /catalogue_invalid/);
});

test('the real MoonBoard Masters 2019 index resolves only layout 5 at 40 degrees', async () => {
  const { loadCatalogueClimbs } = await import('../competitions/app/data/climb-catalogue.mjs');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'competitions/data/climbs/manifest.json'), 'utf8',
  ));
  const entry = manifest.indexes.find(({ brand, layout }) => brand === 'moonboard' && layout === 5);
  assert.ok(entry, 'MoonBoard Masters 2019 index missing');
  const packed = fs.readFileSync(path.join(root, 'competitions/data/climbs', entry.file));
  const fetchImpl = async (url) => url.endsWith('manifest.json')
    ? new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
    : new Response(packed, { headers: { 'content-length': String(packed.length) } });
  const result = await loadCatalogueClimbs({
    brand: 'moonboard', layoutId: 5, modelLabel: 'MoonBoard Masters 2019',
    productSizeId: null, angle: 40,
  }, { fetchImpl });
  assert.equal(result.catalogue.key, 'moonboard:5:layout:40');
  assert.ok(result.climbs.length > 1000);
  assert.equal(result.climbs.every((climb) => climb.brand === 'moonboard'
    && climb.layoutId === 5 && climb.productSizeId === null && climb.angle === 40), true);
  const fixture = result.climbs.find((climb) => climb.uuid === '1110ca02-7d4f-54f6-a7b8-34492c4c98a5');
  assert.equal(fixture?.label, '!!!!');
  assert.ok(Number.isInteger(fixture.createdAt) && fixture.createdAt > 0,
    'the web index must retain the app catalogue creation date for Newest sorting');
  assert.ok(fixture.holds.some(([, role]) => role === 43), 'real fixture has no intermediate handhold');
});

test('the money copy says CruxCoach holds nothing, wherever money is mentioned', () => {
  // Not decoration. CruxCoach has no balance, cannot refund, and cannot
  // guarantee a prize — and a screen that leaves that ambiguous is making a
  // claim about somebody else's money that the software cannot honour.
  const form = fs.readFileSync(path.join(root, 'competitions/app/pages/organizer-form.mjs'), 'utf8');
  const join = fs.readFileSync(path.join(root, 'competitions/app/pages/join.mjs'), 'utf8');

  assert.ok(form.includes("t('money.no_custody')"), 'the fee field must say where the money goes');
  assert.ok(
    form.includes("t('money.prize_not_funded')"),
    'the prize field must say a prize is a promise, not a funded pot',
  );
  assert.ok(
    join.includes("t('money.no_custody.entrant')"),
    'an entrant must be told before paying, not after',
  );
});

test('no money copy implies a pot, escrow, or a platform cut', () => {
  const { STRINGS } = i18nTesting;
  // Words that would be false if they appeared: CruxCoach has no pot to hold,
  // nothing to escrow, and takes no cut.
  const forbidden = [
    /\bescrow/i, /\bprize pot\b/i, /\bplatform fee\b/i, /\bwe hold\b/i,
    /\bheld by CruxCoach\b/i, /\bguarantee[sd]? (?:the )?(?:prize|payout)\b/i,
    /\btreuhand/i, /\bpreistopf\b/i, /\bplattformgebühr\b/i,
  ];
  for (const language of LANGUAGES) {
    for (const [key, text] of Object.entries(STRINGS[language])) {
      for (const pattern of forbidden) {
        // The no-custody strings say these words in order to deny them.
        if (key.startsWith('money.')) continue;
        assert.ok(
          !pattern.test(String(text)),
          `${language}.${key} implies custody: ${text}`,
        );
      }
    }
  }
});
