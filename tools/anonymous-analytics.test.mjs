import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FALLBACK_WINDOW_MS,
  consumeZapstoreFallback,
  initAnonymousAnalytics,
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

test('every static page loads the local aggregate client', () => {
  const pages = [
    'index.html', 'de/index.html', '404.html',
    'boards/index.html', 'de/boards/index.html',
    'boards/list.html', 'de/boards/list.html',
    'kilter-board-app-alternative.html',
    'de/kilter-board-app-alternative.html',
    'moonboard-app.html', 'de/moonboard-app.html',
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
  assert.match(source, /var VERSION = 'cc-v22';/);
  assert.equal((source.match(/'\/assets\/anonymous-analytics\.js'/g) || []).length, 1);
  assert.doesNotMatch(source, /apk-download\.js/);
});
