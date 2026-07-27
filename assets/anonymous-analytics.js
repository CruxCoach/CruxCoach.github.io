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
  // Map and list are two views of the same logical Board Map page.
  ['/boards/list.html', '/boards/'],
  ['/de/boards/list.html', '/de/boards/'],
  ['/kilter-board-app-alternative.html', '/kilter-board-app-alternative.html'],
  ['/de/kilter-board-app-alternative.html', '/de/kilter-board-app-alternative.html'],
  ['/moonboard-app.html', '/moonboard-app.html'],
  ['/de/moonboard-app.html', '/de/moonboard-app.html'],
  ['/tension-board-app.html', '/tension-board-app.html'],
  ['/de/tension-board-app.html', '/de/tension-board-app.html'],
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

/**
 * Point the direct-APK buttons at our own selector.
 *
 * The markup ships with the versioned Codeberg URL in `href`, so the button
 * works with JavaScript switched off, with a privacy signal set, and while our
 * server is down. This upgrade runs only once the page_view beacon has come
 * back — that answer already proves the server is reachable, so no probe of
 * any kind is added and no third party is contacted before a click.
 */
export function upgradeApkButtons(root) {
  const buttons = root && typeof root.querySelectorAll === 'function'
    ? root.querySelectorAll('[data-apk-selector]')
    : [];
  let upgraded = 0;
  buttons.forEach((button) => {
    const selectorUrl = button.dataset && button.dataset.apkSelector;
    if (!selectorUrl) return;
    button.href = selectorUrl;
    upgraded += 1;
  });
  return upgraded;
}

/** The surface is the last segment of /download/apk/<page-key>/<surface>. */
function surfaceOf(selectorUrl) {
  const surface = String(selectorUrl || '').split('/').pop();
  return ['hero', 'install', 'shared_climb'].includes(surface) ? surface : null;
}

export const MIRROR_CHECK_TIMEOUT_MS = 1500;

const CODEBERG_APK_RE =
  /^https:\/\/codeberg\.org\/CruxCoach\/CruxCoach\/releases\/download\/(v\d+\.\d+\.\d+)\/CruxCoach-v\d+\.\d+\.\d+\.apk$/;
const MIRROR_RE = /^https:\/\/cdn\.zapstore\.dev\/[0-9a-f]{64}\.apk$/i;

/**
 * Read metadata URL for the release a Codeberg APK link belongs to.
 *
 * Never the APK attachment itself: a HEAD or GET there would register as a
 * download on Codeberg and inflate a counter other people read.
 */
export function releaseMetadataUrl(href) {
  const match = CODEBERG_APK_RE.exec(String(href || ''));
  return match
    ? `https://codeberg.org/api/v1/repos/CruxCoach/CruxCoach/releases/tags/${match[1]}`
    : null;
}

/**
 * Last resort for a click that cannot reach our server.
 *
 * Only ever runs on a button still holding its Codeberg default — meaning our
 * selector is out of reach and Codeberg is the sole remaining route. If that
 * route is down too, the visitor would get nothing, so we ask Codeberg whether
 * the release is there and send them to the Zapstore mirror when it is not.
 *
 * The question is asked at click time and never before. By clicking, the
 * visitor already set out for Codeberg — so this reveals them to nobody they
 * were not about to reach anyway, which is exactly why no such check may run
 * on page load.
 */
export function apkFallbackHandler(options = {}) {
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : null);
  const fetchImpl = options.fetchImpl
    || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const timeoutMs = options.mirrorTimeoutMs || MIRROR_CHECK_TIMEOUT_MS;
  if (!win || !fetchImpl) return () => false;

  return function handleFallback(event, button) {
    // Leave every non-plain activation to the browser. Intercepting a
    // middle-click or ⌘-click would silently turn "open in a new tab" into a
    // navigation in this one.
    if (event.defaultPrevented) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    const href = button && typeof button.getAttribute === 'function'
      ? button.getAttribute('href') : null;
    const mirror = button && button.dataset && button.dataset.apkMirror;
    const metadataUrl = releaseMetadataUrl(href);
    // Both targets must be recognisable, or we have no business redirecting.
    if (!metadataUrl || !mirror || !MIRROR_RE.test(mirror)) return false;

    event.preventDefault();
    const controller = typeof AbortController === 'function'
      ? new AbortController() : null;
    const timer = win.setTimeout(
      () => controller && controller.abort(), timeoutMs);
    const go = (url) => { win.clearTimeout(timer); win.location.href = url; };

    Promise.resolve(fetchImpl(metadataUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller ? controller.signal : undefined,
    })).then(
      // A slow Codeberg must not hold the download hostage: the abort above
      // lands here as a rejection and takes the visitor to the mirror.
      (response) => go(response && response.ok === false ? mirror : href),
      () => go(mirror),
    );
    return true;
  };
}

export function initAnonymousAnalytics(root = document, options = {}) {
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : { location: { pathname: '/' } });
  const nav = options.navigatorImpl
    || (typeof navigator !== 'undefined' ? navigator : {});
  // A privacy signal switches off counting, never the download. Getting the
  // app must not depend on being willing to be counted.
  const analyticsOff = privacySignalEnabled(nav, win);
  const storage = analyticsOff ? null : sessionStorageFor(win, options);
  const now = options.nowImpl || Date.now;
  const canonicalPath = normalizePagePath(win.location && win.location.pathname);
  const fallback = apkFallbackHandler({ ...options, windowImpl: win });

  if (!analyticsOff) {
    sendAnonymousEvent({
      metric: 'page_view',
      path: canonicalPath,
    }, { ...options, navigatorImpl: nav, windowImpl: win })
      .then((delivered) => (delivered ? upgradeApkButtons(root) : 0));
  }

  root.addEventListener('click', (event) => {
    const directApk = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-apk-selector]')
      : null;
    if (directApk) {
      const selectorUrl = directApk.dataset && directApk.dataset.apkSelector;
      const upgraded = Boolean(selectorUrl)
        && typeof directApk.getAttribute === 'function'
        && directApk.getAttribute('href') === selectorUrl;
      if (!analyticsOff) {
        if (consumeZapstoreFallback(storage, now())) {
          sendAnonymousEvent({
            metric: 'install_fallback',
            from: 'zapstore',
            to: 'direct_apk',
            path: canonicalPath,
          }, { ...options, navigatorImpl: nav, windowImpl: win });
        }
        // An upgraded button is counted by the selector that serves it. A
        // button still on its Codeberg default never reaches us, so count it
        // here. This rescues the click that beat the upgrade, not an outage:
        // if our server is down, this request cannot arrive either.
        const surface = surfaceOf(selectorUrl);
        if (surface && !upgraded) {
          sendAnonymousEvent({
            metric: 'install_click',
            target: 'direct_apk',
            surface,
            path: canonicalPath,
          }, { ...options, navigatorImpl: nav, windowImpl: win });
        }
      }
      // Not upgraded means our selector is unreachable and Codeberg is the
      // only route left — the one case worth verifying before handing it over.
      if (!upgraded) fallback(event, directApk);
      return;
    }
    if (analyticsOff) return;

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
