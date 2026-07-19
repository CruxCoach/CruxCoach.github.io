import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseApkUrl, probeApkUrl } from '../assets/apk-download.js';

const primary = 'https://codeberg.example/app.apk';
const fallback = `https://cdn.example/${'a'.repeat(64)}`;

function response({ ok = true, contentType = 'application/vnd.android.package-archive' } = {}) {
  return {
    ok,
    headers: new Headers({ 'content-type': contentType }),
  };
}

test('accepts an opaque Codeberg HEAD response as network-reachable', async () => {
  const fetchImpl = async () => ({
    type: 'opaque',
    ok: false,
    headers: new Headers(),
  });

  assert.equal(
    await probeApkUrl(primary, { fetchImpl, allowOpaque: true }),
    true,
  );
});

test('keeps the direct Codeberg APK when its probe succeeds', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response();
  };

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), primary);
  assert.deepEqual(calls, [primary]);
});

test('uses the direct Zapstore APK after a Codeberg network failure', async () => {
  const fetchImpl = async (url) => {
    if (url === primary) throw new TypeError('network unavailable');
    return response();
  };

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), fallback);
});

test('rejects a successful HTML response as an APK source', async () => {
  const fetchImpl = async (url) => response({
    contentType: url === primary ? 'text/html' : 'application/octet-stream',
  });

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), fallback);
});

test('falls back after the primary probe times out', async () => {
  const fetchImpl = (url, { signal }) => {
    if (url === fallback) return Promise.resolve(response());
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };

  assert.equal(
    await chooseApkUrl(primary, fallback, { fetchImpl, timeoutMs: 5 }),
    fallback,
  );
});

test('keeps progressive-enhancement primary when neither probe is conclusive', async () => {
  const fetchImpl = async () => response({ ok: false });

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), primary);
});

test('probe sends HEAD and accepts only an APK response', async () => {
  let options;
  const fetchImpl = async (_url, receivedOptions) => {
    options = receivedOptions;
    return response();
  };

  assert.equal(await probeApkUrl(primary, { fetchImpl }), true);
  assert.equal(options.method, 'HEAD');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.mode, 'cors');
});
