# Aurora-family anonymous pins audit

Reviewed 2026-08-31. Six Aurora-backed manufacturer apps expose an anonymous
`GET /pins?gyms=1` response containing only public map-pin fields. The
reproducible comparison is:

```bash
node tools/aurora-pins-audit.mjs
node tools/aurora-pins-audit.mjs --json
```

The audit requests the endpoints directly, discards app account ids and
usernames, retains no raw response, and compares each pin with only its own
board system within 250 m. It is deliberately not an ingest adapter. The
endpoints publish no redistribution licence, omit venue addresses and wall
details, and can expose a board before it opens. Hangtime's Unlicense snapshot
therefore remains the normal source; the live pins are a discovery and
freshness channel.

## Current reconciliation

| System | Anonymous endpoint rows | Disposition after this pass |
| --- | ---: | --- |
| Tension | 368 | 365 pins match directly; two stale coordinates resolve through backed production overrides; one announced pin is backed-excluded |
| Grasshopper | 42 | all 42 match |
| Decoy | 24 | all 24 match |
| So iLL | 12 | all 12 match |
| Touchstone | 5 | all 5 match |
| Aurora | 3 | all 3 match |

The live endpoints total 454 valid pins with no malformed or Null Island rows.
Production also has one reviewed Tension venue absent from the live endpoint
(ICP Boulder Hall & Showroom), so equal aggregate totals are not evidence of
row-for-row equality; the audit reports each category explicitly.

Two Tension pins remain at pre-correction coordinates: Level24 and Bouldering
Project Tempe. Their venue-owned pages place both Tension Boards at the same
current branch points as their Kilter Boards, and the committed source-coordinate
overrides encode those reviewed moves. The audit now recognizes an override only
when its selector matches the live pin and its target resolves onto the current
same-system map venue; a stale or mistyped override therefore remains visible as
a candidate rather than suppressing one.

## Two new Tension pins

The 2026-08-31 live Tension endpoint contained two rows not yet present in the
same day's Hangtime package snapshot.

### KiipeilyAreena Salmisaari — accepted

- The official Tension endpoint identifies `KiipeilyAreena Salmisaari` at
  `60.166129, 24.904168`.
- The venue's current official
  [expansion notice](https://kiipeilyareena.com/salmisaaren-uusi-laajennus-avataan-maanantaina-28-7-klo-13/)
  says the new public area opened on 2025-07-28 and contains two adjustable
  training boards.
- Its current official
  [branch page](https://kiipeilyareena.com/en/locations/salmisaari/) identifies
  the public venue, Energiakatu 3 address, complete regular week and open new
  extension. The existing manufacturer Kilter record accounts for the other
  training board.

The Tension Board is added at the live official pin. The Kilter row 11 m away
is consolidated onto that same point so one physical branch remains one marker.
The branch website and regular public hours are added in the same batch; the
separately stated early-morning member window is not presented as public hours.

### Tilted Climbing — announced, not current

The official Tension endpoint already contains a pin at
`49.30953, -123.033253`, but the venue's current official
[homepage](https://tiltedclimbing.ca/) explicitly says “Tension Board 2 coming
soon”. Its public venue and four current Kilter walls remain published at their
existing point. The premature Tension pin is recorded as `announced` and is
withheld until the venue itself identifies that board as open.

## Authentication boundary

Anonymous pins are the end of the legitimate unauthenticated surface. The
upstream scraper's public source code shows that addresses, walls, angles and
adjustability require a per-app login, and its workflow supplies secret account
credentials for those detail requests. This audit does not create an account,
use credentials, bypass access controls or call authenticated endpoints. Board
details beyond what venue/manufacturer public pages state remain unresolved.
