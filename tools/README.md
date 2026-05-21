# tools/

Scripts that regenerate static data committed under `boards/data/`. None of
this runs in the browser; the site itself stays build-step-free.

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

- `boards/data/boards.geojson` — what the page fetches
- `boards/data/boards.meta.json` — build timestamp + per-board + per-source counts

Then commit the regenerated files. The cadence is "whenever you remember"
for now; if the dataset starts mattering for users, automate via a cron
that runs the script and commits/pushes on diff.

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

## Data-source guidelines

- Prefer sources with explicit public-domain or permissive licensing.
- Drop free-form `description`/`bio` text at the adapter — historical
  MoonBoard entries contain SEO/casino spam from owner-set descriptions.
- Normalize coordinates to decimal degrees. Validate `lat ∈ [-90, 90]`,
  `lon ∈ [-180, 180]`.
- Don't include the user's email/phone even if the upstream exposes them.
