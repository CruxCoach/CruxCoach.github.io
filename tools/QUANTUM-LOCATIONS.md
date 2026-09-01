# Quantum Board location audit

Checked 2026-09-01. The public map uses only active venues with a complete
address, usable coordinates and an explicit primary-source statement that a
Quantum Board is installed. `quantum-locations.json` contains the twelve records
that passed. It also retains the exact public evidence used for each marker.

The 2026-08-31 pass rechecked all nine published venues against their current
operator or manufacturer pages. It also searched Walltopia's current public
project catalogue and product material, the named operator sites below, and
exact-name/location queries for additional installations. Walltopia's public
WordPress API and sitemap are Cloudflare-blocked, so the catalogue could not be
enumerated through a machine endpoint; the ordinary public project pages and
search index were used without attempting to bypass that restriction. The pass
found one newly documented installation, La Roca, but no new publishable pin.

An independent multilingual open-web pass on 2026-09-01 found three current
installations absent from the structured eWalls audit and the reviewed
allowlist: Chletterai in Appenzell, Das Kraftwerk in Althofen and Presa B+ in
Bologna. Each venue's current official page explicitly names its Quantum Board
and exact address. Coordinates come from the Swiss and Austrian official
address registers for the first two and an independently matched exact OSM
street-number point for Presa B+. The queries and candidate decisions are
recorded in `web-only-discovery-ledger.json`.

## eWalls location API audit

The authenticated eWalls location/wall catalogue contained 15 distinct venue
records. Credentials were supplied to the existing sync process and were never
printed or stored. The API is useful for discovery, but it does not reliably
say which public venue owns a Quantum Board, so every candidate was checked
against a public venue or manufacturer source.

| API record | Result |
|---|---|
| Quantum S | Excluded: hidden test record with null-island coordinates; not a public venue. |
| Fitness Board | Excluded: hidden test record with null-island coordinates. |
| Quantum Board M | Excluded: hidden test record with null-island coordinates; no public installation mapping. |
| Fitness Board Vasko | Excluded: hidden test record with null-island coordinates. |
| WICS Set&Send | Excluded: hidden test/integration record, not a public Quantum venue. |
| Momentum Indoor Climbing Sofia | Included after the venue's official equipment page confirmed Quantum. |
| Quantum Belay Board | Merged into Momentum Plovdiv; it is a board record at the same venue, not another location. |
| Momentum Indoor Climbing Plovdiv | Included; its official page names both Quantum XL and Belay. |
| Vertical World Paris | Excluded: eWalls-enabled walls, but no primary evidence of a Quantum Board. |
| ABC Climbing Academy Naperville | Excluded: eWalls/LED wall venue, but no primary evidence of Quantum. |
| Raboutou Barn | Excluded: private location. |
| Momentum Indoor Climbing Fort Union | Excluded: official amenities list Kilter and Tension, not Quantum. |
| Momentum Indoor Climbing Trolley Square | Included after its official tour named Quantum Board. |
| Perth Urban Jungle | Excluded: no primary evidence of a Quantum Board. |
| Quantum L | Excluded: hidden test record without usable coordinates or public venue mapping. |

## Other researched candidates not published

- USA Climbing National Training Center, Salt Lake City: a primary event
  document confirms a Quantum Board, but public use is restricted; not a
  normal venue pin.
- La Roca Asunción: Walltopia's current 2026 project page now identifies the
  venue, city, operator account and fixed-angle Quantum Board M. Neither that
  page nor the operator's public Instagram surface publishes a street address
  or usable coordinate, and exact-name discovery searches found no independent
  identity match. It therefore remains withheld for geodata, not board proof.
- Sputnik Lugones: the operator now publishes Avenida de Gijón s/n, the
  planned adjustable Quantum Board XL and a September 2026 target, but its
  branch/contact pages still say `Próximamente`. Recheck after an explicit
  opening notice.
- The Pad Las Vegas: the operator confirms 9400 W Sahara Avenue and a planned
  Quantum Board XL, but projects an early-2027 opening and labels the branch
  `COMING SOON`.
- Monoliet, Roeselare: the operator's current construction update and homepage
  name the planned Walltopia Quantum Board and a 2027 opening. It is not yet an
  active venue.
- Gamsblock, Kiefersfelden: current construction reporting and a public hiring
  notice show a new hall preparing to open in autumn 2026; no current
  operator-controlled page establishes that the planned Quantum Board is open
  to visitors yet.
- Crux Climbing Center, São Domingos de Rana: a community hall directory labels
  the venue as having a Quantum Board, but the current operator equipment page
  explicitly lists Kilter Board and MoonBoard instead. Without primary Quantum
  evidence, the directory claim is rejected.
- Madrid 2025, Paris, CWA and HFA installations: temporary trade-show or event
  boards, not durable public venues.

This audit is intentionally conservative. Missing a pin is preferable to
directing climbers to a test record, private facility or board that is not yet
open.
