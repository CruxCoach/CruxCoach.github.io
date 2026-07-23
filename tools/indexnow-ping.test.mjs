import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'indexnow-ping.sh');

function dryRun(urls = []) {
  return spawnSync('/bin/bash', [script, '--dry-run', ...urls], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('IndexNow dry run defaults to every sitemap URL', () => {
  const result = dryRun();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dry run would submit 12 URLs/);
  assert.match(result.stdout, /^https:\/\/cruxcoach\.org\/moonboard-app\.html$/m);
  assert.match(result.stdout, /^https:\/\/cruxcoach\.org\/de\/moonboard-app\.html$/m);
});

test('IndexNow accepts explicit same-origin URLs and removes duplicates', () => {
  const url = 'https://cruxcoach.org/kilter-board-app-alternative.html';
  const result = dryRun([url, url]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dry run would submit 1 URLs/);
  assert.equal(result.stdout.split('\n').filter((line) => line === url).length, 1);
});

test('IndexNow rejects URLs outside the verified origin', () => {
  const result = dryRun(['https://example.com/not-ours']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /URL must use https:\/\/cruxcoach\.org\//);
});
