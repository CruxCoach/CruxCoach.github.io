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

### When a page states the week twice

A site can carry its week in more than one place: the text a visitor reads, a
Squarespace business-hours setting, a schema.org `openingHours` block. **The
text is the statement.** The other two are published once from a settings
screen and then left behind, so treating them as equal claims would demote a
correct week because nobody revisited an admin form.
`node tools/venue-hours-conflict.mjs` re-reads every published source and
reports where they differ; the difference is recorded in the record's note, not
acted on. It is the one hours tool that touches the network, so it is run by
hand after a batch and is never part of `scripts/check`.

The week is withdrawn only when the text itself fails: it leaves a day
unstated, it contradicts itself, or it sits under a live notice that the hours
are changing. Crux Climbing states Monday to Saturday and never Sunday; Southern
Stone's three versions disagree beneath an announcement bar reading NEW FALL
HOURS BEGIN TUESDAY AUGUST 18TH. Both are outcomes, not records.

Markup on its own is not a schedule either. Where a site says nothing in words,
what its settings hold is not published — Island Rock Climbing Gym's week
exists only as schema.org and a Squarespace setting that agree with it, and is
recorded rather than published for that reason.

Writing the rule down meant applying it to the records that had been decided
without it. Forty-six weeks were sitting in `ambiguous` because a block
disagreed with the text, and thirty of them had a complete visible week and
nothing else wrong: Murall's three Warsaw halls, MetroRock's three, Adrenaline
Vault's two, Bloc-Hütte Augsburg, Boulderhalle Beta Hannover, Session, Volta,
Sportrock Sterling and the rest. The pattern in almost all of them is the same
— the visible week has a day that breaks the pattern and the block has lost it,
flattening a 6am Tuesday into a 10am one or a Wednesday into the weekday band.
The ones that stayed stayed for reasons the rule does not touch: two visible
blocks that disagree, a missing day, an announcement bar saying the hours
changed last week.

Running the comparison over every published week rather than a batch put a
number on how common the disagreement is: of 1,051 sources read, 66 carry a
machine-readable week that differs from the words above it, and every one of
them differs in the direction the rule predicts — the block holds a flat
weekday band and the text holds the day that breaks it. Six sources did not
answer at all, and none of them answered 404: flaesh.at and climbat.com refuse
both ports outright, betaclimb.com.co serves the page behind an expired
certificate and biwakclimbing.com behind an incomplete chain, and Northern
Rocks answered on the next attempt. A source that stops answering is not a
source that stopped being true, so none of those weeks was touched; the two
certificate failures are the operators' to fix and are worth re-reading rather
than recording.

### One hall, two registries

A gym that owns a Kilter board and a MoonBoard is registered twice, once by
each registry, and the two entries do not agree on where it is: the Kilter row
carries a street address and the MoonBoard row carries none and a rough point.
Six halls land more than a kilometre apart that way, which trips the shared-URL
check — the same page supplying hours for venues that far apart is normally a
chain page attached to the wrong branch.

Each of the six was resolved the same way: read the operator's own list of
halls and see whether a second one could be the distant twin. None could —
Awesome Walls has one Cork centre, Mountain Network one in Amsterdam, Gravity
Vault's next New Jersey gym is tens of kilometres from Upper Saddle River, the
DAV's other Munich centres are in Thalkirchen and Freimann, Eifelblock gives
both its Koblenz halls one address, and Central Rock Gym brands its second
Cambridge hall Harvard Square, 2.6 km further off than the one this entry sits
beside. The finding is written into each record's note, and the check keeps
warning, which is what it is for.

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

# Re-read every published source and report where a Squarespace or schema.org
# block on the same page states a different week. Makes network requests.
node tools/venue-hours-conflict.mjs
node tools/venue-hours-conflict.mjs 51.5074,-0.1278

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
| Venues reviewed (published + outcome entries) | 2190 |
| Published schedules | 1057 |
| Recorded outcomes without hours | 1133 |
| Countries covered | 47 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Every eligible venue has been reviewed for hours — 2190 of 2191, the one
exception being a venue at coordinates 0,0 that no resolver can place.

Outcomes without hours: 779 `no-official-site`, 145 `ambiguous`, 142
`no-hours-on-official-site`, 101 `seasonal`, 27 `appointment-only`, 22
`inaccessible`, 1 `closed`.

Per-country coverage of eligible (public/commercial) venues (top 30):

| country | published | reviewed | eligible | share |
| --- | --- | --- | --- | --- |
| US | 310 | 576 | 576 | 54% |
| DE | 139 | 201 | 201 | 69% |
| CA | 74 | 132 | 132 | 56% |
| GB | 60 | 102 | 102 | 59% |
| AU | 47 | 83 | 83 | 57% |
| NL | 39 | 59 | 59 | 66% |
| FR | 35 | 70 | 70 | 50% |
| CH | 35 | 56 | 56 | 63% |
| AT | 33 | 48 | 48 | 69% |
| ES | 29 | 98 | 98 | 30% |
| NO | 21 | 81 | 81 | 26% |
| BE | 19 | 36 | 36 | 53% |
| DK | 16 | 27 | 27 | 59% |
| IT | 15 | 72 | 72 | 21% |
| PL | 14 | 45 | 45 | 31% |
| SE | 8 | 37 | 37 | 22% |
| ZA | 7 | 12 | 12 | 58% |
| BR | 6 | 26 | 26 | 23% |
| NZ | 6 | 11 | 11 | 55% |
| CZ | 6 | 10 | 10 | 60% |
| IE | 6 | 10 | 10 | 60% |
| SG | 6 | 9 | 9 | 67% |
| FI | 5 | 15 | 15 | 33% |
| JP | 4 | 48 | 48 | 8% |
| CO | 4 | 6 | 6 | 67% |
| LU | 4 | 6 | 6 | 67% |
| RO | 3 | 13 | 13 | 23% |
| SK | 3 | 11 | 11 | 27% |
| PT | 2 | 15 | 15 | 13% |
| SI | 2 | 6 | 6 | 33% |

### The second guess run, and what it says about the tail

Running the same guess over the remaining 1,550 link-less venues — this time
taking the city from the offline place index where the dataset has none — hit
101 sites, a 6.5% rate against 26.5% for the venues that carry an address. The
drop is the tail telling you what it is made of: entries named after the board
rather than the gym, chains reduced to initials, Japanese and Chinese names our
ASCII slug rules cannot turn into a domain, university walls inside a campus site.

**Seasonal is a Nordic August problem.** Six of the 67 outcomes in this batch are
Swedish or Polish halls in a summer regime — Mono Loco, Östersunds, Norrköping,
Borås, Helsingborgs K2, FlyWall — each with the ordinary week printed right beside
the one in force. That is a fifth of everything reviewed in Sweden.

**And the guess keeps proposing the wrong Redmond.** The Jug Rock Gym's candidate
is a gym of that name in Redmond, Oregon; the entry is in Redmond, Washington. The
city check passed on the name of the town and the address caught it.

### Guessing a domain, and letting the page do the verifying

The 437 link-less venues that carry an address or a city were put through a
name-to-domain guess: strip the generic words out of the venue name, join what is
left, try the country's TLDs. **The guess proves nothing.** What decides is the
page it lands on: the venue's name has to appear on it, and so does its street or
its city, or the candidate is dropped. 116 of 437 survived that; 46 of those 116
became records and 69 became outcomes.

**The failures are the interesting half, and they are why the page-side check is
not optional.** `thecoliseum.co.uk` is the right gym. `fairfield.com` is Fairfield
Maxwell. `torontoacademy.ca` is a school. `gravita-zero.it` is a science magazine.
`winchester.com` sells ammunition. `universityofcoloradoboulder.com` and
`aspenred.com` are parked for sale. `mulhouse.fr` is a town hall, and
`momentumclimbing.com` is an American chain that has never been to Sofia. Every
one of those cleared a name-token match and was caught by the address or by a
human reading the evidence; each is logged with the candidate named, so the next
curator does not walk the same path.

**Two of the guesses were better than the data.** TOP Boulder's Kirchheim hall has
its own domain and its own week, which is not the one on the group site — the
group site's block belongs to Malmsheim. And the Beacon Climbing Centre entry
carries a positive longitude, which puts a Welsh climbing wall in the North Sea and
files it under NL; the hours are the venue's, the coordinate is upstream's problem.

**Three published records were withdrawn again.** BlocSchmiede, Boulderplanet and
Monk Amsterdam each turned out to have a second dataset entry several kilometres
from the linked one, and the operator publishes a single address. Which coordinate
is the hall cannot be settled from here, so the entry that carries the verified
link keeps its hours and the other is logged. The report's shared-source note is
what found all three.

### The first pass beyond the verified links

Every venue with a verified official website has been read. The obvious next
group is the one our own data already reaches without a search engine:

- **A twin entry a few metres away.** The dataset lists some halls twice — one
  entry per board system, or with a coordinate taken at the car park — and only
  one of the two carries the link. `co-located` is the signal for that: it says
  "the hall next door is this hall", a test checks that a venue-links record of a
  matching name really is within 150 m, and the record then reads the same page.
  Seven halls, including a CRG Cambridge and a Sportrock that had been sitting
  unlinked next to their own published records.
- **A sibling branch of a chain already curated.** Boulder Lab's Clayton and
  Ferntree Gully halls, Bouldering Project Springdale, Cultivate's Foundy Street,
  Latitude Virginia Beach, CityROCK Pretoria — each named on a chain page that
  already supplies its siblings' hours, verified by the branch name plus the city.
- **And the brand matches that are not.** thefactoryboulder.com is a Spanish
  operator, not the Pennsylvania gym; theedgerockgym.com is Jacksonville's and
  says nothing about a Miami hall; gravityhamilton.com is 60 km from the Niagara
  venue that shares its name. Those are logged as `ambiguous` with the candidate
  named, so the next curator does not re-run the same dead end.

**The most useful find in the batch was a closure.** The Gravity Vault's own
Jersey City page says the gym shut for good on 31 July 2026 — two dataset entries
that will never have hours again, and now say so.

### What Canada and Australia added

**The meridiem rule paid for itself the same day it was written.** Squamish
Athletic Club publishes "Monday: 1:00 – 7:00 … Saturday: 12:00 – 5:00" and
Gravity Hamilton "Mon: 4:00 - 11:00 … Sat: 9:00 - 9:00". Both were drafted as
published records; `timesMissingFromEvidence` refused them, because the times a
curator had "read" were not in the quote. The check is not a formality — it
caught the author of the rule breaking it.

**Fob and swipe access is the Canadian shape.** Squamish labels three of its seven
days "Fob Access Only", Climber's Rock runs the Board Room on 24-hour access with
a staffed check-in window, Bouldering Project Salt Lake prints "Members: Open 24
Hours | Public: 6am - 11pm". Where a staffed or public window is stated with real
times it is published and the wider access goes in the note; where it is not, the
venue is logged.

**Three Australian chains publish per-branch blocks properly** — 9 Degrees (seven
gyms, each with its address), Portside (four, plus a page each) and BlocHaus
(three sites, two gyms each, labelled MKV/LCT and FYS/MCL) — while Urban Climb
and The Hive render every schedule from JavaScript and reach a reader without one
as nothing at all. Adrenaline Vault has clear tables at both gyms and
schema.org's 09:00-17:00 example value underneath, which loses all three of its
records.

**Both Klimat halls separate the gym from the café in their markup**, naming the
blocks "Gym" and "Cafe", which is the cleanest facility split in the data and the
reason both are published without a second thought.

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

### What the second US batch added

**A range needs a meridiem on its opening time.** CoMo Rocks writes "M, W, F
12 - 9 PM" and "Saturday 10 - 7 PM" — the same bare digit needs PM on one row and
AM on the next, and neither is stated. The Edge Melbourne drops it from both ends.
Both are logged. The rule, so a later curator applies it the same way: **a bare
opening number is not a stated time, whatever the closing time says.**

**Some of the members-only cases are the whole week.** Estes Park ("5am - 10pm.
No reservations needed. We are a members only facility!"), Sender One's Santa Ana
Training Center ("accessible to our Youth Programs and active members only"),
Gold Crush and Flagstaff's Main Street Boulders (open hours on three or four days,
24/7 premium access on the rest) publish no public week at all, so they are logged
rather than published. That is the line: an earlier or later members' window over
a stated public week is a note; a members' regime *instead of* a public week is an
outcome.

**MetroRock disagrees with itself four times out of five.** Everett, Littleton and
Bushwick each publish a location hours page whose times its own `schema.org`
markup contradicts, and all three are logged. Essex is the one that agrees — its
`vt-hour-and-rates` page and its markup say the same thing, so it is published.
The same shape sank State Climb, Momentum Katy, Volta, Session Climbing (theme
default again) and Urbana Boulders. Sixteen of the 41 US outcomes are a site
arguing with its own markup.

**Bouldering Project publishes the two-tier week properly.** Its Salt Lake page
prints "Members: Open 24 Hours | Public: 6am - 11pm" on every row, which is the
cleanest statement of that arrangement anywhere in the data so far — no inference
needed, the public window is simply labelled.

**A second shared-source note is expected.** Two dataset entries 1.7 km apart both
resolve to Gravity Vault's Upper Saddle River page, the way the two Cambridge
entries both resolve to Central Rock's; the operator runs one gym in each case.

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

**Every source was re-fetched once, looking for the words around the hours.** All
808 published sources answered (three needed a second attempt; one, Boulder Co
Christchurch's `/your-visit/` sub-path, had 404ed and its record now points at the
location page that carries the same block). Thirty-nine pages matched a
pre-opening or closure marker and **every one of them was a false positive** — a
kids area "coming soon", a new branch in another city, an event with details to
follow, and the German word `Sonderöffnungszeiten`, which contains `eröffnung`.
Stuntwerk Duisburg remains the only real one. That is worth knowing before the
next curator writes a scanner: the marker words are common on climbing-gym sites
and mean something else almost every time.

**A later random re-read found something.** Six published records drawn at random
were re-fetched; five matched. The sixth, Stuntwerk Duisburg, prints "Eröffnung:
coming soon" directly above its "Öffnungszeiten: Montag - Sonntag 09-23 Uhr" —
the hall has not opened, and the week is an intention. It is now logged `pending`
instead of published. Nothing in the day grammar or the evidence check could have
caught that: the times were real and quoted correctly. Only re-reading the page
around them caught it, which is the argument for doing this periodically rather
than once.

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

## The second-pass gap audit

The same pass that closed the website worklist read a week off every link it
found. It also re-read the hours of every venue that had a link but no hours
decision. `node tools/venue-audit.mjs` refuses to pass while any row is
`pending`; none is.

### The shapes that decide an outcome

These recur often enough to be worth stating as rules, because each of them
looks like a schedule until it is read carefully:

- **The hours belong to something else.** Boulderstation Enschede's "by
  appointment Thursdays" was the Mad Rock shop upstairs. Kaamos Climbing's
  "Ma Suljettu, Ti–To 17–20" is headed *Asiakaspalvelu palvelee* — the
  customer-service desk — and is dated to one week; the hall itself is ticketed
  24/7. Gwada Grimpe and Gravity Budapest publish yoga and beginner-class
  timetables and no opening at all. Vertical Spirit's only times are when its
  telephone is answered.
- **The wrong branch's week.** Natural High publishes Brașov's block first and
  Bucharest's further down. AVATAR gives Balicka and Sikorki different weeks on
  one page. Bolder Climbing, Aspire, Alta, Fabrica, Bison, UBT, Project Rock
  and Beta all do the same. Taking the first block found would have been wrong
  in every one of those cases.
- **Members against the public.** Black Rock Bouldering labels Sunday "Members
  & Punch Pass Holders ONLY"; Top Out Climbing Co-op separates "Public
  climbing" from "Member access"; Vertical eXcape's Sunday is "Closed to
  General Public"; Bridges Rock Gym opens to members at 6:00am and to everyone
  else at noon. Only the public half is ever published.
- **An exception published in place of a week.** Space Bloc has only
  "HORAIRES EXCEPTIONNELS" for summer Saturdays; K2 Žilina dates its schedule
  "Leto 30.06. - 01.09. 2026"; Ovčín heads its "leto 2026"; Portland Rock Gym
  Beaverton and The Notch state only Summer Hours. All are `seasonal`.
- **Markup that disagrees with the page.** Beta Bouldering's text says weekdays
  from 7am and its own markup says 10am. Up The Bloc carries two blocks that
  differ on every day. Active Climbing Augusta's header and footer disagree on
  Monday and Friday. All are `ambiguous` — with one exception worth naming:
  Bison Boulders' markup is a single site-wide business record whose address is
  Tobaksbyen's and whose hours are Kødbyen's, so it contradicts Tobaksbyen and
  says nothing about Kødbyen.
- **Markup as the only source.** Approach Climbing, Dino Moves and Island Rock
  publish a week in structured data and nowhere in words. Markup is supporting
  evidence and never the sole source, so those are
  `no-hours-on-official-site`.

### One matcher change

`evidenceMentionsTime` could not read a range that carries one meridiem for
both ends. "Public climbing Wednesday & Friday: 2–8 pm" is a whole afternoon,
and the cross-check called 14:00 unsupported. The opening time may now borrow
the closing marker, but only when the pair does not cross noon: in "10–2 pm"
the 10 is still morning, and a claim of 10 p.m. against that text is still
rejected. Tests cover all three readings.
