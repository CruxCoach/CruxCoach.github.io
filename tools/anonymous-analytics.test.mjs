import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FALLBACK_WINDOW_MS,
  consumeZapstoreFallback,
  apkFallbackHandler,
  initAnonymousAnalytics,
  releaseMetadataUrl,
  upgradeApkButtons,
  markZapstoreClick,
  normalizePagePath,
  privacySignalEnabled,
  sendAnonymousEvent,
} from '../assets/anonymous-analytics.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('canonical paths never expose dynamic shares, queries, or unknown paths', () => {
  assert.equal(normalizePagePath('/'), '/');
  assert.equal(normalizePagePath('/index.html'), '/');
  assert.equal(normalizePagePath('/de/boards/index.html'), '/de/boards/');
  assert.equal(normalizePagePath('/boards/list.html'), '/boards/');
  assert.equal(normalizePagePath('/de/boards/list.html'), '/de/boards/');
  assert.equal(normalizePagePath('/c/naddr1privatepayload'), '/c/:share');
  assert.equal(normalizePagePath('/someone-private'), '/404');
});

test('DNT and Global Privacy Control suppress every request', async () => {
  assert.equal(privacySignalEnabled({ doNotTrack: '1' }, {}), true);
  assert.equal(privacySignalEnabled({ msDoNotTrack: 'yes' }, {}), true);
  assert.equal(privacySignalEnabled({ globalPrivacyControl: true }, {}), true);
  let calls = 0;
  const sent = await sendAnonymousEvent(
    { metric: 'page_view', path: '/' },
    {
      navigatorImpl: { doNotTrack: '1' },
      fetchImpl: async () => { calls += 1; },
    },
  );
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('request omits credentials and referrer and contains only explicit JSON', async () => {
  let call;
  const event = {
    metric: 'install_click', target: 'direct_apk', surface: 'hero', path: '/',
  };
  assert.equal(await sendAnonymousEvent(event, {
    endpoint: 'https://stats.example/v1/site-event',
    navigatorImpl: {},
    windowImpl: {},
    fetchImpl: async (...args) => { call = args; },
  }), true);
  assert.equal(call[0], 'https://stats.example/v1/site-event');
  assert.equal(call[1].credentials, 'omit');
  assert.equal(call[1].referrerPolicy, 'no-referrer');
  assert.equal(call[1].keepalive, true);
  assert.equal(call[1].body, JSON.stringify(event));
  assert.deepEqual(call[1].headers, { 'Content-Type': 'text/plain;charset=UTF-8' });
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('fallback marker is identifier-free, expires, and is consumed once', () => {
  const storage = memoryStorage();
  assert.equal(markZapstoreClick(storage, 1_000), true);
  assert.equal(consumeZapstoreFallback(storage, 1_000 + FALLBACK_WINDOW_MS), true);
  assert.equal(consumeZapstoreFallback(storage, 1_001), false);

  assert.equal(markZapstoreClick(storage, 2_000), true);
  assert.equal(consumeZapstoreFallback(
    storage,
    2_000 + FALLBACK_WINDOW_MS + 1,
  ), false);
});

test('Zapstore then direct APK emits one combined canonical-page fallback', () => {
  const storage = memoryStorage();
  const payloads = [];
  let clickHandler;
  let now = 10_000;
  const root = {
    documentElement: { lang: 'en' },
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    },
  };
  const options = {
    navigatorImpl: {},
    windowImpl: { location: { pathname: '/moonboard-app.html' } },
    sessionStorageImpl: storage,
    nowImpl: () => now,
    fetchImpl: async (_url, request) => {
      payloads.push(JSON.parse(request.body));
    },
  };
  initAnonymousAnalytics(root, options);

  clickHandler({
    target: {
      closest(selector) {
        return selector === '[data-analytics-install-target]'
          ? { dataset: { analyticsInstallTarget: 'zapstore', analyticsSurface: 'hero' } }
          : null;
      },
    },
  });
  now += 60_000;
  const directTarget = {
    closest: (selector) => selector === '[data-apk-selector]' ? {} : null,
  };
  clickHandler({ target: directTarget });
  clickHandler({ target: directTarget });

  assert.deepEqual(payloads, [
    { metric: 'page_view', path: '/moonboard-app.html' },
    {
      metric: 'install_click', target: 'zapstore', surface: 'hero',
      path: '/moonboard-app.html',
    },
    {
      metric: 'install_fallback', from: 'zapstore', to: 'direct_apk',
      path: '/moonboard-app.html',
    },
  ]);
});

const CODEBERG_APK =
  'https://codeberg.org/CruxCoach/CruxCoach/releases/download/v0.2.1/CruxCoach-v0.2.1.apk';
const SELECTOR = 'https://stats.cruxcoach.org/download/apk/home-en/hero';

/** A single direct-APK button plus the bits of the DOM the client touches. */
function pageWithApkButton() {
  const button = {
    href: CODEBERG_APK,
    dataset: { apkSelector: SELECTOR },
    getAttribute: () => button.href,
  };
  const root = {
    documentElement: { lang: 'en' },
    button,
    handler: null,
    querySelectorAll: (selector) =>
      (selector === '[data-apk-selector]' ? [button] : []),
    addEventListener(type, handler) { if (type === 'click') root.handler = handler; },
  };
  return root;
}

function clickTheButton(root) {
  root.handler({
    target: {
      closest: (selector) =>
        (selector === '[data-apk-selector]' ? root.button : null),
    },
  });
}

test('the button is upgraded to our selector only once the beacon comes back', async () => {
  const root = pageWithApkButton();
  const options = {
    navigatorImpl: {},
    windowImpl: { location: { pathname: '/' } },
    sessionStorageImpl: memoryStorage(),
    fetchImpl: async () => {},
  };
  initAnonymousAnalytics(root, options);
  assert.equal(root.button.href, CODEBERG_APK, 'not before the answer arrives');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(root.button.href, SELECTOR);
});

test('an unreachable server leaves the button on its working Codeberg link', async () => {
  // The failure this whole design exists for: stats.cruxcoach.org is down. The
  // click must still deliver an APK, so nothing may be rewritten.
  const root = pageWithApkButton();
  initAnonymousAnalytics(root, {
    navigatorImpl: {},
    windowImpl: { location: { pathname: '/' } },
    sessionStorageImpl: memoryStorage(),
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(root.button.href, CODEBERG_APK);
});

test('a privacy signal leaves the button alone and sends nothing at all', async () => {
  const root = pageWithApkButton();
  let calls = 0;
  initAnonymousAnalytics(root, {
    navigatorImpl: { globalPrivacyControl: true },
    windowImpl: { location: { pathname: '/' } },
    fetchImpl: async () => { calls += 1; },
  });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(root.button.href, CODEBERG_APK);
  assert.equal(calls, 0);
});

test('each direct-APK click is counted exactly once, whoever serves it', async () => {
  const payloads = [];
  const options = (root) => ({
    navigatorImpl: {},
    windowImpl: { location: { pathname: '/' } },
    sessionStorageImpl: memoryStorage(),
    fetchImpl: async (_url, request) => { payloads.push(JSON.parse(request.body)); },
  });

  // A click that beats the upgrade — a real race on a warm cache. The server is
  // up but never sees this one, because it went straight to Codeberg, so the
  // client is the only place it can be recorded.
  //
  // Note what this does NOT rescue: if our server is genuinely down, this
  // request cannot arrive either. During an outage nothing is counted anywhere,
  // and no arrangement of client code can change that.
  const raced = pageWithApkButton();
  initAnonymousAnalytics(raced, options(raced));
  clickTheButton(raced);
  assert.deepEqual(payloads.filter((p) => p.metric === 'install_click'), [
    { metric: 'install_click', target: 'direct_apk', surface: 'hero', path: '/' },
  ]);

  // Upgraded: the selector counts the click as it serves the file. Counting
  // here as well would double every direct-APK install in the daily figures.
  payloads.length = 0;
  const online = pageWithApkButton();
  initAnonymousAnalytics(online, options(online));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  clickTheButton(online);
  assert.deepEqual(payloads.filter((p) => p.metric === 'install_click'), []);
});

test('every static page loads the local aggregate client', () => {
  const pages = [
    'index.html', 'de/index.html', '404.html',
    'boards/index.html', 'de/boards/index.html',
    'boards/list.html', 'de/boards/list.html',
    'kilter-board-app-alternative.html',
    'de/kilter-board-app-alternative.html',
    'moonboard-app.html', 'de/moonboard-app.html',
    'tension-board-app.html', 'de/tension-board-app.html',
    'support.html', 'de/support.html',
    'privacy.html', 'de/privacy.html',
    'imprint.html', 'de/imprint.html',
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(html, /<script type="module" src="\/assets\/anonymous-analytics\.js"><\/script>/, page);
  }
});

test('Zapstore clicks use the JS counter and direct APK clicks use the redirect', () => {
  const expected = [
    ['index.html', 'hero'],
    ['index.html', 'install'],
    ['de/index.html', 'hero'],
    ['de/index.html', 'install'],
    ['kilter-board-app-alternative.html', 'hero'],
    ['de/kilter-board-app-alternative.html', 'hero'],
    ['moonboard-app.html', 'hero'],
    ['de/moonboard-app.html', 'hero'],
    ['tension-board-app.html', 'hero'],
    ['de/tension-board-app.html', 'hero'],
    ['404.html', 'shared_climb'],
  ];
  for (const [page, surface] of expected) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(
      html,
      new RegExp(`data-analytics-install-target="zapstore"[^>]*data-analytics-surface="${surface}"`),
      `${page}: zapstore/${surface}`,
    );
    assert.doesNotMatch(html, /data-analytics-install-target="direct_apk"/, page);
    assert.match(html, /https:\/\/stats\.cruxcoach\.org\/download\/apk\//, page);
  }
});

test('website copy distinguishes current app behavior from the 0.2.2 plan', () => {
  for (const page of ['index.html', 'privacy.html', 'de/index.html', 'de/privacy.html']) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(html, /0\.2\.1/, `${page}: current release`);
    assert.match(html, /0\.2\.2/, `${page}: upcoming release`);
  }
  const llms = fs.readFileSync(path.join(repoRoot, 'llms.txt'), 'utf8');
  assert.match(llms, /Current app release 0\.2\.1 sends no analytics event/);
  assert.match(llms, /upcoming 0\.2\.2 release/);
});

test('privacy notices disclose the collector host and current Codeberg policy', () => {
  for (const page of ['privacy.html', 'de/privacy.html']) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(html, /Hetzner Online GmbH/, page);
    assert.match(html, /Art(?:icle|\.) 6(?:\(1\)| Abs\. 1)\(?f\)?|Art\. 6 Abs\. 1 lit\. f/, page);
    assert.match(html, /codeberg\.org\/Codeberg\/org\/src\/branch\/main\/PrivacyPolicy\.md/, page);
    assert.doesNotMatch(html, /docs\.codeberg\.org\/improving-codeberg\/privacy-policy/, page);
    assert.match(html, /sessionStorage/, `${page}: local fallback marker`);
    assert.match(html, /30 (?:minutes|Minuten)/, `${page}: marker expiry`);
    assert.match(html, /not proof|kein Beweis/, `${page}: fallback semantics`);
  }
});

test('privacy notices distinguish private analytics operations from public app source', () => {
  for (const page of ['privacy.html', 'de/privacy.html']) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(html, /private operational repository|privaten Betriebs-Repository/, page);
    assert.match(html, /source remains publicly available|Quellcode bleibt[\s\S]*?öffentlich verfügbar/, page);
    assert.match(html, /codeberg\.org\/CruxCoach\/CruxCoach/, `${page}: public app source`);
    assert.doesNotMatch(
      html,
      /codeberg\.org\/CruxCoach\/cruxcoach-dlstats/,
      `${page}: private analytics repository`,
    );
  }
});

test('service worker uses a fresh cache and precaches the analytics client once', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'sw.js'), 'utf8');
  assert.match(source, /var VERSION = 'cc-v25';/);
  assert.equal((source.match(/'\/assets\/anonymous-analytics\.js'/g) || []).length, 1);
  assert.doesNotMatch(source, /apk-download\.js/);
});

const MIRROR =
  'https://cdn.zapstore.dev/fb1334ce0113ed821549b35e7480ab800d8c76d9a691b7d58da38a2a780078e4.apk';
const METADATA =
  'https://codeberg.org/api/v1/repos/CruxCoach/CruxCoach/releases/tags/v0.2.1';

test('release metadata is derived from the link, never the attachment itself', () => {
  assert.equal(releaseMetadataUrl(CODEBERG_APK), METADATA);
  // A GET on the attachment would count as a Codeberg download.
  assert.ok(!releaseMetadataUrl(CODEBERG_APK).endsWith('.apk'));
  assert.equal(releaseMetadataUrl('https://evil.example/CruxCoach-v0.2.1.apk'), null);
  assert.equal(releaseMetadataUrl(''), null);
});

function fallbackPage(fetchImpl, { mirror = MIRROR } = {}) {
  const win = {
    location: { href: CODEBERG_APK, pathname: '/' },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const button = {
    href: CODEBERG_APK,
    dataset: { apkSelector: SELECTOR, apkMirror: mirror },
    getAttribute: () => button.href,
  };
  const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  const handled = apkFallbackHandler({ windowImpl: win, fetchImpl })(event, button);
  return { win, event, handled };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 5); });

test('a click that cannot reach us goes to the mirror only if Codeberg is down', async () => {
  const asked = [];
  const healthy = fallbackPage(async (url) => { asked.push(url); return { ok: true }; });
  await settle();
  assert.deepEqual(asked, [METADATA]);
  assert.equal(healthy.win.location.href, CODEBERG_APK, 'healthy Codeberg is kept');

  const down = fallbackPage(async () => { throw new Error('host unreachable'); });
  await settle();
  assert.equal(down.win.location.href, MIRROR);

  const refusing = fallbackPage(async () => ({ ok: false, status: 404 }));
  await settle();
  assert.equal(refusing.win.location.href, MIRROR);
});

test('a slow Codeberg does not hold the download hostage', async () => {
  const win = {
    location: { href: CODEBERG_APK, pathname: '/' },
    setTimeout: (fn) => setTimeout(fn, 0),  // fire the abort immediately
    clearTimeout: (id) => clearTimeout(id),
  };
  const button = {
    href: CODEBERG_APK,
    dataset: { apkSelector: SELECTOR, apkMirror: MIRROR },
    getAttribute: () => button.href,
  };
  const event = { button: 0, defaultPrevented: false, preventDefault() {} };
  apkFallbackHandler({
    windowImpl: win,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  })(event, button);
  await settle();
  assert.equal(win.location.href, MIRROR);
});

test('modified clicks and unrecognised targets are left to the browser', async () => {
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    const win = { location: { href: CODEBERG_APK }, setTimeout, clearTimeout };
    const button = {
      href: CODEBERG_APK,
      dataset: { apkMirror: MIRROR },
      getAttribute: () => CODEBERG_APK,
    };
    const event = { button: 0, [modifier]: true, preventDefault: () => assert.fail(modifier) };
    assert.equal(
      apkFallbackHandler({ windowImpl: win, fetchImpl: async () => assert.fail(modifier) })(event, button),
      false, modifier);
  }
  // Middle-click opens a tab; hijacking it would navigate this one instead.
  const win = { location: { href: CODEBERG_APK }, setTimeout, clearTimeout };
  const middle = { button: 1, preventDefault: () => assert.fail('middle click') };
  assert.equal(apkFallbackHandler({ windowImpl: win, fetchImpl: async () => {} })(
    middle, { getAttribute: () => CODEBERG_APK, dataset: { apkMirror: MIRROR } }), false);

  // A mirror that is not the content-addressed CDN is not a redirect target.
  const evil = fallbackPage(async () => assert.fail('must not probe'), {
    mirror: 'https://evil.example/CruxCoach.apk',
  });
  assert.equal(evil.handled, false);
  assert.equal(evil.win.location.href, CODEBERG_APK);
});

test('a privacy signal keeps the download working while counting nothing', async () => {
  const root = pageWithApkButton();
  const sent = [];
  initAnonymousAnalytics(root, {
    navigatorImpl: { doNotTrack: '1' },
    windowImpl: { location: { pathname: '/' }, setTimeout, clearTimeout },
    fetchImpl: async (url) => { sent.push(url); return { ok: true }; },
  });
  await settle();
  assert.deepEqual(sent, [], 'no page view, no click counter');
  // The click handler is still registered: robustness is not a reward for
  // agreeing to be counted.
  assert.ok(root.handler, 'fallback handler must be registered');
});
