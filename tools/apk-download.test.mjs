import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const selectorSurfaces = [
  ['index.html', 'hero', 'en'],
  ['index.html', 'install', 'en'],
  ['de/index.html', 'hero', 'de'],
  ['de/index.html', 'install', 'de'],
  ['kilter-board-app-alternative.html', 'hero', 'en'],
  ['de/kilter-board-app-alternative.html', 'hero', 'de'],
  ['moonboard-app.html', 'hero', 'en'],
  ['de/moonboard-app.html', 'hero', 'de'],
  ['404.html', 'shared_climb', 'en'],
];

test('keeps Codeberg as the canonical JSON-LD download URL', () => {
  for (const filename of ['index.html', 'de/index.html']) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const match = /<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, `${filename} has SoftwareApplication JSON-LD`);
    const application = JSON.parse(match[1]);
    assert.match(
      application.downloadUrl,
      /^https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\//,
      filename,
    );
  }
});

test('the published selector manifest binds the two byte-identical sources', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, '.well-known/apk-target.json'), 'utf8',
  ));
  assert.deepEqual(Object.keys(manifest), [
    'schema', 'version', 'sha256', 'size', 'codeberg_url', 'zapstore_url',
  ]);
  assert.equal(manifest.schema, 1);
  assert.match(manifest.version, /^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(manifest.size) && manifest.size > 0);
  assert.equal(
    manifest.codeberg_url,
    `https://codeberg.org/CruxCoach/CruxCoach/releases/download/v${manifest.version}/CruxCoach-v${manifest.version}.apk`,
  );
  assert.equal(manifest.zapstore_url, `https://cdn.zapstore.dev/${manifest.sha256}`);

  const llms = fs.readFileSync(path.join(repoRoot, 'llms.txt'), 'utf8');
  assert.ok(llms.includes(manifest.codeberg_url));
  assert.ok(llms.includes(manifest.zapstore_url));
});

test('every direct APK surface exposes exactly one first-party selector button', () => {
  for (const [filename, surface, locale] of selectorSurfaces) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const url = `https://stats.cruxcoach.org/download/apk/${surface}/${locale}`;
    const matches = html.match(new RegExp(url.replaceAll('.', '\\.'), 'g')) || [];
    assert.equal(matches.length, 1, `${filename}: ${surface}/${locale}`);
    assert.match(
      html,
      new RegExp(`href="${url.replaceAll('.', '\\.')}"[^>]*rel="nofollow"[^>]*referrerpolicy="no-referrer"[^>]*data-apk-selector`),
      filename,
    );
    assert.doesNotMatch(html, /data-apk-fallback/, filename);
    assert.doesNotMatch(html, /data-analytics-install-target="direct_apk"/, filename);
  }
});

test('shared-climb selector follows the chosen page language', () => {
  const html = fs.readFileSync(path.join(repoRoot, '404.html'), 'utf8');
  assert.match(
    html,
    /elCtaReleases\.href = 'https:\/\/stats\.cruxcoach\.org\/download\/apk\/shared_climb\/' \+ lang;/,
  );
});

test('no browser-side APK availability implementation remains', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'assets/apk-download.js')), false);
  for (const [filename] of selectorSurfaces) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    assert.doesNotMatch(html, /assets\/apk-download\.js/, filename);
    assert.doesNotMatch(html, /<noscript>[^<]*<a[^>]+(?:APK source|APK-Quelle)/, filename);
  }
});
