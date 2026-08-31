# 12Climb location review

The manufacturer maintains a public Google My Maps KML, consumed by
`@hangtime/climbing-boards` as `12climb.geojson`:

```text
https://www.google.com/maps/d/kml?mid=193vm5XWh8uVnqQS71aVd130TNV2JkDnA&forcekml=1
```

The 2026-08-31 live source contains 35 placemarks and now names all of them.
Hangtime 1.0.92's frozen conversion exposes only four names and leaves the
other 31 identities in free-form `description`, which the generic adapter
correctly refuses to publish. This review treats all manufacturer identities as
candidate evidence only. A row enters `sources/curated.mjs` only when a current
official venue page independently establishes public access and identity.

The live comparison is reproducible and backed by the disposition ledger:

```bash
node tools/12climb-locations-audit.mjs
node tools/12climb-locations-audit.mjs --json
```

The manufacturer's current [Board School page](https://www.12climb.com/12climb-board-school/)
states that the school product is installed in sports halls for physical
education, describes teacher-controlled use, and names several Kyiv schools.
Such a point is not a public climbing venue merely because the school is
municipally owned. Named school rows that had slipped through the adapter are
therefore backed `non-public` exclusions; unnamed school rows remain rejected
at ingestion. The public KPIskala venue is the exception: its own current site
offers climbing by prior arrangement and confirms both boards.

## Complete placemark disposition

`id` is the zero-based feature order in the manufacturer KML/derived GeoJSON;
coordinates are `lat, lon`. `published` means current public production data,
not merely accepted as a candidate.

| id | Coordinate | Manufacturer identity | Decision |
| ---: | --- | --- | --- |
| 0 | 50.4425234, 30.4495923 | KPIskala Classic | published; named upstream, official venue site |
| 1 | 50.4428380, 30.4493219 | KPIskala Board School | published; school-model board inside the verified public KPIskala venue |
| 2 | 50.4887793, 30.4906293 | Climbing SPACE | published via curated source; official venue page confirms public gym, address and interactive board |
| 3 | 50.4746182, 30.4419458 | Technical Lyceum Kyiv | non-public school installation |
| 4 | 50.4161340, 30.4683816 | Gymnasium Millennium 318 | removed by backed `non-public` exclusion |
| 5 | 50.4729180, 30.5129492 | Gymnasium 107 Vvedenska | removed by backed `non-public` exclusion |
| 6 | 50.4327164, 30.4871464 | School 221 | non-public school installation |
| 7 | 50.4200512, 30.5173051 | School 37 | non-public school installation |
| 8 | 50.4173030, 30.5218166 | School 130 | non-public school installation |
| 9 | 50.4931937, 30.4078388 | School 45 | non-public school installation |
| 10 | 50.4728109, 30.4767764 | School 1 | non-public school installation |
| 11 | 50.4789751, 30.4028252 | School 95 | non-public school installation |
| 12 | 50.4130181, 30.6316137 | Slovyanska Gymnasium | non-public school installation |
| 13 | 50.4242990, 30.6474903 | School 105 | non-public school installation |
| 14 | 50.4525777, 30.4936768 | Lyceum 38 | non-public school installation |
| 15 | 50.4145400, 30.6582892 | School 274 | non-public school installation |
| 16 | 50.4519326, 30.4690384 | School 102 | non-public school installation |
| 17 | 50.4220206, 30.4661904 | School 144 | non-public school installation |
| 18 | 50.4721420, 30.4452910 | School 24 | non-public school installation |
| 19 | 50.4779190, 30.4357540 | School 28 | non-public school installation |
| 20 | 51.5240544, 30.7534405 | Slavutych sport center | unresolved; no current branch-specific primary page proving public access and board persistence found |
| 21 | 38.2058679, 128.5299501 | National Climbing School, South Korea | unresolved; manufacturer opening article is historical and no current public-access primary source was established |
| 22 | 50.4577979, 30.5185049 | School 25 | non-public school installation |
| 23 | 50.4321962, 30.5492333 | School 171 | non-public school installation |
| 24 | 50.4558006, 30.4999467 | School 138 | non-public school installation |
| 25 | 50.4693718, 30.4162178 | School 172 | non-public school installation |
| 26 | 49.2767636, 23.5186334 | School 2 | non-public school installation |
| 27 | 50.3335010, 30.3510772 | Britannica School | non-public school installation |
| 28 | 50.4464461, 30.4430291 | Funattic | published via curated source; current official venue page confirms public gym and address |
| 29 | 50.4734096, 30.4985010 | Hyperion Kyiv | published via curated source; current official venue page confirms public gym and address |
| 30 | 50.5077410, 30.5028590 | School 239 | non-public school installation |
| 31 | 50.0381060, 36.2849011 | Block climbing gym, Kharkiv | unresolved; historical operator evidence identifies a climbing space and 2021 installation, but no current operator-controlled public-access page was found |
| 32 | 50.9083891, 34.8006634 | Sumy Palace of Children and Youth | unresolved; youth institution, with no current public drop-in access evidence |
| 33 | 46.4723569, 30.7025312 | SK Dynamica, Odesa | published via curated source; current operator page confirms public drop-in climbing, exact address, 12Climb wall and complete regular week |
| 34 | 50.3783394, 30.4840921 | Midgard School | non-public school installation |

## Balance after the live-name pass

- 6/35 points are published public venues: two existing KPIskala rows and
  four recovered from the manufacturer source with venue-primary evidence.
- 25/35 are explicitly identified school installations and are not public
  venue candidates on the available primary evidence.
- 4/35 remain unresolved: Slavutych, the historical South Korean National
  Climbing School, Block Kharkiv and the Sumy youth institution lack current,
  unambiguous operator evidence for public access and board persistence.
- No coordinates, descriptions, or identities are inferred from Google Maps;
  the Google-hosted file is the manufacturer's own declared source. Search and
  directory results were used only to locate primary pages.

Recheck the four unresolved rows on a later exhaustion pass. A new public row
still requires a current official venue or institution page; an old
manufacturer placemark by itself is deliberately insufficient.
