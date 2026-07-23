import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chooseApkUrl,
  parseCodebergReleaseUrl,
} from '../assets/apk-download.js';

const primary = 'https://codeberg.example/CruxCoach/CruxCoach/releases/download/v1.2.3/CruxCoach-v1.2.3.apk';
const fallback = `https://cdn.example/${'a'.repeat(64)}`;
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const boardInstallPages = [
  'kilter-board-app-alternative.html',
  'de/kilter-board-app-alternative.html',
  'moonboard-app.html',
  'de/moonboard-app.html',
];

test('keeps Codeberg as the single canonical JSON-LD download URL', () => {
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

test('board install pages carry the preverified static fallback', () => {
  const primaryUrls = new Set();
  const fallbackUrls = new Set();

  for (const filename of boardInstallPages) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const link = /href="(https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\/[^"\s]+\.apk)" data-apk-fallback="(https:\/\/cdn\.zapstore\.dev\/[0-9a-f]{64})"/.exec(html);
    assert.ok(link, `${filename} has a Codeberg APK link with a Zapstore fallback`);
    primaryUrls.add(link[1]);
    fallbackUrls.add(link[2]);
    assert.match(
      html,
      /<noscript><a[^>]+href="https:\/\/cdn\.zapstore\.dev\/[0-9a-f]{64}">/,
      `${filename} has a no-JavaScript fallback link`,
    );
    assert.match(
      html,
      /<script type="module" src="\/assets\/apk-download\.js"><\/script>/,
      `${filename} loads the shared fallback enhancement`,
    );
  }

  assert.equal(primaryUrls.size, 1, 'all board install pages use the same release');
  assert.equal(fallbackUrls.size, 1, 'all board install pages use the same fallback object');
});

test('parses the authored versioned Codeberg URL without fetching it', () => {
  assert.deepEqual(parseCodebergReleaseUrl(primary), {
    owner: 'CruxCoach',
    repo: 'CruxCoach',
    tag: 'v1.2.3',
    filename: 'CruxCoach-v1.2.3.apk',
    origin: 'https://codeberg.example',
  });
});

test('runtime selection is deterministic and performs no availability probe', () => {
  assert.equal(chooseApkUrl(primary, fallback), primary);
  assert.equal(chooseApkUrl('not-a-release', fallback), fallback);
});

test('every download surface carries the preverified static fallback', () => {
  for (const filename of ['index.html', 'de/index.html', '404.html']) {
    const html = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    assert.match(html, /data-apk-fallback="https:\/\/cdn\.zapstore\.dev\/[0-9a-f]{64}"/, filename);
  }
});
