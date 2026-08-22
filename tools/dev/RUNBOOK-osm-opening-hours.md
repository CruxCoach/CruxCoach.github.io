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
names the project and links a contact page. The current set needs roughly 30
batched requests. The multi-fetch endpoint answers 404 for the entire batch if a single
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

## The outcome every venue carries

`tools/osm-venues.json` holds exactly one decision per venue on the map. Only
`accepted` is ever enriched; the rest exist so that "we looked" is written down
and the same venue is not re-examined from scratch every sweep.

| status | means |
|---|---|
| `accepted` | bound to one exact OSM object — which may or may not carry hours |
| `private` | a home or garage setup; never enriched, whatever OpenStreetMap says |
| `no-object` | documented checks found no object that IS this venue |
| `ambiguous` | two or more plausible objects, or an identity that is not established |
| `closed` | the venue is gone, or its object is tagged disused |
| `unreachable` | discovery could not complete — this is the retry queue |

`unreachable` is the only status the sweep does not skip, so a bad afternoon at
Overpass comes back round instead of becoming a permanent gap.

## Adding a batch of matches

This is the part that cannot be automated, and the reason the data is worth
anything. **Never attach the nearest object.** A wrong match publishes someone
else's opening hours under a real gym's name.

```bash
node tools/dev/osm-candidates.mjs --country FR --limit 6 --radius 200
node tools/dev/osm-candidates.mjs --name "boulderwelt"
node tools/dev/osm-candidates.mjs --key 48.1070|11.5457
```

### Sweeping at scale

For a whole country — or the whole map — the helper batches 40 venues into one
Overpass request, caches every response on disk, and sorts the answers into
buckets so the reading is tractable:

```bash
node tools/dev/osm-candidates.mjs --all --chunk 40 --json > /tmp/sweep.json
node tools/dev/osm-candidates.mjs --country DE --bucket MULTI --verbose
node tools/dev/osm-candidates.mjs --all --offline          # cache only, no network
```

| bucket | what it means | what it can become |
|---|---|---|
| `EXACT` | one candidate whose name is identical, nothing else shares a word | accepted, after reading the line |
| `STRONG` | one candidate whose name contains or is contained by the venue's | accepted, after reading the line |
| `MULTI` | two or more candidates with a name link | read individually; often `ambiguous` |
| `WEAK` | candidates exist, none whose name relates to the venue's | `no-object`, unless a person argues otherwise |
| `NONE` | nothing in range | `no-object` |

Buckets are about **names**, never distance. `EXACT` and `STRONG` are
*proposals*: they still have to be read, because a shared word can be a city
("Toronto Climbing Academy" against "Toronto City Sports Centre" is a soccer
pitch) and because the object is sometimes the building rather than the venue —
a university recreation centre, a municipal pool, a ski arena. `WEAK` is not a
dead end either: "INWALL Climbing Center" and "In Wall Climbing Center" share
no whole word and are one gym.

Sweep first, review after. Use `--include-curated` for a sweep you intend to
review in stages: the venue list then stays stable, so chunk boundaries — and
therefore the cache — survive the decisions you record along the way.

Re-run `--radius 600` over whatever is left as `NONE`: a venue whose upstream
coordinate is off by 300 m looks like "nothing there" at 250 m. Eight venues
were found that way, one of them 566 m from its own object.

`--recheck no-object` re-examines venues that already ended with an outcome of
that kind, which is how to give them a second chance without disturbing
anything already matched.

**The sweep asks for exactly the tags the refresh will accept**, no more. Wider
questions find objects whose hours can never be published: `--broad` asks for
any named building, shop, office or club, and it does turn up gyms — mapped as
a plain named building with no venue tag at all — but `classifyOsmTags()`
refuses those, so a match there would publish nothing. It is a last-resort look
for "is this gym mapped at all", not a source of hours. A test asserts the two
lists agree, because widening the acceptance list without widening the sweep
would leave venues undiscoverable and nobody any the wiser.

### When one venue is listed twice

The upstream dataset registers a venue once per board system, so a single hall
can arrive as two rows a few metres apart — "Steil Boulderhalle" and "Steil
Boulderhalle Karlsruhe", "VELS Boulderhalle Stuttgart" and "VELS Moonboard24".
Both rows are the same business and both may point at the same OSM object.

Identical names within 150 m need no ceremony. Anything else needs the second
row to say so:

```json
{ "status": "accepted", "duplicate_listing_of": "48.7194|9.1284", "…": "…" }
```

That is a curator asserting "I looked, and these two rows are one gym". Without
it the second row is `ambiguous`, which is the right answer for the case this
guard exists for: "Boulderbar Hauptbahnhof" and "Boulderbar Hauptbahnhof Plus"
are 60 m apart with one name inside the other, and they are two halls.

It reads the public Overpass API, which is a shared resource: keep the batches
small, leave the delays alone, and expect 429 (slot exhausted) and 504 (query
timed out) under load — both are waited out automatically. If the instance
stops answering entirely, `--endpoint https://…/api/interpreter` points it at a
mirror. None of this touches the refresh path, which reads the OSM API directly.

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
