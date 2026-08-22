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

- **`boards/data/boards.geojson`** — `website` and `website_checked` on the venue
  feature. Nothing else about the record is published; provenance and signals
  stay in the curated file, which is the reviewable record.
- **The map popup** (`boards/map.js`) — label, host name, and the check date, in
  both languages. `safeSiteUrl()` re-validates the URL before building an href.
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
| Venues reviewed (linked + research entries) | 1075 |
| Verified website links | 965 |
| Rejected / ambiguous / private / closed | 110 |
| Countries covered | 22 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Per-country coverage of eligible (public/commercial) venues:

| country | linked | eligible | share |
| --- | --- | --- | --- |
| US | 257 | 576 | 45% |
| DE | 163 | 201 | 81% |
| GB | 69 | 102 | 68% |
| CA | 58 | 132 | 44% |
| CH | 52 | 56 | 93% |
| ES | 50 | 98 | 51% |
| NL | 50 | 59 | 85% |
| FR | 46 | 70 | 66% |
| AT | 44 | 48 | 92% |
| NO | 35 | 81 | 43% |
| AU | 30 | 83 | 36% |
| BE | 28 | 36 | 78% |
| IT | 21 | 72 | 29% |
| DK | 14 | 27 | 52% |
| PL | 12 | 45 | 27% |
| SE | 11 | 37 | 30% |
| FI | 8 | 15 | 53% |
| IE | 5 | 10 | 50% |
| CZ | 4 | 10 | 40% |
| ZA | 3 | 12 | 25% |
| LU | 3 | 6 | 50% |
| PT | 2 | 15 | 13% |

Research-log reasons so far: 87 `unverified` (56 of them operator sites that
answer 403/429/401/500/526, fail their TLS handshake, serve an expired,
wrong-hostname or unverifiable certificate, redirect to a hosting-platform
staging hostname, or show a maintenance or suspension notice, so no page could be
opened and read), 9 `ambiguous`, 5 `closed`, 4 `http-only`, 1 `duplicate`.

- **Last completed batch:** Europe's remaining independents from name-derived
  domains — 28 linked across Norway, Sweden, Denmark, Finland, Spain and France,
  and five rejected by hand after the comparison had passed them.
- **Next batch:** Australia and Sweden off the Overpass run now in flight.

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
