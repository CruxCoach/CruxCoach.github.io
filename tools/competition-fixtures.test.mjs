import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '../competitions/app/protocol/ccj.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixturesDir = path.join(repoRoot, 'competitions/fixtures');

/**
 * The fixtures are the cross-client contract with the Android app, which keeps
 * a byte-identical copy. If a protocol change silently changes what the
 * generator would emit, this fails here rather than surfacing months later as
 * "the app and the website disagree about the leaderboard".
 */
test('the committed fixtures are what the generator produces today', () => {
  assert.doesNotThrow(() => {
    execFileSync(
      process.execPath,
      ['tools/dev/build-competition-fixtures.mjs', '--check'],
      { cwd: repoRoot, stdio: 'pipe' },
    );
  }, 'run: node tools/dev/build-competition-fixtures.mjs');
});

test('the manifest digest covers every fixture file, and matches', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'MANIFEST.json'), 'utf8'));

  const onDisk = [];
  for (const sub of ['streams', 'vectors']) {
    for (const file of fs.readdirSync(path.join(fixturesDir, sub)).sort()) {
      onDisk.push(`${sub}/${file}`);
    }
  }
  assert.deepEqual(Object.keys(manifest.files).sort(), onDisk,
    'MANIFEST.json must list exactly the files that exist');

  for (const [name, digest] of Object.entries(manifest.files)) {
    const text = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
    assert.equal(await sha256Hex(text), digest, `${name} does not match its recorded digest`);
  }

  const recomputed = await sha256Hex(
    Object.entries(manifest.files).map(([name, digest]) => `${name} ${digest}\n`).join(''),
  );
  assert.equal(recomputed, manifest.manifest_sha256);
});

test('the generator is deterministic across runs', () => {
  const before = fs.readFileSync(path.join(fixturesDir, 'MANIFEST.json'), 'utf8');
  execFileSync(process.execPath, ['tools/dev/build-competition-fixtures.mjs'], {
    cwd: repoRoot, stdio: 'pipe',
  });
  const after = fs.readFileSync(path.join(fixturesDir, 'MANIFEST.json'), 'utf8');
  assert.equal(after, before, 'regenerating must not change a single byte');
});

test('the fixture keys are unmistakably test keys', () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'vectors/protocol.json'), 'utf8'));
  assert.match(vectors.note, /test keys/i);
  // Every secret is present in the file, which is the point: anything signed
  // with them is worthless, and nobody can mistake them for real material.
  for (const [label, key] of Object.entries(vectors.keys)) {
    assert.match(key.secret_hex, /^[0-9a-f]{64}$/, label);
    assert.match(key.pubkey, /^[0-9a-f]{64}$/, label);
  }
});

test('no fixture references a public relay', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const text = fs.readFileSync(full, 'utf8');
      for (const match of text.matchAll(/wss?:\/\/[^"\\\s]+/gi)) {
        // `.invalid` is reserved by RFC 2606 and can never resolve, so a
        // fixture naming one can never reach a real relay operator. Loopback
        // is allowed because the runbook's dev relay lives there. `ws://` is
        // scanned too: a cleartext URL to a real host would be worse, not
        // better, than an encrypted one.
        const url = match[0].toLowerCase();
        const safe = url.includes('.invalid')
          || /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$|\/)/.test(url);
        if (!safe) offenders.push(`${full}: ${url}`);
      }
    }
  };
  walk(fixturesDir);
  assert.deepEqual(offenders, [], 'fixtures must only name unresolvable .invalid relays');
});

/**
 * The Android repository keeps a byte-identical copy of this fixture set, and
 * its own test suite asserts the SAME constant. Regenerating here without
 * copying the files across therefore fails on this side, rather than silently
 * leaving the two clients pinned to different contracts.
 *
 * When this fails after an intentional protocol change:
 *   1. node tools/dev/build-competition-fixtures.mjs
 *   2. update FIXTURES_MANIFEST_SHA256 below
 *   3. copy competitions/fixtures/ to the app's
 *      shared/src/commonTest/resources/competition/
 *   4. update the same constant in CompetitionFixtures.kt
 */
const FIXTURES_MANIFEST_SHA256 = '4ccdb7b324c0f047fac1fc851c03d62e472c09d791c40c78567f2d9aff3caf61';

test('the fixture manifest matches the digest the Android client pins', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.manifest_sha256, FIXTURES_MANIFEST_SHA256);
});
