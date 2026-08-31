# Quantum Board location audit

Checked 2026-08-25. The public map uses only active venues with a complete
address, usable coordinates and an explicit primary-source statement that a
Quantum Board is installed. `quantum-locations.json` contains the nine records
that passed. It also retains the exact public evidence used for each marker.

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
- La Roca Asunción: a Quantum Board M is confirmed, but no sufficiently
  reliable full address and coordinate pair was found.
- Sputnik Lugones, The Pad Las Vegas, Monoliet and Gamsbloc: announced or
  planned, not verified as active.
- Madrid 2025, Paris, CWA and HFA installations: temporary trade-show or event
  boards, not durable public venues.

This audit is intentionally conservative. Missing a pin is preferable to
directing climbers to a test record, private facility or board that is not yet
open.

