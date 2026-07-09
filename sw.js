/*
 * cruxcoach.org resilience service worker
 *
 * Goal: the site keeps working for any visitor who has loaded it at
 * least once, even if the canonical origin (Codeberg Pages) is fully
 * down — independent of DNS-level failover.
 *
 * Strategy:
 *  - Same-origin GET / navigations: stale-while-revalidate. The cached
 *    copy is served instantly (so a dead origin is invisible to
 *    returning visitors); a background fetch refreshes the cache when
 *    the origin is reachable.
 *  - If there is no cache AND the origin fetch fails: try the mirror
 *    origins from /mirrors.json for the SAME path. Cross-origin reads
 *    only work if the mirror sends permissive CORS headers; static
 *    hosts often do for GET, but it is NOT guaranteed — so the
 *    guaranteed floor is a locally-generated offline page that links
 *    every mirror, requiring no CORS at all.
 *
 * Honest limitation: a brand-new visitor whose very first request
 * hits a dead origin has no service worker yet — this layer cannot
 * help them. That narrow case is what DNS-level mitigation (low TTL /
 * health-checked failover) is for; it is intentionally out of scope
 * here.
 */

'use strict';

var VERSION = 'cc-v15';
var CACHE = 'cruxcoach-' + VERSION;
var MIRRORS_KEY = '/__mirrors__';

/* Pages/assets known to exist in the repo. Precache is tolerant: a
 * single missing entry must not abort the whole install. */
var CORE = [
  '/',
  '/index.html',
  '/de/',
  '/de/index.html',
  '/imprint.html',
  '/privacy.html',
  '/support.html',
  '/kilter-board-app-alternative.html',
  '/moonboard-app.html',
  '/de/imprint.html',
  '/de/privacy.html',
  '/de/support.html',
  '/de/kilter-board-app-alternative.html',
  '/de/moonboard-app.html',
  '/404.html',
  '/boards/',
  '/boards/index.html',
  '/boards/list.html',
  '/boards/map.js',
  '/de/boards/',
  '/de/boards/index.html',
  '/de/boards/list.html',
  '/assets/logo.svg',
  '/assets/icon-512.png',
  '/mirrors.json'
];

/* Embedded fallback used only if /mirrors.json can't be read. Empty
 * by design: a mirror host URL must never be guessed. With no mirror
 * the SW still fully protects returning visitors from cache; the
 * cross-origin hop just has no target until mirrors.json carries
 * verified origins (filled later, no code change). The canonical
 * origin is intentionally never a mirror of itself. */
var DEFAULT_MIRRORS = [];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(
        CORE.map(function (url) {
          return fetch(url, { cache: 'no-store' }).then(function (res) {
            if (res && res.ok) return cache.put(url, res.clone());
          }).catch(function () {});
        })
      );
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    }).then(refreshMirrors)
  );
});

/* Fetch and cache the authoritative mirror list. Best-effort. */
function refreshMirrors() {
  return fetch('/mirrors.json', { cache: 'no-store' }).then(function (res) {
    if (res && res.ok) {
      return caches.open(CACHE).then(function (c) {
        return c.put(MIRRORS_KEY, res.clone());
      });
    }
  }).catch(function () {});
}

function getMirrors() {
  return caches.open(CACHE).then(function (c) {
    return c.match(MIRRORS_KEY).then(function (res) {
      if (!res) return DEFAULT_MIRRORS.slice();
      return res.json().then(function (data) {
        var list = (data && Array.isArray(data.mirrors)) ? data.mirrors : [];
        var origins = list
          .filter(function (m) { return m && m.url && m.enabled !== false; })
          .map(function (m) { return String(m.url).replace(/\/+$/, ''); });
        return origins.length ? origins : DEFAULT_MIRRORS.slice();
      }).catch(function () { return DEFAULT_MIRRORS.slice(); });
    });
  });
}

/* Try the same path on each mirror. Cross-origin: needs CORS on the
 * mirror to be readable; failures are swallowed and we move on. */
function tryMirrors(pathWithQuery) {
  return getMirrors().then(function (origins) {
    var i = 0;
    function next() {
      if (i >= origins.length) return Promise.reject();
      var url = origins[i++] + pathWithQuery;
      /* Per-mirror timeout: a hanging mirror must not stall the whole
       * chain until the browser's own network timeout. */
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 4000);
      return fetch(url, { mode: 'cors', cache: 'no-store', signal: ctrl && ctrl.signal })
        .then(function (res) {
          if (timer) clearTimeout(timer);
          if (res && res.ok) return res;
          return next();
        })
        .catch(function () {
          if (timer) clearTimeout(timer);
          return next();
        });
    }
    return next();
  });
}

/* Locally-generated last-resort page. No network, no CORS needed. */
function offlinePage() {
  return getMirrors().then(function (origins) {
    var links = origins.map(function (o) {
      return '<li><a href="' + o + '/">' + o.replace(/^https?:\/\//, '') +
        '</a></li>';
    }).join('');
    var html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>CruxCoach — temporary fallback</title>' +
      '<meta name="theme-color" content="#141312">' +
      '<style>body{background:#141312;color:#e8e6e3;font:16px/1.6 ' +
      'system-ui,sans-serif;margin:0;padding:2.5rem 1.25rem;max-width:' +
      '34rem}h1{font-size:1.3rem}a{color:#ff7a3d}ul{padding-left:1.1rem}' +
      'li{margin:.4rem 0}</style></head><body>' +
      '<h1>cruxcoach.org is briefly unreachable</h1>' +
      '<p>The main host is down. The exact same site is mirrored — ' +
      'open any of these:</p><ul>' + links + '</ul>' +
      '<p>Once you reach a working copy it is cached locally, so this ' +
      'page should not appear again.</p></body></html>';
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin assets

  var pathWithQuery = url.pathname + url.search;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        // Background revalidation (does not block the response).
        var network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return null; });

        if (cached) {
          event.waitUntil(network);
          return cached;
        }

        // Cold cache: need the network, with mirror + offline fallback.
        return network.then(function (res) {
          if (res && res.ok) return res;
          return tryMirrors(pathWithQuery).then(function (mres) {
            /* Cache the mirror hit under the canonical request so the
             * next request for this path is served warm instead of
             * walking the whole cold path again. */
            if (mres && mres.ok) cache.put(req, mres.clone());
            return mres;
          }).catch(function () {
            return cache.match('/404.html').then(function (nf) {
              return nf || offlinePage();
            });
          });
        });
      });
    })
  );
});
