# Venue reports — the policy behind the button

`/boards/` has one control that sends something: **Report a correction**, in
every venue popup. This file is why it behaves the way it does, in the same
spirit as `VENUE-LINKS.md` — the rules that are easy to break by accident, and
the reasons that make them worth keeping.

## What it is

A visitor standing in a gym can tell us that the board listed here is gone, that
the pin is on the wrong building, or that the place closed in July. They should
be able to do that without an account, without a GitHub login, and without
publishing their observation under their name on a public issue tracker.

So: a small dialog, an optional board target, ten categories, and one free-text
field. It posts to a first-party API on our own domain, which encrypts the
report to the maintainer's Nostr key and delivers it as a private message. A
person reads it. If the map changes, it changes because a human edited a curated
overlay afterwards.

## The rules

**No key ever ships in this repo.** The dialog signs nothing. Encryption happens
on the server, because a signing key served from a static site is a published
key. If a future change makes the browser want to sign something, that is a
design error, not a missing feature.

**Nothing is persisted in the browser.** No draft in `localStorage`, no report in
the URL or the fragment, no `IndexedDB`, no cookie. A report is an observation
about a place somebody visits; a device someone else can pick up is a real
threat model for exactly that. `venue-report-form.test.mjs` greps for the storage
APIs with comments stripped, so a promise in a comment cannot pass for a
property.

**Offline refuses.** It would be easy to queue a failed report and send it later.
That queue is browser persistence with a friendlier name, so the dialog says it
is offline and asks the person to come back.

**No analytics, at all.** The report path sends nothing to
`stats.cruxcoach.org`. A category or a venue in an analytics dimension would tell
the collector what somebody reported, which is the one thing the encryption is
for. Note this is the opposite of the site's usual rule — normally a surface that
can be clicked but not counted breaks the numbers. Here, not being counted is the
point, and no counter is added.

**The endpoint is decided by hostname.** `resolveEndpoint()` looks at
`location.hostname` and nothing else. A query parameter or fragment that could
name the endpoint would let any link decide where a stranger's report is sent. On
loopback it points at `http://127.0.0.1:3002` so a local checkout works with no
configuration.

**Every check runs again on the server.** The client-side validation exists to
tell a person what is wrong before they press send. It decides nothing. The
server re-parses the whole body against the same committed contract and rejects
unknown fields outright.

**Absence of an access value means unknown.** `unknown` is a legal thing to
report — "this is listed as public and nobody verified it" is a real correction —
but no code path anywhere turns silence into `public`.

**An evidence link is hostile input.** It is shape-checked (scheme, credentials,
host, length) and then stored as text. No service fetches it, and the operator's
Inbox renders it as selectable text rather than a link.

## The contract

`tools/venue-report-contract.v1.json` is committed byte-identically here and in
`cruxcoach-dashboard` (`packages/shared/contracts/`). A test in each repo pins
its SHA-256. Changing the taxonomy therefore means changing two files in two
repos and updating two digests — deliberately annoying, because the alternative
is a website that posts a body the API silently rejects.

Adding a category:

1. Edit the contract file in both repos, byte-identically.
2. Update `CATEGORIES` and the `STRINGS` tables (**both** languages) in
   `boards/report-core.mjs`.
3. Update `VENUE_REPORT_CATEGORIES`, the parser's
   `PROPOSAL_FIELDS_BY_CATEGORY`, and the dashboard's `CATEGORY_LABEL` and
   `OVERLAY_HINT`.
4. Update both pinned digests. `scripts/check` and the dashboard's `pnpm test`
   will tell you if you missed one.

## Identity

A report names a `venue_id` and optionally a board `instance_id`. Those come from
`tools/venue-ids.mjs` and survive the nightly rebuild — see the AGENTS.md section
on the boards pipeline. The one rule worth repeating here: **never renumber**. An
open report is a piece of paper with an id written on it, and a changed
derivation turns every one of them into a reference to nothing.

## What we deliberately did not build

- **A CAPTCHA.** The anti-abuse story is server-side: an origin allowlist, a
  single-use ticket bound to that origin, per-IP and service-wide rate limits,
  and duplicate suppression. Those are real and implemented. A CAPTCHA would be
  a third-party embed on a site whose first hard constraint is that it has none.
- **Client-side proof of work.** It would spend a visitor's battery to slow an
  attacker who can afford a headless browser anyway, and it makes the form worse
  on exactly the low-end phone somebody is holding in a gym.
- **A public report feed.** Reports quote members of the public about places
  they visit. There is no version of publishing that queue that is fair to the
  person who wrote it, or to the gym.
- **Automatic application.** No report edits `overrides.json`,
  `venue-links.json`, `wellpass.json` or `venue-ids.json`. Ever. The whole point
  of the review step is that a stranger's claim is a claim.
