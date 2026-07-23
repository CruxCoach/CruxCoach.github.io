#!/usr/bin/env node
// Points every direct-download link on the site at the newest full release.
//
// Codeberg has no URL that always serves the newest APK when release assets
// carry versioned names (CruxCoach-vX.Y.Z.apk), so the site hard-codes the
// current versioned URL and this script — run nightly by cron-refresh.sh —
// rewrites it whenever a new release appears. The /releases/latest API
// endpoint already excludes prereleases and drafts, and the URL is taken
// from the release's actual .apk asset (never constructed), so a
// half-published release without an uploaded APK leaves the links alone.
//
// The same APK is also published content-addressed on Zapstore's Blossom CDN.
// We derive that fallback URL from the release's SHA-256 sidecar, then require
// the CDN object to have the same byte size and SHA-256 before changing either
// set of links. The update is therefore atomic: pages never mix releases or
// point at a fallback that does not serve the exact release APK.
//
// Sidecar URLs (….apk.sha256) are rewritten alongside if a page ever links
// one. Exit code 0 = links are current (whether or not files were rewritten),
// 1 = error (API/CDN unreachable, no asset, …) — callers keep the old links.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'de/index.html', '404.html', 'llms.txt', 'kilter-board-app-alternative.html', 'de/kilter-board-app-alternative.html', 'moonboard-app.html', 'de/moonboard-app.html'];
const API = 'https://codeberg.org/api/v1/repos/CruxCoach/CruxCoach/releases/latest';
const CODEBERG_LINK_RE =
  /https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\/[^"'\s)]+\.apk(\.sha256)?/g;
const ZAPSTORE_LINK_RE = /https:\/\/cdn\.zapstore\.dev\/[0-9a-fA-F]{64}/g;
const CODEBERG_DOWNLOAD_PREFIX =
  'https://codeberg.org/CruxCoach/CruxCoach/releases/download/';
const ZAPSTORE_CDN_PREFIX = 'https://cdn.zapstore.dev/';

const res = await fetch(API, { headers: { accept: 'application/json' } });
if (!res.ok) {
  console.error(`releases/latest API returned ${res.status}`);
  process.exit(1);
}
const release = await res.json();
const apk = (release.assets ?? []).find((a) => a.name?.endsWith('.apk'));
const shaAsset = (release.assets ?? []).find((a) => a.name?.endsWith('.apk.sha256'));
const apkUrl = apk?.browser_download_url;
const shaUrl = shaAsset?.browser_download_url;
if (!apkUrl?.startsWith(CODEBERG_DOWNLOAD_PREFIX) || !apkUrl.endsWith('.apk')) {
  console.error(`no usable .apk asset on latest release ${release.tag_name ?? '?'}`);
  process.exit(1);
}
if (!shaUrl?.startsWith(CODEBERG_DOWNLOAD_PREFIX) || !shaUrl.endsWith('.apk.sha256')) {
  console.error(`no usable .apk.sha256 asset on latest release ${release.tag_name ?? '?'}`);
  process.exit(1);
}
if (!Number.isSafeInteger(apk.size) || apk.size <= 0) {
  console.error(`invalid APK size on latest release ${release.tag_name ?? '?'}`);
  process.exit(1);
}

const shaRes = await fetch(shaUrl, { headers: { accept: 'text/plain' } });
if (!shaRes.ok) {
  console.error(`APK SHA-256 sidecar returned ${shaRes.status}`);
  process.exit(1);
}
const shaBody = await shaRes.text();
if (shaBody.length > 4096) {
  console.error('APK SHA-256 sidecar is unexpectedly large');
  process.exit(1);
}
const shaMatch = /^([0-9a-fA-F]{64})(?:[ \t]+\*?.+)?$/.exec(shaBody.trim());
const apkSha256 = shaMatch?.[1]?.toLowerCase();
if (!apkSha256) {
  console.error('APK SHA-256 sidecar contains no valid digest');
  process.exit(1);
}

const zapstoreUrl = ZAPSTORE_CDN_PREFIX + apkSha256;
const zapstoreRes = await fetch(zapstoreUrl);
if (!zapstoreRes.ok) {
  console.error(`Zapstore CDN fallback returned ${zapstoreRes.status}`);
  process.exit(1);
}
if (!zapstoreRes.body) {
  console.error('Zapstore CDN fallback returned no response body');
  process.exit(1);
}
const zapstoreHash = createHash('sha256');
let zapstoreSize = 0;
for await (const chunk of zapstoreRes.body) {
  zapstoreHash.update(chunk);
  zapstoreSize += chunk.byteLength;
  if (zapstoreSize > apk.size) {
    console.error(`Zapstore CDN size exceeds expected ${apk.size} bytes`);
    process.exit(1);
  }
}
const zapstoreSha256 = zapstoreHash.digest('hex');
if (zapstoreSize !== apk.size || zapstoreSha256 !== apkSha256) {
  console.error(
    `Zapstore CDN mismatch: expected ${apk.size} bytes / ${apkSha256}, ` +
      `received ${zapstoreSize} bytes / ${zapstoreSha256}`,
  );
  process.exit(1);
}

console.log(`latest release: ${release.tag_name} → ${apkUrl}`);
console.log(`Zapstore fallback: sha256=${apkSha256} size=${zapstoreSize}`);

let rewritten = 0;
for (const file of FILES) {
  const abs = path.join(ROOT, file);
  const before = fs.readFileSync(abs, 'utf8');
  const after = before
    .replace(CODEBERG_LINK_RE, (_m, sidecarSuffix) => apkUrl + (sidecarSuffix ?? ''))
    .replace(ZAPSTORE_LINK_RE, zapstoreUrl);
  if (after === before) {
    console.log(`${file}: unchanged`);
    continue;
  }
  fs.writeFileSync(abs, after);
  rewritten += 1;
  console.log(`${file}: updated`);
}
console.log(rewritten ? `${rewritten} file(s) rewritten` : 'all links already current');
