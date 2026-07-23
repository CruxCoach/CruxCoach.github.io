# tools/

Scripts that regenerate static content committed to the repo. None of
this runs in the browser; the site itself stays build-step-free.

## Direct APK download links (`update-download-link.mjs`)

```
node tools/update-download-link.mjs
```

Every download button/link on the site points at the current release's
versioned direct APK URL (`…/releases/download/vX.Y.Z/CruxCoach-vX.Y.Z.apk`)
instead of the releases page. Each interactive button also carries the
content-addressed Zapstore CDN URL for the exact same APK. The small
`assets/apk-download.js` enhancement resolves the CORS-enabled canonical
Codeberg attachment through the public release API, verifies its HTTP status
and APK MIME type for up to 2.5 seconds, and transparently changes that same
button to Zapstore on any failure or timeout. The nightly job also verifies
both full payloads byte-for-byte. Without JavaScript, the ordinary Codeberg
link remains usable.

Codeberg offers no stable "always newest" URL for versioned asset names, so
this script asks its API for the latest full release (prereleases/drafts
excluded), takes the URL of the actual `.apk` asset, and reads its SHA-256
sidecar. It streams the corresponding Zapstore object and requires matching
size and SHA-256 before atomically rewriting both URLs in `index.html`,
`de/index.html`, `404.html` and `llms.txt`. It is a no-op when the links are
already current, and it never publishes a half-mirrored release. Runs nightly
via `cron-refresh.sh`, which commits the rewrite as
`chore(download): bump direct APK link to vX.Y.Z`.

## Sitemap `lastmod` and IndexNow

Keep sitemap modification dates tied to the actual page files instead of editing
them by hand:

```bash
# Refresh every sitemap entry.
node tools/update-sitemap-lastmod.mjs

# Refresh only entries backed by these changed pages.
node tools/update-sitemap-lastmod.mjs index.html de/index.html
```

For committed files, the updater uses the date of the newest Git commit that
touched that file. A locally modified page receives today's UTC date. Every
`<loc>` must resolve to a real page inside the repository; invalid or missing
mappings make the command fail rather than write a misleading sitemap.

The nightly `cron-refresh.sh` refreshes and commits the relevant `lastmod`
entries whenever it changes APK links or generated board pages. It also records
the last successfully submitted deployed `origin/main` commit in
`~/.cache/cruxcoach-pages-cron/indexnow-main-head`. Comparing that state after
every run catches deployments merged through the Codeberg UI as well as commits
pushed by the cron itself. A failed IndexNow request does not advance the state,
so the next run retries it.

Submit the full sitemap after a broad deployment, or pass only the canonical
URLs that actually changed:

```bash
tools/indexnow-ping.sh
tools/indexnow-ping.sh \
  https://cruxcoach.org/kilter-board-app-alternative.html \
  https://cruxcoach.org/de/kilter-board-app-alternative.html

# Validate the key and URL selection without making a network request.
tools/indexnow-ping.sh --dry-run https://cruxcoach.org/moonboard-app.html
```

The script rejects foreign origins, removes duplicate URLs, and enforces
IndexNow's 10,000-URL request limit. With no URL arguments it reads every
`<loc>` from `sitemap.xml`. Ownership is proven by the 32-hex key file at the
site root; replacing that file is enough to rotate the key.

## Refresh boards.geojson

```
node tools/build-boards-data.mjs
```

On first run the script installs `@rapideditor/country-coder` into a
per-tmp cache (`$TMPDIR/cruxcoach-build-deps/`) so every venue gets an
ISO-3166-1 alpha-2 country code regardless of which upstream source
shipped it. Subsequent runs reuse that cache — no node_modules in the
repo.

The script then pulls the latest `@hangtime/climbing-boards` from npm,
normalizes every feature, drops malformed/incomplete entries, groups
into venues by `(lat, lon)` rounded to ~10 m, and rewrites:

- `boards/data/boards.geojson` — what the map page fetches at runtime
- `boards/data/boards.meta.json` — build timestamp + per-board + per-source counts
- `boards/list.html` — a full **static** directory of every venue grouped by
  country (see "Static HTML" below)
- `boards/index.html` — the per-board counts table between its
  `<!-- GENERATED:board-stats -->` markers is re-injected

Then commit the regenerated files. The cadence is "whenever you remember"
for now; if the dataset starts mattering for users, automate via a cron
that runs the script and commits/pushes on diff.

## Static HTML (`render-static.mjs`)

The map renders entirely in client-side JavaScript, fetching
`boards/data/boards.geojson` at runtime. Crawlers that don't execute JS —
which includes the AI assistants (ChatGPT, Claude, Perplexity all read HTML
snapshots only) — therefore can't see a single venue, city or country. So
`build-boards-data.mjs` also emits static HTML via `tools/render-static.mjs`:

- **`renderListPage()`** → `boards/list.html`: a full text directory of every
  venue, grouped by country, with a per-board counts table and a country
  table-of-contents. This is the crawlable, citable artifact; it's linked
  from the map page and listed in `sitemap.xml`.
- **`renderStatsBlock()`** → the inner HTML between the
  `<!-- GENERATED:board-stats START … END -->` markers in `boards/index.html`.
  Editing inside those markers by hand is pointless — the next build
  overwrites it. Edit the prose *outside* the markers freely; if you ever
  remove the markers, the build warns and skips injection rather than
  crashing.

**Both outputs are a pure function of the venue data — deliberately no build
timestamp.** Re-running on an unchanged dataset produces byte-identical HTML,
so the nightly `cron-refresh.sh` (which keys change-detection on
`boards.geojson`) never makes a no-op commit. Volatile metadata like the build
time stays in `boards.meta.json`, which the pages link to.

## Adding a new source

Each source lives in `tools/sources/<name>.mjs` and exports a single async
function `load()` returning:

```js
{
  entries: [
    { source: 'mysrc', board: 'kilter', name: 'Some Gym',
      lat: 48.137, lon: 11.575,
      username: 'optional' },
    // ...
  ],
  meta: { /* anything you want recorded in boards.meta.json */ }
}
```

Valid `board` values: `kilter | tension | grasshopper | decoy | soill |
touchstone | aurora | moonboard | 12climb`. Anything else is dropped with
a warning so the schema is enforced centrally.

Then register the source in `build-boards-data.mjs`:

```js
import * as mysrc from './sources/mysrc.mjs';
const SOURCES = [
  { id: 'hangtime', mod: hangtime },
  { id: 'mysrc',    mod: mysrc },
];
```

The merge policy is **first-source-wins by `(board, lat, lon)`**: existing
hangtime entries shadow later sources at the same coordinate. Change this
in `build-boards-data.mjs` if you need richer merging.

## Manual overrides

`tools/overrides.json` hand-corrects fields the upstream sources leave blank
or get wrong — e.g. a MoonBoard whose variant can't be parsed from its
free-form description. It's a committed, hand-edited JSON array;
`build-boards-data.mjs` applies it after loading every source and before
venue grouping, so the correction survives every rebuild (including the
nightly `cron-refresh.sh`).

```json
[
  {
    "board": "moonboard",
    "lat": 48.3896024, "lon": 10.8874895,
    "name": "Bloc-Hütte Augsburg",
    "note": "free-form, humans only — the build ignores this field",
    "set": { "variant": "mb2016" }
  }
]
```

- **Matching**: by `board` + `(lat, lon)` rounded to 4 decimals (~11 m — the
  same precision as venue grouping), so the file may carry coordinates at any
  precision. `name` is a human label only; the build warns if it doesn't
  match the entry that was matched on, which catches coordinate typos.
- **Semantics**: every key under `set` is written onto the matched per-board
  object and wins over the upstream value. Replacing a non-null upstream
  value is logged and counted as a conflict, so a stale override stays
  visible.
- **MoonBoard `variant`** accepts: `mb2016`, `mb2017-masters`,
  `mb2019-masters`, `mb2024`, `mini-2020`, `school-room`.
- After editing, rebuild (`node tools/build-boards-data.mjs`) and commit the
  regenerated `boards/data/` files alongside `overrides.json`. Counts land in
  `boards.meta.json` under `overrides`.

## egym Wellpass curation

`tools/wellpass.json` flags which DACH venues are part of the egym Wellpass
corporate-fitness network, so the map can offer a "In Wellpass / Unknown /
Not in Wellpass" filter. It is a committed, hand-edited JSON array; the
seed list was produced by an out-of-repo matcher that compares a Wellpass
gym-list scrape against the venue names in `boards.geojson`. The matcher
itself and the raw scrape are deliberately gitignored — only the
curated venue identifiers (name + coordinates + boolean) live in this repo.

```json
[
  {
    "lat": 48.3896024, "lon": 10.8874895,
    "name": "Bloc-Hütte Augsburg",
    "wellpass": true,
    "_source": "auto-match J=100% ovl=100% via \"Bloc-Hütte Augsburg\""
  }
]
```

- **Matching**: same `(board)? + (lat, lon)` rounding as `overrides.json`
  (4 decimals, ≈ 11 m), via `venueKey()`. The `name` is a sanity check —
  the build warns on mismatches.
- **Semantics**: `wellpass: true` marks a venue as confirmed in Wellpass,
  `wellpass: false` as confirmed not in Wellpass. Venues not listed stay
  undefined ("unknown") in the output.
- **Workflow**: when the Wellpass roster changes, regenerate the seed
  outside the repo with the personal matcher, manually verify, then drop
  the resulting JSON onto `tools/wellpass.json`.
- Stats land in `boards.meta.json` under `wellpass`.

## Data-source guidelines

- Prefer sources with explicit public-domain or permissive licensing.
- Drop free-form `description`/`bio` text at the adapter — historical
  MoonBoard entries contain SEO/casino spam from owner-set descriptions.
- Normalize coordinates to decimal degrees. Validate `lat ∈ [-90, 90]`,
  `lon ∈ [-180, 180]`.
- Don't include the user's email/phone even if the upstream exposes them.
