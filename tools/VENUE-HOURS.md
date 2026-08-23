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
| Venues reviewed (published + outcome entries) | 767 |
| Published schedules | 530 |
| Recorded outcomes without hours | 237 |
| Countries covered | 20 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Per-country coverage of eligible (public/commercial) venues:

| country | published | reviewed | eligible | share |
| --- | --- | --- | --- | --- |
| DE | 132 | 169 | 201 | 66% |
| US | 120 | 140 | 576 | 21% |
| GB | 52 | 70 | 102 | 51% |
| NL | 37 | 51 | 59 | 63% |
| CH | 35 | 52 | 56 | 62% |
| AT | 31 | 44 | 48 | 65% |
| FR | 25 | 46 | 70 | 36% |
| BE | 19 | 28 | 36 | 53% |
| ES | 16 | 49 | 98 | 16% |
| NO | 15 | 35 | 81 | 19% |
| DK | 10 | 14 | 27 | 37% |
| IT | 9 | 21 | 72 | 12% |
| PL | 7 | 12 | 45 | 16% |
| FI | 5 | 8 | 15 | 33% |
| IE | 5 | 5 | 10 | 50% |
| SE | 4 | 11 | 37 | 11% |
| ZA | 3 | 3 | 12 | 25% |
| CZ | 2 | 4 | 10 | 20% |
| LU | 2 | 3 | 6 | 33% |
| PT | 1 | 2 | 15 | 7% |

- **Last completed batch:** the first 140 linked United States venues — 120
  published, 20 logged. Every linked venue in Europe was reviewed before it.
- **Next batch:** the remaining 136 linked US venues, then Canada (64) and
  Australia (33).

### What the first US batch taught

**Two-tier access is the American shape of the problem.** Where Europe hid its
hours behind seasons, the US hides them behind membership: Crux South Austin,
Rocknasium, Climb Iowa, MetroROCK, Coeur, Synergy, Adventure Rock, Armadillo,
Momentum, Climb Bentonville and The Edge all publish one week for the public and
an earlier or later one for members. That is not a contradiction and it is not a
reason to refuse — it is the same case as Greifbar's badge system, and it gets
the same answer: **publish the public week, put the members' window in the note.**
Crux South Austin is the sharpest version, because the headline says 6AM–11PM and
the FAQ says no walk-in, guest pass or punch pass holder may enter before 11AM.
Publishing 6AM there would send a visitor to a locked door at dawn, which is
exactly the failure the OSM hours were withdrawn for.

**The meridiem gets shortened away.** `10A-11P`, `4p-8p`, `mon-fri 6a-10p` —
three sites in one batch, so `evidenceMentionsTime` now accepts a bare `a`/`p`
with a lookahead that stops it swallowing "9 pages". The Edge Melbourne drops the
letter entirely (`Monday 2-9 | Tuesday 11-9`) and is logged `ambiguous`: every one
of those times would have to be guessed, and the guess is not written down
anywhere on the page.

**Chain sites here list every branch on one page, with its address.** Armadillo,
Adventure Rock, Cultivate, Rockreation, Grotto, Vital and The Circuit all publish
address-plus-hours per location, which is what `official-chain-page` and the
`hours-scope` signal exist for — and what lets Adventure Rock's three-tab table
resolve to Walker's Point (613 S 2nd St) rather than to whichever block the text
extractor happened to flatten first.

**Movement contradicts itself twice.** Its location pages carry a compact hours
widget and, further down, an FAQ sentence that repeats the week in prose. At
Hampden and Boulder the two disagree (6am against 9am; 10:30pm against 11pm and a
different Sunday), so both are logged rather than guessed — while the other
fourteen Movement gyms in this batch agree with themselves and are published.

**Spire is the branch-identity case in its purest form.** The operator runs a Main
Facility and a Training Center with completely different weeks, and the two
dataset entries are named "Spire Climbing + Fitness Training Center" and "Spire
Climbing Center Training Facility". One of them carries the main facility's street
address. Nothing in the data disambiguates them, and the training centre's own
page says its hours fluctuate, so both are logged.

**One warning is left standing on purpose.** Two dataset entries a kilometre apart
are both "Central Rock Gym Cambridge" with the same verified link, and Central
Rock runs one Cambridge gym; the report's shared-source note fires on the sloppy
coordinate, not on a real second branch. It joins Eifelblock, Awesome Walls Cork
and Mountain Network Amsterdam in that category.

### What Europe taught

**Seasonal is the biggest single reason a gym gets no hours** — 60 of the 217
outcomes, and it is the same shape in every language: `Schulferien`, `BUITEN DE
VAKANTIE PERIODES`, `Zomervakantie`, `Term-time hours (from September)`, `horaire
d'été`, `Horario agosto`, `ORARI ESTIVI`, `Sommeråpningstid`, `Sommar stängt
vecka 28-31`, `Åpningstider 1. Mai - 15. August`. The most expensive single case
was Beest Boulders: all seven halls publish nothing but a block headed
`Zomerperiode juli & augustus`, and six of them look like ordinary weekly tables
until you read the heading two lines above.

Not every seasonal note costs a record. Where the season is a *dated window that
has ended* and the regular week is published beside it — Førde, Sørlandet, Studio
Vertikal, Orobia, Kletterakademie Mitterdorf — the regular week is what is
recorded and the note says the window existed. The line is whether the page still
leaves you two answers for the same Tuesday.

**Contradictions come in three shapes**, all caught by opening a second page of
the same site — the cheapest quality step there is. Markup against text is the
most common, and Norway and Poland produced its purest form: five Høyt Under
Taket halls and three Muralls all carry the schema.org placeholder
`09:00-17:00, all seven days` under a perfectly clear visible timetable. Page
against page is next: Bergen Klatresenter publishes two `apningstider` pages that
swap Monday and Tuesday between the two halls, and Buldreterminalen swaps Tuesday
and Wednesday between its homepage and its directions page. And notice against
table, where DAV Landshut's timetable says Friday 14:00 and a notice on the same
page says it moved to 10:00 in April.

**A stated week is not always an opening.** DAV Erlangen publishes Mo–So
07:00–23:00 for an unstaffed hall you cannot enter without a key; Quergang is
public on Tuesday evenings and subscriber-only otherwise; Boulderkeskus Kino is
Premium-card-only; The Adventure Hub opens to the public on a Friday and a
Saturday afternoon.

**Two access regimes, one answer.** Where a venue publishes staffed hours *and* a
wider card, badge or booking window, the record takes the staffed ones — the ones
that need nothing but turning up — and says so in a note. Where the venue
publishes only the wide window (Die Knäpperei's 0–24, Bloc Spot Murtal, Randa,
Luma in Bath), that is the schedule, and the note says how entry works.

**Facility hours versus venue hours.** Bergstation Hilden's table has three
columns; Flashpoint Bristol publishes the wall and the café as two tables; Delfts
Bleau's second column is when the building closes; Coque Luxembourg publishes four
weeks and none of them is labelled as the climbing wall's, which is why it is
logged rather than guessed.

**Markup is a witness, not a source.** Where a site publishes `openingHours` and
nothing a reader can see, the record is refused. Where markup and text agree it
goes in the note, because it is the cheapest confirmation available and it settles
ambiguous table layouts.

**Chain pages that do the right thing** are what made the good countries fast, and
they are not rare: Newton, Minimum, City Bouldering, Boulders (eleven Danish halls
with an address and an `Åbningstider` row each), Boulderkeskus, Klatreverket,
CityROCK, De Fabriek, Boulderhal Sterk. That is what `official-chain-page` plus
the `hours-scope` signal is for, and the schema enforces it: the Konala record was
refused until it carried something tying the page to that specific hall.

**A sample re-read found nothing wrong.** Eight published records spread evenly
through the file — Boulderbar Hauptbahnhof Plus, ELYS Boulderloft, Bouldergarten,
EnergieWände Weimar, Boulders Aarhus Syd, Bloc Bristol, New MACACO, Klatreverket
Løren — were fetched again and compared against their sources day by day. All
eight matched. That is not proof the file is clean, but it is the check worth
repeating whenever a batch introduces a new shape of source.

**The evidence cross-check keeps finding notation, not errors.** Every failure so
far has been the matcher's, not the data's: `22h30` in Switzerland, `9u30` in
Flanders, `10pm` in Britain, `08H30` in France. Each one taught it a spelling, and
the direction that matters still fails — `10pm` does not cover 22:30.
