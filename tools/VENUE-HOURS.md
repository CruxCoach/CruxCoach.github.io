# Curated venue opening hours

`tools/venue-hours.json` attaches a manually verified **weekly opening schedule**
to a venue on the Board Map, read from that venue's own official website. This
file is the decision note for that overlay: what it is, why it is shaped this
way, how a schedule is verified, and what is deliberately left out.

## Why this exists, and why the last attempt was withdrawn

The map used to carry opening hours derived from OpenStreetMap. They were
removed in `f670da0` because they were materially inaccurate: OSM's
`opening_hours` tag is contributed by passers-by, is not the venue speaking, and
goes stale invisibly. Nothing in this overlay is restored from, reused from or
derived from that dataset or its code — it is a different claim with a different
source of truth.

That history sets the standard here. **Wrong hours are worse than no hours.** A
wrong website link wastes a click; a wrong schedule sends somebody across a city
to a locked door. Every rule below follows from that one asymmetry, and it is why
this overlay publishes far less than it looks at.

## Verification standard

A record may only be created after a human has **opened the venue's own official
page** and matched **at least two independent signals** against the venue in the
dataset.

- The required source is the venue's official website, an official
  location-specific or operator page, or an official booking/access page the
  venue itself controls. Search results, Google or Apple listings,
  OpenStreetMap, social profiles, directories, reviews and aggregators are
  **discovery hints only** and may never supply the published hours. Nothing
  from a search-results page enters this file.
- Signals must be genuinely independent. `name` and `brand` are one observation
  and count once; the schema enforces that. The venue's already-verified
  `tools/venue-links.json` record is itself a legitimate signal (`venue-link`) —
  it is the record of a human having established that this domain is this
  venue's — but it is one signal, never two.
- A **location-specific page beats a chain-wide page**. Where a chain has no
  per-location page, `official-chain-page` is allowed only when the page states
  which locations the hours apply to. That is the `hours-scope` signal, and the
  schema refuses an `official-chain-page` record without it. One operator's
  generic hours are never spread across its branches.
- Only **regular public access hours** are recorded. Course timetables,
  members-only slots, appointment-only access, school-holiday schedules and
  seasonal variations are not simplified into a weekly grid — they are an
  outcome in `tools/venue-hours-research.json` instead.
- Email addresses, phone numbers, prices, personal data and anything behind a
  login are never copied. The schedule and the URL it came from are the only
  things this file takes from a page, plus a short quote of the schedule as
  evidence, which stays internal.

### Fail closed

Publishing nothing is always an available answer, and it is the right one more
often than not. A record is **not** created when:

- the page's schedule contradicts itself, or two official pages disagree;
- the schedule is rendered by script or sits behind a booking widget the fetch
  cannot read;
- the page states fewer than seven days — a missing day is missing, and the
  schema will not let it be inferred, filled in or quietly treated as closed;
- the page publishes a season-dependent week — two regimes with dates
  (`Sommer 01.07.–30.09.` / `Winter 01.10.–30.06.`), or a schedule headed
  "outside the holidays" with a holiday one beside it. A single grid would be
  wrong for part of every year and this overlay has no way to expire one. Single
  dated exceptions — 24 December, New Year's Day, one Easter closure — are a
  different thing, and are what the on-page caveat is for;
- it is unclear which branch of a multi-site operator the page describes;
- only a search snippet is visible and the page itself cannot be opened;
- the venue is a private or home setup — those get no hours at all, enforced in
  code by `classifyVenue()`.

Every one of those has a status in the outcome log, so "no hours" never has to
be re-derived from scratch.

**The visible page and the page's own markup both count.** A site whose text
says one thing and whose `schema.org` `openingHours` says another is publishing
two schedules, and nothing in this file's rules can rank one over the other —
so it is `ambiguous`, not "the one that looks right". The German batches turned
this up repeatedly, most often as an untouched theme default (`Monday,…,Sunday
09:00-17:00`, which is schema.org's own example value) sitting under a perfectly
clear visible timetable. It is tempting to call that an artifact and move on.
The reason not to is that the judgement does not survive being written down: a
machine consumer of that site really is told 09:00–17:00, and "obviously a
placeholder" is a curator's intuition, not a rule a later curator could apply
the same way. The count of venues lost this way is in the ledger, because if it
ever gets large the answer is to talk to operators, not to loosen the rule.

## Record shape

```json
{
  "lat": 48.1234, "lon": 11.5678,
  "name": "Boulderwelt München Ost",
  "country": "DE",
  "source": "https://www.boulderwelt-muenchen-ost.de/oeffnungszeiten/",
  "checked": "2026-08-23",
  "provenance": "official-location-page",
  "signals": ["venue-link", "street-address"],
  "hours": {
    "mon": "09:00-23:00", "tue": "09:00-23:00", "wed": "09:00-23:00",
    "thu": "09:00-23:00", "fri": "09:00-23:00", "sat": "10:00-22:00",
    "sun": "closed"
  },
  "evidence": "Mo–Fr 09:00–23:00 · Sa 10:00–22:00 · So geschlossen",
  "note": "free-form, humans only — the build ignores this field"
}
```

| field | meaning |
| --- | --- |
| `lat` / `lon` | the venue's coordinates, as in `boards.geojson` |
| `name` | the venue name — a match anchor and a sanity check |
| `country` | ISO-3166-1 alpha-2; guards the proximity rematch |
| `source` | canonical HTTPS URL of the exact page the schedule was read from |
| `checked` | UTC date the page was last opened, `YYYY-MM-DD` — **internal** |
| `provenance` | `official-location-page` \| `official-site` \| `official-chain-page` \| `official-booking-page` |
| `signals` | ≥ 2 independent matches from `name`, `brand`, `street-address`, `postal-code`, `city`, `location-page`, `coordinates`, `board-mention`, `venue-link`, `hours-scope` |
| `hours` | all seven days, `mon`…`sun` |
| `evidence` | the schedule quoted as the page states it — **internal**, ≤ 600 chars |
| `note` | optional, ignored by the build |

### The day grammar

A day is `closed`, or one or more `HH:MM-HH:MM` ranges separated by commas, and
it must be stored exactly as `canonicalDaySpec()` would write it.

```
"mon": "09:00-23:00"                 a plain day
"tue": "09:00-12:00,15:00-22:00"     a split day, both halves preserved
"wed": "00:00-24:00"                 round-the-clock access
"thu": "20:00-25:00"                 open until 01:00 the next morning
"fri": "closed"                      the page says closed
```

The grammar refuses everything that could make a schedule silently wrong: a
zero-length range (`10:00-10:00` — is that closed or all day?), ranges that
overlap or merely touch (that is one range someone cut in half), ranges out of
order, an end before its start, and anything past `28:00`. A day left out is not
an empty day; it is a missing one, and the record is refused.

**Monday first**, everywhere: in the curated file, in the public array, and in
both renderers. The sources are overwhelmingly European and print the week that
way.

## What reaches the public, and what never does

`toPublicHours()` is the only door between a curated record and the dataset the
site serves, and exactly two things go through it:

```json
"hours": ["09:00-23:00","09:00-23:00","09:00-23:00","09:00-23:00","09:00-23:00","10:00-22:00",""],
"hours_src": "https://www.boulderwelt-muenchen-ost.de/oeffnungszeiten/"
```

Seven strings, Monday first, `""` for a day the venue states as closed — chosen
over the word `closed` because it is the smallest thing that can carry that
meaning in a file the map downloads, while the curated file a human edits keeps
the unmissable word.

`checked`, `evidence`, `signals` and `provenance` are **curation metadata and are
never published**. They are not written to `boards.geojson`, not rendered into
either directory, not put in the map popup, and not summarized into anything a
browser fetches. The user requirement is explicit: the internal check date never
appears on a page. Three tests hold that line — one on the projection itself, one
on the two renderers, and one that greps every published artifact for each
record's own `checked` date and the first 24 characters of its `evidence` quote.

`boards.meta.json` gets counts only: how many records applied, how many were
refused and why, how many venues per provenance class. No names, no URLs, no
dates.

## Where the hours appear

- **`boards/data/boards.geojson`** — the two properties above, on venues that
  have them. A venue without curated hours carries neither, so the file does not
  grow for the 60% of the map that has nothing to say.
- **The map popup** (`boards/map.js`) — the week as runs of identical days
  ("Mon–Fri 09:00–23:00"), under a heading, with the caveat sentence and a link
  to the source page. It re-validates both properties before rendering.
- **The static directories** (`boards/list.html`, `de/boards/list.html`) — the
  same week on one line beneath the venue, so a crawler that does not run
  JavaScript can read it. `render-static.mjs` re-validates through
  `safePublicHours()` first.

Both renderers re-check rather than trusting the geojson, for the same reason the
website links do: a renderer that trusts its input is one bad merge away from
printing nonsense on 2,800 lines, and these are the last places that can say no.

### How it is labelled

Every surface says the hours come from the venue and that they can change:

> *As published by the venue; public holidays and short-notice changes may
> differ.*

Nothing claims the hours are live, and **nothing computes whether a venue is open
right now**. The data has no timezone, no holiday calendar and no notion of a
one-off closure, so an "open now" badge would be a guess wearing the clothes of a
fact. The visitor gets what the venue published and a link to check it.

### Why the directory links the source only sometimes

In the popup the source is always linked. In the directories it is linked only
when the hours came from a page *other* than the venue's official website — which
is already a link on the same line, and is then the source. That page's weight
scales with coverage (`boards/list.html` grew 406 KB → 592 KB when links landed),
and a second identical link on every venue line is exactly the kind of duplication
that turns a useful directory into a slow one.

## Matching, and how it fails closed

Identical to `tools/venue-links.json`, and deliberately the same code:
`resolveVenueRecord()` in `tools/venue-links.mjs` is shared by both overlays, so
neither can drift into being laxer than the other.

1. **Exact** — `venueKey()` at 4 decimals (~11 m).
2. **Proximity rematch** — within 250 m, same country, name similarity ≥ 0.5,
   and exactly one candidate. Zero is `unmatched`, more than one is `ambiguous`.

Beyond that, hours are dropped when the record fails schema validation, when the
venue classifies as `private`, and when two records resolve onto the same venue
(**both** go — nothing in the data says which one is wrong). One source page used
by venues more than a kilometre apart raises an advisory: that is either two of an
operator's gyms, in which case the provenance must be `official-chain-page` with a
`hours-scope` signal, or a drifted upstream coordinate. Only a curator can tell
those apart.

## The outcome log

`tools/venue-hours-research.json` records every reviewed venue that got **no**
hours, so that "no hours" is never indistinguishable from "nobody has looked".
Nothing in it reaches `boards.geojson`, the map or the directories.

| status | meaning |
| --- | --- |
| `private` | home wall — never carries hours |
| `closed` | the venue is permanently closed |
| `no-official-site` | no official site to read a schedule from |
| `no-hours-on-official-site` | the official site publishes no schedule |
| `ambiguous` | contradictory, partial, or the branch cannot be identified |
| `seasonal` | hours vary by season or term, with no stated regular week |
| `appointment-only` | access by booking, membership or arrangement only |
| `inaccessible` | the page could not be read (403, TLS failure, script-only) |
| `pending` | reviewed, undecided, deliberately queued |

`inaccessible` in particular is a fact about one moment, not about a venue. Like
the venue-links research log, it is worth re-reading periodically; the same sweep
that recovered ten venues for the links file would work here.

## Commands

```bash
# Validate the curated file against the committed venue data. Exits non-zero on
# anything the build would refuse — run this before committing a batch.
node tools/venue-hours-report.mjs
node tools/venue-hours-report.mjs --json
node tools/venue-hours-report.mjs --show          # print every published schedule

# Worklist for the next batch: venues with a verified official website but no
# hours and no recorded outcome. --unlinked shows the ones needing a site first.
node tools/venue-hours-report.mjs --todo DE,AT,CH --limit 40
node tools/venue-hours-report.mjs --todo IT --limit 40 --unlinked

# Apply the overlay to the committed dataset and re-render both directories,
# without pulling a new upstream dataset into the same commit.
node tools/build-boards-data.mjs --overlays-only
```

### How a batch is done

1. **Take a country or an operator, not a scattering of venues.** Hours are
   published per operator far more consistently than per venue, and a batch that
   follows one operator's site reads one page layout instead of thirty.
2. **Start from `tools/venue-links.json`.** The 1,001 verified links are 1,001
   domains a human has already established as the venue's own, which removes the
   hardest half of the identity problem before it starts.
3. **Fetch the official page and its plausible schedule subpages**, and read the
   text. The fetching harness lives outside the repo, exactly as the Wellpass
   matcher and the venue-links discovery runs do: only the verified result is
   committed, never the scrape.
4. **Read the schedule off the page and write it down by hand**, then quote what
   was read into `evidence`. The quote is not decoration — it is what makes an
   accepted record auditable, and writing it is what forces the page to have been
   read rather than pattern-matched.
5. **Everything else goes to the outcome log** with a status and a reason.

## Other hours-adjacent fields: evaluated, not implemented

**Open-now state.** The single most requested thing and the single most dangerous.
It needs a timezone, a holiday calendar and a notion of one-off closures, none of
which this data has. See above.

**Holiday and seasonal calendars.** Real, and genuinely useful in DACH, where
Christmas and Easter schedules are published weeks ahead. Held back because they
expire: a field that is correct in December and wrong in January needs an
expiry-and-withdraw policy this overlay does not have yet. The generic caveat
covers the visitor in the meantime.

**Course and members-only timetables.** Per board, not per venue, and rarely a
stable URL. It would mean transcribing prose, which is a copyright question and a
staleness question at once.

**Board-specific access windows** ("the Kilter room is bookable 07:00–09:00").
The useful version of this is exactly the question most map visitors have, and
almost nobody publishes it in a form that could be verified. Not worth a field
until there is a source that is actually a schedule.

## Progress ledger

Totals come from `node tools/venue-hours-report.mjs`; the narrative rows are
maintained by hand as batches land.

| metric | count |
| --- | --- |
| Venues reviewed (published + outcome entries) | 40 |
| Published schedules | 31 |
| Recorded outcomes without hours | 9 |
| Countries covered | 1 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Per-country coverage of eligible (public/commercial) venues:

| country | published | reviewed | eligible | share |
| --- | --- | --- | --- | --- |
| DE | 31 | 40 | 201 | 15% |

- **Last completed batch:** Germany, the first 40 venues of the worklist that
  already carry a verified official website. 31 published, 9 logged: 5
  `ambiguous`, 3 `seasonal`, 1 `inaccessible`.
- **Next batch:** the rest of Germany's linked venues, then Austria and
  Switzerland.

### What the first German batch taught

Three of the nine refusals are the seasonal rule doing its job — Kraftwerk
Lüneburg publishes a summer and a winter regime, Kletterarena a summer schedule
with no end date, and Hold On Tide a week explicitly headed "outside the
holidays". None of those is a week that stays true, and all three would have
looked perfectly publishable to a curator reading only the times.

Three more are the markup conflict described above (Bloc-Hütte Augsburg,
Boulderhalle Beta Hannover, BAMBULE). BAMBULE is the one that shows why the rule
is worth its cost: its visible row reads "Samstag/Sonntag 09:00 – 21:00/21:30",
two closing times for one day, *and* its markup disagrees with both.

The remaining shapes are worth naming because they recur:

- **One operator, two halls, one schedule page.** Mandala Dresden runs
  Zeitenströmung and Postplatz and publishes a single Preise & Öffnungszeiten
  page that never says which hall it describes. That is exactly the case the
  chain-page rule exists for, and the answer is no hours rather than a coin flip.
- **A schedule that is really an availability.** DAV Teisendorf states
  Mo–So 07:00–22:00 and then removes most of it: reservation is compulsory
  during school hours, club training closes it at unlisted times, and the whole
  hall shuts when the Turnhalle does in the holidays.
- **Facility hours versus venue hours.** Bergstation Hilden's table has three
  columns — Halle, Kursbüro, Shop — and only the first is public access;
  Sportpark Kelkheim opens at 9 but its climbing hall at 10; Boulderlabor lists
  the hall, then the café, then route-setting days. Reading the first row of a
  table without reading its heading is how a plausible wrong answer gets in.
