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

`sources/curated.mjs` is the intentionally small exception to automated feeds.
Add a row there only when the venue's own current page confirms a public board
that upstream omits. Keep the official page beside the row as a reviewable
comment, record the verification date in the adapter metadata, and use
`overrides.json` instead when the upstream row already exists but is wrong.

`sources/quantum.mjs` loads the separately reviewed public Quantum Board
installations in `quantum-locations.json`. Because the eWalls catalogue does
not reliably map boards to public venues, only records backed by primary
venue/manufacturer evidence are admitted; the audit and exclusions live in
`QUANTUM-LOCATIONS.md`.

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

## Closed, duplicate, non-public, announced, and mislocated upstream locations

`tools/location-exclusions.json` removes an upstream coordinate only after a
`closed`, `duplicate`, `non-public`, `announced`, or `mislocated` decision at the same coordinate is backed by the
primary-source research in `tools/venue-links-research.json`. The exclusion
file intentionally carries no second copy of the evidence; its loader refuses
an unbacked, differently named, undated, or contradictory row. Exclusions are
applied before venue grouping and overrides, survive nightly upstream refreshes,
and report stale/unmatched rows in `boards.meta.json`.

Null Island is handled one step earlier: source adapters drop exact `0,0`
coordinates as missing location data. Registry defaults from unrelated rows
must never collapse into a public marker.

`mislocated` is reserved for a real venue or board placed at a materially wrong
point (for example, a city-centre default between two named branches). The
replacement location must be added from branch-specific primary evidence in the
same batch; it is not a general-purpose way to discard an awkward coordinate.

`non-public` is reserved for an institution-only installation whose primary
sources identify no public climbing venue access, such as a board installed for
physical-education lessons inside a school. It must not be used merely because
public access has not yet been proved; those cases remain research candidates.

`announced` is reserved for a manufacturer pin that the venue's own current
page explicitly says is still “coming soon” or otherwise not open. It prevents
an app's premature pin from being presented as a current public installation;
the outcome must be rechecked and removed once the venue announces opening.

After changing exclusions, run a full `node tools/build-boards-data.mjs` (not
`--overlays-only`) and commit the regenerated dataset, metadata, and directories.

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

## Venue website links

`tools/venue-links.json` attaches one manually verified official website to a
venue, at venue level rather than per board. `tools/venue-links-research.json`
records every venue that was checked and got no link, with a reason. The full
policy, the record schema and the decision note for the link classes that were
*not* built live in [`tools/VENUE-LINKS.md`](VENUE-LINKS.md).

```bash
# Validate the curated file against the committed venue data (exits non-zero on
# anything the build would refuse). Run before committing a batch.
node tools/venue-links-report.mjs

# Worklist for the next batch.
node tools/venue-links-report.mjs --todo DE,AT,CH --limit 40 --with-address

# Re-apply the venue-level overlays and re-render both directories, without
# pulling a new upstream dataset into the same commit.
node tools/build-boards-data.mjs --overlays-only
```

- **Matching**: `venueKey()` at 4 decimals like the other overlays, then a
  proximity rematch within 250 m that also requires the country and the name to
  agree. Anything ambiguous drops the link and logs it — a link on the wrong gym
  is worse than no link, because a visitor cannot tell it is wrong.
- **Never on private venues**: `classifyVenue()` refuses `commercial: false`
  MoonBoard-only venues outright.
- **URL policy**: HTTPS only, no credentials, no IP literals, no social or
  aggregator hosts, tracking parameters and fragments stripped. Stored already
  canonical, so a review diff shows the link a visitor actually gets.
- **Shared URLs**: two venues pointing at one page is normal — upstream splits a
  gym into a Kilter entry and a MoonBoard entry metres apart. Past
  `SHARED_URL_SITE_LIMIT_M` (1 km) the build adds a second, louder note, because
  at that distance it is more likely two of an operator's gyms and the records
  should say `official-chain-page`. It is an advisory: only a curator can tell
  that from a drifted upstream coordinate.
- Counts land in `boards.meta.json` under `venue_links`.

## Venue opening hours

`tools/venue-hours.json` attaches a manually verified weekly opening schedule to
a venue, read from that venue's own official page.
`tools/venue-hours-research.json` is the other half: every venue that was
reviewed and got no hours, with a status and a reason. The full policy, the
record schema, the day grammar and the decision note for the fields deliberately
*not* built live in [`tools/VENUE-HOURS.md`](VENUE-HOURS.md).

```bash
# Validate the curated file against the committed venue data (exits non-zero on
# anything the build would refuse). Run before committing a batch.
node tools/venue-hours-report.mjs

# Worklist for the next batch, and the schedules already published.
node tools/venue-hours-report.mjs --todo DE,AT,CH --limit 40
node tools/venue-hours-report.mjs --show

# Re-apply the venue-level overlays and re-render, without pulling a new
# upstream dataset into the same commit.
node tools/build-boards-data.mjs --overlays-only
```

- **Matching**: the same `resolveVenueRecord()` the website links use — the
  4-decimal `venueKey()`, then a 250 m proximity rematch that also requires the
  country and the name to agree. Both overlays share one resolver so neither can
  drift into being laxer than the other.
- **Never on private venues**: `classifyVenue()` refuses `commercial: false`
  MoonBoard-only venues, exactly as it does for links.
- **Fail closed**: a schedule that is partial, contradictory, seasonal,
  appointment-only or unreadable produces an outcome record, not hours. The
  schema will not accept a week with a day missing, and it will not accept a day
  it cannot spell canonically.
- **The verification date and the evidence quote never ship.** `toPublicHours()`
  passes exactly the seven-day array and the source URL into the dataset; the
  `checked` date, the `evidence` quote, the `signals` and the `provenance` stay
  in the curated file. Tests grep the published geojson and both directories for
  each record's own date and evidence.
- **No open-now state, ever.** The data has no timezone, no holiday calendar and
  no notion of a one-off closure. Both renderers state the published week, label
  it as the venue's own, and link the page it came from.
- Counts land in `boards.meta.json` under `venue_hours`.

## Keeping the two overlays honest over time (network tools)

Both curated overlays record what a page said on the day it was read, and pages
move. Two tools re-read them; both make network requests, so neither is part of
`scripts/check` and both are run by hand after a curation batch.

```bash
# Fetch every published venue link and report what no longer answers. 404 and
# 410 must be acted on; a 403 or no answer at all from a host that still
# resolves is usually bot protection this machine cannot get past.
node tools/venue-links-liveness.mjs

# Re-read the source of every published week and report three things: where a
# Squarespace business-hours setting or a schema.org block on the same page says
# something different, where a time the record publishes is no longer printed on
# the page at all, and where the page prints no time to a reader in the first
# place (a single-page app, or a schedule in an image). A difference is a finding
# to read, not a verdict — see "When a page states the week twice" in
# VENUE-HOURS.md.
node tools/venue-hours-conflict.mjs
```

Two more read a page the way a browser would rather than the way a fetcher
does. They are for reopening a venue that is stuck, so they take the venues to
try rather than sweeping the whole file, and they write one file per venue into
a directory beside them.

```bash
# Where a page prints no address, read the pin out of the map it embeds and say
# how far that is from the registry point. Eight shapes are covered: Google
# embeds and query links, Squarespace location objects, schema.org
# GeoCoordinates, generic lat/lng JSON, data attributes, OSM embeds, geo: URIs.
node tools/venue-map-pin.mjs "41.7105,-86.1896=https://www.apexclimbinggym.com"

# Where the rendered HTML has no day beside a time, look in the page's own
# script bundle — a single-page app's text is still the page.
node tools/venue-hours-bundle.mjs "47.5148,19.1143=https://fless.hu"

# Where upstream records no street, ask the coordinate what street it is on and
# look for that, and for its postcode, on the candidate's pages.
node tools/venue-street-match.mjs "35.6534,-105.9925=https://climbsantafe.com"
```

## Coverage audit (`venue-audit.mjs`, `venue-audit-ledger.json`)

```bash
# Validate the ledger and print coverage; exits non-zero while any row is
# still pending or unbacked by a real curated or research record.
node tools/venue-audit.mjs

# What is still open, and the next N rows to work on.
node tools/venue-audit.mjs --queue DE
node tools/venue-audit.mjs --next 20 --country US
node tools/venue-audit.mjs --json
```

The two overlays above answer "what do we know?"; this answers "what have we
looked at?", which is a different question and the one that decides whether a
gap is real or merely unexamined.

- **The worklist is frozen.** `venue-audit-ledger.json` holds one row per
  eligible venue that lacked a website or hours when the audit opened — 1,475
  of them — so the denominator cannot drift as venues are added upstream.
  `computeWorklist()` recomputes it from the committed data and the test fails
  if the two disagree.
- **Every row must resolve to exactly one venue**, through the same
  `resolveVenueRecord()` the overlays use. The one venue it cannot place —
  Fitbloc, at coordinates 0,0 with no country — sits in an `unresolvable`
  bucket, is exempt from the backing rule, and must carry a `note` on each
  field it needs.
- **Every decided outcome must be backed** by a real record in the matching
  curated or research file. A row cannot claim `accepted` without a link, or
  `seasonal` without an outcome record saying so.
- **Retryable outcomes stay in the queue.** `unverified`, `unavailable` and
  `pending` for websites; `inaccessible` and `pending` for hours. Those are
  facts about one moment — a 403, a TLS failure, a page that renders in the
  browser — rather than facts about the venue, so they are recorded and kept
  open rather than closed as absent.
- **The ledger never ships.** It is a working file: `venue-audit.test.mjs`
  greps every published artifact for each row's contents and asserts no served
  file references it.

The audit's own findings — what it changed about candidate discovery, the
shapes that decide an hours outcome, and the three upstream coordinate bugs it
surfaced — are written up at the end of
[`VENUE-LINKS.md`](VENUE-LINKS.md) and [`VENUE-HOURS.md`](VENUE-HOURS.md).

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

### Aurora-family anonymous-pins audit

Tension, Grasshopper, Decoy, So iLL, Touchstone and Aurora expose small
anonymous manufacturer-app pin lists. Compare all six with the committed map:

```bash
node tools/aurora-pins-audit.mjs
node tools/aurora-pins-audit.mjs --json
```

The tool discards account ids and usernames and retains no response. A pin is a
candidate, not proof of current public access: review it against the venue's own
current page. The endpoints have no published redistribution licence and omit
addresses and board details, so Hangtime remains the normal ingest source.

### Kilter manufacturer-locator audit

Kilter's official locator page embeds a public StoreRocket dataset. It is a
valuable candidate channel, but not a safe production feed: it includes private
home walls, stale/closed venues, duplicate submissions, Null Island and several
coordinates in the wrong country. Compare it manually with the committed map:

```bash
node tools/kilter-locator-audit.mjs
node tools/kilter-locator-audit.mjs --json
```

The command retains no raw response and deliberately prints no phone or email.
Rows under `candidates` are not additions: each still needs an unambiguous public
venue identity and current primary evidence. Coordinate matches, known
exclusions, explicit private rows and likely coordinate drift are separated so
the residual worklist is reproducible. A point within 250 m is a match only when
the names or addresses identify the same venue; a 100 m co-location tolerance
absorbs ordinary entrance/geocoding variation. This prevents a second gym in a
dense city from disappearing merely because it is nearby. Same-identity drift
also compares the locator's address with Kilter addresses already in the map,
so an operator rename does not hide a known bad pin. Conclusive, name-matched
`venue-links-research.json` outcomes classify locator-only private/closed/
duplicate/non-public/announced/mislocated rows without turning those decisions
into production-wide coordinate exclusions. Same-identity submissions at the
same rounded point are counted separately as locator duplicates, with the most
detailed access/profile row retained for review. `--input file.json`
accepts a previously fetched response for tests or an exact-repeat audit.

### Touchstone chain board audit

Touchstone's current official training-board guide is a structured, chain-wide
supplement for four supported systems. The reviewed matrix, count discrepancy,
future installations and branch-level corroboration are recorded in
`TOUCHSTONE-CHAIN-BOARDS.md`. Curated rows recover only current boards absent
from the frozen registries; existing rows are corrected with `overrides.json`,
and near-coordinate duplicates use the backed exclusion workflow.

- Prefer sources with explicit public-domain or permissive licensing.
- Drop free-form `description`/`bio` text at the adapter — historical
  MoonBoard entries contain SEO/casino spam from owner-set descriptions.
- Normalize coordinates to decimal degrees. Validate `lat ∈ [-90, 90]`,
  `lon ∈ [-180, 180]`.
- Don't include the user's email/phone even if the upstream exposes them.
