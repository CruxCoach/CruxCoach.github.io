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
    const matches = html.match(
      new RegExp(`data-apk-selector="${url.replaceAll('.', '\\.')}"`, 'g')) || [];
    assert.equal(matches.length, 1, `${filename}: ${pageKey}/${surface}`);
    assert.doesNotMatch(html, /data-analytics-install-target="direct_apk"/, filename);
  }
});

test('the button works before any script runs, and needs no second button', () => {
  // The whole point of the arrangement: `href` is a plain versioned Codeberg
  // link. With JS off, with DNT set, or while stats.cruxcoach.org is down, one
  // click still yields CruxCoach-vX.Y.Z.apk. Our selector is an upgrade applied
  // on top, never a precondition — and the UI stays a single button either way.
  for (const [filename, pageKey, surface] of selectorSurfaces) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const url = `https://stats.cruxcoach.org/download/apk/${pageKey}/${surface}`;
    assert.match(
      html,
      new RegExp(
        `href="https://codeberg\\.org/CruxCoach/CruxCoach/releases/download/`
        + `v\\d+\\.\\d+\\.\\d+/CruxCoach-v\\d+\\.\\d+\\.\\d+\\.apk"`
        + `[^>]*rel="nofollow"[^>]*referrerpolicy="no-referrer"`
        + `[^>]*data-apk-selector="${url.replaceAll('.', '\\.')}"`),
      filename,
    );
  }
});

test('the shared-climb CTA keeps its static href instead of forcing the selector', () => {
  const html = fs.readFileSync(path.join(repoRoot, '404.html'), 'utf8');
  assert.doesNotMatch(html, /elCtaReleases\.href\s*=/);
  assert.match(html, /data-apk-selector="https:\/\/stats\.cruxcoach\.org\/download\/apk\/shared-climb\/shared_climb"/);
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

test('every direct-APK button carries the content-addressed mirror', () => {
  // The click-time last resort can only redirect to a target the markup names,
  // and it refuses anything that is not the Zapstore CDN blob for this release.
  for (const [filename] of selectorSurfaces) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const mirrors = html.match(/data-apk-mirror="([^"]+)"/g) || [];
    const selectors = html.match(/data-apk-selector="/g) || [];
    assert.equal(mirrors.length, selectors.length, `${filename}: one mirror per button`);
    for (const mirror of mirrors) {
      assert.match(
        mirror,
        /^data-apk-mirror="https:\/\/cdn\.zapstore\.dev\/[0-9a-f]{64}\.apk"$/,
        filename,
      );
    }
  }
});

test('the nightly updater keeps the mirror attribute in step with the release', () => {
  // Without this the attribute would silently rot to an old release, and the
  // last resort would hand out a version nobody asked for.
  const updater = fs.readFileSync(
    path.join(repoRoot, 'tools/update-download-link.mjs'), 'utf8');
  const zapstoreRe = /const ZAPSTORE_LINK_RE = (.+);/.exec(updater);
  assert.ok(zapstoreRe, 'updater must define ZAPSTORE_LINK_RE');
  // eslint-disable-next-line no-eval
  const pattern = eval(zapstoreRe[1]);
  const markup = 'data-apk-mirror="https://cdn.zapstore.dev/'
    + '0'.repeat(64) + '.apk"';
  const rewritten = markup.replace(pattern, 'https://cdn.zapstore.dev/' + 'a'.repeat(64));
  assert.equal(
    rewritten,
    'data-apk-mirror="https://cdn.zapstore.dev/' + 'a'.repeat(64) + '.apk"',
    'the .apk suffix must survive the rewrite',
  );
});
