# Web-only board discovery

This is the independent discovery track for public boards that do not occur in
any app feed, manufacturer locator or registry. It is deliberately separate from
source reconciliation: a result may be valuable precisely because no structured
source knows it.

`web-only-discovery-matrix.json` defines ten supported board systems, common
spellings/models, twelve world regions, multilingual venue/facility/training and
opening/installation/renovation/news/social lexicons, and two independent pass
formulations. `web-only-discovery-ledger.json` records exact completed queries and
candidate dispositions. Its separate `rechecks` array preserves historical repeat
work completed before the primary-cell-only policy took effect; those records
remain auditable but create no further work. The Cartesian completion denominator
is 2 passes × 10 boards × 12 regions = 240 primary cells. Each primary cell is
searched exactly once, and historical rechecks never inflate that denominator.

Run `node tools/web-only-discovery-audit.mjs`. A cell is complete only when it
records its date, languages, exact queries, reviewed-result count and candidate
count. Empty result sets still need the exact query record. Search snippets,
directories, sitemaps and public operator social profiles are discovery signals,
not production evidence. A candidate is published only after the current
official venue page establishes public access and the board, with legitimate
geodata and the normal repository provenance rules. Uncertain, closed, private,
seasonal, inaccessible and contradictory cases remain explicit outcomes.

Pass A combines board spellings with venue, facility, training-area and FAQ
terms. Pass B independently combines them with opening, installation,
renovation, news/blog and operator-social terms. Both must cover every matrix
cell exactly once. A productive cell is integrated and validated but does not
restart its region, board or pass. Retryable technical failures are documented in
the candidate or research ledger and likewise do not trigger a whole-cell rerun.
Web-only completion means all 240 primary cells have reproducible coverage,
remaining technical blockers are explicit, and the integrated production diff has
passed central regeneration, reports, full tests and a privacy/leak audit. The
three initial candidate rows document pre-track Japanese web-only findings and
intentionally count as zero completed cells.

## Primary-cell completion allocation (2026-09-01)

The primary-only transition was frozen at integration commit `e0f379a`, with 24
of 240 primary cells complete and 216 open. The open keys are partitioned without
overlap across three isolated worktrees based on that same commit:

- `research/web-primary-tension-decoy`: Tension, Grasshopper and Decoy, Passes A
  and B in all twelve regions (72 cells).
- `research/web-primary-soill-aurora`: So iLL, Touchstone and Aurora, Passes A and
  B in all twelve regions (72 cells).
- `research/web-primary-moon-kilterb`: MoonBoard and 12Climb, Passes A and B in
  all twelve regions, plus Pass B only for Kilter and Quantum (72 cells).

Kilter Pass A and Quantum Pass A were already represented by the 24 completed
primary cells and are excluded from every worker package. The main
`research/board-data-completion` worktree is integration-only while those workers
run. Generated data and static HTML are rebuilt there only after all reviewed
worker commits are merged.
