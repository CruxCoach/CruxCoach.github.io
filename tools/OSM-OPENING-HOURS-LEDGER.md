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

| | |
|---|---|
| Venues reviewed | **53** of 2,830 on the map |
| Accepted (exact OSM object, verified by hand) | **46** |
| Rejected (documented, never enriched) | **7** |
| Accepted matches carrying `opening_hours` | **35** |
| — rendered as a weekly schedule | **32** |
| — shown as the unmodified OSM value | **3** |
| Accepted matches with no hours tagged in OSM yet | **11** |
| Objects gone / retagged / unreachable at the last refresh | 0 / 0 / 0 |
| Last OpenStreetMap read | **2026-08-22T12:02Z** |

Countries with at least one matched venue (7): DE 19, CH 6, GB 6, AT 5, US 4,
CZ 3, NL 3. Of those, hours are displayed in six: DE 18, AT 5, GB 4, CH 3,
US 3, NL 2 — the three Czech venues are matched but nobody has tagged their
hours in OSM yet.

### The three values shown raw rather than rendered

They are not failures; they are the fallback doing its job. Each one shows the
unchanged OSM value plus a link to the object.

| Venue | Why | Value |
|---|---|---|
| Blöckle (Ravensburg) | `comment-or-fallback` | `… PH 10:00-20:30 "Variiert an Feiertagen"` — a free-text comment changes what the rule means |
| Bloc Climbing Centre (Bristol) | `unsupported-selector` | `… SH 10:00-22:00` — school-holiday terms are not knowable from the tag |
| Berta Block (Berlin) | `unsupported-selector` | `PH Mo-Fr 09:00-23:00; PH Sa-Su 10:00-22:00` — a public-holiday × weekday intersection |

### The seven rejections

Every one is a recorded decision, so the same venue is not re-examined from
scratch next batch. Reasons in full are in `tools/osm-venues.json`.

| Venue | Reason |
|---|---|
| Alpenverein Wien | No climbing object within 200 m |
| Bloc Spot Murtal | No OSM object of any kind within 200 m |
| Boulderbar Hauptbahnhof Plus (Wien) | Ambiguous — the only nearby object carries the neighbouring venue's name and is matched there |
| ALI Dixon Climbing Center (Corvallis) | Only the university recreation building, not tagged for climbing; its hours are the building's |
| Agility Boulders (Capitola) | No climbing object within 250 m |
| Beacon Climbing Centre (the NL duplicate) | Upstream coordinate has a flipped longitude sign; the real venue is already matched under its GB coordinate |
| Jungle Sport Park (Praha-Letňany) | Ambiguous — two climbing objects describe the same site, only one has hours |

## Limitations

- **Coverage is deliberately thin.** 46 of 2,830 venues. Every row costs a
  person's attention, and that is the point: the alternative — attaching the
  nearest climbing object automatically — publishes a neighbour's hours under a
  real gym's name, which is worse than publishing nothing.
- **No "open now", anywhere.** The site shows the weekly pattern OSM records
  and says so. Deciding whether a venue is open at this moment needs the
  venue's timezone, the local public-holiday calendar, school-holiday terms,
  seasonal rules and one-off closures to all be right; they are not.
- **The renderer covers a bounded subset** (weekday selectors, time ranges,
  `off`/`closed`, `PH`, `24/7`). Months, week numbers, `SH`, sunrise/sunset,
  nth-weekday, open-ended times, comments and `||` fallbacks fall back to the
  raw value. See the header of `tools/opening-hours.mjs`.
- **Freshness is OSM's, not ours.** `check_date:opening_hours` is a mapper
  saying they stood in front of the place; without it the page shows the
  object's last edit date instead, and says which of the two it is showing.
  Only one venue in the current set (Big Depot Manchester) carries a check date.
- **Venue identity is a rounded coordinate** (`tools/venue-key.mjs`, ~11 m). If
  upstream moves a venue by more than that, its curated match stops resolving;
  the refresh reports it as `unmatched_venue` rather than guessing.
- **Home and garage setups are never enriched**, by three independent rules:
  the curator has to assert `"venue": "public"`, `venueLooksPrivate()` refuses
  anything with a home signal and no commercial signal, and the OSM object
  itself has to still carry a public sports-venue tag at refresh time.

## Next batch

In rough order of value per unit of attention:

1. **Finish the large German and Austrian chains** — Boulderwelt Regensburg,
   München Ost/West, the remaining DAV centres. Same operator, same tagging
   conventions, high hit rate.
2. **France, Spain, Italy, Poland, the Nordics.** No venue in any of these is
   curated yet, and the search stopped only because Overpass rate-limited the
   run. `node tools/dev/osm-candidates.mjs --country FR --limit 6` picks up
   where it left off; already-decided venues are skipped automatically.
3. **Re-visit the 11 accepted venues with no hours tagged.** Nothing to do in
   this repository — if the hours matter, tag them in OpenStreetMap and the
   next refresh picks them up on its own. That is the intended direction of
   travel: the fix belongs upstream.
4. **UK and US chains** (Awesome Walls, Big Depot, Touchstone): several sites
   per operator, and the objects are usually already tagged.
5. Consider whether `PH <weekday>` intersections are worth supporting in the
   renderer — it is the only refusal reason that showed up more than once and
   it has an unambiguous meaning. Two of the three raw values would render.

## How to add a batch

See `tools/dev/RUNBOOK-osm-opening-hours.md`. Short version: run the candidate
helper, decide each venue by hand, append accepted **and** rejected entries to
`tools/osm-venues.json`, run `node tools/refresh-osm-hours.mjs --force`, then
`node tools/build-boards-data.mjs --static-only`, then `scripts/check`, then
update the counts above.
