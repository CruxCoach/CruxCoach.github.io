import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseApkUrl,
  parseCodebergReleaseUrl,
  probeApkUrl,
  resolveCodebergApkUrl,
} from '../assets/apk-download.js';

const primary = 'https://codeberg.example/CruxCoach/CruxCoach/releases/download/v1.2.3/CruxCoach-v1.2.3.apk';
const apiUrl = 'https://codeberg.example/api/v1/repos/CruxCoach/CruxCoach/releases/tags/v1.2.3';
const attachment = 'https://codeberg.example/attachments/12345678-abcd-efab-cdef-123456789abc';
const fallback = `https://cdn.example/${'a'.repeat(64)}`;

function response({ ok = true, contentType = 'application/vnd.android.package-archive' } = {}) {
  return {
    ok,
    headers: new Headers({ 'content-type': contentType }),
  };
}

function releaseResponse() {
  return {
    ok: true,
    json: async () => ({
      assets: [{
        name: 'CruxCoach-v1.2.3.apk',
        uuid: '12345678-abcd-efab-cdef-123456789abc',
        size: 1234,
      }],
    }),
  };
}

test('derives the CORS release API from a direct Codeberg URL', () => {
  assert.deepEqual(parseCodebergReleaseUrl(primary), {
    apiUrl,
    filename: 'CruxCoach-v1.2.3.apk',
    origin: 'https://codeberg.example',
  });
});

test('selects the fully verified Codeberg attachment URL', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.method]);
    if (url === apiUrl) return releaseResponse();
    if (url === attachment) return response();
    throw new Error(`unexpected URL ${url}`);
  };

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), attachment);
  assert.deepEqual(calls, [[apiUrl, 'GET'], [attachment, 'HEAD']]);
});

test('uses the direct Zapstore APK after a Codeberg API failure', async () => {
  const fetchImpl = async (url) => {
    if (url === apiUrl) throw new TypeError('network unavailable');
    if (url === fallback) return response();
    throw new Error(`unexpected URL ${url}`);
  };

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), fallback);
});

test('uses Zapstore when the Codeberg attachment is not an APK', async () => {
  const fetchImpl = async (url) => {
    if (url === apiUrl) return releaseResponse();
    if (url === attachment) return response({ contentType: 'text/html' });
    if (url === fallback) return response();
    throw new Error(`unexpected URL ${url}`);
  };

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), fallback);
});

test('falls back after the Codeberg API probe times out', async () => {
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

test('keeps the progressive primary when neither source can be verified', async () => {
  const fetchImpl = async () => response({ ok: false });

  assert.equal(await chooseApkUrl(primary, fallback, { fetchImpl }), primary);
});

test('rejects incomplete Codeberg asset metadata', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ assets: [{ name: 'CruxCoach-v1.2.3.apk', size: 1234 }] }),
  });

  assert.equal(await resolveCodebergApkUrl(primary, { fetchImpl }), null);
});

test('APK probe sends a CORS HEAD and validates the MIME type', async () => {
  let options;
  const fetchImpl = async (_url, receivedOptions) => {
    options = receivedOptions;
    return response();
  };

  assert.equal(await probeApkUrl(attachment, { fetchImpl }), true);
  assert.equal(options.method, 'HEAD');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.mode, 'cors');
});
