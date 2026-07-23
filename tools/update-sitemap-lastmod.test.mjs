import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pageFileForUrl, rewriteSitemap } from './update-sitemap-lastmod.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('maps canonical sitemap URLs to their source HTML files', () => {
  assert.equal(pageFileForUrl('https://cruxcoach.org/'), 'index.html');
  assert.equal(pageFileForUrl('https://cruxcoach.org/de/'), 'de/index.html');
  assert.equal(
    pageFileForUrl('https://cruxcoach.org/moonboard-app.html'),
    'moonboard-app.html',
  );
  assert.throws(() => pageFileForUrl('https://example.com/page.html'), /unsupported/);
});

test('every sitemap entry has one valid lastmod and a real source file', () => {
  const xml = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  assert.equal(entries.length, 12);
  for (const [, block] of entries) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
    assert.ok(loc, 'entry has a loc');
    assert.equal((block.match(/<lastmod>/g) ?? []).length, 1, `${loc} has one lastmod`);
    assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, loc);
    assert.ok(fs.existsSync(path.join(repoRoot, pageFileForUrl(loc))), `${loc} resolves locally`);
  }
});

test('rewrites only the selected sitemap page', () => {
  const input = `<urlset>
  <url>
    <loc>https://cruxcoach.org/</loc>
    <lastmod>2025-01-01</lastmod>
  </url>
  <url>
    <loc>https://cruxcoach.org/de/</loc>
    <lastmod>2025-01-01</lastmod>
  </url>
</urlset>`;
  const output = rewriteSitemap(input, ['de/index.html'], () => '2026-07-23');
  assert.match(output, /<loc>https:\/\/cruxcoach\.org\/<\/loc>\s*<lastmod>2025-01-01/);
  assert.match(output, /<loc>https:\/\/cruxcoach\.org\/de\/<\/loc>\s*<lastmod>2026-07-23/);
});
