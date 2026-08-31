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
| Kilter | `@hangtime/climbing-boards` | official venue/equipment pages | Global manufacturer/registry source and omissions not yet re-audited in this pass |
| Tension | `@hangtime/climbing-boards` | official venue/equipment pages | Same; normalized source currently has usernames only |
| Grasshopper | `@hangtime/climbing-boards` | official venue/equipment pages | Same; low count needs manufacturer-directory review |
| Decoy | `@hangtime/climbing-boards` | official venue/equipment pages | Same; low count needs manufacturer-directory review |
| So iLL | `@hangtime/climbing-boards` | official venue/equipment pages | Same; low count needs manufacturer-directory review |
| Touchstone | `@hangtime/climbing-boards` | official chain pages | Same; chain catalogue needs direct comparison |
| Aurora | `@hangtime/climbing-boards` | official venue/equipment pages | Same; low count needs manufacturer-directory review |
| MoonBoard | `@hangtime/climbing-boards` plus two curated rows | official MoonBoard and venue pages | Variant/angle gaps and stale/private/invalid registry rows require systematic review |
| 12Climb | `@hangtime/climbing-boards` | manufacturer/venue pages | Adapter drops 31 malformed upstream records; exclusion reasons need audit |
| Quantum | reviewed primary-source allowlist | eWalls discovery catalogue plus official pages | Fifteen catalogue records and named external candidates were reviewed on 2026-08-25 |

## Iteration log

Add one row after every material batch. Counts come from the audit command;
accepted evidence and rejected outcomes belong in their policy-owned files.

| Date | Scope | Verified additions/corrections | Remaining objective gaps |
| --- | --- | --- | --- |
| 2026-08-31 | Baseline inventory | None; measurement only | Structured-source audit, stale-marker correction, 410 retry rows, board details, venue fields, Wellpass negatives |
| 2026-08-31 | Stale/invalid marker correction | Removed 14 board rows at twelve closed venues and one wrong-place duplicate; rejected twelve additional MoonBoard registry rows at Null Island. Result: 2,834 venues / 3,079 board rows, zero missing countries, zero closed/duplicate production markers | 124 city gaps, 410 retry rows, 971 MoonBoard variant gaps, 1,318 MoonBoard angle gaps; structured-source audit still open |

## Final exhaustion rule

The work is complete only after every board/system and region, manufacturer or
structured feed, venue chain, existing candidate/research ledger, retryable
error, and missing field has been revisited. Then rerun a separate global pass.
If that pass yields any new verified fact, integrate it and restart the pass.
The final row here must identify the channels that remain objectively blocked
and record an entirely zero-yield pass before the goal may be marked complete.
