const APK_CONTENT_TYPES = [
  'application/vnd.android.package-archive',
  'application/octet-stream',
];

async function fetchWithTimeout(
  url,
  init,
  { fetchImpl = (...args) => fetch(...args), timeoutMs = 2500 } = {},
) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timedOut = {};
  let timeout;
  try {
    const request = fetchImpl(url, {
      ...init,
      signal: controller ? controller.signal : undefined,
    });
    const response = await Promise.race([
      request,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), timeoutMs);
      }),
    ]);
    if (response === timedOut) {
      if (controller) controller.abort();
      return null;
    }
    return response;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeApkUrl(url, options = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'follow',
    },
    options,
  );
  if (!response || !response.ok) return false;
  const rawContentType = response.headers && response.headers.get
    ? response.headers.get('content-type')
    : null;
  const contentType = rawContentType
    ? rawContentType.split(';', 1)[0].trim().toLowerCase()
    : null;
  return APK_CONTENT_TYPES.includes(contentType);
}

export function parseCodebergReleaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 6 || parts[2] !== 'releases' || parts[3] !== 'download') {
    return null;
  }
  const [owner, repo, , , tag, filename] = parts;
  if (!owner || !repo || !tag || !filename) return null;
  return {
    apiUrl: `${parsed.origin}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/releases/tags/${encodeURIComponent(tag)}`,
    filename,
    origin: parsed.origin,
  };
}

/** Resolve Codeberg's CORS-enabled canonical attachment URL and verify it. */
export async function resolveCodebergApkUrl(releaseUrl, options = {}) {
  const release = parseCodebergReleaseUrl(releaseUrl);
  if (!release) return null;
  const response = await fetchWithTimeout(
    release.apiUrl,
    {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'follow',
      headers: { accept: 'application/json' },
    },
    options,
  );
  if (!response || !response.ok || typeof response.json !== 'function') return null;

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return null;
  }
  const assets = payload && Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find((candidate) =>
    candidate && candidate.name === release.filename
      && typeof candidate.uuid === 'string'
      && /^[a-zA-Z0-9-]{8,128}$/.test(candidate.uuid)
      && Number.isFinite(candidate.size)
      && candidate.size > 0);
  if (!asset) return null;

  const attachmentUrl = `${release.origin}/attachments/${encodeURIComponent(asset.uuid)}`;
  return await probeApkUrl(attachmentUrl, options) ? attachmentUrl : null;
}

export async function chooseApkUrl(primaryUrl, fallbackUrl, options = {}) {
  const codebergUrl = await resolveCodebergApkUrl(primaryUrl, options);
  if (codebergUrl) return codebergUrl;
  if (await probeApkUrl(fallbackUrl, options)) return fallbackUrl;

  // Preserve progressive enhancement when both live checks are inconclusive.
  return primaryUrl;
}

export function enhanceApkDownloadLinks(root = document, options = {}) {
  const links = [...root.querySelectorAll('a[data-apk-fallback]')]
    .filter((link) => typeof link.getClientRects !== 'function' || link.getClientRects().length > 0);
  const choices = new Map();

  for (const link of links) {
    const primaryUrl = link.href;
    const fallbackUrl = link.dataset.apkFallback;
    if (!fallbackUrl) continue;

    const key = `${primaryUrl}\n${fallbackUrl}`;
    let choice = choices.get(key);
    if (!choice) {
      choice = chooseApkUrl(primaryUrl, fallbackUrl, options);
      choices.set(key, choice);
    }

    let selectedUrl = null;
    choice.then((url) => {
      selectedUrl = url;
      link.href = url;
      link.dataset.apkSource = url === fallbackUrl ? 'zapstore' : 'codeberg';
    });

    link.addEventListener('click', async (event) => {
      if (selectedUrl || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      link.setAttribute('aria-busy', 'true');
      try {
        selectedUrl = await choice;
        link.href = selectedUrl;
        window.location.assign(selectedUrl);
      } finally {
        link.removeAttribute('aria-busy');
      }
    });
  }
}

if (typeof document !== 'undefined') {
  enhanceApkDownloadLinks();
}
