# MoonBoard structured-source audit

MoonBoard is the one large registry in the map whose upstream location feed is
no longer live. This note records the replacement-source search so a future
refresh can distinguish a genuinely new public channel from repeated work.

## Current state — 2026-09-01

- `@hangtime/climbing-boards` 1.0.93 is the current audited package and documents
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

The Japanese coordinate retry now resolves BolBol and Blue Bird without using
Google or Apple Maps. BolBol's operator-authored map configuration binds its
full Hashimoto address to a precise marker. Blue Bird's exact 米沢町13 lot is in
the Ministry of Land, Infrastructure, Transport and Tourism's freely reusable
2025 block-level Location Reference Information. The same MLIT source also
resolves three other documented retries: Hyoutanjima Ogaki, WEST ROCK Fuchu and
Sakuragaike Climbing Center. Each current operator page identifies the public
MoonBoard, exact address and complete regular week. Sakuragaike further states
that its MoonBoard wall is 130 degrees, normalized to 40 degrees from vertical.
Generation and LED fields remain unknown wherever the operator is silent.

That regional retry also found Colorful Rock, a current Nagoya gym missing from
the frozen registry. Its operator page states a permanent MoonBoard and a May
2025 change from Masters 2017 to the 2016 setup; its own JSON-LD coordinate is
independently identical to the MLIT address point. All six venues receive
official links and complete operator-stated weeks. The published map cites the
MLIT Location Reference Information in both language versions. The wider
Asia-Pacific and multilingual pass remains in progress; this is not an
exhaustion claim.

The next Japanese-language pass searched current operator pages by generation,
facility terminology and the eight geographic region groups. It raised the
Japanese production inventory from 41 to 46 MoonBoard rows and resolved one
legacy identity. Four previously absent current venues are now published:
ROCONESS Shiroishi (operator-stated 2019 Masters with LEDs), iTTE Matsuyama,
ao_roc Kashima and ボルダTO9蒲郡店. MLIT's current exact-lot records establish
ROCONESS, iTTE and ao_roc; TO9 uses MLIT's pre-readjustment 2018 lot point plus
Gamagori's official 2021 old/new-address table. The current Monolithe operator
site identifies the legacy Kawagoe row, its LED MoonBoard, exact branch address
and complete week, so its prior no-site outcomes are withdrawn.

The discovery balance for this pass is explicit and remains open:

| Candidate | Outcome | Reason / next retry |
| --- | --- | --- |
| ボルダTO9蒲郡店 | published | Current operator board/address evidence and authority geodata; hours withheld because adult-only LINE-gated unmanned access differs from staffed access. |
| ROCONESS | published | Current operator facility page states 2019 Masters, LEDs, address and complete week. |
| 愛媛クライミングジム iTTE | published | Current operator facility/access/hours pages and exact MLIT lot. |
| アオロク ao_roc.climbing | published | Current operator facility/address/week and exact MLIT lot. |
| モノリス川越店 | reconciled | Existing row; current operator branch and wall pages restore identity, site, hours and LED detail. |
| TO-DO クライミング | coordinate retry | Current board/address evidence is sufficient, but neither the 2025 MLIT file nor OSM exposes the exact 石川22 point; neighborhood points are not published. |
| FUNNY BONE | currency retry | Venue is active in 2026, but accessible operator MoonBoard evidence is from 2020; do not infer that the board remains. |

Searches also rediscovered CRUX Osaka, Climbing BUM Yokohama, QRiMo,
Sakuragaike, Colorful Rock, Kurayoshi and other already-published rows. A new
venue in this pass means Japan is not exhausted; subsequent passes must retry
the two withheld candidates and audit the remaining legacy production rows for
current identity, closure and board service.

That legacy review is now a reproducible, fail-closed inventory rather than a
prose-only task. `moonboard-japan-decisions.json` accounts for all 45 physical
Japanese production venues and `moonboard-japan-audit.mjs` independently counts
their 46 MoonBoard objects (MOVEMENT has two). At creation, twelve venues
checked in the two operator/authority passes were marked current with per-row
provenance and the remaining 33 were deliberately evidence-free `pending`
rows. The audit and
its unit test reject malformed decisions as well as any new, renamed, moved or
removed production venue. This establishes the denominator, not exhaustion:
each pending row still requires a current identity, closure, public-access and
board-service decision.

The first legacy batch resolves four more rows. Current branch pages explicitly
identify ClimbingBUM Yokohama's illuminated MoonBoard and QRiMo's full-set,
non-LED MoonBoard. Tottori's official facility inventory identifies the
MoonBoard wall at the current prefectural Kurayoshi centre, but does not support
the registry's 2024 generation or LED flags, so those details are cleared.
CRUX exposes a material duplicate/mislocation: its current branch page names
both the MoonBoard and Grasshopper Board at the one CRUX Osaka venue in Suita
and embeds a point matching the existing Grasshopper row, while the legacy
MoonBoard sat about 10 km south without a second branch identity. The old point
is backed as mislocated and its replacement is co-located in Suita. The Japanese
ledger is now 16 current / 29 pending, still 45 venues / 46 board rows.

The D.Bouldering chain pass then checks every Japanese production branch label
against its own operator path instead of transferring equipment between
branches. Tsunashima's current facility/concept pages repeatedly name its
MoonBoard; Hachioji's operator relocation page promises the board at the current
OPA branch and the branch remains active through 2026; Sengen-cho's May 2025
reset schedule explicitly keeps the MoonBoard area open and its news continues
in 2026. CUORE Imaike's branch page explicitly states the 2019 version and its
operator homepage remains current. Sendai-Nagamachi and Yachiyo are different:
their active branch pages do not name a MoonBoard, while only detailed
independent venue reports do. They remain `unverified`, not current. All six
rows lose inherited LED/generation/angle claims that their branch-primary
sources do not support; CUORE's explicit 2019 generation is retained. The
Japanese balance is 20 current, two unverified and 23 pending.

Four further legacy rows were then checked against current operator surfaces.
BoulderGarden SaBo and HUT WALL are demonstrably active public gyms, but their
current sites do not name the frozen MoonBoard rows; only secondary sources do.
CAIRN's venue identity remains visible in a 2025 manufacturer retailer list,
while its HTTP-only operator site is inaccessible and the available MoonBoard
claim is a decade old. Activ-A has no accessible current operator page, a 2021
post-relocation visitor report is its latest board signal, and the production
point appears to be its pre-relocation site. All four therefore remain
`unverified`, and inherited LED/generation claims are cleared. HUT WALL's
current operator page does independently repair its previously unresolved
official website. The ledger now stands at 20 current, six unverified and 19
pending.

The next four-row legacy pass separates current venue identity from current
board proof. JOYWALL's current operator site establishes the Kurume branch,
exact address, official website and a complete regular week, but does not name
the frozen MoonBoard; OKKUROCK's current operator site likewise establishes an
active public venue without stating that the board remains. Both are therefore
`unverified`, and their unsupported inherited LED claims are cleared. DAIBU's
operator announced a 30 November 2025 closure, so its stale production marker
is removed. Finally, the frozen TRAILROCK row was found to share MOVEMENT
Climbing Space's coordinate byte-for-byte even though both current operator
sites give distinct Koriyama addresses. A selective source-row exclusion now
removes only TRAILROCK while preserving MOVEMENT's real marker; neither current
site states a MoonBoard, so MOVEMENT remains `unverified` and no corrected
TRAILROCK board is guessed. The Japanese ledger now accounts for 44 published
venues and 44 MoonBoard rows: 20 current, nine unverified and 15 pending, plus
the excluded DAIBU closure.

The remaining fifteen-row legacy pass closes that inventory without turning
weak discovery evidence into production facts. RIOT and SunnyDipper both had
real current MoonBoards but frozen city-level points: current operator pages
give exact Nagoya-Moriyama and Tamaki addresses, and MLIT's 2025 block-level
files supply their replacement points. VORTEX's current operator site and
official account explicitly identify its MoonBoard and exact Kasama address;
The Ranch's live operator facility page likewise labels its MOON BOARD and
Kumamoto address. Their unstated generation, LED and angle details remain
unknown. VOLNY's point is the generic Tokyo centre rather than either current
branch, and neither complete branch page names a MoonBoard, so the bad marker is
removed without guessing a replacement. Goodbouldering, GRANNY and Little
Forest are active public gyms but lack current branch-primary board statements;
they remain `unverified`, although safe official websites and Little Forest's
complete week are independently published. Seven explicitly non-commercial,
account-style rows have no public operator identity and remain private without
venue enrichment. The fail-closed ledger is now fully decided: 24 current, 12
unverified, seven private, three mislocated and one closed, with zero pending.
Production contains 43 Japanese MoonBoard venues / rows. This exhausts the
legacy inventory, not Japanese discovery: the withheld TO-DO and FUNNY BONE
candidates and another nationwide operator/manufacturer search still remain.

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

The first post-ledger Japanese discovery retry resolves two of the three named
open candidates without weakening the provenance boundary. TO-DO Climbing's
current operator facility page explicitly labels its MoonBoard and exact Akita
address. MLIT's current Akita file genuinely has no 石川22 record, but the exact
named venue building is independently present in OpenStreetMap; that point is
published only in combination with the operator's current identity, address and
board statement. The operator's two current pages disagree by one hour on both
weekday and weekend opening, so hours remain an `ambiguous` outcome.

D.Bouldering's current Okinawa Toyosaki branch and facility pages explicitly
identify the MoonBoard, exact iias Toyosaki address and 130-degree wall. The
representative point for the exact 豊崎3 lot comes from MLIT's 2025 Okinawa
Location Reference Information, and the angle is normalized to 40 degrees from
vertical. The same branch page supplies a complete regular week. Neither venue
states a supported generation or LEDs, so those fields remain unknown.

FUNNY BONE was rechecked across the correct current operator domain
`r.goope.jp/funnybone`—homepage, facility photographs, access, pricing,
calendar, current announcements and indexed archives. The gym is demonstrably
active in 2026, but its only explicit operator MoonBoard statement remains the
May 2020 reopening post. The unrelated `funnyb.jp` business is not used. FUNNY
BONE therefore remains a documented currency retry rather than a production
addition. The Japanese audit now accounts for 49 decisions and 45 production
venues / MoonBoard rows: 26 current, 12 unverified, seven private, three
mislocated and one closed, with zero pending or unknown map rows. Because this
retry yielded two venues, a fresh nationwide Japanese discovery pass is still
required before any regional exhaustion claim.

The fresh nationwide pass has itself produced three further current venues, so
Japan is still not exhausted. Rainbow Cliff's current operator homepage names
its public MoonBoard, exact Sapporo address and complete week; the exact
東札幌二条二丁目3 block comes from MLIT's 2025 Hokkaido file. Tokyo Dome's
current Spo-Dori! bouldering page explicitly names its LED MoonBoard, and its
access and information pages bind the public all-day facility and seven-day week
to 後楽1-3-61 黄色いビル3F; the exact named building is independently present
in OpenStreetMap. Climbing Gym Penguin's current homepage likewise names its
MoonBoard, complete week and 田島4-40-16 address, whose exact block is in MLIT's
2025 Saitama file. No generation or angle is inferred, and Penguin/Rainbow Cliff
retain unknown LED status because their operators do not state it.

The older nationwide discovery lists were re-opened rather than treated as
truth. Their current balance is:

| Candidate | Outcome | Current primary-source result |
| --- | --- | --- |
| Rainbow Cliff | published | Current operator board/address/week plus exact MLIT block. |
| スポドリ！ Spo-Dori! | published | Current operator LED board/address/week plus exact named OSM building. |
| Climbing Gym Penguin | published | Current operator board/address/week plus exact MLIT block. |
| UNDERGROUND | removed installation | Current operator says its MoonBoard was dismantled in January 2023. |
| THREE PEAKS | closed | Current operator closure page states the gym closed 31 May 2026. |
| BOLD Osaka | closed fixed venue | Current operator channel describes the Osaka gym as former and now offers only mobile event walls. |
| HEADROCK | currency retry | Current operator domain is access-blocked here; current independent venue material is not substituted for a branch-primary board statement. |
| RISE Yokohama | currency retry | Operator site is active in September 2026 but its current facility surface does not name a MoonBoard. |
| OVERGROUND | availability retry | Former operator domain returns 502; only non-primary current-looking directory material names the board. |
| BAD WALL | access/geodata retry | Operator names its MoonBoard but restricts use to members and publishes no exact street address; no public-access or coordinate assumption is made. |
| 深谷クライミングヴィレッジ | currency retry | Current operator facility page names the public hall and week but no MoonBoard. |
| ZERO 宇都宮下栗 | identity/currency retry | Accessible operator archive mentions MoonBoard use but does not currently bind it to the old 下栗 branch; current search results point to a different 宇都宮 address. |
| RISE/OVERGROUND-era closed rows | rejected | 3RD WALLY, VERT and Lotus already have explicit historical closure signals and are not revived. |

ClimbingBUM Yokohama, BolBol, WEST ROCK, D.Bouldering branches, Blue Bird and
the other current hits from these lists resolve to already reviewed production
rows. The audit now accounts for 52 decisions and 48 Japanese production venues
/ MoonBoard rows: 29 current, 12 unverified, seven private, three mislocated and
one closed, with zero pending or unknown map rows.

The same full rebuild advanced Hangtime from 1.0.92 to 1.0.93, so its delta was
audited rather than accepted as opaque churn. Dreamstone Boulders Kelapa Gading
is a new address-bearing structured Kilter row; only operator social/Linktree
surfaces were found, so no website or hours are inferred. Rock Room's new
address-bearing Kilter row sits 16 metres from its legacy MoonBoard point. The
current operator site explicitly names both boards at 319 Victoria Ave E, so an
override merges the legacy MoonBoard onto that venue and clears the unsupported
inherited 2016/LED claims. Salmisaari's now-upstream Tension row replaces the
former curated duplicate. This source refresh and the two Japanese additions
produce 2,849 venues / 3,137 board rows, including 1,527 MoonBoards at 1,403
venues, without publishing a duplicate Rock Room marker.

The next nationwide tranche adds two more branch-primary installations.
Mono Climbing Studio's current location page binds a public MoonBoard, exact
那珂3-27-27 address and complete 06:00–26:00 week specifically to its Hakata
branch; the representative point for exact block 27 comes from MLIT's 2025
Fukuoka Location Reference Information. The same chain page was checked across
the Omura and Sasebo sections and makes no MoonBoard claim for either, so the
Hakata finding is not projected chain-wide. D.Bouldering's current Namba
facility page explicitly names its 130-degree MoonBoard, while the branch page
supplies the exact 難波千日前12-35 address and complete week. The angle is
normalized to 40 degrees from vertical and the exact block point comes from
MLIT's 2025 Osaka file. Neither operator states a supported generation or LED
state, so those fields remain unknown.

The D.Bouldering sitemap, current branch pages and WordPress search/API surfaces
were checked chain-wide; Hachioji, Tsunashima, Okinawa and Sengen-cho resolve to
already reviewed production rows, and no other direct branch-primary MoonBoard
claim surfaced. Three additional Japanese candidates remain fail-closed:
Climbing Gym 壁屋's current operator page explicitly names its public MoonBoard,
address and week, but MLIT omits lot 1191 and no exact named map object was found;
Climbing Park HOME has a current operator identity/address/week but no operator
MoonBoard statement; Climbing Gym Sarukichi has current municipal identity and
secondary MoonBoard evidence, but its operator domain does not resolve. They
remain coordinate, primary-board and primary-availability retries respectively,
not production rows.

Japan now has 54 reviewed decisions and 50 production venues / MoonBoard rows:
31 current, 12 unverified, seven private, three mislocated and one closed, with
zero pending or unknown map rows. The whole dataset contains 2,854 venues and
3,142 board rows, including 1,532 MoonBoards at 1,408 venues, with 1,813 official
websites and 1,329 complete regular weeks. Because this tranche again yielded
two current venues, the nationwide Japanese discovery pass must restart; this
is not an exhaustion claim.

The restarted pass immediately corrects one discovery mistake and finds another
missing venue. Sarukichi's old custom domain is unavailable, but the operator's
actual current Jimdo site remains accessible. Its facility page explicitly
identifies an LED MoonBoard on a 130-degree wall, and its homepage binds that
equipment to the public Togane gym at 家徳288-1. Togane's 2025 merchant list
independently confirms the current venue identity; MLIT's 2025 Chiba file
supplies the representative point for exact lot 288. The wall angle is normalized
to 40 degrees from vertical; generation is not inferred.

GANBA was found through a fresh facility-page wording search rather than an old
location list. Its accessible operator homepage and facility page identify the
public Nagoya gym, exact 南脇町2-3 address and installed LED MoonBoard. MLIT's
2025 Aichi file supplies the representative point for the exact lot. The operator
does not state a supported generation or angle, so both remain unknown.

Both sites expose apparently old schedules that materially disagree with
multiple current venue surfaces: Sarukichi differs on opening times and Tuesday
closures, while GANBA differs on weekday and holiday opening. Those current
secondary surfaces are used only as conflict signals, never as replacement
hours. Both weeks therefore remain explicit `ambiguous` research outcomes until
the operators publish a clearly current schedule.

Japan now has 56 reviewed decisions and 52 production venues / MoonBoard rows:
33 current, 12 unverified, seven private, three mislocated and one closed, with
zero pending or unknown map rows. The whole dataset contains 2,856 venues and
3,144 board rows, including 1,534 MoonBoards at 1,410 venues, with 1,815 official
websites and 1,329 complete regular weeks. Because this restarted pass again
yielded two current venues, it must restart once more; this is still not an
exhaustion claim.

The next restart adds a reproducible Japanese directory cross-check instead of
depending on free-form search ranking. Clatsuku's public gym filter currently
labels 20 Japanese venues as having a MoonBoard. It is used only as a discovery
index: its records are self-submitted/stale in places and no board, address,
hours or coordinate is imported from it. Eight entries resolve to already
reviewed production rows (Blue Bird, Vortex, GANBA, Monolithe, HUT WALL,
goodbouldering, Penguin and Colorful Rock). The remaining dispositions are:

| Candidate | Outcome | Primary-source boundary |
| --- | --- | --- |
| クライミングジム＆ショップ ストーンラブ | published | Current operator venue page explicitly names its LED MoonBoard; operator address/week plus exact official GSI address point. |
| Luvrock bouldering spot | currency retry | Active operator site and 2026 notices, but its current pages and WordPress search expose no MoonBoard statement. |
| HEADROCK CLIMBING GYM | access/currency retry | Operator domain returns 403 here; no directory statement substitutes for current operator evidence. |
| Climbing gym CLapple | closed | The operator's sister-gym archive states that CLapple closed on 31 May 2023; stale current-looking directories are rejected. |
| CRAGER'S奥州水沢 | currency retry | Current 2026 retail-event evidence establishes the venue, but the operator uses a social-only channel and no current primary board statement is accessible. |
| Climbing park HOME | primary-board retry | Current operator identity/address/week remains available, but no operator MoonBoard statement was found. |
| Be born climbing gym | currency retry | Active operator site and 2026 notices, but its current site contains no MoonBoard statement. |
| bouldering gym OWL | currency retry | Active operator site publishes the venue and week, but no current MoonBoard statement. |
| CAMP&CLIMBING FREAKY | currency retry | Active operator site publishes current public use, but no current MoonBoard statement. |
| ROCKTIME CLIMBING GYM | primary-availability retry | Current independent material names the board; the former operator domain does not resolve, so it is not promoted. |
| クライミングスポットまっくす | renamed/currency retry | Current operator says it became VOLNY Sagamihara and describes its walls without naming a MoonBoard; the 2019 installer page is historical only. |
| cactus2 | currency retry | Current operator Wix site establishes the venue but contains no MoonBoard statement; directory claims conflict on generation and are not imported. |

Stone Love's operator writes its address compactly as `南川添1205`; Japan's
official GSI address service resolves the normalized `南川添12-5` form to an
exact point without a Google or Apple map dependency. Its current operator
pages also publish the complete regular week. Generation and angle remain
unknown because the operator states neither. Since this independently restarted
pass again found a publishable venue, Japan is still not exhausted and the next
pass must restart from different discovery channels. Japan now has 57 reviewed
decisions and 53 production venues / MoonBoard rows: 34 current, 12 unverified,
seven private, three mislocated and one closed. The whole dataset contains 2,857
venues and 3,145 board rows, including 1,535 MoonBoards at 1,411 venues, 1,816
official websites and 1,330 complete regular weeks.

The next restart searched Japanese operator pages by installation language
(`ムーンボードを設置`, `ムーンボード設置`, `MoonBoardを設置`, and
`ムーンボード導入`) rather than by directory membership. The current operator
pages found for RIOT Climbing, ao_roc and Rainbow Cliff resolve to already
reviewed production venues. Edge and Sofa's operator archive explicitly closes
the old Suwa installation on 27 February 2022, and the private-home construction
results are non-public by their own descriptions. The remaining outcomes are:

| Candidate | Outcome | Primary-source boundary |
| --- | --- | --- |
| Climbing Gym Canyon | published | Current operator homepage names its public 2019 MoonBoard at 40 degrees, exact address and complete week; official GSI address point. |
| ボルダリングジム キイストーン三川 | closed/withheld | The board claim survives only on the operator's old LINE page; the Mikawa venue closed in October 2022, so current-looking directory rows are rejected. |

Canyon is absent from the frozen registry and has no nearby production venue,
so the official GSI point does not create a duplicate. Its operator explicitly
states the setup as 2019 at 40 degrees; LEDs remain unknown. Because this
different-channel restart again yielded a publishable venue, Japan is still not
exhausted and another independent pass is required. Japan now has 58 reviewed
decisions and 54 production venues / MoonBoard rows: 35 current, 12 unverified,
seven private, three mislocated and one closed. The whole dataset contains 2,858
venues and 3,146 board rows, including 1,536 MoonBoards at 1,412 venues, 1,817
official websites and 1,331 complete regular weeks.

The following restart used Japanese wall-builder portfolios and additional
operator phrasing (`ムーンボードがあります`, `ムーンボード完備`, and exact
2019 wording). Installer results for Sarukichi and TO-DO resolve to already
reviewed venues; every other named installation found there explicitly describes
a private home. CAL-COLO, BolBol, Monolithe Kawagoe, RIOT and Colorful Rock also
resolve to existing reviewed production rows. The apparent Climbing Bum Yokohama
gap was an identity/geometry defect rather than a missing row: production called
it only `ClimbingBUM`, derived the nearby city Azamino, and placed it about 120 m
south of the address on its current branch page. The same page explicitly names
the illuminated MoonBoard, while Japan's official GSI address service resolves
the exact Nakagawachuo 1-25-1 point. This pass therefore corrects the existing
row to the branch name, Yokohama, exact address and official point without adding
a duplicate. Because this restart still yielded verifiable information, it is
not a zero-yield exhaustion pass and Japan must be searched again.
