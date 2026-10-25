# Shiny Wall location audit

Checked 2026-10-25. Shiny Wall publishes no public location feed or map. The
manufacturer's app lists the walls each gym has marked public; that list
(snapshot of 2026-08-25) is the discovery source. A gym reaches the map only
after a public source pins it to a real, publicly accessible venue.
`shinywall-locations.json` holds the 18 records that passed, with the public
evidence and the origin of every coordinate. None of the app's own data is
copied beyond the gym's name, the board variant and the wall count: wall names,
controller names, logos, routes and anything about app users stay out.

## Selection

1. **Board family.** Only Standard-family boards count — Standard, Standard
   Full, Standard Max, Standard Max Full and the Mini sizes. They share one
   fixed hold layout per variant, which is what a visiting climber needs. Custom,
   Lite, Lasso and other bespoke walls are out of scope, even at gyms that also
   have a Standard board.
2. **Public flag.** The wall must be marked public in the app. That yields 31
   Standard-family walls at 31 gyms, which matches the manufacturer's own claim
   of "over 30 active Standards".
3. **Public venue.** A public venue page, an OpenStreetMap object, an official
   address register or the manufacturer's project list must identify the gym as
   a publicly accessible venue at a specific address. Municipal facilities count
   even where the operator asks for a federation licence.
4. **Coordinate.** In order of preference: the coordinate of a venue already on
   the map (so the boards share one marker), an official street-number point
   (CartoCiudad, Spanish cadastre, Base Adresse Nationale), or the matching
   OpenStreetMap object. Every coordinate names its source and reference.

## Published venues

| Venue | City | Country | Board | Coordinate |
|---|---|---|---|---|
| The Boulder Room | Munich | DE | Standard Max Full | existing Quantum Board venue |
| Ciudad Deportiva Santa María | Alcañiz | ES | Standard | OSM way 858335644 (sports-complex centroid) |
| Climbbox | Almería | ES | Standard | CartoCiudad portal 28 |
| Blokáceres | Cáceres | ES | Standard Max | CartoCiudad portal 21 |
| Boulder Up | Gijón | ES | Standard Max Full | OSM node 14054816401 |
| iCLIMB Jaén | Jaén | ES | Standard | OSM way 931095021 |
| Rocódromo Rawindoor | Logroño | ES | Standard | existing Kilter Board venue |
| Can Bombo | Olot | ES | Standard Full | OSM node 6558072102 |
| Can Còdol | Solsona | ES | Standard | cadastral parcel 6607512CG7560N |
| Gravetat Zero | Terrassa | ES | Standard Max Full | existing Kilter Board venue |
| Indoorwall Vic | Vic | ES | Standard Max Full | CartoCiudad portal 87 |
| Upzone 360 | Rodez | FR | Standard Max Full | BAN 12202_0040_00019 |
| Bloc à Bleau | Samoreau | FR | Standard Max Full | BAN 77442_0150_00010 |
| Vertix Climbing Gym | Calice Ligure | IT | Standard Max Full | OSM node 13243377237 |
| Palestra di arrampicata Koren | Cazzano Sant'Andrea | IT | Standard Max | OSM node 13395238441 |
| Escape Climbing Garden | Collegno | IT | Standard Max Full | OSM node 6590329982 |
| ASD Rockmadness | Sassari | IT | Standard Max | OSM node 10095363695 |
| Hangout | Târgu Mureș | RO | Standard Max Full | existing MoonBoard venue |

Six of the gyms are also named on the manufacturer's own site (project list or
customer testimonials). Gravetat Zero, Upzone 360, Boulder Up, The Boulder Room
and Alcañiz name their Shiny Wall on their own pages.

Notes:

- Gravetat Zero's MoonBoard row from the upstream feed sits about 250 m from
  the gym's address and therefore remains a separate marker; the Shiny Wall
  joins the Kilter Board venue at the address.
- Alcañiz's climbing wall is in the covered frontón of the municipal Ciudad
  Deportiva Santa María. OpenStreetMap does not map the frontón separately, so
  the marker uses the sports complex's centroid (within about 100 m).
- Can Còdol opened in 2025 in a converted industrial building; CartoCiudad has
  no portal for number 2 yet, so the cadastral parcel centroid is used.

## Not published (13 public walls)

| Reason | Walls |
|---|---|
| Trade-fair demonstration walls (not a venue) | 2 |
| Not publicly accessible (military training wall; members-only club room with key access) | 2 |
| Gym named only by its town, or a club whose current wall location is not published | 4 |
| Name is ambiguous or no matching climbing venue was found | 5 |

These can be added once the manufacturer or the venue publishes an address.
Four further gyms have a Standard wall without the public flag in the app; two
of them appear on the manufacturer's site, but the rule above keeps them out
until the flag or another decision changes. Private home walls and internal
test entries are excluded and not listed.

## Attribution

Some coordinates come from OpenStreetMap (© OpenStreetMap contributors, ODbL),
CartoCiudad (© Instituto Geográfico Nacional, CC BY 4.0), the Spanish cadastre
(Dirección General del Catastro) and the Base Adresse Nationale (Licence
Ouverte 2.0).
