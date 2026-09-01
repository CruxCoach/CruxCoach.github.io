# MoonBoard structured-source audit

MoonBoard is the one large registry in the map whose upstream location feed is
no longer live. This note records the replacement-source search so a future
refresh can distinguish a genuinely new public channel from repeated work.

## Current state — 2026-09-01

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

The second regional pass recovered five further current public 2024
installations from operator-owned pages: Beyond Bouldering Thebarton and
Hangdog Wollongong in Australia, Boulder Co Christchurch in New Zealand, and
Gallery Bouldering Oxford and Social Climbing Coventry in the United Kingdom.
Gallery's hydraulic wall is verified at 25–40°, while Beyond's board is fixed
at 40°; the other three operators do not publish a safely normalizable angle.
Hangdog states that it has both a Classic and a 2024 MoonBoard, but the public
schema intentionally publishes one `moonboard` entry for that physical venue
rather than inventing a second variant from an underspecified “Classic” label.

The same pass consolidated Boulder Heads' MoonBoard and Tension Board at the
operator's one Baringa address and classified its MoonBoard as 2024/fixed 40°.
Grand Wall Bouldering Co-op's current page establishes a 2024 LED board, while
its 24/7 access is member-only after onboarding and issuance of a personal
code; that access rule remains an `appointment-only` research outcome rather
than a public regular week. These changes raise the map to 1,508 MoonBoard rows
at 1,383 physical venues. Regional and multilingual recovery remains in
progress; this second batch is not an exhaustion claim either.

The first German/French/Italian-language pass added two public venues absent
from the frozen feed: Rainbow Rocket Boulders in Kempten with the current 2024
configuration, and Double Dyno in Cagliari/Pirri with a current LED MoonBoard
whose generation and angle the operator does not state. It also supplied fixed
40° details for the existing 2024 boards at Boulder Hall Burgoberbach and DAV
Würzburg, and classified TSV 1846 Nürnberg's full-size board as the 2024 set
without overwriting its distinct Mini 2020 row. The TSV operator additionally
establishes a current adjustable Tension Board 2, which is now represented at
the same venue. Gravità Zero's two 17 m-apart registry points are now one
Trieste venue on the operator's current domain, with the MoonBoard classified
as 2019 Masters at fixed 40°.

Two tempting search results were deliberately not added. Granit
Rueil-Malmaison's still-indexed equipment page describes a 25° MoonBoard, but
the operator's current closure notice states that the gym permanently closed
on 17 March 2026; that exclusion was already backed in the venue research
ledger. CAI Valdagno's 2025 bulletin establishes a public LED 2024 MoonBoard at
Palavolta for the 2024/25 season, but no current 2025/26 or 2026 operator page
could be found. Without current access confirmation it remains a retry
candidate rather than a production marker. Multilingual recovery remains in
progress and this pass is not an exhaustion claim.

The continuation of that pass recovered two more current public installations.
Solo Escalade Toulouse's operator page explicitly lists a 2024 MoonBoard beside
the Kilter Board already present at its exact address-bearing map point. Lezard's
current association page identifies its public Mozzate gym, exact Via Anna Frank
1/3 address and MoonBoard; the exact named venue point is independently present
in OpenStreetMap. Neither operator states an angle, and Lezard states neither a
generation nor LEDs, so those fields remain unknown. Solo's separately labelled
September–June and summer weeks and Lezard's summer, weather-dependent weekend
access remain internal research outcomes rather than misleading regular hours.
The map now contains 1,512 MoonBoard rows at 1,387 physical venues. Regional and
multilingual recovery is still in progress; this is not an exhaustion claim.

Portside Boulders provides a particularly strong chain-wide primary source: its
current MoonBoard guide names all four Perth branches and gives each generation
and fixed 40° angle, while the four current branch pages establish public access,
identity, address and complete regular weeks. O'Connor and Joondalup therefore
gain their missing 2024 boards, Willetton gains its missing 2019 board, and
Osborne Park's existing 2016 board is consolidated with the address-bearing
Kilter marker 17 m away. The guide describes the boards as app-connected LEDs,
so that detail is recorded for all four. The map now contains 1,515 MoonBoard
rows at 1,390 physical venues.

The first Japanese-language search also found current operator-controlled pages
for BolBol in Sagamihara and Blue Bird Bouldering Gym in Ota that state public
MoonBoards, full street addresses and regular schedules. Neither venue exists in
the frozen registry. They are not published yet: accessible OpenStreetMap data
does not establish an exact venue point, and the address-only neighborhood
centroids are too imprecise. Google Maps was not used, and a third-party Japanese
geocoder whose terms require its own displayed map/attribution was not imported
into the dataset. Both remain explicit coordinate-retry candidates. The wider
Asia-Pacific and multilingual pass remains in progress; this is not an
exhaustion claim.

CAL-COLO's current operator page explicitly identifies both its Kilter Board
and an LED-guided MoonBoard at the same Kizugawa address. Because the Kilter
venue already carries a precise independently corroborated point, the missing
MoonBoard can be added without importing an address centroid or third-party map
coordinate. The operator does not identify the generation or angle, so those
fields remain unknown. The map now contains 1,516 MoonBoard rows at 1,391
physical venues.

The Korean-language discovery pass starts from a reproducible nationwide list
published in August 2025. Its CSV names 56 boards at 55 venues (one venue has
both 2016 and 2024 sets), while production contains 14 South Korean MoonBoard
rows. None of the Korean candidate names normalizes directly to those legacy
English/user labels, so the first reconciliation queue explicitly retains all
14 instead of assuming either a match or a gap. The list is third-party,
includes renames and closures, and links to a commercial map service. Its names
and stated generations are being audited one by one against current
operator-controlled sources and independent precise geodata; none will be
imported solely from the list or its map links.

The first Korean reconciliation resolves Hana Climbing Gym. Its current
operator page identifies the public gym, exact Daejeon World Cup Stadium
location, MoonBoard and Kilter Board, and publishes a complete regular week. A
dated operator notice states that the MoonBoard changed from the 2019 setup to
the 2016 setup in July 2022, correcting the frozen row's 2017-Masters label.
The discovery list also claims a second 2024 board, but the current operator
page describes only one MoonBoard and does not name a 2024 setup, so that second
row remains unverified.

The next Korean disposition pass settled five more source rows without lowering
the publication bar. OnFleek's current operator site confirms one public
MoonBoard at its sole stated Cheonho address, and its current facility image is
visibly the dense sky-blue/wood 2024 setup, not the list's 2016 claim. It remains
unpublished because no acceptable independent source yet fixes the venue to a
precise coordinate; the purported Samsung branch is separately unverified
because the same current site names only Cheonho. ClimbTogether's operator site
confirms its current Wonju venue and address but neither names nor depicts a
MoonBoard. The municipal page for Jungnang Sports Climbing Stadium likewise
describes the public Yongma Waterfall Park walls without naming a system board.
Finally, Climbing Park Seongsu's own post says the venue ended operations on 25
August 2026, so it is closed rather than a missing addition. The audit now has
one published, five unverified, one closed and 49 pending candidate rows; 13
production rows still need reconciliation. Every non-pending row carries its
exact HTTPS evidence URLs, and the audit rejects decided rows without them.

ClimbSquare ICN's venue-owning company supplies the next publishable Korean
reconciliation. Its current training-board page explicitly identifies a public
three-board hydraulic frame with app-connected LED MoonBoard, Kilter Board and
Tension Board at the exact-address Kilter venue already in production. The
missing MoonBoard and Tension Board are therefore co-located there. The page
does not identify the MoonBoard generation or a board-specific angle, so the
discovery list's 2016 label is not promoted into those fields.

Three other high-confidence identity matches remain deliberately unpublished.
Kin:D's public operator profile is current, and multiple independent opening
and visit reports agree on a 2024 MoonBoard beside the production Kilter Board,
but the accessible operator posts do not identify it and older posts require
authentication to search. A current independent visit likewise confirms both
boards at Koala Kintex, while no current operator board statement was found.
Koala's operator-controlled Kakao channel confirms the Sangam venue but not a
MoonBoard. Secondary revisions conflict over whether the two Koala boards are
2016 or 2024, so neither is published. The audit now has two published, eight
unverified, one closed and 45 pending rows; 13 production-only MoonBoard labels
still require reconciliation.

The next current-channel pass dispositioned three more claimed 2024 setups.
RockTree Bundang's operator website and public profile establish the branch, but
neither identifies a MoonBoard; the detailed 2022 visit describes only an
adjustable spray wall. SeoulForest Jongno's current operator profile and branch
post establish the exact production venue, but its accessible posts do not name
the claimed system board. SO Climbing is still a current public gym at the
exact-address production point according to the national sports-safety report,
and a 2018 report proves a historical MoonBoard, but no accessible current
operator source supports the discovery list's 2024 claim. All three therefore
remain unverified rather than being used to rewrite existing rows. OnFleek's
June 2026 operator competition post now independently confirms current
MoonBoard use and the national report supplies its exact street address, but no
legitimate precise coordinate is available; an address centroid is not used.
The audit now has two published, eleven unverified, one closed and 42 pending
rows; all 13 production-only labels remain explicitly unreconciled.

OTTERCLIMBING is the third publishable Korean candidate. Its current,
document-backed operator business profile explicitly lists a public MoonBoard
wall, the exact second-floor address and an embedded venue point; Busan's
current merchant register independently matches the business and floor. The
operator does not state a generation, LEDs or angle, so none is inferred from
the discovery list's 2024 label. The marketplace profile and its linked social
channel are not promoted to an official website, and conflicting third-party
weekend schedules keep hours out of production. The map now contains 1,518
MoonBoard rows at 1,393 physical venues; the Korean audit has three published,
eleven unverified, one closed and 41 pending rows, with all 13 legacy
production-only labels still awaiting identity reconciliation.

The 2024 candidate tranche is now exhausted. Seosuwon Climbing Center remains
a current public venue at one consistently reported Suwon address, but its
accessible membership and climbing-log pages do not mention a MoonBoard and no
operator-controlled board statement is readable. Gwang Climbing is likewise a
current public Changwon venue identified by the provincial education authority
and current activity data, but none of the accessible sources names a system
board. Their apparent Naver operator channels are robots-blocked; no login or
access-control workaround was attempted. Both discovery-list claims therefore
remain unverified. Together with the published OTTERCLIMBING row, this leaves
three published, thirteen unverified, one closed and 39 pending candidates.
