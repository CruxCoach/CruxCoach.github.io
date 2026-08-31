// Small, reviewable supplement for public venues that an official venue page
// confirms but the upstream location feeds omit. Keep this source deliberately
// narrow: correct existing upstream rows in tools/overrides.json instead.
//
// MoonBoard's location feed has been frozen since 2026-05-14, so official venue
// pages are currently the only durable source for additions such as these.

const ENTRIES = [
  {
    // https://www.boulderwelt-muenchen-ost.de/halle/
    source: 'curated',
    board: 'moonboard',
    name: 'Boulderwelt München Ost',
    lat: 48.12578,
    lon: 11.61108,
    city: 'München',
    country: 'DE',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // https://www.boulderwelt-hamburg.de/halle/
    source: 'curated',
    board: 'moonboard',
    name: 'Boulderwelt Hamburg',
    lat: 53.55395,
    lon: 10.02095,
    city: 'Hamburg',
    country: 'DE',
    commercial: true,
    led: true,
    variant: null,
    angle: null,
  },
];

export async function load() {
  return {
    entries: ENTRIES.map(entry => ({ ...entry })),
    meta: {
      entries: ENTRIES.length,
      verified_on: '2026-08-31',
      policy: 'official-venue-pages',
    },
  };
}
