# Repository Instructions

These instructions apply equally to Claude Code, Codex, and human contributors.

## What this repo is

Source for **https://cruxcoach.org** — the public landing page for the CruxCoach
open-source Android Kilter Board app. Published via **GitHub Pages** since
2026-08-06: the default branch is served directly, so a push goes live within
minutes. There is **no build step** for the site itself.

The apex moved off Codeberg Pages after it served 502 for over a day and there
was nothing on our side to fix — the outage was in Codeberg's own migration to a
new git-pages front end. Codeberg remains a live push target and keeps its
`.domains` file, and the `main.cruxcoach-pages.cruxcoach.codeberg.page` TXT
record is deliberately still in DNS: together they make a rollback a single DNS
change instead of a re-setup. Do not delete either without replacing that path.

## Commands

```bash
# Non-mutating prerequisite check
scripts/bootstrap --check

# Repository validation
scripts/check

# Preview the site locally (no build — just serve the files)
python3 -m http.server          # then open http://localhost:8000

# Regenerate the boards map dataset (the ONLY code that "builds" anything)
node tools/build-boards-data.mjs
# → rewrites boards/data/boards.geojson + boards.meta.json; commit both after.

# Regenerate the cross-client competition fixtures (shared with the Android app)
node tools/dev/build-competition-fixtures.mjs
# → also update the pinned digest in tools/competition-fixtures.test.mjs AND in
#   the app's shared/src/androidUnitTest/.../CompetitionFixtures.kt

# A loopback Nostr relay for the competition runbook. Never a public relay.
node tools/dev/relay.mjs --port 7447
```

The lightweight `scripts/check` validates JavaScript, JSON, and the sitemap and
runs the Node unit tests (`tools/*.test.mjs`); there is no package.json or
browser test suite. The competition suites are part of it: protocol, reducer,
fixtures, signers, NIP-44, QR, pages, the dev relay, and an end-to-end run of a
whole competition over a loopback relay.
`node_modules/` is gitignored; `build-boards-data.mjs` installs its one dependency
(`@rapideditor/country-coder`) into a per-`$TMPDIR` cache on first run, never into
the repo.

## Hard constraints (these are the rules people get wrong)

- **No external dependencies at runtime.** No CDN-hosted CSS, fonts, or JS; no
  user tracking, cookies, or third-party embeds. A local first-party script sends
  only allowlisted dimensions to an immediate daily aggregate counter. Leaflet is
  **vendored** under `assets/vendor/leaflet/`. Deliberate third-party requests are
  limited to OSM map tiles and the Nostr WebSocket calls in `404.html`; install
  destinations are contacted only after a click. All are disclosed on the privacy
  page.
- **The site is JS-free except for five deliberate exceptions:**
  1. `404.html` runs inline JS on `/c/<naddr>` paths to fetch climb metadata from
     public Nostr relays (`relay.damus.io`, `nos.lol`, `relay.primal.net`) over
     WebSocket and render an install/landing view.
  2. `boards/index.html` uses vendored Leaflet + markercluster to render the map.
     Its search box also matches an offline place index (`boards/data/cities.json`,
     built by `tools/build-cities-data.mjs`), lazily fetched from this origin on
     the first query — a static file, never a geocoder call. The location button
     is the only feature that requests a browser permission; `map.locate()` keeps
     the coordinates in the page and transmits them nowhere. Both are disclosed
     on the privacy pages.
  3. `sw.js` is a resilience service worker (stale-while-revalidate + mirror
     fallback from `mirrors.json`) so returning visitors survive an origin outage.
  4. Every HTML page loads `assets/anonymous-analytics.js` — except `get.html`,
     which must stay self-contained (see below) and therefore carries a copy of
     the page-view beacon inline, under the synthetic label `/app-share`. It
     sends only a canonical logical-page label and Zapstore-button dimensions;
     Board Map map/list views share a label while language remains separate. The
     direct-APK route counts its own coarse click. Both paths honour DNT/GPC,
     never handle IDs, and use no credentials or referrer.
     **A page that can be clicked but not counted breaks the numbers, not just
     one of them.** `get.html` counted its install click and never its own
     arrival, so every QR scan surfaced as a download nobody had viewed a page
     for. Any new interactive surface needs both halves, and a page view label
     is only real once `SITE_PATHS` in the collector's `anonymous_schema.py`
     accepts it — an unlisted label is answered with 400 and counts nothing.
  5. `competitions/` (and its `/de/` mirror) is a small application — the one
     part of this site that is not a document. It reads and writes a competition
     on Nostr relays, and it is the only place that signs anything. Its rules:
     - **ES modules under `competitions/app/`, no inline script, no inline
       style.** Every page ships a `Content-Security-Policy` meta tag with
       `default-src 'none'; script-src 'self'; style-src 'self'` and no
       `unsafe-inline`. `tools/competition-pages.test.mjs` fails the build if any
       of that slips.
     - **`competitions/app/protocol/` must not touch the DOM.** That is what lets
       `node --test` run the code the site actually serves, which is the whole
       basis of the cross-client conformance claim against the Android app. A
       test enforces it.
     - **Nothing ever assigns `innerHTML`.** Titles, display names and
       announcements arrive from a public relay. Everything reaches the DOM via
       `textContent`; a test greps for the alternatives.
     - **Crypto is vendored, not written**: `assets/vendor/nostr-crypto/`
       (@noble/secp256k1 and @noble/ciphers, both MIT and dependency-free) with
       digests and provenance in `PROVENANCE.md`. SHA-256, HMAC, HKDF, PBKDF2
       and AES-GCM come from WebCrypto instead. The official BIP-340, RFC 8439
       and NIP-44 vectors run against the exact bytes we serve.
     - **These pages carry NO analytics beacon and no install button.** The
       collector's `SITE_PATHS` allowlist lives in `cruxcoach-dlstats`, and
       `normalizePagePath` would file a competition view under `/404` and corrupt
       that metric. A page that can be clicked but not counted breaks the
       numbers — so this surface carries no counter at all rather than a broken
       one. Adding one means adding the labels to the collector FIRST; see
       `DECISIONS-TO-REVIEW.md` on the branch that introduced this.
     - **`/comp/<naddr>` is the canonical join link.** `404.html` rewrites it to
       `competitions/join.html#<naddr>`; the Android app claims the same path as
       an App Link. The three application pages are `noindex` and out of the
       sitemap — their content lives behind a fragment and comes from relays, so
       a crawler can only ever see an empty shell.
     - **`tools/dev/relay.mjs` is a development-only loopback relay** used by the
       tests and the runbook (`tools/dev/RUNBOOK-competitions.md`). It refuses to
       bind anything but loopback and is never referenced by a page. No test may
       write to a public relay, and `ws://` is accepted only for loopback hosts.
- **Dark-mode-only**: `color-scheme=dark` in meta; no JS theme toggle.
- **Accessibility**: every link has discernible text; decorative elements are
  `aria-hidden="true"`. Prefer plain semantic HTML over div soup.
- **Bilingual mirror**: English at the root, German under `/de/`. Any page added or
  changed at the root generally needs its `/de/` counterpart, kept in sync, with
  `hreflang` alternates and a `sitemap.xml` entry. Legal pages
  (`imprint.html`, `privacy.html`) are `Disallow`ed in `robots.txt`.
- **PNG hygiene**: image metadata (tIME/tEXt) is stripped from committed PNGs.
- **Public repo, permanent secrets**: `.gitignore` aggressively blocks Nostr key
  material (`*nsec*`, `*.bunker`, `nostr-key*`) and the personal Wellpass matcher.
  A leaked nsec is unrecoverable — never commit anything matching those patterns.

## SEO / AI-search surface

These files are load-bearing for discoverability and are maintained by hand — keep
them current when site facts change (especially on app releases; that includes
`softwareVersion` in both homepages' JSON-LD):

- **Direct APK download links**: every interactive download surface is **one**
  button whose `href` is the versioned Codeberg APK, carrying the closed
  first-party route `https://stats.cruxcoach.org/download/apk/<page-key>/<surface>`
  in `data-apk-selector`. `anonymous-analytics.js` swaps the two once the
  `page_view` beacon has come back — that answer already proves the host is up, so
  **no availability probe of any kind is added and no third party is contacted
  before a click**. The static default is what removes the single point of failure:
  with JS off, with DNT/GPC set, or while our host is down, the click still yields
  `CruxCoach-vX.Y.Z.apk`. Never bind a surface to the selector URL alone
  (`404.html` did, and was the one page that stayed broken) and never add a second
  visible button — robustness belongs behind the single button, not in the UI.
  The selector serves our own verified copy, else redirects to Codeberg, else
  relays Zapstore; it performs its background checks without visitor data. A click
  is counted exactly once: by the selector when it serves, by the beacon when the
  button was never upgraded. JSON-LD and `llms.txt` retain the versioned Codeberg URL as the
  canonical machine-readable target. `tools/update-download-link.mjs` reads the
  Codeberg release metadata and SHA-256 sidecar without downloading the Codeberg
  APK, fully verifies the content-addressed Zapstore payload against that size
  and digest, updates the canonical URLs, and atomically publishes
  `/apk-target.json` for the selector whenever a new full release
  appears.
  A new interactive surface needs one of the closed `page-key`/`surface`
  redirect paths; a new canonical source file still belongs in that script's
  `FILES` list.
- `llms.txt` — structured project summary for LLM crawlers (distribution channels,
  privacy model, disambiguation vs. other "cruxcoach" sites). No Wikidata ID —
  the former item (Q139592177) was deleted 2026-05-01 as non-notable; don't
  re-add one until a new item with independent references exists.
- `sitemap.xml` — includes `hreflang` alternates; add new indexable pages here.
- `robots.txt` — sitemap reference + `noindex` on legal pages.
- JSON-LD in `index.html` — `SoftwareApplication` + `Offer` + `Organization`,
  plus a `FAQPage` whose Q&A text must stay **identical** to the visible
  `#faq` section (Google requires FAQ markup to match on-page content). The
  `/de/` page mirrors both. `boards/index.html` and `boards/list.html` carry
  their own `@graph` (WebApplication/Dataset/FAQPage/BreadcrumbList,
  CollectionPage). All pages carry canonical + OG, and every page with a `/de/`
  counterpart carries `hreflang` in both directions — including `/boards/` and
  `/boards/list.html`, which do have German mirrors.
- `boards/list.html` — build-generated static venue directory (see below);
  exists so non-JS AI crawlers can read the actual venue/country data.
- `humans.txt`, `.well-known/security.txt` (RFC 9116), `.well-known/assetlinks.json`.

## Boards map data pipeline (`tools/`)

The map at `/boards/` is the one data-driven part. None of this runs in the browser —
it regenerates static files committed under `boards/data/`. Read `tools/README.md`
for the full contract; the essentials:

- **Generated static HTML** (via `tools/render-static.mjs`): the map renders
  client-side, so non-JS crawlers can't see any venue. The build therefore also
  writes `boards/list.html` (full venue directory by country) and re-injects the
  counts table between the `<!-- GENERATED:board-stats -->` markers in
  `boards/index.html`. Both are a pure function of the data (no timestamp) so the
  cron makes no no-op commit. Don't hand-edit inside the markers; rebuild.
- **Source adapters** live in `tools/sources/<name>.mjs`, each exporting
  `async load()` → `{ entries: NormalizedEntry[], meta }`. Register them in the
  `SOURCES` array in `build-boards-data.mjs`. `hangtime` (the
  `@hangtime/climbing-boards` npm package, Unlicense) is primary;
  `curated` is a deliberately small official-venue-page supplement for rows
  missing from frozen or incomplete upstream feeds; `quantum` is the reviewed
  primary-source allowlist documented in `tools/QUANTUM-LOCATIONS.md`. The frontend reads only the
  merged GeoJSON and never knows which source a board came from.
- **Venue grouping**: entries are grouped by `(lat, lon)` rounded to 4 decimals
  (~11 m) via `venueKey()`, so a multi-board gym renders as one composite marker.
  Valid `board` values are enforced centrally; unknown boards are dropped with a
  warning. Merge policy is **first-source-wins** by `(board, lat, lon)`.
- **Hand-curated overlays**, matched by the same `venueKey()` rounding and applied
  on every rebuild:
  - `tools/overrides.json` — corrects blank/wrong upstream fields (e.g. MoonBoard
    `variant`); each `set` key wins over upstream and conflicts are logged.
  - `tools/wellpass.json` — flags DACH venues in the egym Wellpass network for the
    map's Wellpass filter. Only curated `name+coords+boolean` rows are committed;
    the matcher and raw scrape are gitignored.
  - `tools/venue-links.json` — one manually verified **official website** per
    venue, with the UTC date it was checked and the independent signals that
    matched. Never inferred from a name or a search snippet; never attached to a
    private/home setup; matching fails closed on any ambiguity. Rejected
    candidates go to `tools/venue-links-research.json`, which is not production
    data. Policy and the decision note for the link classes deliberately *not*
    built: `tools/VENUE-LINKS.md`. `node tools/venue-links-report.mjs` validates a
    batch; `node tools/build-boards-data.mjs --overlays-only` re-applies the
    venue-level overlays and re-renders without pulling a new upstream dataset.
  - `tools/venue-hours.json` — one manually verified weekly opening schedule per
    venue, read from that venue's **own official page** (never OSM, never a
    listing or aggregator — the OSM-derived hours were withdrawn in `f670da0` for
    being materially inaccurate, and nothing here is derived from them). Fails
    closed hard: a week with a day the source does not state, a seasonal or
    appointment-only rule, or a branch that cannot be identified produces an
    outcome record in `tools/venue-hours-research.json`, not hours. **The
    `checked` date, the `evidence` quote, the signals and the provenance are
    internal and must never reach `boards.geojson`, either directory, the map
    popup or anything else a browser fetches** — `toPublicHours()` is the only
    door, and tests grep every published artifact for them. Nothing computes an
    open-now state. Policy: `tools/VENUE-HOURS.md`; validation:
    `node tools/venue-hours-report.mjs`.
- **Adapter guidelines**: drop free-form `description`/`bio` text at the adapter
  (historical MoonBoard entries contain SEO/casino spam); validate coordinate
  ranges; never propagate upstream email/phone.

## Daily refresh automation

`tools/cron-refresh.sh` runs nightly (crontab ~03:30). It first runs
`update-download-link.mjs` and commits `chore(download): bump direct APK link …`
if a new app release moved the APK URL, then runs `build-boards-data.mjs` and
commits + pushes to Codeberg only when `boards/data/boards.geojson` actually changes
(it deliberately ignores `boards.meta.json`, whose `generated_at` changes every
build, to avoid daily no-op commits). It is `flock`-guarded, fast-forward-only on
`main`, and retries the push 3× because Codeberg occasionally drops SSH. The
`data(boards): daily refresh — …` commits on `main` come from this script.
After the refresh it also pushes to GitHub (`git push github main`, deploy key
`~/.ssh/id_ed25519_github_pages`, non-fatal on failure). Since 2026-08-06 that
is the CANONICAL host, not a mirror: with the `CNAME` file in the repo, GitHub
301s cruxcoach.github.io to the apex, so it can no longer serve as a failover
target and is disabled in `mirrors.json`.

The mirror is now **https://mirror.cruxcoach.org** — our own machine, a Caddy
site block in `cruxcoach-dlstats/deploy/caddy/Caddyfile` serving THIS checkout
read-only with `Access-Control-Allow-Origin: *`. It needs no separate publish
step, which is the point: a second publishing path is a second thing that can
drift. `cruxcoach-dlstats/check_origins.py` (cron, every 6 h) verifies the apex,
every enabled mirror including its CORS header, both machine-readable manifests
on every host, and the download route.

**Any origin the site is served from must also be listed in
`DEFAULT_SITE_ORIGINS` in `cruxcoach-dlstats/anonymous_schema.py`.** Publishing a
mirror is only half the job. The collector answers an unknown origin with 403,
and that reply carries no `Access-Control-Allow-Origin` — so the beacon fails,
the buttons are never upgraded, and the click-time liveness probe fails the same
way. Visitors on such a host are counted nowhere and handed to a third party for
the download. `mirror.cruxcoach.org` sat in exactly that state from publication
until 2026-08-08, i.e. during the outage it exists to absorb; a test now reads
`mirrors.json` and asserts the two lists agree.
If anything was pushed to origin, it finally runs `tools/indexnow-ping.sh`
(non-fatal), which submits every sitemap URL to api.indexnow.org so Bing/Yandex &
co. re-crawl promptly. IndexNow needs no account: ownership is proven by the
32-hex key file at the repo root (currently `31ad8e39….txt`; the script locates
it by pattern, so rotating the key means replacing that file, nothing else).
Run the script manually after hand-pushed content changes.
On a release (i.e. the download-link commit fired), it additionally runs
`tools/wayback-save.sh <tag>` (non-fatal): waits until the new tag is live on
Pages, then archives every sitemap URL + llms.txt via the Wayback Machine's
anonymous Save Page Now. Once per release only — do NOT wire it into the
nightly path; anonymous SPN is tightly rate-limited.
