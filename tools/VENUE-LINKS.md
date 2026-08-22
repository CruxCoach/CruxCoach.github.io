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
| Venues reviewed (linked + research entries) | 454 |
| Verified website links | 398 |
| Rejected / ambiguous / private / closed | 56 |
| Countries covered | 7 |
| Eligible venues in the dataset (public/commercial) | 2191 |

Per-country coverage of eligible (public/commercial) venues:

| country | linked | eligible | share |
| --- | --- | --- | --- |
| DE | 163 | 201 | 81% |
| GB | 55 | 102 | 54% |
| CH | 51 | 56 | 91% |
| NL | 46 | 59 | 78% |
| AT | 44 | 48 | 92% |
| BE | 23 | 36 | 64% |
| FR | 16 | 70 | 23% |

Research-log reasons so far: 47 `unverified` (41 of them operator sites that
answer 403/401/500/526 or serve an expired or wrong-hostname certificate, so no
page could be opened and read), 6 with no findable official site, 2 `ambiguous`,
1 `closed`, 1 `duplicate`.

- **Last completed batch:** France, second pass — The Roof, Bloc Session,
  Vertical'Art, Altissimo and Climbing District.
- **Next batch:** the rest of France, then Italy, Spain and the Nordics. Both
  depend on an OSM discovery run: Overpass has been returning 429/502/504 for
  most of the France/Italy attempt, so that queue is the gating item rather than
  the verification work.

### A note on discovery after the search budget ran out

Partway through Belgium this session exhausted its web-search allowance. That
turned out to matter less than expected: OSM discovery plus first-hand
verification is the sanctioned path anyway, and the Benelux run alone carried 43
candidates that search had not surfaced. Search was only ever the fallback for
countries whose OSM coverage is thin.
