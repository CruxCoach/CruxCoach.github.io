#!/usr/bin/env node
// Fetch every published venue link and report the ones that no longer answer.
//
//   node tools/venue-links-liveness.mjs              # every distinct URL
//   node tools/venue-links-liveness.mjs 51.5,-0.12   # only these venues
//
// A verified link is a fact about the day it was verified. Sites move their
// per-location pages, operators close halls, and a link that 404s is worse for
// a visitor than no link at all — so this is run by hand after a curation batch
// and before any pass that claims the file is current.
//
// Read the result with care. A host answering 403, 503 or nothing at all is
// usually bot protection or a TLS block that a real browser gets past; the
// domain still resolving is the tell. What must be acted on is 404 and 410,
// and a redirect that lands somewhere unrelated.
//
// This is one of the two link tools that touch the network, so it is never part
// of scripts/check.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lookup } from 'node:dns/promises';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINKS = join(REPO_ROOT, 'tools', 'venue-links.json');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const GONE = new Set([404, 410]);

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: controller.signal, redirect: 'follow' });
    const body = await res.text();
    return { status: res.status, bytes: body.length, final: res.url };
  } catch {
    return { status: 0, bytes: 0, final: url };
  } finally {
    clearTimeout(timer);
  }
}

async function resolves(url) {
  try {
    await lookup(new URL(url).hostname);
    return true;
  } catch {
    return false;
  }
}

const only = new Set(process.argv.slice(2));
const records = JSON.parse(readFileSync(LINKS, 'utf-8'));
const targets = new Map();
for (const r of records) {
  const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
  if (only.size && !only.has(key)) continue;
  if (!targets.has(r.website)) targets.set(r.website, []);
  targets.get(r.website).push(r.name);
}

const queue = [...targets.entries()];
let ok = 0;
let gone = 0;
let unreachable = 0;

async function worker() {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const [url, names] = item;
    const { status, bytes } = await probe(url);
    if (status >= 200 && status < 400) { ok += 1; continue; }
    const who = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    if (GONE.has(status)) {
      gone += 1;
      console.log(`gone         ${status}  ${who}  ${url}`);
    } else {
      unreachable += 1;
      const dns = (await resolves(url)) ? 'host resolves' : 'DOES NOT RESOLVE';
      console.log(`unreachable  ${status || 'no answer'}  ${dns}  ${who}  ${url}`);
    }
    void bytes;
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n${targets.size} distinct links: ${ok} answered, ${gone} gone (404/410), ${unreachable} unreachable from here`);
