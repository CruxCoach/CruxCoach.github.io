/**
 * Keep direct APK links usable without making any pre-click request.
 *
 * The nightly release job already validates and rewrites both the versioned
 * Codeberg URL and the content-addressed Zapstore mirror. Probing either URL in
 * a visitor's browser disclosed connection metadata and Codeberg counted a
 * HEAD against the attachment as a download. Runtime selection therefore does
 * no network I/O; the canonical direct link is followed only on user action.
 */

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
  return { owner, repo, tag, filename, origin: parsed.origin };
}

export function chooseApkUrl(primaryUrl, fallbackUrl) {
  if (parseCodebergReleaseUrl(primaryUrl)) return primaryUrl;
  try {
    const fallback = new URL(fallbackUrl);
    if (fallback.protocol === 'https:') return fallback.href;
  } catch (error) {
    // Progressive enhancement: leave the authored href untouched.
  }
  return primaryUrl;
}

export function enhanceApkDownloadLinks(root = document) {
  const links = [...root.querySelectorAll('a[data-apk-fallback]')];
  for (const link of links) {
    const selectedUrl = chooseApkUrl(link.href, link.dataset.apkFallback);
    link.href = selectedUrl;
    link.dataset.apkSource = selectedUrl === link.dataset.apkFallback
      ? 'zapstore'
      : 'codeberg';
  }
}

if (typeof document !== 'undefined') {
  enhanceApkDownloadLinks();
}
