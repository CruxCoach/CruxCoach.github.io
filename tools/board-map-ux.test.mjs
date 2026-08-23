import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const en = readFileSync(new URL('../boards/index.html', import.meta.url), 'utf8');
const de = readFileSync(new URL('../de/boards/index.html', import.meta.url), 'utf8');
const map = readFileSync(new URL('../boards/map.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('both map languages expose the same installable and recoverable UI', () => {
  for (const [html, manifest] of [
    [en, '/boards/manifest.webmanifest'],
    [de, '/de/boards/manifest.webmanifest'],
  ]) {
    assert.match(html, new RegExp(`<link rel="manifest" href="${manifest}">`));
    assert.match(html, /class="skip-map-controls" href="#map-filters"/);
    assert.match(html, /id="map-empty" role="status" aria-live="polite" hidden/);
    assert.match(html, /id="map-empty-reset"/);
    assert.match(html, /codeberg\.org\/CruxCoach\/cruxcoach-pages\/issues\/new/);
    assert.match(html, /max-height: var\(--map-panel-max-height/);
    assert.doesNotMatch(html, /\.legend \{ max-height: calc\(100vh/);
    assert.match(html, /\/boards\/map\.js\?v=20260823-1/);
  }
});

test('map supports empty filters, keyboard popups and independent access status', () => {
  assert.match(map, /hash \+= '&b='/);
  assert.match(map, /popupReturnFocus/);
  assert.match(map, /event\.key === 'Escape'/);
  assert.match(map, /role', 'button'/);
  assert.match(map, /renderAccessSection/);
  assert.match(map, /if \(!stats\.accessDefined\) return ''/);
  assert.match(map, /props\.access/);
  assert.match(map, /map-empty-reset/);
  assert.match(map, /openstreetmap\.org\/directions\?to=/);
});

test('localized manifests are valid and precached', () => {
  for (const path of ['../boards/manifest.webmanifest', '../de/boards/manifest.webmanifest']) {
    const manifest = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.icons[0].src, '/assets/icon-512.png');
    assert.match(manifest.start_url, /^\/(?:de\/)?boards\/$/);
  }
  assert.match(sw, /'\/boards\/manifest\.webmanifest'/);
  assert.match(sw, /'\/de\/boards\/manifest\.webmanifest'/);
});

test('source freshness is explicit and MoonBoard is honestly marked frozen', () => {
  const freshness = JSON.parse(readFileSync(new URL('./board-source-freshness.json', import.meta.url), 'utf8'));
  assert.equal(freshness.boards.moonboard.status, 'frozen');
  for (const item of Object.values(freshness.boards)) {
    assert.match(item.last_data_change, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(item.commit, /^[0-9a-f]{40}$/);
  }
  assert.match(en, /feed has been frozen since May 2026/);
  assert.match(de, /Feed ist seit Mai 2026 eingefroren/);
});
