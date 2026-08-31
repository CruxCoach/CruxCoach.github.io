# MoonBoard structured-source audit

MoonBoard is the one large registry in the map whose upstream location feed is
no longer live. This note records the replacement-source search so a future
refresh can distinguish a genuinely new public channel from repeated work.

## Current state — 2026-08-31

- `@hangtime/climbing-boards` 1.0.92 is still the latest package and documents
  that MoonBoard removed `https://moonboard.com/MoonBoard/GetMapMarkers` in May
  2026. Its bundled MoonBoard GeoJSON is therefore a frozen snapshot, not a
  current manufacturer feed.
- Moon Climbing's [July 2026 migration notice](https://eu.moonclimbing.com/News/post/moonboard-app-update-important-information)
  says the replacement app began rolling out on 22 June and that the old app
  and API would remain only temporarily after full rollout.
- The current official [Google Play listing](https://play.google.com/store/apps/details?id=com.trainingboard.moon)
  describes gym management and lets commercial and private gyms add their own
  boards. It does not publish a web directory, export, API contract, or public
  location endpoint.
- Exact searches of MoonBoard/Moon Climbing's public sites, search indexes and
  certificate/DNS candidates found no replacement anonymous directory.

The current Android release was inspected only to discover whether such a
public endpoint exists. This is candidate-source analysis, never location
evidence. The audited artifact was package `com.trainingboard.moon`, version
1.3.68 (368), SHA-256
`2021495995056729dbde643ab02719ac1a9d66966e2d0b40e2ee92f7174942b1`, signed
with certificate SHA-256
`9903070fe6cf4674e1a8875c07c911aa859a4fee666a8c83a409084d3ec94caf`.
Static analysis found:

- explicit gym, location and generic-board models and `gyms/*` routes;
- Firebase Authentication plus a Bearer-token refresh interceptor;
- Firebase App Check activated with the `playIntegrity` provider; and
- a hard failure when App Check does not return a token.

Consequently the new in-app gym catalogue is not an anonymous structured
source. No login, credential, device attestation, interception, modified
client, rate-limit workaround, or App Check bypass was attempted. It must not
be made an adapter unless Moon Climbing later publishes an anonymous endpoint
and terms suitable for this use.

## Remaining legitimate channels

1. Current official MoonBoard product/setup pages establish the supported
   variants (`mb2016`, `mb2017-masters`, `mb2019-masters`, `mini-2020`,
   `mb2024`, `mini-2025`) and the supported standard angles, but not venues.
2. Official venue and chain pages can establish a public installation,
   branch identity, address and board details. Search results, social pages,
   directories and OSM remain candidate/identity signals only.
3. The frozen registry remains useful for candidate discovery. A row that looks
   like a home setup must not gain guessed public venue context.

The final exhaustion pass must repeat the public-endpoint search and recheck the
official app listing/migration notice. Until a public manufacturer channel
appears, current-location recovery is necessarily a branch-by-branch official
venue research task.

## Venue-recovery batches

The first region-spanning exact-generation pass recovered three current public
2024 installations omitted by the frozen feed: Boardworks Climbing in Bend,
Rock Haven in Gresham and The Front Ogden. It also classified the existing
University of Calgary board as 2024 at fixed 40°. Boardworks' four existing
manufacturer rows are now one physical venue, and Calgary's formerly separate
MoonBoard/Kilter pins are likewise one venue. Every addition is backed by the
operator's current branch page; the venue-link and hours ledgers carry the
identity and fail-closed schedule decisions.

Exact searches for the 2025 Mini set produced manufacturer/product pages and
private/home installations but no branch-primary public venue. Nothing was
added from those results. Regional and multilingual searches for all six
generations remain in progress; this first batch is not an exhaustion claim.
