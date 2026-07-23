# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Source for **https://cruxcoach.org** — the public landing page for the CruxCoach
open-source Android Kilter Board app. Published via **Codeberg Pages**: the default
branch is served directly, so a push goes live within minutes. There is **no build
step** for the site itself.

## Commands

```bash
# Preview the site locally (no build — just serve the files)
python3 -m http.server          # then open http://localhost:8000

# Regenerate the boards map dataset (the ONLY code that "builds" anything)
node tools/build-boards-data.mjs
# → rewrites boards/data/boards.geojson + boards.meta.json; commit both after.
```

The lightweight `scripts/check` validates JavaScript, JSON, and the sitemap and
runs the Node unit tests; there is no package.json or browser test suite.
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
  3. `sw.js` is a resilience service worker (stale-while-revalidate + mirror
     fallback from `mirrors.json`) so returning visitors survive an origin outage.
  4. `index.html`, `de/index.html`, the four board-specific landing pages, and the
     shared-climb view in `404.html` load
     `assets/apk-download.js` to validate authored static URLs without making any
     visitor-side availability request.
  5. Every HTML page loads `assets/anonymous-analytics.js`. It sends only a
     canonical page label and explicit install-button dimensions, uses
     `credentials: omit` + `no-referrer`, honours DNT/GPC, and never handles IDs.
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

- **Direct APK download links**: every download surface (hero, install card,
  404 climb landing, llms.txt) offers both the current release's **versioned**
  Codeberg URL and its content-addressed Zapstore CDN fallback — never the releases
  page. JSON-LD keeps Codeberg as its canonical `downloadUrl`. Codeberg has no
  "always newest" URL for versioned asset names, so
  `tools/update-download-link.mjs` (run by the nightly cron) rewrites these URLs
  in `index.html`, `de/index.html`, `404.html`, the four board-specific landing
  pages and `llms.txt` when a new full release appears. It derives the Zapstore URL
  from the Codeberg SHA-256 sidecar and verifies the CDN object before updating
  either source. Hand-editing is fine — the cron self-heals. A new page with a
  download link must be added to the `FILES` list in that script (and to
  `link_files` in `cron-refresh.sh`).
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
  CollectionPage). All pages carry canonical + OG; the two homepages carry
  `hreflang` (`/boards/` does not — there is no `/de/boards/`).
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
  `SOURCES` array in `build-boards-data.mjs`. Currently only `hangtime` (the
  `@hangtime/climbing-boards` npm package, Unlicense). The frontend reads only the
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
After the refresh it also syncs the GitHub Pages fallback mirror
(`git push github main` → https://cruxcoach.github.io, deploy key
`~/.ssh/id_ed25519_github_pages`; listed in `mirrors.json`, non-fatal on failure).
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
