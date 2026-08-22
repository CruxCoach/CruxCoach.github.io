# OpenStreetMap opening-hours ledger

The running record of which venues on the board map have been matched to an
OpenStreetMap object, which have deliberately not been, and what is still open.
Update it in the same commit as `tools/osm-venues.json`; the counts below come
from that file and from `boards/data/osm-opening-hours.json`.

Regenerate the numbers with:

```bash
node tools/refresh-osm-hours.mjs --offline   # no network; re-renders the sidecar
jq '.stats' boards/data/osm-opening-hours.json
jq 'group_by(.status) | map({status: .[0].status, n: length})' tools/osm-venues.json
```

## Status — 2026-08-22

**Every venue on the map has exactly one outcome.** 2,830 of 2,830.

| Outcome | Venues | |
|---|---:|---|
| **accepted** — bound to one exact OSM object | **1,175** | of which 772 carry opening hours |
| **private** — home or garage setup, never enriched | **640** | |
| **no-object** — documented checks found nothing that IS this venue | **984** | |
| **ambiguous** — two plausible objects, or identity not established | **31** | |
| **closed** | 0 | |
| **unreachable** — retry queue | **0** | the sweep completed everywhere |

Of the 1,175 accepted matches:

| | |
|---|---:|
| Carrying `opening_hours` | **772** |
| — rendered as a weekly schedule | **733** |
| — shown as the unmodified OSM value | **39** |
| No hours tagged in OpenStreetMap yet | **401** |
| Object retagged since curation (hours withheld) | **2** |
| Object gone, or unreachable at the last refresh | 0 / 0 |
| Matched by `manual-exact-name` (sweep proposal, then read) | 890 |
| Matched by `manual` (investigated individually) | 285 |
| Second listing of a venue already matched | 51 |
| Carrying `check_date:opening_hours` | 29 |

Last OpenStreetMap read: **2026-08-22**. Countries with at least one matched
venue: **57**. Countries where hours are displayed: **44** — US 180, DE 139,
CA 47, FR 40, NL 40, ES 34, GB 34, BE 28, AT 26, AU 26, CH 26, PL 18, NO 16,
DK 14, and thirty more.

### The 39 values shown raw rather than rendered

Not failures — the fallback doing its job. Each shows the unchanged OSM value
and a link to the object.

| Reason | Count | What it looks like |
|---|---:|---|
| `unsupported-selector` | 26 | `SH 10:00-22:00`, `Aug 10:00-21:00`, `PH Mo-Fr 09:00-23:00` — school holidays, months, holiday × weekday |
| `comment-or-fallback` | 6 | `… "Variiert an Feiertagen"` — free text changes what the rule means |
| `unsupported-time` | 3 | extended times past `24:00`, or an ambiguous `00:00-00:00` |
| `too-long` | 2 | a seasonal timetable rather than a weekly schedule |
| `unsupported-rule` | 2 | sunrise/sunset, open-ended `18:00+` |

### What the 31 ambiguities are

- **Two OSM objects for one venue with different hours** (El Roko, Beyond The
  Wall Climbing). OpenStreetMap contradicts itself; neither value can be
  preferred. Fixable upstream by merging the duplicate.
- **Two listings of one venue too far apart to link** (Block'Out Vitrolles
  239 m, Gravity Vault Jersey City 190 m, BoulderWorld Belfast 220 m, Hangar
  Ostrava 250 m, Gravetat Zero 260 m, Flashpoint Bristol 390 m, Sender One SNA
  400 m, S'Avanzada 222 m, VietClimb 177 m). One of the two coordinates is
  wrong upstream.
- **A second brand on the same site** (The Boardroom at Climber's Rock,
  Boulderbar Hauptbahnhof Plus, AVATAR Sikorki, Rock & Board at Rock & Wall).
- **Identity resting on an inference this file may not make** — a rename
  (Movement Harlem against "The Cliffs at Harlem"), an abbreviation (ULI
  against "Upper Limits Rock Climbing Gym"), or nothing but a town name (K7
  Västerås, Skarpa Bytom, Mountain Network Amsterdam).

### The two objects whose hours are withheld

`The School Room` (node/11888595333) and `Boulderkeskus Kino`
(node/7947586930) both carry `access=private` in OpenStreetMap. The match
stands — those objects *are* those venues — but `classifyOsmTags()` refuses
them and the refresh publishes no hours. This is the fail-closed path working
on real data, found on the first full refresh.

## Limitations

- **984 venues have no OSM object.** Two thirds of them have nothing at all
  within 600 m; the rest have only a Decathlon, a yoga studio, or the leisure
  centre that houses the wall. The fix is upstream: map the gym in
  OpenStreetMap and the next refresh picks it up.
- **401 matched venues have no hours tagged.** Nothing to do in this
  repository either — tag them in OpenStreetMap.
- **No "open now", anywhere.** The site shows the weekly pattern OSM records
  and says so. Deciding whether a venue is open at this moment needs the
  venue's timezone, the local public-holiday calendar, school-holiday terms,
  seasonal rules and one-off closures to all be right; they are not.
- **The renderer covers a bounded subset** (weekday selectors, time ranges,
  `off`/`closed`, `PH`, `24/7`, the `,` rule separator). Everything else falls
  back to the raw value. See the header of `tools/opening-hours.mjs`.
- **Freshness is OSM's, not ours.** Only 29 of 772 carry
  `check_date:opening_hours`, so most blocks read "last edited on …", which is
  a weaker statement and deliberately worded as one.
- **A name match is not proof.** The sweep proposes on names and a person
  approves, but a gym that renamed itself, or an object that shares only a town
  name, is refused rather than guessed at. That is why 31 venues sit in
  `ambiguous` with an object visible a few metres away.
- **Venue identity is a rounded coordinate** (`tools/venue-key.mjs`, ~11 m). If
  upstream moves a venue further than that, its decision stops resolving; the
  refresh reports it.
- **Home and garage setups are never enriched**, by three independent rules:
  the curator asserts `"venue": "public"`, `venueLooksPrivate()` refuses a home
  signal with no commercial one, and the OSM object must still carry a public
  sports-venue tag at refresh time.

## Next batch

1. **Re-sweep when upstream adds venues.** The refresh prints how many venues
   have no outcome; `node tools/dev/osm-candidates.mjs --all` picks up exactly
   those, because settled venues are skipped.
2. **Re-check the 401 matched venues with no hours**, and the 984 with no
   object, a few months from now. Both change through other people's edits, and
   both are already bound to a venue, so a re-sweep is cheap.
3. **Work the ambiguities upstream.** Nine of the 31 are one venue listed twice
   at coordinates 180–400 m apart; four are one venue mapped twice in OSM. Both
   are worth fixing where they are wrong rather than worked around here.
4. Consider whether `PH <weekday>` intersections are worth rendering — the
   commonest single refusal reason with an unambiguous meaning. Month selectors
   are not: rendering one would mean picking a season to show.

## How to add a batch

See `tools/dev/RUNBOOK-osm-opening-hours.md`, "Sweeping at scale". Short
version: sweep, read the proposals, append accepted **and** non-accepted
outcomes to `tools/osm-venues.json`, run `node tools/refresh-osm-hours.mjs
--force`, then `node tools/build-boards-data.mjs --static-only`, then
`scripts/check`, then update the counts above.
