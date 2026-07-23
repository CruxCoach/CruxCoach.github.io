#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const SITE_ORIGIN = 'https://cruxcoach.org';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function pageFileForUrl(value) {
  const url = new URL(value);
  if (url.origin !== SITE_ORIGIN || url.search || url.hash) {
    throw new Error(`unsupported sitemap URL: ${value}`);
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative) return 'index.html';
  return relative.endsWith('/') ? `${relative}index.html` : relative;
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function lastModifiedDate(file) {
  const override = process.env.SITEMAP_LASTMOD_DATE;
  if (override && !DATE_RE.test(override)) {
    throw new Error(`invalid SITEMAP_LASTMOD_DATE: ${override}`);
  }
  if (!fs.existsSync(path.join(ROOT, file))) {
    throw new Error(`sitemap target does not exist: ${file}`);
  }
  if (git('status', '--porcelain', '--', file)) {
    return override ?? new Date().toISOString().slice(0, 10);
  }
  return git('log', '-1', '--format=%cs', '--', file)
    || override
    || new Date().toISOString().slice(0, 10);
}

export function rewriteSitemap(xml, selectedFiles, dateForFile) {
  const requested = selectedFiles ? new Set(selectedFiles) : null;
  const matched = new Set();
  const output = xml.replace(/<url>([\s\S]*?)<\/url>/g, (block) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
    if (!loc) throw new Error('sitemap <url> entry has no <loc>');
    const file = pageFileForUrl(loc);
    if (requested && !requested.has(file)) return block;
    matched.add(file);
    const date = dateForFile(file);
    if (!DATE_RE.test(date)) throw new Error(`invalid lastmod for ${file}: ${date}`);
    if (/<lastmod>[^<]*<\/lastmod>/.test(block)) {
      return block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${date}</lastmod>`);
    }
    const locLine = /^(\s*)<loc>[^<]+<\/loc>$/m.exec(block);
    if (!locLine) throw new Error(`cannot locate <loc> line for ${loc}`);
    return block.replace(locLine[0], `${locLine[0]}\n${locLine[1]}<lastmod>${date}</lastmod>`);
  });

  if (requested) {
    const missing = [...requested].filter((file) => !matched.has(file));
    if (missing.length) {
      throw new Error(`files have no sitemap entry: ${missing.join(', ')}`);
    }
  }
  return output;
}

function normalizeSelectedFiles(args) {
  if (!args.length) return null;
  return args.map((value) => {
    const absolute = path.resolve(ROOT, value);
    const relative = path.relative(ROOT, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`file must be inside the repository: ${value}`);
    }
    return relative.split(path.sep).join('/');
  });
}

function main() {
  const selected = normalizeSelectedFiles(process.argv.slice(2));
  const before = fs.readFileSync(SITEMAP, 'utf8');
  const after = rewriteSitemap(before, selected, lastModifiedDate);
  if (after === before) {
    console.log('sitemap.xml: lastmod values already current');
    return;
  }
  fs.writeFileSync(SITEMAP, after);
  console.log(`sitemap.xml: updated lastmod for ${selected?.length ?? 'all'} page(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`sitemap lastmod: ${error.message}`);
    process.exitCode = 1;
  }
}
