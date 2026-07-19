const APK_CONTENT_TYPES = [
  'application/vnd.android.package-archive',
  'application/octet-stream',
];

export async function probeApkUrl(
  url,
  { fetchImpl = (...args) => fetch(...args), timeoutMs = 2500, allowOpaque = false } = {},
) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timedOut = {};
  let timeout;
  try {
    const request = fetchImpl(url, {
      method: 'HEAD',
      cache: 'no-store',
      mode: allowOpaque ? 'no-cors' : 'cors',
      redirect: 'follow',
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
      return false;
    }
    // Codeberg's release-asset endpoint does not expose CORS headers. An
    // opaque HEAD still proves that the host answered; network errors and
    // hangs continue to reject/abort and therefore activate the fallback.
    if (allowOpaque && response.type === 'opaque') return true;
    if (!response.ok) return false;
    const rawContentType = response.headers && response.headers.get
      ? response.headers.get('content-type')
      : null;
    const contentType = rawContentType
      ? rawContentType.split(';', 1)[0].trim().toLowerCase()
      : null;
    return APK_CONTENT_TYPES.includes(contentType);
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function chooseApkUrl(
  primaryUrl,
  fallbackUrl,
  options = {},
) {
  if (await probeApkUrl(primaryUrl, { ...options, allowOpaque: true })) return primaryUrl;
  if (await probeApkUrl(fallbackUrl, options)) return fallbackUrl;

  // Preserve the no-JavaScript behavior when neither cross-origin probe is
  // conclusive. The release automation has already verified this URL.
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
