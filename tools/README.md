# tools/

Scripts that regenerate static data committed under `boards/data/`. None of
this runs in the browser; the site itself stays build-step-free.

## Refresh boards.geojson

```
node tools/build-boards-data.mjs
```

Pulls the latest `@hangtime/climbing-boards` from npm, normalizes every
feature, drops malformed/incomplete entries, deduplicates by
`(board, lat, lon)` rounded to ~10 m, and rewrites:

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

## Data-source guidelines

- Prefer sources with explicit public-domain or permissive licensing.
- Drop free-form `description`/`bio` text at the adapter — historical
  MoonBoard entries contain SEO/casino spam from owner-set descriptions.
- Normalize coordinates to decimal degrees. Validate `lat ∈ [-90, 90]`,
  `lon ∈ [-180, 180]`.
- Don't include the user's email/phone even if the upstream exposes them.
