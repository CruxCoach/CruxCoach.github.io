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
    // Stash the link being replaced. If our server turns out to be gone by
    // the time someone clicks, this is the way back — the href no longer
    // holds it.
    if (!button.dataset.apkDirect) {
      button.dataset.apkDirect = button.getAttribute
        ? button.getAttribute('href') : button.href;
    }
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
// Our own server, one round trip away (~120 ms measured). Kept tight: this
// sits between a click and a download that has not started yet.
export const SELECTOR_CHECK_TIMEOUT_MS = 800;

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
 * Ask a host whether it is answering. Three outcomes, not two.
 *
 * 'up'      it answered
 * 'down'    it answered badly, or did not answer inside the timeout
 * 'unknown' the question could never be put — a content blocker, a missing
 *           CORS header, no network at all
 *
 * The distinction is the whole point. Treating 'unknown' as 'down' is what
 * sent visitors to the content-addressed mirror while every source was
 * healthy: a blocked request looks exactly like a dead host, so the check
 * must not be allowed to argue *for* the worse option on no evidence.
 */
function probe(fetchImpl, win, url, timeoutMs, method) {
  const controller = typeof AbortController === 'function'
    ? new AbortController() : null;
  const timer = win.setTimeout(() => controller && controller.abort(), timeoutMs);
  return Promise.resolve(fetchImpl(url, {
    method,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: controller ? controller.signal : undefined,
  })).then(
    (response) => {
      win.clearTimeout(timer);
      return (response && response.ok === false) ? 'down' : 'up';
    },
    (error) => {
      win.clearTimeout(timer);
      // A host too slow to answer inside the timeout is unhealthy enough to
      // route around. Anything else says nothing about the host.
      return (error && error.name === 'AbortError') ? 'down' : 'unknown';
    },
  );
}

function plainClick(event) {
  // Leave every non-plain activation to the browser. Intercepting a
  // middle-click or ⌘-click would silently turn "open in a new tab" into a
  // navigation in this one.
  if (event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * Decide where a direct-APK click actually goes, at the moment it happens.
 *
 * The button's targets are all in the markup, so this only ever picks between
 * them: our selector, the versioned Codeberg link, the content-addressed
 * mirror. It walks them in that order and takes the first that answers.
 *
 * Nothing is asked before a click. Our own server is asked only about itself,
 * and the two third parties only once a click is already on its way to them —
 * which is why no check may run while someone is merely reading the page.
 */
export function apkClickHandler(options = {}) {
  const win = options.windowImpl
    || (typeof window !== 'undefined' ? window : null);
  const fetchImpl = options.fetchImpl
    || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const selectorTimeout = options.selectorTimeoutMs || SELECTOR_CHECK_TIMEOUT_MS;
  const mirrorTimeout = options.mirrorTimeoutMs || MIRROR_CHECK_TIMEOUT_MS;
  if (!win || !fetchImpl) return () => false;

  return function handleApkClick(event, button) {
    if (!plainClick(event)) return false;
    const data = (button && button.dataset) || {};
    const href = button && typeof button.getAttribute === 'function'
      ? button.getAttribute('href') : null;
    const upgraded = Boolean(data.apkSelector) && href === data.apkSelector;
    const direct = data.apkDirect || (upgraded ? null : href);
    const mirror = data.apkMirror;
    const metadataUrl = releaseMetadataUrl(direct);
    // Both remaining targets must be recognisable, or there is nothing to fall
    // back to and the browser should just follow the link.
    if (!metadataUrl || !mirror || !MIRROR_RE.test(mirror)) return false;

    event.preventDefault();
    const go = (url) => { win.location.href = url; };
    // Only a Codeberg that positively answered badly sends anyone to the
    // mirror. The mirror works, but it is content-addressed, so the file
    // arrives named after its hash — a last resort, not a coin flip.
    const thirdParty = () => probe(fetchImpl, win, metadataUrl, mirrorTimeout, 'GET')
      .then((state) => go(state === 'down' ? mirror : direct));

    if (!upgraded) {
      thirdParty();
      return true;
    }
    // Upgraded means our server answered when the page loaded — minutes ago,
    // possibly. A HEAD costs one round trip and counts nothing, and without it
    // this click would be the one place the button still depends on us.
    //
    // 'unknown' counts against us here, unlike above: a blocker that stops
    // this request almost certainly stops the download too, and the way out
    // leads to Codeberg's properly named file rather than to a hash.
    probe(fetchImpl, win, data.apkSelector, selectorTimeout, 'HEAD')
      .then((state) => (state === 'up' ? go(data.apkSelector) : thirdParty()));
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
  const handleApkClick = apkClickHandler({ ...options, windowImpl: win });

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
      // Every direct-APK click is routed here, upgraded or not: the button
      // holds all three targets and the handler picks the first that answers.
      handleApkClick(event, directApk);
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
