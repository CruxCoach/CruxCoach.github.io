const DEFAULT_ENDPOINT = 'https://stats.cruxcoach.org/v1/site-event';

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

export function initAnonymousAnalytics(root = document, options = {}) {
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : { location: { pathname: '/' } });
  const nav = options.navigatorImpl
    || (typeof navigator !== 'undefined' ? navigator : {});
  if (privacySignalEnabled(nav, win)) return;

  sendAnonymousEvent({
    metric: 'page_view',
    path: normalizePagePath(win.location && win.location.pathname),
  }, { ...options, navigatorImpl: nav, windowImpl: win });

  root.addEventListener('click', (event) => {
    const target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-analytics-install-target]')
      : null;
    if (!target) return;
    const installTarget = target.dataset.analyticsInstallTarget;
    const surface = target.dataset.analyticsSurface;
    const locale = (root.documentElement && root.documentElement.lang) === 'de'
      ? 'de'
      : 'en';
    if (!['direct_apk', 'zapstore'].includes(installTarget)) return;
    if (!['hero', 'install', 'shared_climb'].includes(surface)) return;
    sendAnonymousEvent({
      metric: 'install_click',
      target: installTarget,
      surface,
      locale,
    }, { ...options, navigatorImpl: nav, windowImpl: win });
  }, { capture: true });
}

if (typeof document !== 'undefined') {
  initAnonymousAnalytics();
}
