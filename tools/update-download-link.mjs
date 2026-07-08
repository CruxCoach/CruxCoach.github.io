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
// Sidecar URLs (….apk.sha256) are rewritten alongside if a page ever links
// one. Exit code 0 = links are current (whether or not files were rewritten),
// 1 = error (API unreachable, no asset, …) — callers keep the old links.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'de/index.html', '404.html', 'llms.txt', 'kilter-board-app-alternative.html', 'de/kilter-board-app-alternative.html'];
const API = 'https://codeberg.org/api/v1/repos/CruxCoach/CruxCoach/releases/latest';
const LINK_RE =
  /https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\/[^"'\s)]+\.apk(\.sha256)?/g;

const res = await fetch(API, { headers: { accept: 'application/json' } });
if (!res.ok) {
  console.error(`releases/latest API returned ${res.status}`);
  process.exit(1);
}
const release = await res.json();
const apk = (release.assets ?? []).find((a) => a.name?.endsWith('.apk'));
const apkUrl = apk?.browser_download_url;
const EXPECTED_PREFIX = 'https://codeberg.org/CruxCoach/CruxCoach/releases/download/';
if (!apkUrl?.startsWith(EXPECTED_PREFIX) || !apkUrl.endsWith('.apk')) {
  console.error(`no usable .apk asset on latest release ${release.tag_name ?? '?'}`);
  process.exit(1);
}
console.log(`latest release: ${release.tag_name} → ${apkUrl}`);

let rewritten = 0;
for (const file of FILES) {
  const abs = path.join(ROOT, file);
  const before = fs.readFileSync(abs, 'utf8');
  const after = before.replace(LINK_RE, (_m, sha) => apkUrl + (sha ?? ''));
  if (after === before) {
    console.log(`${file}: unchanged`);
    continue;
  }
  fs.writeFileSync(abs, after);
  rewritten += 1;
  console.log(`${file}: updated`);
}
console.log(rewritten ? `${rewritten} file(s) rewritten` : 'all links already current');
