import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  normalizePagePath,
  privacySignalEnabled,
  sendAnonymousEvent,
} from '../assets/anonymous-analytics.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('canonical paths never expose dynamic shares, queries, or unknown paths', () => {
  assert.equal(normalizePagePath('/'), '/');
  assert.equal(normalizePagePath('/index.html'), '/');
  assert.equal(normalizePagePath('/de/boards/index.html'), '/de/boards/');
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
    metric: 'install_click', target: 'direct_apk', surface: 'hero', locale: 'en',
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

test('the two install targets are labeled on every requested surface', () => {
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
    for (const target of ['zapstore', 'direct_apk']) {
      const targetFirst = new RegExp(
        `data-analytics-install-target="${target}"[^>]*data-analytics-surface="${surface}"`,
      );
      assert.match(html, targetFirst, `${page}: ${target}/${surface}`);
    }
  }
});
