const DEFAULT_ENDPOINT = 'https://stats.cruxcoach.org/v1/site-event';
const FALLBACK_MARKER = 'cruxcoach:zapstore-click-at';
export const FALLBACK_WINDOW_MS = 30 * 60 * 1000;

const CANONICAL_PATHS = new Map([
  ['/', '/'],
  ['/index.html', '/'],
  ['/de', '/de/'],
  ['/de/', '/de/'],
  ['/de/index.html', '/de/'],
  ['/boards', '/boards/'],
  ['/boards/', '/boards/'],
  ['/boards/index.html', '/boards/'],
  ['/de/boards', '/de/boards/'],
  ['/de/boards/', '/de/boards/'],
  ['/de/boards/index.html', '/de/boards/'],
  ['/boards/list.html', '/boards/list.html'],
  ['/de/boards/list.html', '/de/boards/list.html'],
  ['/kilter-board-app-alternative.html', '/kilter-board-app-alternative.html'],
  ['/de/kilter-board-app-alternative.html', '/de/kilter-board-app-alternative.html'],
  ['/moonboard-app.html', '/moonboard-app.html'],
  ['/de/moonboard-app.html', '/de/moonboard-app.html'],
  ['/support.html', '/support.html'],
  ['/de/support.html', '/de/support.html'],
  ['/privacy.html', '/privacy.html'],
  ['/de/privacy.html', '/de/privacy.html'],
  ['/imprint.html', '/imprint.html'],
  ['/de/imprint.html', '/de/imprint.html'],
  ['/404.html', '/404'],
]);

/** Reduce every public URL to a closed, non-identifying page dimension. */
export function normalizePagePath(pathname) {
  const path = typeof pathname === 'string' ? pathname : '/404.html';
  if (/^\/c\/[^/]+\/?$/i.test(path)) return '/c/:share';
  return CANONICAL_PATHS.get(path) || '/404';
}

/** Respect explicit browser privacy preferences even though no ID is used. */
export function privacySignalEnabled(nav = {}, win = {}) {
  const dntValues = [nav.doNotTrack, nav.msDoNotTrack, win.doNotTrack]
    .map((value) => String(value || '').toLowerCase());
  return nav.globalPrivacyControl === true
    || dntValues.includes('1')
    || dntValues.includes('yes');
}

/**
 * Send only the already-allowlisted aggregate dimensions. The remote server
 * independently rejects unknown fields and never stores a raw request.
 */
export function sendAnonymousEvent(payload, options = {}) {
  const nav = options.navigatorImpl
    || (typeof navigator !== 'undefined' ? navigator : {});
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : {});
  if (privacySignalEnabled(nav, win)) return Promise.resolve(false);

  const fetchImpl = options.fetchImpl
    || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return Promise.resolve(false);
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  return Promise.resolve(fetchImpl(endpoint, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
  })).then(() => true, () => false);
}

/** Store only a local timestamp, never an analytics/session identifier. */
export function markZapstoreClick(storage, now = Date.now()) {
  if (!storage || !Number.isFinite(now)) return false;
  try {
    storage.setItem(FALLBACK_MARKER, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Consume one same-tab marker if it is at most 30 minutes old. */
export function consumeZapstoreFallback(storage, now = Date.now()) {
  if (!storage || !Number.isFinite(now)) return false;
  try {
    const raw = storage.getItem(FALLBACK_MARKER);
    storage.removeItem(FALLBACK_MARKER);
    if (raw === null || raw.trim() === '') return false;
    const markedAt = Number(raw);
    return Number.isFinite(markedAt)
      && now >= markedAt
      && now - markedAt <= FALLBACK_WINDOW_MS;
  } catch {
    return false;
  }
}

function sessionStorageFor(win, options) {
  if (Object.prototype.hasOwnProperty.call(options, 'sessionStorageImpl')) {
    return options.sessionStorageImpl;
  }
  try {
    return win.sessionStorage || null;
  } catch {
    return null;
  }
}

export function initAnonymousAnalytics(root = document, options = {}) {
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : { location: { pathname: '/' } });
  const nav = options.navigatorImpl
    || (typeof navigator !== 'undefined' ? navigator : {});
  if (privacySignalEnabled(nav, win)) return;
  const storage = sessionStorageFor(win, options);
  const now = options.nowImpl || Date.now;
  const canonicalPath = normalizePagePath(win.location && win.location.pathname);

  sendAnonymousEvent({
    metric: 'page_view',
    path: canonicalPath,
  }, { ...options, navigatorImpl: nav, windowImpl: win });

  root.addEventListener('click', (event) => {
    const directApk = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-apk-selector]')
      : null;
    if (directApk) {
      if (consumeZapstoreFallback(storage, now())) {
        sendAnonymousEvent({
          metric: 'install_fallback',
          from: 'zapstore',
          to: 'direct_apk',
          path: canonicalPath,
        }, { ...options, navigatorImpl: nav, windowImpl: win });
      }
      return;
    }

    const target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-analytics-install-target]')
      : null;
    if (!target) return;
    const installTarget = target.dataset.analyticsInstallTarget;
    const surface = target.dataset.analyticsSurface;
    if (!['direct_apk', 'zapstore'].includes(installTarget)) return;
    if (!['hero', 'install', 'shared_climb'].includes(surface)) return;
    if (installTarget === 'zapstore') markZapstoreClick(storage, now());
    sendAnonymousEvent({
      metric: 'install_click',
      target: installTarget,
      surface,
      path: canonicalPath,
    }, { ...options, navigatorImpl: nav, windowImpl: win });
  }, { capture: true });
}

if (typeof document !== 'undefined') {
  initAnonymousAnalytics();
}
