// Small, reviewable supplement for public venues that an official venue page
// confirms but the upstream location feeds omit. Keep this source deliberately
// narrow: correct existing upstream rows in tools/overrides.json instead.
//
// MoonBoard's location feed has been frozen since 2026-05-14, so official venue
// pages are currently the only durable source for additions such as these.

const ENTRIES = [
  {
    // Current presence: https://www.boulderwelt-muenchen-ost.de/halle/
    // LED + 40°: https://www.boulderwelt-muenchen-ost.de/moonboard/
    source: 'curated',
    board: 'moonboard',
    name: 'Boulderwelt München Ost',
    lat: 48.12578,
    lon: 11.61108,
    city: 'München',
    country: 'DE',
    commercial: true,
    led: true,
    variant: null,
    angle: 40,
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
  {
    // Public venue, address, and both boards:
    // https://climbicp.com/au/first-visit/
    // Kilter access/layout/size/frame/angle and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029866)
    source: 'curated',
    board: 'kilter',
    name: 'ICP Boulder Hall & Showroom',
    lat: -27.4549218,
    lon: 153.0328871,
    address: '1/435 St Pauls Tce, Fortitude Valley, QLD 4006',
    city: 'Fortitude Valley',
    country: 'AU',
    walls: [{
      wall_name: null,
      layout: 'Homewall — Full Ride',
      size_id: null,
      size_label: '7x10',
      adjustable: false,
      angle: 40,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // https://climbicp.com/au/first-visit/ identifies a Tension Board at the
    // same public Boulder Hall and prints the branch address.
    source: 'curated',
    board: 'tension',
    name: 'ICP Boulder Hall & Showroom',
    lat: -27.4549218,
    lon: 153.0328871,
    city: 'Fortitude Valley',
    country: 'AU',
  },
  {
    // Current branch, public access, address, and board:
    // https://www.blockdock.me/petrzalka
    // Coordinate corroboration: the EINPARK building at the printed address.
    source: 'curated',
    board: 'kilter',
    name: 'BLOCK DOCK Petržalka',
    lat: 48.1312802,
    lon: 17.0998312,
    address: 'EINPARK, Einsteinova 33, 851 01 Petržalka',
    city: 'Bratislava',
    country: 'SK',
    walls: [],
  },
  {
    // Current branch, public access, address, and board:
    // https://www.blockdock.me/raca
    // The point is inside the building at the printed Púchovská 14 address.
    source: 'curated',
    board: 'moonboard',
    name: 'BLOCK DOCK Rača',
    lat: 48.2146345,
    lon: 17.1641254,
    city: 'Bratislava',
    country: 'SK',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current branch address and adjustable Kilter Board:
    // https://www.spireclimbing.com/hours-locations
    // Wall layout/size comes from the Kilter registry row being corrected;
    // its branch coordinate/address were wrong, not its listed wall.
    source: 'curated',
    board: 'kilter',
    name: 'Spire Climbing + Fitness Training Center',
    lat: 45.67642,
    lon: -111.14422,
    address: '10 Innovation Ln Unit C, Bozeman, MT 59718',
    city: 'Bozeman',
    country: 'US',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: 10,
      size_label: '12x12, with Kickboard',
      adjustable: true,
      angle: 40,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: 3,
    }],
  },
  {
    // Current public gym, address, and hours: https://farnortharcata.com/
    // Board/access/layout/size/range and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029525)
    source: 'curated',
    board: 'kilter',
    name: 'Far North Climbing Gym',
    lat: 40.8709508,
    lon: -124.0899342,
    address: '1065 K Street Suite C, Arcata, CA 95521',
    city: 'Arcata',
    country: 'US',
    walls: [{
      wall_name: null,
      layout: 'Original',
      size_id: null,
      size_label: '12x12',
      adjustable: true,
      angle: null,
      min_angle: 25,
      max_angle: 70,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public gym and city: https://ironcliffs.com/
    // Board/access/layout/size/frame, address, and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 30213490)
    source: 'curated',
    board: 'kilter',
    name: 'Iron Cliffs Gym',
    lat: 37.6878446,
    lon: -113.081693,
    address: '609 W 1450 N Suite 2, Cedar City, UT 84721',
    city: 'Cedar City',
    country: 'US',
    walls: [{
      wall_name: null,
      layout: 'Original',
      size_id: null,
      size_label: '16x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
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
