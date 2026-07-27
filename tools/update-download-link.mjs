#!/usr/bin/env node
// Publishes the newest fully mirrored APK target for the website and selector.
//
// Codeberg has no URL that always serves the newest APK when release assets
// carry versioned names (CruxCoach-vX.Y.Z.apk), so canonical machine-readable
// links still contain the current version. This script — run nightly by
// cron-refresh.sh — rewrites them whenever a new release appears; interactive
// buttons use a stable first-party selector route. The /releases/latest API
// endpoint already excludes prereleases and drafts, and the URL is taken
// from the release's actual .apk asset (never constructed), so a
// half-published release without an uploaded APK leaves the links alone.
//
// The same APK is also published content-addressed on Zapstore's Blossom CDN.
// We derive that fallback URL from the release's SHA-256 sidecar, then require
// the CDN object to have the same byte size and SHA-256 before changing either
// set of links. It also atomically publishes the verified tuple to
// /apk-target.json for the selector's server-side health cache. Keep this at
// the public root: Codeberg Pages does not publish newly added dot-directory
// files reliably.
//
// Sidecar URLs (….apk.sha256) are rewritten alongside if a page ever links
// one. Exit code 0 = links are current (whether or not files were rewritten),
// 1 = error (API/CDN unreachable, no asset, …) — callers keep the old links.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'de/index.html', '404.html', 'llms.txt', 'kilter-board-app-alternative.html', 'de/kilter-board-app-alternative.html', 'moonboard-app.html', 'de/moonboard-app.html', 'tension-board-app.html', 'de/tension-board-app.html'];
const MANIFEST = path.join(ROOT, 'apk-target.json');
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
const versionMatch = /^v([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$/.exec(release.tag_name ?? '');
const version = versionMatch?.[1];
if (!version) {
  console.error(`latest release has no stable version tag: ${release.tag_name ?? '?'}`);
  process.exit(1);
}
const expectedApkUrl = `${CODEBERG_DOWNLOAD_PREFIX}v${version}/CruxCoach-v${version}.apk`;
if (!apkUrl?.startsWith(CODEBERG_DOWNLOAD_PREFIX) || !apkUrl.endsWith('.apk')) {
  console.error(`no usable .apk asset on latest release ${release.tag_name ?? '?'}`);
  process.exit(1);
}
if (apkUrl !== expectedApkUrl) {
  console.error(`unexpected APK name or URL on latest release ${release.tag_name}`);
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

const manifest = `${JSON.stringify({
  schema: 1,
  version,
  sha256: apkSha256,
  size: apk.size,
  codeberg_url: apkUrl,
  zapstore_url: zapstoreUrl,
}, null, 2)}\n`;
const beforeManifest = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
if (beforeManifest === manifest) {
  console.log('apk-target.json: unchanged');
} else {
  const temporary = `${MANIFEST}.tmp`;
  fs.writeFileSync(temporary, manifest);
  fs.renameSync(temporary, MANIFEST);
  rewritten += 1;
  console.log('apk-target.json: updated');
}
// Keep our own copy of the release in step with the manifest we just wrote.
//
// The selector serves that copy first, so it must never lag behind a release:
// a stale file fails the digest check, the selector silently drops to Codeberg,
// and nobody notices that the local stage stopped working. Doing it here makes
// it self-healing — the copy is re-fetched on the first nightly run after a
// release, with no step for a human to forget.
//
// Failure is NOT fatal on purpose. A missing or unreadable copy costs the
// local stage, not the download: Codeberg and Zapstore remain, and the
// selector's digest check refuses to serve anything it cannot vouch for.
const LOCAL_APK_DIR = process.env.CRUXCOACH_APK_LOCAL_DIR
  ?? path.join(ROOT, '..', 'cruxcoach-dlstats', 'apk');
const localApk = path.join(LOCAL_APK_DIR, `CruxCoach-v${version}.apk`);

function digestOf(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

try {
  if (digestOf(localApk) === apkSha256) {
    console.log('local APK copy: already current');
  } else {
    fs.mkdirSync(LOCAL_APK_DIR, { recursive: true });
    const response = await fetch(apkUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== apkSha256 || bytes.length !== apk.size) {
      throw new Error(`downloaded copy does not match the manifest (${digest})`);
    }
    // Write beside the target and rename, so a torn write can never be picked
    // up as a valid copy by a selector refresh running at the same moment.
    const temporary = `${localApk}.tmp`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, localApk);
    console.log(`local APK copy: fetched ${bytes.length} bytes, digest verified`);
    // Older releases are dead weight once the manifest has moved on.
    for (const name of fs.readdirSync(LOCAL_APK_DIR)) {
      if (name.startsWith('CruxCoach-v') && name.endsWith('.apk')
          && name !== path.basename(localApk)) {
        fs.unlinkSync(path.join(LOCAL_APK_DIR, name));
        console.log(`local APK copy: removed stale ${name}`);
      }
    }
  }
} catch (error) {
  console.warn(`local APK copy: skipped (${error.message})`);
}

console.log(rewritten ? `${rewritten} file(s) rewritten` : 'all links already current');
