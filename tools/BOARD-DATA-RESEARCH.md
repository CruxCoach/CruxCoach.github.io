# Board Map data-completion audit

This is the running balance for the exhaustive public-location and venue-detail
research. It complements the field-specific ledgers in `VENUE-LINKS.md`,
`VENUE-HOURS.md`, `QUANTUM-LOCATIONS.md`, and `venue-audit-ledger.json`.

Reproduce the current quantitative view with:

```bash
node tools/board-data-gap-audit.mjs
node tools/board-data-gap-audit.mjs --json
```

The audit is read-only. Search results, OSM, directories, and guessed domains
remain discovery signals only. A production addition still needs the primary
evidence and identity checks required by the relevant source or overlay policy.

## Baseline — 2026-08-31, commit 23de1b7

- 2,848 venue features, 3,105 board entries, 111 multi-board venues.
- Sources: 3,094 Hangtime entries, two official-page curated entries, and nine
  primary-source-reviewed Quantum installations.
- Per board: Kilter 1,124; Tension 366; Grasshopper 42; Decoy 24; So iLL 12;
  Touchstone 5; Aurora 3; MoonBoard 1,516; 12Climb 4; Quantum 9.
- Location fields: 2,722 venues have an upstream or explicitly hedged nearest
  city label; 126 have neither; one venue has no country.
- Venue details among 2,209 eligible public/commercial venues: 1,771 official
  websites (80.2%) and 1,293 regular opening schedules (58.5%). Wellpass has 86
  positive records; there are no explicit negative records.
- The frozen venue-detail ledger has 1,487 rows and 410 retryable rows. Twelve
  website and thirteen hours rows remain `pending`.
- Board-detail gaps: 980 MoonBoard rows have no verified variant and 1,334 have
  no angle. Two Kilter entries lack an address; all Kilter entries contain a
  `walls` array. The other Hangtime board adapters expose only a registry
  username, so variant/size/angle completeness cannot currently be measured
  from their normalized rows.
- Quality findings requiring a correction path: one null-island Fitbloc marker
  aggregates twelve unrelated MoonBoard records; twelve officially closed
  markers and one known wrong-place duplicate remain published; 97 venues
  contain repeated entries of the same board type (often legitimate distinct
  walls/variants, so this is a review set, not a deletion list).

## Source inventory and exhaustion state

| Board/system | Current structured source | Known supplementary channel | Initial state |
| --- | --- | --- | --- |
| Kilter | `@hangtime/climbing-boards` PowerSync export | Kilter's official public StoreRocket locator plus venue pages | Locator comparison is reproducible; 76 residual candidates remain after the first correction batch |
| Tension | `@hangtime/climbing-boards` plus the current anonymous official-app pin endpoint | official venue/equipment pages | All 368 current pins reconciled in `AURORA-PINS-AUDIT.md`: 367 published and one not-yet-current installation withheld; the two pins newer than Hangtime 1.0.92 were reviewed individually |
| Grasshopper | `@hangtime/climbing-boards` plus the current anonymous official-app pin endpoint | official venue/equipment pages | All 42 current pins match the map; see `AURORA-PINS-AUDIT.md` |
| Decoy | `@hangtime/climbing-boards` plus the current anonymous official-app pin endpoint | official venue/equipment pages | All 24 current pins match the map; see `AURORA-PINS-AUDIT.md` |
| So iLL | `@hangtime/climbing-boards` plus the current anonymous official-app pin endpoint | official venue/equipment pages | All twelve current pins match the map; see `AURORA-PINS-AUDIT.md` |
| Touchstone | `@hangtime/climbing-boards` | official Touchstone chain pages | Current chain catalogue and branch pages fully reconciled in `TOUCHSTONE-CHAIN-BOARDS.md`: five current boards, one future installation excluded, one near-coordinate duplicate merged, and fixed 35°/LED system details normalized |
| Aurora | `@hangtime/climbing-boards` plus the current anonymous official-app pin endpoints | official venue/equipment pages | The three Aurora Climbing, five Touchstone and all 454 family-wide current pins are reconciled; see `AURORA-PINS-AUDIT.md`. Detailed wall records remain authentication-gated and were not accessed |
| MoonBoard | frozen Hangtime registry plus curated rows | official MoonBoard and venue pages | Hangtime documents that MoonBoard removed `GetMapMarkers` in May 2026; no replacement public official location endpoint found yet |
| 12Climb | manufacturer-maintained public Google My Maps KML through Hangtime | manufacturer/venue pages | All 35 placemarks reviewed in `12CLIMB-LOCATIONS.md`: five public venues published, twenty school installations classified non-public, ten objectively unresolved |
| Quantum | reviewed primary-source allowlist | eWalls discovery catalogue plus official pages | Fifteen catalogue records and named external candidates were reviewed on 2026-08-25 |

## Iteration log

Add one row after every material batch. Counts come from the audit command;
accepted evidence and rejected outcomes belong in their policy-owned files.

| Date | Scope | Verified additions/corrections | Remaining objective gaps |
| --- | --- | --- | --- |
| 2026-08-31 | Baseline inventory | None; measurement only | Structured-source audit, stale-marker correction, 410 retry rows, board details, venue fields, Wellpass negatives |
| 2026-08-31 | Stale/invalid marker correction | Removed 14 board rows at twelve closed venues and one wrong-place duplicate; rejected twelve additional MoonBoard registry rows at Null Island. Result: 2,834 venues / 3,079 board rows, zero missing countries, zero closed/duplicate production markers | 124 city gaps, 410 retry rows, 971 MoonBoard variant gaps, 1,318 MoonBoard angle gaps; structured-source audit still open |
| 2026-08-31 | Kilter manufacturer locator, first pass | Added a reproducible, networked comparison against Kilter's public manufacturer locator. Of 1,220 locator rows, 1,213 had usable coordinates. After the batch, 1,022 match an existing Kilter venue within 250 m, twelve match backed exclusions, 33 are explicitly private, and 70 are likely coordinate drift. Primary evidence added ICP Boulder Hall & Showroom (Kilter and Tension), Far North, and Iron Cliffs; moved Spire's Kilter details from the wrongly geocoded main facility onto its real multi-board Training Center. The residual candidate list fell from 81 to 76. | Review all 76 residual locator candidates and every probable-drift row; explicitly ledger stale branches such as old BFF Bukit Timah and moved The Font Wandsworth. |
| 2026-08-31 | BLOCK DOCK branch correction | Replaced one upstream MoonBoard marker at a city-centre default point with the operator's two current branches: MoonBoard at Rača and Kilter at Petržalka. Added branch-specific official sites and both complete regular weeks. | Recheck other multi-branch operator rows and coordinate-drift findings for the same failure mode. |
| 2026-08-31 | 12Climb manufacturer KML | Audited all 35 placemarks. Recovered Climbing SPACE, Funattic, and Hyperion Kyiv from unnamed manufacturer rows using current official venue evidence, including all three websites and complete regular weeks. Removed the two named school-only markers that had passed the adapter; twenty school installations are non-public, and ten identity/access cases remain explicitly unresolved. Result: 2,838 venues / 3,085 board rows; 12Climb rises from four to five public venues; websites 1,778 and hours 1,299. | 124 city gaps and 409 retry rows remain. Retry the ten unresolved 12Climb points during the final pass; do not infer access for schools, youth institutions, or the historical national-school installation. |
| 2026-08-31 | Touchstone chain training-board inventory | Reconciled every current and announced Touchstone, Kilter, MoonBoard and Tension installation named in the operator's official guide. Restored five current MoonBoards omitted by the frozen registry, merged Class 5's 10 m duplicate without losing its Touchstone Board, corrected Great Western Power Company's Kilter size to the operator-stated adjustable 12×12 Original, and normalized all five Touchstone Boards as fixed 35° with LEDs. Added Cliffs of Id's official page and complete regular week. Result: 2,838 venues / 3,090 board rows, 113 multi-board venues; websites remain 1,778 and hours 1,299; MoonBoard variant gaps fall to 971 and angle gaps to 1,323. | 124 city gaps and 409 retry rows remain. Touchstone's two explicitly future installations stay excluded; the wider Kilter candidate/drift audit, non-chain MoonBoard recovery and other manufacturers remain open. |
| 2026-08-31 | Aurora-family live app pins | Added a reproducible comparison of all six anonymous manufacturer-app pin endpoints: 454 valid rows and no malformed rows. Reconciled every pin. Added Tension at KiipeilyAreena Salmisaari from the current pin plus official branch/expansion evidence, moved its existing Kilter point 11 m to form one real two-board venue, and added the official website and complete regular public week. Withheld Tilted Climbing's new Tension pin because the venue still says “coming soon”; its exact backed exclusion is deliberately unmatched against Hangtime 1.0.92 and will prevent a premature marker when the package refreshes. Result: 2,838 venues / 3,091 board rows, 114 multi-board venues; Tension rises to 368; websites 1,779, hours 1,300, retry queue 408. | The live anonymous location surfaces are exhausted for Tension, Grasshopper, Decoy, So iLL, Touchstone and Aurora. Authentication-gated wall detail was not accessed. Recheck the announced Tilted board and all endpoints in the final pass; Kilter residuals, MoonBoard recovery and 408 retry rows remain open. |

## Final exhaustion rule

The work is complete only after every board/system and region, manufacturer or
structured feed, venue chain, existing candidate/research ledger, retryable
error, and missing field has been revisited. Then rerun a separate global pass.
If that pass yields any new verified fact, integrate it and restart the pass.
The final row here must identify the channels that remain objectively blocked
and record an entirely zero-yield pass before the goal may be marked complete.
