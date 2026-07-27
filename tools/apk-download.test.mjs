import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const selectorSurfaces = [
  ['index.html', 'home-en', 'hero'],
  ['index.html', 'home-en', 'install'],
  ['de/index.html', 'home-de', 'hero'],
  ['de/index.html', 'home-de', 'install'],
  ['kilter-board-app-alternative.html', 'kilter-en', 'hero'],
  ['de/kilter-board-app-alternative.html', 'kilter-de', 'hero'],
  ['moonboard-app.html', 'moonboard-en', 'hero'],
  ['de/moonboard-app.html', 'moonboard-de', 'hero'],
  ['404.html', 'shared-climb', 'shared_climb'],
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
    path.join(repoRoot, 'apk-target.json'), 'utf8',
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
  for (const [filename, pageKey, surface] of selectorSurfaces) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const url = `https://stats.cruxcoach.org/download/apk/${pageKey}/${surface}`;
    const matches = html.match(new RegExp(`href="${url.replaceAll('.', '\\.')}"`, 'g')) || [];
    assert.equal(matches.length, 1, `${filename}: ${pageKey}/${surface}`);
    assert.match(
      html,
      new RegExp(`href="${url.replaceAll('.', '\\.')}"[^>]*rel="nofollow"[^>]*referrerpolicy="no-referrer"[^>]*data-apk-selector`),
      filename,
    );
    assert.doesNotMatch(html, /data-apk-fallback/, filename);
    assert.doesNotMatch(html, /data-analytics-install-target="direct_apk"/, filename);
  }
});

test('shared-climb selector uses its canonical aggregate page key', () => {
  const html = fs.readFileSync(path.join(repoRoot, '404.html'), 'utf8');
  assert.match(
    html,
    /elCtaReleases\.href = 'https:\/\/stats\.cruxcoach\.org\/download\/apk\/shared-climb\/shared_climb';/,
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

test('the nightly updater never downloads the Codeberg APK for validation', () => {
  const updater = fs.readFileSync(
    path.join(repoRoot, 'tools/update-download-link.mjs'),
    'utf8',
  );
  const fetchTargets = [...updater.matchAll(/\bfetch\(\s*([^,\n)]+)/g)]
    .map((match) => match[1].trim());
  // zapstoreUrl appears twice: once to verify size and digest, once to pull
  // our own copy of the release. Both are the content-addressed CDN, which
  // counts nothing — the rule this test protects is that no synthetic fetch
  // ever hits a Codeberg release asset.
  assert.deepEqual(fetchTargets, ['API', 'shaUrl', 'zapstoreUrl', 'zapstoreUrl']);
  assert.ok(!fetchTargets.includes('apkUrl'), 'never fetch the Codeberg asset');
});
