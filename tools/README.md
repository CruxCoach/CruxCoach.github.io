# tools/

Scripts that regenerate static content committed to the repo. None of
this runs in the browser; the site itself stays build-step-free.

## Direct APK download links (`update-download-link.mjs`)

```
node tools/update-download-link.mjs
```

Every interactive APK button points to a closed first-party route
`https://stats.cruxcoach.org/download/apk/<page-key>/<surface>`. The page key
maps to one canonical analytics path without transmitting a full URL, query,
or identifier. The server-side
selector checks availability without visitor data and redirects the one button
to the current Codeberg APK or its byte-identical, content-addressed Zapstore
mirror. It works without JavaScript and avoids both pre-click provider
connections and Forgejo counting an APK availability `HEAD` as a download.

Codeberg offers no stable "always newest" URL for versioned asset names, so
this script asks its API for the latest full release (prereleases/drafts
excluded), takes the URL of the actual `.apk` asset, and reads its SHA-256
sidecar. It streams the corresponding Zapstore object and requires matching
size and SHA-256 before updating canonical Codeberg/Zapstore URLs and atomically
publishing `apk-target.json`. That closed-schema manifest binds the
version, digest, byte size, and both exact hosts for the selector. The script is
a no-op when all targets are current, and it never publishes a half-mirrored
release. It runs nightly via `cron-refresh.sh`, which commits the rewrite as
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

## Nearest-city enrichment (`nearest-city.mjs`)

Only about a third of the venues arrive from upstream with a `city`. Measured
against the data, that left the map's text search finding 2 of the 18 boards
within 15 km of New York, and 2 of 8 around Zürich. `build-boards-data.mjs`
therefore borrows the place index and labels the rest: for every venue without
a city it attaches the nearest town within 25 km.

```json
{ "name": "Beacon Climbing Center", "city_nearest": "Bangor", "city_nearest_km": 13.0 }
```

- **Never written to `city`.** A gym 13 km outside Bangor is not *in* Bangor,
  so the derived value lives in its own field and the UI hedges it — the map
  and the directory render "near Bangor" / "bei Bangor", never a bare city
  name. Consumers that want only verified addresses keep reading `city`.
- **Coverage**: 1,044 upstream + 1,647 derived = 2,691 of 2,816 venues (96%).
  The remaining 125 sit further than 25 km from any indexed town. Counts land
  in `boards.meta.json` under `city_from_upstream` / `city_from_nearest` /
  `city_missing`.
- **Optional dependency**: if `boards/data/cities.json` is absent the build
  warns and skips enrichment rather than failing, so a fresh clone and the
  nightly refresh still work.
- **Localized**: where the nearest town has a German name, the venue also gets
  `city_nearest_de`, so the German directory and map say "bei München" where
  the English ones say "near Munich".
- **Not a metro-area fix.** GeoNames lists boroughs as their own cities, so a
  Brooklyn gym is labelled "Brooklyn", not "New York City", and a text search
  for the metro still will not gather them all. That case is answered by the
  map instead: jumping to a place at zoom 11 puts a ~70 × 45 km window on
  screen, which covers every board around New York, London, Berlin and Vienna.

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

## OpenStreetMap opening hours (`refresh-osm-hours.mjs`)

```bash
node tools/refresh-osm-hours.mjs            # read OSM for the curated venues
node tools/refresh-osm-hours.mjs --offline  # re-render committed values, no network
node tools/refresh-osm-hours.mjs --check    # verify the committed file is current
node tools/build-boards-data.mjs --static-only   # re-render the directories after a change
```

Shows opening hours for venues that a person has matched, by hand, to one exact
OpenStreetMap object. Full operations note: `tools/dev/RUNBOOK-osm-opening-hours.md`.
Current coverage and the review record: `tools/OSM-OPENING-HOURS-LEDGER.md`.

**Separate file, separate licence.** OSM data is ODbL 1.0, a share-alike
licence; `boards.geojson` is CC-BY-4.0. Mixing them would misdeclare one or
relicense the other, so everything OSM-derived lives in
`boards/data/osm-opening-hours.json` with its own `source` block, and a test
asserts that no `opening_hours`/`osm_id` ever appears in the GeoJSON.

**Matches are curated, never inferred.** `tools/osm-venues.json` binds a venue
to an exact `osm_type`/`osm_id`, with `verified_on` and free-text `evidence`
saying what was compared. Nothing attaches the nearest climbing gym: a wrong
match publishes a neighbour's hours under a real venue's name. Rejections are
recorded too, with a reason — "two plausible objects" is a decision, not a
gap. The loader fails the build on a structurally invalid entry, a venue
decided twice, or one OSM object claimed by two venues.

**Private setups are never enriched**, by three independent rules: the curator
has to write `"venue": "public"`, `venueLooksPrivate()` refuses a venue with a
home signal and no commercial one, and the OSM object itself has to still carry
a public sports-venue tag when the refresh reads it.

**Build time only, from our own origin.** The refresh command is the only thing
that contacts OpenStreetMap — batched multi-fetch (≤ 40 ids), sequential, 1.2 s
apart, 20 s timeout, identifying User-Agent; the whole current set is two
requests. It reads `opening_hours`, `check_date:opening_hours`, `name`, the
classifying tag, `timestamp` and `version`, and drops everything else where the
response is parsed — no phone numbers, no e-mail, no contact details. Visitors
read the committed sidecar from this site, so nobody is announced to a third
party for looking at a gym's hours, and the map still works when OSM does not.
An unreachable object keeps its last committed value and is flagged; a deleted
or retagged one loses its hours.

**No "open now".** `tools/opening-hours.mjs` renders the weekly pattern and
labels it "Opening hours according to OpenStreetMap". Answering "is it open
right now" correctly needs the venue's timezone, public holidays, school
holidays, overnight ranges, seasonal rules and one-off closures to all be
right; they are not, so the site does not answer it. Every rendered schedule
carries that caveat, plus the freshness date (`check_date:opening_hours` when a
mapper recorded one, otherwise the object's last edit) and a link to the exact
object.

**A bounded renderer instead of a vendored parser.** The reference
implementation covers the entire specification and is several hundred kilobytes
plus a holiday database — too much for a repository with no runtime
dependencies, and it would invite the "open now" claim. So the supported subset
is small and explicit (weekday selectors and ranges, time lists, `off`/`closed`,
`PH`, `24/7`, the `,` rule separator) and everything outside it — months, week
numbers, `SH`, sunrise/sunset, `Mo[1]`, open-ended times, comments, `||`
fallbacks — falls back to the unmodified OSM value plus the object link.
Refusing is a supported outcome, not a failure.

**Rendered once, shown twice.** Every user-visible string, in both languages, is
produced by the renderer at refresh time and stored in the sidecar. The map
popup and the static directories only place that text, so they cannot drift
apart. Editing the renderer therefore leaves the committed file stale — re-run
with `--offline`; `scripts/check` fails if you forget.

## Place index (`build-cities-data.mjs`)

```bash
node tools/build-cities-data.mjs
# → rewrites boards/data/cities.json + cities.meta.json; commit both after.
```

Builds the offline place index behind the board map's location search.

**Why it exists.** The map's venue search filters `boards.geojson` by text, so
it can only find a city that a venue actually carries in its `city` field —
and only about a third of them do. Measured against the data, searching "New
York" reached 2 of the 18 boards standing within 15 km of it; Zürich 2 of 8,
London 5 of 13. The place index answers from the other side: you jump the map
to a place, and the clusters plus the "boards in view" list report what is
there by geometry rather than by patchy text. A city with no board is a valid
search — you still get to look.

**Why it is a build step.** A live geocoder (Nominatim and friends) would send
every keystroke and the visitor's IP to a third party, which the runtime rule
in `AGENTS.md` forbids. A static file from our own origin keeps that intact,
works offline, and the service worker caches it after first use. The map loads
it lazily on the first real query, so visitors who never search never pay for
it.

**Size is the design constraint.** Every GeoNames city above 15k inhabitants
is 34k places and 665 KiB gzipped — five times `boards.geojson`. Three choices
bring it to ~240 KiB:

1. **Proximity pruning.** Places within `--radius-km` (default 100) of a board
   are kept down to `--min-population` (default 15 000); everywhere else only
   `--global-population` (default 200 000) and up, so a visitor far from any
   board still lands somewhere sensible.
2. **Two decimals of coordinate** (~1.1 km). A place jump lands at zoom 11.
3. **No population column.** Rows are written largest-first, so list order
   already encodes the ranking the search needs.

**Row shape** — `[name, country, lat, lon, region?, alternates?, name_de?]`,
trailing optional fields omitted when empty:

```json
["Munich","DE",48.14,11.58,"",[],"München"]
["Berlin","US",44.47,-71.19,"New Hampshire"]
```

- **`name`** is GeoNames' primary, which is language-neutral in intent but in
  practice usually the English form.
- **`name_de`** is the German form, and only present when it actually differs.
  It exists because the `/de/` pages must *display* the German name, not merely
  match it — a venue near Munich has to read "bei München" there. Roughly 1,000
  cities carry one.

- **`region`** is attached only to names that repeat within one country, so
  the list can say "Berlin, New Hampshire" without spending bytes to say
  "Bavaria" behind a München nothing collides with.
- **`alternates`** are what make every city findable in both site languages.
  They matter because GeoNames is inconsistent about which form is primary: it
  stores "Munich", "Vienna" and "Prague" in English but "Köln", "Zürich" and
  "Sevilla" locally, so without them the German site cannot find München and
  the English one cannot find Cologne. They come from two sources, merged:

  1. **`alternateNamesV2.zip`** — the language-tagged dump, which is the only
     GeoNames file that says *which* language a name belongs to. For each city
     the build takes the German and the English name, preferring GeoNames' own
     `isPreferredName`, then `isShortName`. Historic and colloquial forms are
     skipped, so "Pressburg" does not resurface as a name for Bratislava.
     The dump is 193 MB and ~19 M rows, so it is never held in memory: the
     build locates the entry in the ZIP's central directory and streams that
     byte range through inflate, filtering rows by tab offsets before parsing
     them. That pass takes about 15 seconds and is cached for later runs.
     `--no-alternates` skips it for quick iteration — it prints a warning and
     records `alternates_from_dump: false` in the meta, because committing
     output built that way would silently drop thousands of names.
  2. **`tools/city-exonyms.json`** — a hand-curated overlay in the same spirit
     as `overrides.json` and `wellpass.json`, applied *first* so it can correct
     the dump. An entry matching no city is reported as a warning and listed in
     `cities.meta.json` under `exonym_entries_unmatched`, so an upstream rename
     surfaces instead of silently doing nothing.

  A name that normalizes to the primary name is dropped either way — the search
  strips diacritics on both sides, so "Zurich" behind "Zürich" is dead weight.
  About 1,600 of the 17,819 cities end up with an alternate; the rest are
  spelled the same in both languages.

**Rebuilding.** Not part of the nightly cron: GeoNames changes slowly and the
pruning set barely moves. Rerun it by hand when the exonym overlay changes, or
after boards appear in a region the index does not cover yet — the pruning
reads `boards.geojson`, so build that first. The dumps are cached under
`$TMPDIR/cruxcoach-build-deps/geonames`, so repeat runs need no network.
`cities.json` carries no timestamp and is a pure function of its inputs, so a
no-op rebuild produces no diff.

**Licensing.** GeoNames data is CC BY 4.0. Attribution is required and lives
in `humans.txt`, the privacy pages, and `cities.meta.json`.

## Data-source guidelines

- Prefer sources with explicit public-domain or permissive licensing.
- Drop free-form `description`/`bio` text at the adapter — historical
  MoonBoard entries contain SEO/casino spam from owner-set descriptions.
- Normalize coordinates to decimal degrees. Validate `lat ∈ [-90, 90]`,
  `lon ∈ [-180, 180]`.
- Don't include the user's email/phone even if the upstream exposes them.
