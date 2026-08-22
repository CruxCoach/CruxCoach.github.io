# Runbook — OpenStreetMap opening hours

Operations note for the opening hours shown on the board map and in the
generated venue directories. Read `tools/OSM-OPENING-HOURS-LEDGER.md` for where
the curation currently stands.

## What the moving parts are

| File | What it is | Who writes it |
|---|---|---|
| `tools/osm-venues.json` | Curated venue ↔ OSM object decisions, accepted and rejected | A person, by hand |
| `boards/data/osm-opening-hours.json` | The ODbL sidecar: raw OSM values + provenance + finished bilingual text | `tools/refresh-osm-hours.mjs` |
| `tools/opening-hours.mjs` | The bounded renderer, and every user-facing string | — |
| `tools/osm-hours.mjs` | Validation, guards, sidecar assembly | — |
| `boards/list.html`, `de/boards/list.html` | Static directories, hours included | `tools/build-boards-data.mjs` |
| `boards/map.js` | Reads the sidecar from this origin and fills the popup | — |

Two rules hold the whole thing together:

1. **Only `refresh-osm-hours.mjs` talks to OpenStreetMap.** The site build and
   every visitor read the committed sidecar. A visitor's browser never asks OSM
   about a gym, and the production build works with no network at all.
2. **Every user-visible string is rendered once**, at refresh time, into the
   sidecar — in both languages. The map and the directories only place text, so
   they cannot disagree about what a schedule says.

## Routine refresh

```bash
node tools/refresh-osm-hours.mjs          # respects the interval guard (144 h)
node tools/refresh-osm-hours.mjs --force  # ignore the guard
node tools/refresh-osm-hours.mjs --dry-run
```

It prints one machine-readable line: `[osm-hours] result: changed | unchanged |
skipped | current | would-change`. On `changed`:

```bash
node tools/build-boards-data.mjs --static-only   # re-render both directories
scripts/check
git add boards/data/osm-opening-hours.json boards/list.html de/boards/list.html
git commit -m "data(osm): refresh venue opening hours from OpenStreetMap"
```

On `unchanged`, discard the file: the only difference is its `checked_at`
stamp, and a daily no-op commit is exactly what this repository avoids.

```bash
git checkout -- boards/data/osm-opening-hours.json
```

**How it reads OSM.** One `GET` per object type against
`https://api.openstreetmap.org/api/0.6/{nodes,ways,relations}.json`, up to 40
ids per request, sequential, 1.2 s apart, 20 s timeout, with a User-Agent that
names the project and links a contact page. The whole current set is two
requests. The multi-fetch endpoint answers 404 for the entire batch if a single
member has been deleted, so a failed batch is retried one id at a time — that
finds the deleted object without punishing the rest.

**What it takes.** `opening_hours`, `check_date:opening_hours`, the object's
`name`, the tag that classifies it as a public venue, its `timestamp` and its
`version`. Nothing else. Phone numbers, e-mail addresses, operator names and
contact details are dropped where the response is parsed and never reach the
repository.

**When OSM is down or slow**, the affected objects keep their previously
committed values and are marked `unreachable`. Losing a whole city's hours
because of one bad minute would be worse than showing last week's value with
its (unchanged) freshness date. An object that is confirmed **deleted** or has
been **retagged** into something that is no longer a public sports venue does
lose its hours — that is a fact about the object, not an outage.

## Optional: the nightly cron

`tools/cron-refresh.sh` can do the above by itself, but **it is off by
default**. Reading a third-party API on a schedule is an operator decision, so
it needs the environment variable:

```cron
30 3 * * * CRUXCOACH_OSM_HOURS=1 /home/<user>/cruxcoach-pages/tools/cron-refresh.sh
```

It paces itself with `~/.cache/cruxcoach-pages-cron/osm-hours-last-check`
(7 days; override with `CRUXCOACH_OSM_HOURS_INTERVAL_DAYS`). A run that finds
nothing changed touches the stamp file, reverts the sidecar and leaves no
commit behind. A run that finds a change re-renders the two directories,
refreshes the sitemap `lastmod` and pushes one commit. Every failure path is
non-fatal: the boards refresh must never be blocked by OpenStreetMap.

## Adding a batch of matches

This is the part that cannot be automated, and the reason the data is worth
anything. **Never attach the nearest object.** A wrong match publishes someone
else's opening hours under a real gym's name.

```bash
node tools/dev/osm-candidates.mjs --country FR --limit 6 --radius 200
node tools/dev/osm-candidates.mjs --name "boulderwelt"
node tools/dev/osm-candidates.mjs --key 48.1070|11.5457
```

The helper prints candidates with the evidence needed to decide — name,
distance, classifying tags, address, whether hours are tagged — and writes
nothing. Venues already decided (accepted *or* rejected) are skipped, and
anything that looks like a home wall is never offered.

Decide each venue, then append to `tools/osm-venues.json`:

```json
{
  "name": "Boulderwelt Frankfurt",
  "lat": 50.16409, "lon": 8.68487,
  "status": "accepted",
  "venue": "public",
  "osm_type": "way", "osm_id": 28299711,
  "match_method": "manual",
  "verified_on": "2026-08-22",
  "evidence": "way/28299711 \"Boulderwelt Frankfurt\", leisure=sports_centre + sport=climbing, 8 m away, addr August-Schanz-Straße 50; the two other objects in range are a karting hall and a gym."
}
```

Match on **identity**, not proximity: an identical or near-identical name, a
matching address, the right kind of tag. If two objects are plausible, or the
only candidate is the shopping centre that contains the gym, that is a
rejection — record it, with a reason and a date:

```json
{
  "name": "Jungle Sport Park",
  "lat": 50.14204, "lon": 14.51789,
  "status": "rejected",
  "reason": "Ambiguous: two climbing objects describe the same site…",
  "reviewed_on": "2026-08-22"
}
```

Then:

```bash
node tools/refresh-osm-hours.mjs --force
node tools/build-boards-data.mjs --static-only
scripts/check
# update the counts in tools/OSM-OPENING-HOURS-LEDGER.md
```

The loader fails the build — deliberately, loudly — on a missing `evidence`, a
missing `verified_on`, a non-manual `match_method`, a venue decided twice, or
one OSM object claimed by two venues.

## Changing the renderer or its wording

The committed sidecar carries finished strings, so editing
`tools/opening-hours.mjs` leaves it stale. Re-render, with no network:

```bash
node tools/refresh-osm-hours.mjs --offline
node tools/build-boards-data.mjs --static-only
```

`node tools/refresh-osm-hours.mjs --check` verifies the committed file matches
the renderer and exits non-zero if it does not; `scripts/check` asserts the
same thing, so drift cannot be committed silently.

## Licensing

Opening hours and the OSM object metadata are **ODbL 1.0**, © OpenStreetMap
contributors. The venue dataset (`boards/data/boards.geojson`) is CC-BY-4.0.
They are kept in separate files for exactly that reason, and a test asserts
that no OSM-derived field ever appears in the GeoJSON. Attribution appears in
the map popup, in both directories' footers, in the "Data sources" section of
both map pages, in `humans.txt`, and in the sidecar's own `source` block. If
you ever move a value from one file to the other, the licence declarations on
both — including the JSON-LD `Dataset` nodes on the map pages — have to move
with it.

## Things that should worry you

- A venue's hours in the popup that contradict its own website. We show what
  OSM says; the fix is to edit OSM. That is what the "View or correct these
  hours" link is for, and it is why the object link is always shown.
- `unmatched_venue` above zero: upstream moved or dropped a venue that has a
  curated match. Re-check the coordinate and update `tools/osm-venues.json`.
- `not_a_public_venue` above zero: an object was retagged. It has already lost
  its hours; decide whether the match is still right.
- A refresh that suddenly reports many `gone` objects. Two requests failing in
  an unusual way looks the same as an editor deleting things. Re-run before
  believing it.
