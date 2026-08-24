# Curated venue website links

`tools/venue-links.json` attaches one manually verified **official website** to a
venue on the Board Map. This file is the decision note for that overlay: what it
is, why it is shaped this way, how a link is verified, and what was deliberately
left out.

## Why a separate curated file

The map already has two hand-curated overlays — `tools/overrides.json` (fix a
wrong upstream field) and `tools/wellpass.json` (a boolean the upstream does not
have). Website links are a third thing again, and they get their own file rather
than riding on `overrides.json` for two reasons:

- **Overrides are per board, links are per venue.** `overrides.json` matches
  `(board, lat, lon)` and writes onto a per-board object. A gym with a Kilter
  Board and a MoonBoard would need two identical URL entries there, and the two
  could drift apart. A venue has one website; the record says so once.
- **A link carries evidence, a field correction does not.** Every record here
  states the date it was checked, what kind of page it is, and which independent
  signals matched. That is not a `set: {}` blob — it is a claim with provenance,
  and it deserves a schema that refuses to store the claim without the evidence.

`tools/venue-links-research.json` is the other half: every venue that was looked
at and did **not** get a link, with a status and a reason. It is not production
data — nothing in it reaches `boards.geojson`, the map, or the directories — and
its purpose is that "no link" stops being indistinguishable from "nobody has
looked yet".

## Verification standard

A record may only be created after a human has **opened the candidate page** and
matched **at least two independent signals** against the venue in the dataset.

- A URL is never inferred from a venue name, a domain that looks right, or a
  search-result snippet. Search results and OpenStreetMap `website` /
  `contact:website` tags are **discovery candidates only** — they say where to
  look, never what to record. Nothing from a search-engine results page and no
  Google Places data enters the dataset.
- Signals must be genuinely independent. `name` and `brand` are the same
  observation and count once; the schema enforces that.
- A **location-specific official page beats a chain homepage**. Where a chain has
  no per-location page, `official-chain-page` is allowed, but only if the page
  itself names the location — the schema requires `street-address`, `city` or
  `location-page` among the signals in that case.
- URLs are canonicalized to HTTPS, with tracking parameters and fragments
  removed. A site that serves no HTTPS is logged as `http-only` and gets no link.
- Email addresses, phone numbers, opening hours, reviews, personal data and
  anything behind a login are never copied. Only the URL is recorded.
- Upstream names and descriptions are untrusted input throughout — they are
  escaped at every render boundary and never used as the sole match signal.

### Private venues are never linked

Roughly a fifth of the dataset is home walls. `classifyVenue()` in
`tools/venue-links.mjs` sorts every venue into `commercial`, `private` or
`unknown` from upstream fields alone, and `applyVenueLinks()` **refuses** a link
on anything classified `private` — a code-level guarantee, not a habit. Attaching
a "website" to somebody's garage would be wrong for the visitor and an unwanted
spotlight on a private address.

`unknown` venues (chiefly Tension/Grasshopper/Decoy entries that carry nothing
but an owner username) may be linked, but only because the verification standard
requires opening the official page first — which is precisely what establishes
that a venue is open to the public. It is never licence to guess.

## Record shape

```json
{
  "lat": 48.1234, "lon": 11.5678,
  "name": "Boulderwelt München Ost",
  "country": "DE",
  "website": "https://www.boulderwelt-muenchen-ost.de/",
  "verified": "2026-08-22",
  "provenance": "official-site",
  "signals": ["name", "street-address"],
  "note": "free-form, humans only — the build ignores this field"
}
```

| field | meaning |
| --- | --- |
| `lat` / `lon` | the venue's coordinates, as in `boards.geojson` |
| `name` | the venue name — a match anchor and a sanity check, not decoration |
| `country` | ISO-3166-1 alpha-2; guards the proximity rematch |
| `website` | canonical HTTPS URL, stored exactly as it will be served |
| `verified` | UTC date the page was last opened and checked, `YYYY-MM-DD` |
| `provenance` | `official-location-page` \| `official-site` \| `official-chain-page` |
| `signals` | ≥ 2 independent matches from `name`, `brand`, `street-address`, `postal-code`, `city`, `location-page`, `coordinates`, `board-mention` |
| `note` | optional, ignored by the build |

Research records use `status` (`ambiguous`, `closed`, `private`, `duplicate`,
`unavailable`, `unverified`, `no-website`, `social-only`, `http-only`),
`checked`, `reason`, and an optional untrusted `candidate` string.

## Matching, and how it fails closed

Coordinates drift: upstream re-derives them, and a venue can move across the
street. Matching therefore has two stages and refuses whenever the answer is not
unique.

1. **Exact** — `venueKey()` at 4 decimals (~11 m), the same key the build groups
   venues by.
2. **Proximity rematch** — if no exact hit, look for venues within
   `MATCH_RADIUS_M` (250 m) that are in the same country *and* whose name is
   similar. Exactly one match is accepted and logged; zero is `unmatched`; more
   than one is `ambiguous`.

Every one of these drops the link and logs a line rather than guessing:

- the venue at that coordinate is now a different gym (name similarity below 0.5)
- the record's country disagrees with the venue's
- the venue classifies as `private`
- two records resolve onto the same venue — **both** are dropped, because nothing
  in the data says which one is wrong
- the record fails schema or URL validation

Name comparison is a Jaccard overlap of normalized tokens with legal-form
stopwords removed, so `Boulderwelt München Ost` still matches
`Boulderwelt München Ost GmbH` and `Boulderwelt Munchen Ost`, but not
`Boulderwelt München West`.

## Where the links appear

- **`boards/data/boards.geojson`** — only `website` on the venue feature.
  Verification dates, provenance and signals stay in the curated file and are
  not shipped to the map; they are review metadata, not visitor-facing data.
- **The map popup** (`boards/map.js`) — label and host name in both languages.
  `safeSiteUrl()` re-validates the URL before building an href; the internal
  verification date is deliberately not rendered.
- **The static directories** (`boards/list.html`, `de/boards/list.html`) — so
  crawlers that do not run JavaScript can see them. `render-static.mjs`
  re-validates through `isCanonicalVenueUrl()` before rendering.

Both renderers re-check rather than trusting the geojson. A renderer that trusts
its input is one bad merge away from writing somebody else's href into 2,800
directory entries, and these are the last places that can still say no.

Links are ordinary editorial links — `target="_blank" rel="noopener"
referrerpolicy="origin"`, no `nofollow`. `referrerpolicy="origin"` means an
operator learns only that the visit came from `https://cruxcoach.org`, never
which venue page was open. Both privacy pages disclose this.

**What this costs the directory page.** Each rendered link is about 180 bytes of
markup, so a fully linked directory is materially heavier than an unlinked one:
`boards/list.html` went from 406 KB to 592 KB uncompressed, 53 KB to 69 KB
gzipped. That is the page whose entire purpose is to put this data where a
non-JS crawler can read it, so the weight is the feature — but it scales with
coverage, and if it ever needs capping the answer is to split the directory by
country, not to drop the links.

## Commands

```bash
# Validate the curated file against the committed venue data. Exits non-zero on
# anything the build would refuse — run this before committing a batch.
node tools/venue-links-report.mjs
node tools/venue-links-report.mjs --json

# Worklist for the next batch: public/commercial venues with neither a link nor
# a research entry.
node tools/venue-links-report.mjs --todo DE,AT,CH --limit 40 --with-address

# Apply the overlay to the committed dataset and re-render both directories,
# without pulling a new upstream dataset into the same commit.
node tools/build-boards-data.mjs --overlays-only
```

### How a batch is done

1. **Discover candidates.** OpenStreetMap objects tagged `sport=climbing` /
   `sport=bouldering` that carry a `website` or `contact:website` tag are pulled
   in bulk and matched to venues by proximity and name. This proposes a URL and
   nothing else — the tag is a pointer, not evidence.
2. **Open the page.** Every candidate is fetched and read: the gym name, the
   street address and town it publishes, and whether it names the board system
   the venue is listed for.
3. **Match two independent signals** against the venue's own record (upstream
   street address for Kilter venues, city, board type, name).
4. **Cross-check the geography where the strings do not settle it.** When a
   venue carries no upstream address, the address printed on the *official page*
   is geocoded once (OSM Nominatim, rate-limited, identifying User-Agent) and
   compared to the venue's coordinate. A hit inside ~300 m establishes that the
   address on that page is this venue's address, which is what `street-address`
   records. The geocoder's output is never stored — only the accept/reject
   decision it supports.
5. **Everything else goes to the research log** with a status and a reason.

Steps 1 and 4 both talk to third-party services and both live **outside** this
repo, exactly as the Wellpass matcher does: only the verified result is
committed, never the scrape.

`--overlays-only` reads the existing `boards/data/boards.geojson`, re-applies the
venue-level overlays (Wellpass and links) and re-renders — no network, no npm, no
upstream refresh, and `generated_at` is left alone because the upstream data it
describes did not change. The full nightly build applies exactly the same
overlays through the same function, so the shortcut cannot diverge from it.

## Other link classes: evaluated, not implemented

The obvious next fields were considered and are deliberately absent. None is
blocked on effort — each is blocked on a verification policy that does not exist
yet, and adding a speculative field now would mean a schema promising evidence
nobody defined.

**Booking / timetable.** High product value: "can I get on the board tonight" is
the actual question behind most map visits. But booking URLs are the least stable
thing a gym publishes — they point at third-party platforms that get replaced,
and a stale booking link fails *silently and expensively* (a visitor turns up).
It would need a freshness policy (re-verify on a fixed interval, expire rather
than persist) that the website field does not need, because a wrong homepage is
merely useless while a wrong booking link is actively misleading.

**Official social profile.** Cheap to verify — the profile usually links back to
the official site, giving a clean two-way signal — and genuinely the *only* web
presence for a good number of small gyms, which currently land in the research
log as `social-only`. Held back because the map would then send visitors to
tracking-heavy platforms from a site whose entire premise is that it does not,
and because "official" is much harder to establish for a profile than for a
domain. If added, it belongs behind its own field with its own disclosure, never
folded into `website` — which is why the URL policy rejects social hosts outright
rather than quietly accepting them.

**Accessibility / board instructions.** The useful version of this is per-board,
not per-venue (angle schedule, whether the board is bookable separately, whether
a day pass covers it), and almost no operator publishes it as a stable URL. It
would mostly become prose transcribed from a page — which is a copyright question
and a staleness question at once. Not worth a field until there is a source that
is actually a link.

**Correction / source page.** Different in kind: this is about *our* data, not
the venue's. A "something wrong here?" affordance would raise the quality of
every other field, and it needs no per-venue curation at all — one link to the
repository's issue tracker, pre-filled with the venue, would do. This is the one
of the four worth building next, and it is a UI change rather than a data schema.

## Progress ledger

Totals are produced by `node tools/venue-links-report.mjs`; the narrative rows
are maintained by hand as batches land.

| metric | count |
| --- | --- |
| Venues reviewed (linked + research entries) | 2190 |
| Verified website links | 1510 |
| Rejected / ambiguous / private / closed / unavailable | 680 |
| Countries covered | 56 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Every eligible venue that lacked a link has been opened individually and
carries an outcome — see **The second-pass gap audit** and **The retry pass**
below for what the outcomes mean and which of them stay in the queue.

Per-country coverage of eligible (public/commercial) venues (top 25):

| country | linked | eligible | share |
| --- | --- | --- | --- |
| US | 398 | 576 | 69% |
| DE | 180 | 201 | 90% |
| CA | 108 | 132 | 82% |
| GB | 78 | 102 | 76% |
| ES | 70 | 98 | 71% |
| AU | 68 | 83 | 82% |
| FR | 61 | 70 | 87% |
| NO | 58 | 81 | 72% |
| NL | 52 | 59 | 88% |
| CH | 52 | 56 | 93% |
| AT | 45 | 48 | 94% |
| IT | 43 | 72 | 60% |
| BE | 30 | 36 | 83% |
| SE | 29 | 37 | 78% |
| PL | 25 | 45 | 56% |
| DK | 25 | 27 | 93% |
| FI | 10 | 15 | 67% |
| BR | 8 | 26 | 31% |
| PT | 8 | 15 | 53% |
| RO | 7 | 13 | 54% |
| ZA | 7 | 12 | 58% |
| NZ | 7 | 11 | 64% |
| SK | 7 | 11 | 64% |
| CZ | 7 | 10 | 70% |
| SG | 7 | 9 | 78% |

Research-log reasons: 730 `unverified`, 2 `ambiguous`, 1 `closed`, 1
`social-only`, 1 `unavailable`. `unverified` is deliberately the large bucket:
it is retryable, and it is what a venue gets when a page could not be opened, a
site renders only in a browser, or the only candidate that answered belongs to
somebody else.

- **Last completed batch:** the retry pass over the whole queue (below).
- **Next batch:** the 730 `unverified` rows, and what would move them is set
  out at the end of this file.

### What is actually gating the remaining countries

Not verification effort, and — since this session found two more channels — no
longer discovery alone either. There are now four ways to find a venue's official
page, and which ones are available is what decides how fast a country goes:

1. **The operator's own location index.** Fastest by far, and the reason the
   United States, Canada, Australia and the Nordics moved in single passes. Only
   works where climbing is concentrated in named multi-site operators.
2. **OSM/Overpass `around:400` per venue.** The original channel, and still the
   only one that finds independents nobody could have guessed — it produced every
   Spanish link in this file. The public endpoints return 429/502/504 to
   sustained use, so a run is measured in hours, and the yield varies wildly by
   country: Spain gave 18 candidates and 18 links; Italy gave none at all.
3. **Domains derived from the venue's own name**, then fetched and compared
   against the address upstream records. Cheap, and it opened the American long
   tail. Its hit rate only means anything *after* the comparison — see below.
4. **Web search.** Exhausted early in this session, and not much missed: it was
   only ever the fallback for regions with thin OSM coverage.

What is still unlinked splits into three groups. Venues whose operator has no
website at all, or only a social page — nothing to link, and the log says so.
Venues whose site exists but cannot be read: a 403, a country-blocker, a
client-side renderer that serves an empty document to a fetch. And venues in
countries none of the four channels reach, most obviously Japan, Korea and China,
where the name yields no domain and OSM's coverage of climbing gyms is thin.

### The operator index, and why the US went quickly

The United States needed no discovery run at all. Its 576 eligible venues are
unusually concentrated: six operators account for 94 of them, and each publishes
a location index with a per-location page and a printed street address. The whole
pass was therefore read straight off the operators' own sites.

Two habits made that safe rather than fast-and-loose:

- **Open every location page, not just the index.** All 30 Movement pages and all
  21 Central Rock pages were fetched and their printed address checked. The index
  is a claim about the pages; only the page is the page.
- **Tie the address to the coordinate, not to the name.** Where upstream carries
  an address the two strings are compared directly. Where it does not — Tension
  and MoonBoard entries almost never do — the address is geocoded once and
  measured against the venue, or the venue's own coordinate is reverse-geocoded
  and its street, city and ZIP compared. Both directions are needed: Utah's grid
  addresses (`220 W 10600 S`) defeat a forward lookup, and Central Rock Kennesaw's
  forward lookup lands 3 km from the gym while the reverse lookup lands on the
  gym's own street number.

It also produced the session's cleanest fail-closed case. Sportrock runs two
Alexandria buildings 31 m apart, each with its own location page, and the
operator's board listings contradict the upstream ones — `/alexandria` advertises
a MoonBoard while `/srpi` advertises a Kilter room, the opposite of what upstream
records. The named Kilter entry is at 5308 Eisenhower Ave by both upstream and a
reverse lookup, so it is linked; the unnamed MoonBoard entry between the two
buildings cannot be assigned to one page and is logged `ambiguous` instead.

### Why the index is never the evidence

The second US pass produced the clearest example yet of why every location page
gets opened. Crux Climbing Center's own location index lists Central Austin at
220 Ralph Ablanedo Dr — but that is the South Austin hall's address. The Central
page prints 6015 Dillard Circle Unit B, and upstream agrees. Trusting the index
would have pointed two venues at each other's page, with a matching street
address to make it look verified.

The same pass turned up three more shapes worth recording:

- **A hall the operator no longer has.** Gravity Vault's Jersey City page is
  still served, and still says "permanently closed"; Jersey City is gone from the
  location list. Two upstream venues sit there. They are logged `closed`, not
  linked to a page that disowns them.
- **Upstream coordinates that contradict upstream addresses.** Both Montclair and
  Crux South have two entries for one gym, and in both cases the entry that
  *carries* the street address is the one whose coordinate is ~750 m from it. The
  unnamed sibling is the accurate one. Neither is dropped; the note says which is
  which.
- **Sites that refuse to be read at all.** Touchstone answers 403 to everything,
  and First Ascent runs a country-blocker plugin that does the same. Nine venues
  between them are logged `unverified` rather than linked on the strength of a
  domain name that looks right.

### Re-checking what was logged as unreachable

Roughly half the research log is venues whose operator site would not answer
when it was first tried — 403, 429, 500, an expired certificate, a TLS handshake
that failed. Those are not permanent facts about a venue, they are facts about
one moment, so the log is worth re-reading periodically.

A sweep of the 39 distinct candidate URLs logged for that reason found nine that
now answer, and all nine verified: Spinnerei Indoor, Flashpoint Bristol, Cardiff
and Swansea, Rainbow Rocket North, Boulderhal Sendmast, Cube Bouldergym and Pink
Peaks. `tools/venue-links.mjs` keeps the two files mutually exclusive, so moving
a venue across means withdrawing its research entry first.

One re-check went the other way and improved a reason rather than a status:
Indoorwall Jaca was logged because the site was down, but the site is up now and
its location list names nine centres, none of them in Jaca. The entry stays, with
a reason that says what is actually true.

### One URL, two venues

The build has always noted when two venues share a URL, because upstream routinely
splits one gym into a Kilter entry and a MoonBoard entry a few metres apart and
both should point at the same page. What it did not notice is the other reason a
URL gets shared: the operator has two gyms and one page covering both. That is
not a data error, but it does mean the record's provenance should say
`official-chain-page` rather than claiming a single location.

`applyVenueLinks` now measures how far apart the venues sharing a URL actually
are. Past `SHARED_URL_SITE_LIMIT_M` (1 km — comfortably beyond the 250 m the
proximity rematch allows), it adds a second note naming the records that still
claim a single location.

It is deliberately an advisory and not a build failure, because the distance
alone cannot tell the two cases apart: Awesome Walls Cork, Central Rock Cambridge
and Gravity Vault Upper Saddle River each have two upstream entries kilometres
apart that really are one gym with a drifted coordinate. Only a curator can say
which is which — the note tells them where to look. It found one real error on
introduction: Newton Boulderhalle Graz, whose site covers the Kapfenberg hall
42 km away and which was filed as an `official-site`.

### Guessing a domain is fine; believing it is not

The American long tail has no operator index to read and no usable Overpass
coverage, so this pass proposed candidate domains from each venue's own name —
`agilityboulders.com`, `comorocks.com`, `blockerboulders.com` — and probed them.
132 of 167 answered. That number is the trap: a domain that answers proves
nothing, and the ones that answer include `climb.com`, `boulders.com`,
`beaches.com` and `class.com`.

So every candidate that answered was fetched and its text checked against four
things upstream records separately — the house number, the road name, the ZIP
and the city — and only the components that actually matched were claimed as
signals. Sixty-five passed with at least two. The rest are still open, not
linked on the strength of a plausible domain.

Even that was not quite enough on its own. Hand-checking a sample of what passed
caught three the automated comparison could not:

- **Climb Lawrence** and **projectROCK Easley** have closed. Both sites still
  resolve; one shows a "We Are Closed" notice, the other redirects to a page on
  the operator's main domain saying the same. Both are logged `closed`.
- **Woodward PA** is Camp Woodward's own site, and the coordinate really is at
  its Sports Camp Drive address — but the site prints no street line and never
  mentions climbing, so only the name and the town matched. Logged.

A fourth was a provenance error rather than a wrong link: Upper Limits runs three
gyms and lists all three by address, so its record is an `official-chain-page`,
not an `official-site`.

Running the same pipeline over Europe made the point again, and harder. Thirty-four
candidates passed the address comparison; hand-checking rejected five of them:

- **holbaek.dk** is Holbæk Kommune's municipal site. Its postcode and town matched
  the climbing club's because the municipality shares them.
- **worldclimbing.com** is the international federation formerly known as the
  IFSC, not the Madrid gym called World Climbing.
- **klatreverket.no** lists four Oslo centres and none in Kristiansand, 320 km
  away, where upstream has a venue of that name.
- **klatreklubben.no** offers no HTTPS at all.
- **ambassaden.no** gives exactly the Henrik Ibsens gate 48 address upstream
  carries — and is an event venue and restaurant collective that never mentions
  training or climbing.

The comparison is doing real work: it rejected 68 of the 102 European candidates
outright. But four matching address components are evidence that *a* building
matches, not that the site belongs to the gym, and only reading the page tells
those apart.

### When upstream gives no address at all

Roughly two-thirds of what is still unlinked has no upstream address to compare
against — Tension and MoonBoard entries almost never carry one. For those the
comparison runs the other way: read the address the operator's page prints,
geocode it once, and measure the result against the venue's coordinate. Same
evidence, opposite direction, and it is the method that was already being used by
hand for individual venues.

Automating it exposed a pitfall worth writing down. A first pass reported *no
address found* on 121 of 122 American pages, which was obviously wrong. The
regex was finding the postcode correctly and then taking the 70 characters before
it — which on a gym homepage is opening hours and navigation:

```
' | 10am - 9pm Sat - Sunday  | 10am - 6pm 1404 38th Ave Capitola, CA 95010'
```

Nominatim geocodes none of that. A street line starts at a house number, so
rewinding from the postcode to the last digit-led token and cutting there yields
`1404 38th Ave Capitola, CA 95010`, and the pass went from one match to fifteen.
The lesson is not about regexes: an automated check that rejects everything looks
exactly like an automated check that is working, and the only way to tell is to
know what the answer should roughly be before running it.

The distance still has to be read by a human. Four American venues came back
`FAR` with a truncated address, and opening those pages recovered full addresses
for all four — three of which then matched, while Aiguille's own address turned
out to sit 3.5 km from its upstream coordinate, on the other side of Longwood.

### Where the yield actually stopped

The address-less pass is worth recording as a negative result as much as a
positive one. Over the United States it turned 127 candidate sites into 19 links.
Over Europe, Canada and Australia it turned 162 into 6.

The difference is not the method, it is what the candidate domains were. American
gyms are overwhelmingly `<name>climbing.com`, so a name-derived guess lands on the
gym often enough to be worth checking. Elsewhere the guess lands on a municipality
(`holbaek.dk`), a grain trader (`granit.fr`), a city portal (`nottingham.co.uk`),
a charity (`suas.ie`) or nothing at all — and 147 of the 162 European pages
printed no address the fetch could see, either because the domain was not the
gym's or because the page renders client-side.

So the four channels are now genuinely exhausted for the venues that remain, and
the honest read of the ledger is that the next 200 links cost far more per link
than the last 500 did. What would change that, roughly in order of value:

1. **A rendering fetch.** A large minority of the "no address" pages are real gym
   sites that serve an empty document to curl. Anything that executes the page
   would convert them.
2. **Overpass coverage where it is thin.** Italy returned no candidates at all,
   and Japan, Korea and China have never had a run. A patient, low-rate crawl
   over months rather than hours would do better than this session managed.
3. **Reading the remaining research log again.** A third of it is sites that were
   down, blocked or misconfigured on the day. That set only shrinks by being
   re-read, which is cheap — a second sweep this session recovered ten venues,
   the last of them Sunderland Wall.

   Read those reasons carefully rather than at face value. Five of the entries
   blamed on a 403 or 429 came back with the same status from several unrelated
   hosts in the same moment, which points at a limit on the fetching side rather
   than anything about the operator. Those reasons now say so, because "the site
   refuses us" and "we were being throttled" call for very different next steps.

## The second-pass gap audit

Every eligible venue without a verified link — 1,190 of them across 79
countries — was opened again, one at a time, and every previous negative
outcome was treated as a hypothesis rather than a fact. The worklist was frozen
in `tools/venue-audit-ledger.json` before the pass started so the denominator
could not drift, and `node tools/venue-audit.mjs` refuses to pass while any row
on it is still `pending`.

It exists because the first pass missed `https://zugzwang-auerbach.de/`. It had
tried `https://www.zugzwang-auerbach.de/`, seen a certificate that does not
cover the www hostname, and stopped — while the HTTPS apex works and matches
the hall's name, its street in Auerbach and its Kilter Board. Every host is now
probed at the apex *and* at www independently, and a failure on one is never
allowed to reject the other. That rule found the reverse case three times:
`treelab.com.br`, `delirescalade.com` and `altrock.ca` fail at the apex and
answer at www.

### What the pass changed about how candidates are found

- **The whole venue name as one domain label.** The guesser drops generic words
  before it builds a domain, so "Climb Nashville" never became
  climbnashville.com and "Duluth Climbing and Fitness" never became its own
  name. Sweeping the full name in `.com` and the country's TLD found 214 hosts
  that answer.
- **A map the venue embeds of itself.** A page with a Google Maps embed has
  published its own coordinates, first-party, with no geocoder contacted. That
  is what places The Core Climbing Gym at 0 m, Guelph Grotto at 1 m, Atelier
  Bloc at 20 m and a few dozen others, and what tells Bolder Climbing's two
  Calgary halls apart — 184 m against 10.4 km.
- **National federation club directories.** Klatring Danmark publishes its
  member clubs with each club's own site at `klatringdanmark.dk/klubliste`.
  Nine of Denmark's eleven links came from it, including Holbæk, whose domain
  is `hkk4300.dk` after the town's postal code and which no name-derived guess
  would ever have reached.
- **A plain-browser User-Agent on 403/429.** Hostinger and LiteSpeed hosts
  refuse the audit's UA and serve a browser's.

### Where it still fails, and why those rows stay open

851 venues are recorded `unverified`, which is retryable by design. The
recurring shapes, in rough order of frequency:

1. **Upstream carries no address.** With no street, no postal code and often a
   town-level coordinate, a candidate cannot be tested against a location even
   when it is obviously the right business. This is the single largest cause.
2. **The site renders in the browser.** A few hundred characters of navigation
   and nothing else. Shaker Rocks, Dallas Bouldering Project and Climb World
   are all real gyms whose own domains serve no readable content.
3. **An anti-bot interstitial.** Maniak's three Belgian halls, Boulderhaus's
   five German ones, Touchstone and Kletterzentrum Innsbruck all answer 403
   behind Cloudflare to every header set tried.
4. **A generic word in the venue's name.** "Apex", "Gravity", "Planet", "West",
   "City" and "University of" all match a gym on another continent. A
   foreign-ccTLD guard now flags those before they can be accepted.

### Three dataset bugs the audit surfaced

Worth reporting upstream rather than working around:

- **Beacon Climbing Centre** is filed at 53.1406,**4.2518** — the North Sea off
  Texel — and classified as Dutch, with the address Zone 5, Cibyn Estate, LL55
  2BD, Caernarfon. Caernarfon is at 53.1406,**-4.2518**: the longitude sign.
- **Up The Bloc** is filed at **-79.5856,43.6045** and classified as Antarctic.
  Those are the Mississauga gym's latitude and longitude the wrong way round.
- **Fitbloc** sits at 0,0 with no country, which no resolver can place; it is
  recorded in the ledger's `unresolvable` bucket with a note on each field.

### The one link this audit accepted and then withdrew

`poweruptandangsora.com` prints Power Up Tandang Sora's address and looks like
the gym's own domain. It is "Patikim · Philippine Venue Guide", a third-party
visit guide that describes itself as "An independent field guide" and tells
readers to "Treat the official channel as the final source". Every one of the
336 links the audit accepted was then re-read against that pattern, and this
was the only one.

## The retry pass

The gap audit closed the worklist by recording an outcome for every venue; most
of those outcomes were `unverified`, which is retryable by design. This pass
re-opened all 914 of them and found 121 links the first pass had missed. What
follows is the channels it added, because each one is reusable.

### Reading a page that renders in the browser

A site that renders client-side still ships its content somewhere a fetcher can
reach, through routes the platform documents for itself: Squarespace answers
any page as JSON on `?format=json-pretty`, WordPress answers `/wp-json/wp/v2/…`,
a Wix page embeds a `wix-warmup-data` blob, Next.js embeds `__NEXT_DATA__`, and
JSON-LD sits in the document. None of this goes round a block; they are the
site's own published routes, and `deep.mjs` reads all five.

That is what recovered Ethos Climbing's whole week, DÉLIRE's four branches with
an address and a schedule each, ARC Sudbury's seven different days behind a
"Today's Hours" widget, and leTruss's 定休日 なし.

### Asking Overpass per venue instead of per country

The country-wide query returns zero elements for the United States, and did for
Germany, France, Canada, Mexico and Russia too — a query that times out
silently rather than a country with no climbing in it. Asking instead for what
sits within 400 m of each venue that still needs a link, twenty venues per
request, returns them. Twenty-three American venues came out of that alone.

### Three name-derived channels the guesser does not reach

- **The whole venue name as one domain label**, in `.com` and the country's
  TLD. The guesser drops generic words first, so it never tries
  climbnashville.com or 2bfitbouldergym.hu.
- **The venue's own social handle**, which upstream records for 128 of the open
  venues and which is very often the domain with the dots put back.
  climbgravitybear.com, climbvertex.com and tamarockscr.com all came from it,
  each replacing a candidate on another continent or a domain broker.
- **The name OSM gives the object**, where OSM names the hall but tags no
  website. That is how airclimbing.it was found.

### Operator siblings, and federation directories

A venue still in the queue is often a branch of an operator already linked
somewhere else; matching on the distinctive part of the name within the same
country proposes that operator's site, which then has to print this branch's
own address. Svenska Klätterförbundet's member directory did for Sweden what
Klatring Danmark's did for Denmark.

### Where the line is, and what it costs

OSM is a pointer, never the evidence, and the wide name sweep made the cost of
that rule much more visible. Asking OSM for every climbing object within 5 km
and matching on the name turns up thirty-nine open venues with an object
carrying a website tag, most of them within a hundred metres. Fifteen of them
became links, because the page at the end confirmed something. Eleven did not,
and each one is the same shape: an OSM object with the venue's exact name a few
metres away, tagged with a domain, and a page that yields the name and nothing
else.

RockHaus is mapped 7 m from its venue and its own page gives an address 1.2 km
away in another municipality. KIVI is mapped 77 m away and its page yields only
the name. Kingston Bouldering Co-op is mapped 2 m away and shares only its name
and the town inside that name. Basecamp Toronto publishes two halls and no
address for either. Gropo publishes a week and never an address. Santa Fe
Climbing Center prints "3008 Cielo Court | Santa Fe, NM" and upstream records
no street to match it against, so the only thing shared is the town that is
already in the venue's name.

The rule earns this. The Boardroom Wimbledon had a candidate with the venue's
exact name, in the venue's exact trade, and 300 km away in North Wales. A name
plus a pointer is one observation twice.

The same discipline caught the pass's one false positive before it was written.
The automated read reported name, street 33 and Medellín on elmuro.co; the page
does not contain "Calle 33" at all, and the site is the Colombian local-news
network the first pass had already identified.

### Reading the venue's own page from a snapshot

Some sites answer 403 to everything. Boulderhaus, Maniak, Touchstone, First
Ascent, Kletterzentrum Innsbruck and CRANK are all the right domain refusing to
be read, which is a different failure from a wrong domain and deserves a
different answer.

A dated snapshot of that same page is still the venue's own words, so it is
allowed to settle **whose domain this is** — and nothing else. It is never used
for hours, because a schedule is exactly the kind of thing that changes between
the snapshot and today; every hall linked this way keeps its `inaccessible`
hours record. Each note gives the snapshot's date so a reader can weigh it.

That yielded five links out of 458 venues tried — the three Maniak halls (each
on its own subdomain, Charleroi's printing "…Bruxelles, 6020 Dampremy"), Das Ki
in Innsbruck ("Matthias-Schmid-Straße 12c, 6020 Innsbruck", upstream's address
to the letter) and CRANK in Macgregor. It is a narrow channel: only 27 of the
458 had a readable snapshot at all, because most of those candidates were the
wrong company's site and an archive of the wrong company is still wrong.

It is also a channel with a courtesy limit. Asking the archive for 458 venues
across eight paths each earns a 429, and the sweep was stopped when it arrived;
21 venues were being read at that moment and are recorded as not yet retried
rather than as failures.

### Two sweeps that found nothing, written down so nobody repeats them

A guessing channel is worth recording when it fails, because the cost of
re-running it is the same as the cost of running it.

**.org and .net over every open venue** — 4,512 guesses, 145 resolving hosts,
two links: Urban Boulder in Vitoria-Gasteiz and The Pump Factory in Iloilo. The
rest are what a generic word gets you: canrock.net is a Japanese company,
mandurah.net is a web agency, topout.org is a guide to climbing around
Calabogie, Ontario.

**The newer TLDs** — .co, .club, .fit, .fitness, .studio, .site, .online,
.space, .life, .io, .app, .me and .shop, over the venue's whole name, its first
two words and its first word. 16,042 candidate hosts, 2,283 of them resolving,
3,128 venue-and-candidate pairs read, and **not one new link**. Every hit is a
one-word domain that belongs to somebody else — urban.co, campus.app,
academy.shop, power.studio. The single high score is elmuro.co, which is the
Colombian local-news network the first pass had already rejected and which
scores only because "33" appears somewhere on it.

The lesson both times is the same: a guess is worth making when the string
being guessed is distinctive. Chains and full venue names are; the first word
of a two-word name is not.

### Some of them are not places

A handful of registry rows do not record a venue at all; they record a city.
The Stronghold's MoonBoard is filed at 34.0522,-118.2437, which is the standard
point for Los Angeles rather than either of the two halls the operator runs
there. R2C2 Gym sits on Las Vegas's, VOLNY on Tokyo's, Block Dock on
Bratislava's, Illyria's Board on Sydney's.

That is worth naming because it explains a whole shape of failure. No page can
ever confirm one of these by an address or a map, since there is nothing at the
point to confirm; the coordinate rules out the two signals that would otherwise
be easiest to get. Checking a candidate's map against them would also have been
actively misleading — a gym genuinely near the city centre would have scored a
match. Each of the affected records now says which city its point is.

### What the remaining 730 actually are

The `wrong-owner` bucket was tested rather than assumed. For every open venue
that has both an upstream address and a candidate, the candidate's pages were
read and every street-looking line extracted and compared. Not one matched, and
most candidates print no street at all — one Shanghai gym's candidate prints
Google's own address at 1600 Amphitheatre Parkway. These are not formatting
misses; they are different businesses.

What would move the rest, in rough order of value:

1. **A rendering fetch.** The platform routes cover Squarespace, Wix,
   WordPress and Next.js; they do not cover a hand-rolled single-page app, and
   22 hours rows and a long tail of links are still behind one.
2. **An address for the venues that have none.** 113 of the 178 open American
   venues have no upstream street, and most are MoonBoard-registry entries —
   a board inside a gym rather than a venue. Without a street there is often no
   second signal to be had, however obvious the operator is.
3. **A way past an anti-bot interstitial that is not a way round it.**
   Boulderhaus's five halls, Maniak's three, Touchstone and Kletterzentrum
   Innsbruck answer 403 to every header set and are not otherwise reachable.
