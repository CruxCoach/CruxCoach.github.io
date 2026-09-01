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
    // Current public venue, address, and MoonBoard generation:
    // https://www.boardworksclimbing.com/
    // Board dimensions and adjustable range:
    // https://www.boardworksclimbing.com/amenities
    source: 'curated',
    board: 'moonboard',
    name: 'Boardworks Climbing',
    lat: 44.03913,
    lon: -121.3032,
    city: 'Bend',
    country: 'US',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public venue, board generation, and address/coordinates:
    // https://www.rockhavenclimbing.com/facility/
    // https://www.rockhavenclimbing.com/
    source: 'curated',
    board: 'moonboard',
    name: 'Rock Haven Climbing Gym',
    lat: 45.52658504620519,
    lon: -122.43448777322068,
    city: 'Gresham',
    country: 'US',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current branch, public access, fixed angle, and board generation:
    // https://thefrontclimbingclub.com/ogden/amenities/
    source: 'curated',
    board: 'moonboard',
    name: 'The Front Climbing Club Ogden',
    lat: 41.2311,
    lon: -111.97512,
    city: 'Ogden',
    country: 'US',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: 40,
  },
  {
    // Current branch, public access, exact branch address, fixed angle, and
    // board generation: https://beyondbouldering.com.au/thebarton/
    // The coordinate is its existing address-bearing Kilter/Tension venue.
    source: 'curated',
    board: 'moonboard',
    name: 'Beyond Bouldering Thebarton',
    lat: -34.91386,
    lon: 138.57631,
    city: 'Thebarton',
    country: 'AU',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: 40,
  },
  {
    // Current branch, public access, address, and board generation:
    // https://www.boulderco.co.nz/locations/christchurch/facility-chch/
    // The coordinate is its existing Kilter venue and sits four metres from
    // the operator's current structured location point.
    source: 'curated',
    board: 'moonboard',
    name: 'Boulder Co Christchurch',
    lat: -43.53832,
    lon: 172.59476,
    city: 'Riccarton',
    country: 'NZ',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public venue and adjustable 25°-40° 2024 MoonBoard:
    // https://gallerybouldering.co.uk/facilities/
    // Address: https://gallerybouldering.co.uk/ ; coordinate independently
    // matched to that exact address through OpenStreetMap/Nominatim.
    source: 'curated',
    board: 'moonboard',
    name: 'Gallery Bouldering',
    lat: 51.7474718,
    lon: -1.2401007,
    city: 'Oxford',
    country: 'GB',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public access, both MoonBoards, address, exact coordinate, and
    // hours: https://hangdog.com.au/bouldering and https://hangdog.com.au/
    // The venue also has a second Classic board; the public map schema stores
    // one row per system/venue, so the current 2024 generation is represented.
    source: 'curated',
    board: 'moonboard',
    name: 'Hangdog Climbing Gym Wollongong',
    lat: -34.436991,
    lon: 150.886987,
    city: 'Wollongong',
    country: 'AU',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current branch, public access, address, and board generation:
    // https://social-climbing.com/centres/coventry
    source: 'curated',
    board: 'moonboard',
    name: 'Social Climbing Coventry',
    lat: 52.40906,
    lon: -1.51112,
    city: 'Coventry',
    country: 'GB',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public venue, exact address, and 2024 MoonBoard generation:
    // https://www.soloescalade.fr/
    // The coordinate is its existing address-bearing Kilter venue. The page
    // does not state LEDs or an angle, so neither is inferred.
    source: 'curated',
    board: 'moonboard',
    name: 'Solo Escalade Toulouse',
    lat: 43.62005,
    lon: 1.42052,
    city: 'Toulouse',
    country: 'FR',
    commercial: true,
    led: null,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public venue, exact address, and 2024 hold configuration:
    // https://rainbowrocket-boulders.de/
    // The coordinate is its existing address-bearing Kilter venue.
    source: 'curated',
    board: 'moonboard',
    name: 'Rainbow Rocket Boulders',
    lat: 47.7387,
    lon: 10.33247,
    city: 'Kempten Bavaria',
    country: 'DE',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: null,
  },
  {
    // Current public venue, MoonBoard, address and ordinary weekday access:
    // https://www.doubledyno.it/palestra
    // https://www.doubledyno.it/contatti
    // The point independently matches the exact street number in OSM.
    source: 'curated',
    board: 'moonboard',
    name: 'Double Dyno',
    lat: 39.2538197,
    lon: 9.1132358,
    city: 'Cagliari',
    country: 'IT',
    commercial: true,
    led: true,
    variant: null,
    angle: null,
  },
  {
    // Current member club, exact address, current Tension Board 2 and its
    // adjustable 25°-60° range: https://tsvbouldern.de/
    // The public schema has no Tension wall-detail fields; retain the verified
    // system presence without inventing an app username.
    source: 'curated',
    board: 'tension',
    name: 'TSV 1846 Nürnberg - Bouldern',
    lat: 49.4521018,
    lon: 11.0766654,
    city: 'Nürnberg',
    country: 'DE',
  },
  {
    // Current public venue, exact address, and MoonBoard presence:
    // https://www.lezardclimb.it/
    // The exact named venue point is independently corroborated by OSM. The
    // operator does not state the generation, LEDs or angle, so they stay null.
    source: 'curated',
    board: 'moonboard',
    name: 'Lezard',
    lat: 45.6792606,
    lon: 8.9475553,
    city: 'Mozzate',
    country: 'IT',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current branch, exact address, 2024 setup, LEDs and fixed 40° angle:
    // https://www.portsideboulders.com.au/locations/oconnor
    // https://www.portsideboulders.com.au/post/moonboard
    // The exact address point is independently corroborated by OSM.
    source: 'curated',
    board: 'moonboard',
    name: "Portside Boulders O'Connor",
    lat: -32.0577678,
    lon: 115.7856163,
    city: "O'Connor",
    country: 'AU',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: 40,
  },
  {
    // Current branch, exact address, 2019 setup, LEDs and fixed 40° angle:
    // https://www.portsideboulders.com.au/locations/willetton
    // https://www.portsideboulders.com.au/post/moonboard
    // The exact address point is independently corroborated by OSM.
    source: 'curated',
    board: 'moonboard',
    name: 'Portside Boulders Willetton',
    lat: -32.0400023,
    lon: 115.8865878,
    city: 'Willetton',
    country: 'AU',
    commercial: true,
    led: true,
    variant: 'mb2019-masters',
    angle: 40,
  },
  {
    // Current branch, public access, 2024 setup, LEDs and fixed 40° angle:
    // https://www.portsideboulders.com.au/locations/joondalup
    // https://www.portsideboulders.com.au/post/moonboard
    // Co-locate with the current manufacturer-app Decoy venue.
    source: 'curated',
    board: 'moonboard',
    name: 'Portside Boulders Joondalup',
    lat: -31.75081,
    lon: 115.76338,
    city: 'Joondalup',
    country: 'AU',
    commercial: true,
    led: true,
    variant: 'mb2024',
    angle: 40,
  },
  {
    // Current public venue, exact address, LED MoonBoard and regular access:
    // https://bol-bol.com/gym/facilities
    // The venue-owned map configuration places its marker at this coordinate.
    // The operator does not state a generation or angle.
    source: 'curated',
    board: 'moonboard',
    name: 'BolBol',
    lat: 35.600647,
    lon: 139.352181,
    address: '神奈川県相模原市緑区橋本4-9-28',
    city: 'Sagamihara',
    country: 'JP',
    commercial: true,
    led: true,
    variant: null,
    angle: null,
  },
  {
    // Current public venue and MoonBoard:
    // https://climbing-bluebird.jp/about
    // Its exact 米沢町13 address resolves to the representative lot point in
    // MLIT's 2025 block-level location-reference file 10_2025.csv.
    source: 'curated',
    board: 'moonboard',
    name: 'Blue Bird BOULDERING GYM',
    lat: 36.263468,
    lon: 139.347351,
    address: '群馬県太田市米沢町13番地',
    city: 'Ota',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, MoonBoard, exact address and regular access:
    // https://park.hyoutanjima.jp/
    // 東町4丁目1 in MLIT's 2025 block-level location-reference file
    // 21_2025.csv supplies this representative address point.
    source: 'curated',
    board: 'moonboard',
    name: 'ボルダリング＆クライミングパーク ひょうたん島 大垣店',
    lat: 35.370733,
    lon: 136.647393,
    address: '岐阜県大垣市東町4丁目1番地3',
    city: 'Ogaki',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, MoonBoard, exact address and regular access:
    // https://www.westrock-climbing.com/intro_fuchu/
    // 分梅町5丁目9 in MLIT's 2025 block-level location-reference file
    // 13_2025.csv supplies this representative address point. The coordinate
    // in the page's Google-derived JSON-LD is 1.6 km away and is not used.
    source: 'curated',
    board: 'moonboard',
    name: 'WEST ROCK Fuchu',
    lat: 35.662423,
    lon: 139.462647,
    address: '東京都府中市分梅町5-9-1',
    city: 'Fuchu',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, app-connected MoonBoard and exact address:
    // https://climbingcenter.jp/floor
    // The operator states a 130-degree wall (40 degrees from vertical).
    // 立野原東1511 in MLIT's 2025 block-level location-reference file
    // 16_2025.csv supplies this representative address point.
    source: 'curated',
    board: 'moonboard',
    name: '桜ヶ池クライミングセンター',
    lat: 36.50025,
    lon: 136.872064,
    address: '富山県南砺市立野原東1511',
    city: 'Nanto',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: 40,
  },
  {
    // Current public venue, exact address and current 2016 setup:
    // https://colorfulrock.com/climbingwall
    // The venue's own JSON-LD and MLIT's 2025 block-level reference point for
    // 須成町3丁目14 independently give the same coordinate.
    source: 'curated',
    board: 'moonboard',
    name: 'カラフルロック Colorful Rock',
    lat: 35.115149,
    lon: 136.872711,
    address: '愛知県名古屋市港区須成町3丁目14番',
    city: 'Nagoya',
    country: 'JP',
    commercial: true,
    led: null,
    variant: 'mb2016',
    angle: null,
  },
  {
    // Current public venue and MoonBoard:
    // https://bto9-ga.com/
    // The operator's current address replaced 府相町端廻796 after the 2021
    // land readjustment. The municipal old/new-address table links that parcel
    // to 府相町一丁目, and MLIT's 2018 lot record supplies its representative
    // point. Generation, LEDs and angle are not stated on the current page.
    source: 'curated',
    board: 'moonboard',
    name: 'ボルダTO9蒲郡店',
    lat: 34.821599,
    lon: 137.236109,
    address: '愛知県蒲郡市府相町一丁目110番地',
    city: 'Gamagori',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current reservation-based public venue, 2019 Masters LED MoonBoard and
    // exact address: https://roconess.com/climbing%E3%82%A8%E3%83%AA%E3%82%A2/
    // MLIT's 2025 block-level location-reference file 04_2025.csv supplies the
    // representative point for 白石市字兎作3.
    source: 'curated',
    board: 'moonboard',
    name: 'ROCONESS',
    lat: 38.001454,
    lon: 140.624956,
    address: '宮城県白石市字兎作3-1',
    city: 'Shiroishi',
    country: 'JP',
    commercial: true,
    led: true,
    variant: 'mb2019-masters',
    angle: null,
  },
  {
    // Current public venue and MoonBoard:
    // https://itte-climbing.com/wall-and-facilities.html
    // The exact 久万ノ台639 lot in MLIT's 2025 block-level
    // location-reference file 38_2025.csv supplies this point. The operator
    // does not state generation, LEDs or angle.
    source: 'curated',
    board: 'moonboard',
    name: '愛媛クライミングジム iTTE',
    lat: 33.861438,
    lon: 132.742492,
    address: '愛媛県松山市久万ノ台639-1',
    city: 'Matsuyama',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, MoonBoard and exact address:
    // https://aoroc.jp/facility/
    // MLIT's 2025 block-level location-reference file 08_2025.csv supplies the
    // representative point for 鹿嶋市宮津台4752. The operator does not state
    // generation, LEDs or angle.
    source: 'curated',
    board: 'moonboard',
    name: 'アオロク ao_roc.climbing',
    lat: 35.983114,
    lon: 140.642811,
    address: '茨城県鹿嶋市宮津台4752-10',
    city: 'Kashima',
    country: 'JP',
    commercial: true,
    led: null,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, exact address and LED MoonBoard:
    // https://cal-colo.com/
    // Co-locate with its existing exact-address Kilter venue. The operator
    // does not state a generation or angle, so both stay unknown.
    source: 'curated',
    board: 'moonboard',
    name: 'カルコロ CAL-COLO',
    lat: 34.78667,
    lon: 135.81206,
    city: 'Kizugawa',
    country: 'JP',
    commercial: true,
    led: true,
    variant: null,
    angle: null,
  },
  {
    // Current public venue, exact address, and Kilter Board:
    // https://hanasports.or.kr/hcg/introduce.php
    // Co-locate with the existing MoonBoard at Daejeon World Cup Stadium.
    // The operator publishes no safely normalizable Kilter wall geometry.
    source: 'curated',
    board: 'kilter',
    name: '하나클라이밍짐 Hana Climbing Gym',
    lat: 36.3643697,
    lon: 127.3247016,
    address: '대전광역시 유성구 월드컵대로 32, 대전월드컵경기장 남서관 1층',
    city: 'Daejeon',
    country: 'KR',
    walls: [],
  },
  {
    // The venue owner's current training-board page identifies a public,
    // app-connected LED MoonBoard on the shared hydraulic training frame:
    // https://www.discoverycs.com/training-board
    // Co-locate with the existing exact-address Kilter venue. The page does
    // not identify the MoonBoard generation or a board-specific angle.
    source: 'curated',
    board: 'moonboard',
    name: '디스커버리 클라임스퀘어 Climbsquare ICN',
    lat: 37.59289,
    lon: 126.67303,
    city: 'Incheon',
    country: 'KR',
    commercial: true,
    led: true,
    variant: null,
    angle: null,
  },
  {
    // The same current operator page explicitly identifies a Tension Board
    // on the public three-board training frame at ClimbSquare ICN:
    // https://www.discoverycs.com/training-board
    source: 'curated',
    board: 'tension',
    name: '디스커버리 클라임스퀘어 Climbsquare ICN',
    lat: 37.59289,
    lon: 126.67303,
    city: 'Incheon',
    country: 'KR',
  },
  {
    // The venue's current, document-backed business profile explicitly names
    // a public MoonBoard wall and supplies the exact address and embedded point:
    // https://www.daangn.com/kr/local-profile/%EC%98%A4%ED%84%B0%ED%81%B4%EB%9D%BC%EC%9D%B4%EB%B0%8D-7hmm4gijbo8u/
    // Busan's current merchant register independently matches the operator to
    // 498 Nakdong-daero, second floor. Neither source states the generation,
    // LEDs or angle, so the discovery list's 2024 label is not copied.
    source: 'curated',
    board: 'moonboard',
    name: '오터클라이밍 OTTERCLIMBING',
    lat: 35.1088403702862,
    lon: 128.967159324406,
    address: '부산광역시 사하구 낙동대로 498, 2층',
    city: 'Busan',
    country: 'KR',
    commercial: true,
    led: null,
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
  {
    // Public venue, address, and an interactive board:
    // https://www.climbingspace.com.ua/about
    // 12Climb board identity and coordinates come from the manufacturer's
    // maintained location KML (placemark "Climbing gym Space, Kyiv").
    source: 'curated',
    board: '12climb',
    name: 'Climbing SPACE',
    lat: 50.4887793,
    lon: 30.4906293,
    city: 'Kyiv',
    country: 'UA',
  },
  {
    // Public venue, address, and current regular hours:
    // https://funattic.com.ua/ua/
    // 12Climb board identity and coordinates come from the manufacturer's
    // maintained location KML (placemark "Funattic climbing gym").
    source: 'curated',
    board: '12climb',
    name: 'Funattic',
    lat: 50.4464461,
    lon: 30.4430291,
    city: 'Kyiv',
    country: 'UA',
  },
  {
    // Public venue, address, and current regular hours:
    // https://hyperion.kiev.ua/ua/pro-klub
    // 12Climb board identity and coordinates come from the manufacturer's
    // maintained location KML (placemark "Hyperion climbing gym").
    source: 'curated',
    board: '12climb',
    name: 'Hyperion Kyiv',
    lat: 50.4734096,
    lon: 30.498501,
    city: 'Kyiv',
    country: 'UA',
  },
  {
    // The current operator page names the public climbing/bouldering hall,
    // its 12Climb wall, exact address, drop-in access, and regular week:
    // https://dynamica.od.ua/ua/skalolazanie-i-boldering/
    // The manufacturer KML supplies the matching board coordinate.
    source: 'curated',
    board: '12climb',
    name: 'SK Dynamica',
    lat: 46.4723569,
    lon: 30.7025312,
    city: 'Odesa',
    country: 'UA',
  },
  {
    // Current chain-wide board inventory and version:
    // https://touchstoneclimbing.com/touchstone-training-boards/
    // Branch identity/address: https://touchstoneclimbing.com/team-training-center/
    source: 'curated',
    board: 'moonboard',
    name: 'Team Touchstone',
    lat: 37.85118,
    lon: -122.29303,
    city: 'Berkeley',
    country: 'US',
    commercial: true,
    led: null,
    variant: 'mb2019-masters',
    angle: null,
  },
  {
    // Current chain-wide board inventory and version:
    // https://touchstoneclimbing.com/touchstone-training-boards/
    // Branch confirmation: https://touchstoneclimbing.com/pacific-pipe/tour-and-amenities/
    source: 'curated',
    board: 'moonboard',
    name: 'Pacific Pipe Climbing',
    lat: 37.81644,
    lon: -122.28852,
    city: 'Oakland',
    country: 'US',
    commercial: true,
    led: null,
    variant: 'mb2016',
    angle: null,
  },
  {
    // Current board/version/angle and public branch details:
    // https://touchstoneclimbing.com/cliffs-of-id/tour-and-amenities/
    // The coordinate is the map pin embedded by that official branch page.
    source: 'curated',
    board: 'moonboard',
    name: 'Cliffs of Id',
    lat: 34.0331,
    lon: -118.3707,
    city: 'Culver City',
    country: 'US',
    commercial: true,
    led: null,
    variant: 'mb2024',
    angle: 40,
  },
  {
    // Current chain-wide board inventory and version:
    // https://touchstoneclimbing.com/touchstone-training-boards/
    // Branch confirmation: https://touchstoneclimbing.com/the-post/tour/
    source: 'curated',
    board: 'moonboard',
    name: 'The Post Climbing',
    lat: 34.16505,
    lon: -118.15031,
    city: 'Pasadena',
    country: 'US',
    commercial: true,
    led: null,
    variant: 'mb2019-masters',
    angle: null,
  },
  {
    // Current chain-wide board inventory and version:
    // https://touchstoneclimbing.com/touchstone-training-boards/
    // Branch confirmation: https://touchstoneclimbing.com/hyperion/tour-and-amenities/
    source: 'curated',
    board: 'moonboard',
    name: 'Hyperion Climbing',
    lat: 37.48421,
    lon: -122.21474,
    city: 'Redwood City',
    country: 'US',
    commercial: true,
    led: null,
    variant: 'mb2024',
    angle: null,
  },
  {
    // The Touchstone app point is 10 m from the co-located Kilter/Tension
    // point and produced a duplicate marker. The backed upstream exclusion
    // removes that point; the current official branch/board guide establishes
    // this replacement at the address-bearing venue coordinate.
    source: 'curated',
    board: 'touchstone',
    name: 'Class 5',
    lat: 33.84909,
    lon: -118.35149,
    city: 'Torrance',
    country: 'US',
    username: 'class5gym',
    adjustable: false,
    angle: 35,
    led: true,
  },
  {
    // Current public Walker's Point branch and address:
    // https://adventurerock.com/walkers-point/
    // Kilter identity and coordinates: official manufacturer locator
    // https://settercloset.com/pages/kb-locator (StoreRocket id 33861670)
    source: 'curated',
    board: 'kilter',
    name: "Adventure Rock Walker's Point",
    lat: 43.0249104,
    lon: -87.9130311,
    address: '613 S 2nd St, Milwaukee, WI 53204',
    city: 'Milwaukee',
    country: 'US',
    walls: [],
  },
  {
    // Current public branch, street address and regular hours:
    // https://latitudeclimbing.com/norfolk/
    // Kilter identity and coordinates: official manufacturer locator
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029538)
    source: 'curated',
    board: 'kilter',
    name: 'Latitude Climbing Norfolk',
    lat: 36.8659723,
    lon: -76.2805601,
    address: '1830 Lindsay Avenue, Norfolk, VA 23504',
    city: 'Norfolk',
    country: 'US',
    walls: [],
  },
  {
    // Current public branch and address: https://qb.brooklynboulders.com/
    // Kilter access/layout/size/frame and coordinates: official manufacturer
    // locator https://settercloset.com/pages/kb-locator (StoreRocket id 22029425)
    source: 'curated',
    board: 'kilter',
    name: 'Brooklyn Boulders Queensbridge',
    lat: 40.7527726,
    lon: -73.9405401,
    address: '23-10 41st Ave, Long Island City, NY 11101',
    city: 'Long Island City',
    country: 'US',
    walls: [{
      wall_name: null,
      layout: 'Original',
      size_id: null,
      size_label: '12x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public branch and address: https://climbhangar18.com/arcadia/
    // Kilter identity and coordinates: official manufacturer locator
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029453)
    source: 'curated',
    board: 'kilter',
    name: 'Hangar 18 Arcadia',
    lat: 34.1432717,
    lon: -118.0319401,
    address: '305 N Santa Anita Ave, Arcadia, CA 91006',
    city: 'Arcadia',
    country: 'US',
    walls: [],
  },
  {
    // Current public branch and address: https://climbhangar18.com/riverside/
    // Kilter identity and coordinates: official manufacturer locator
    // https://settercloset.com/pages/kb-locator (StoreRocket id 34137801)
    source: 'curated',
    board: 'kilter',
    name: 'Hangar 18 Riverside',
    lat: 33.9460709,
    lon: -117.446141,
    address: '6935 Arlington Avenue, Riverside, CA 92503',
    city: 'Riverside',
    country: 'US',
    walls: [],
  },
  {
    // Current public branch and address: https://climbhangar18.com/upland/
    // Kilter identity and coordinates: official manufacturer locator
    // https://settercloset.com/pages/kb-locator (StoreRocket id 34182346)
    source: 'curated',
    board: 'kilter',
    name: 'Hangar 18 Upland',
    lat: 34.0938889,
    lon: -117.6475,
    address: '256 E Stowell St, Upland, CA 91786',
    city: 'Upland',
    country: 'US',
    walls: [],
  },
  {
    // Current public venue, address, board and 0-70 degree frame range:
    // https://www.blockout.fr/actus/kilter-board-tours/
    // Address and coordinates: official manufacturer locator StoreRocket
    // id 33905308, corroborated by https://www.blockout.fr/tours/contact/
    source: 'curated',
    board: 'kilter',
    name: "Block'Out Tours",
    lat: 47.4325601,
    lon: 0.6943276,
    address: '7-9 Avenue du Danemark, 37100 Tours',
    city: 'Tours',
    country: 'FR',
    walls: [{
      wall_name: 'Kilter Board',
      layout: null,
      size_id: null,
      size_label: null,
      adjustable: true,
      angle: null,
      min_angle: 0,
      max_angle: 70,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public municipal venue, board, booking and dimensions:
    // https://www.bykle.kommune.no/tenester/kultur-og-fritid/kulturhus/hovden-grendehus/
    // Address/layout/size/frame and coordinates: official manufacturer locator
    // StoreRocket id 22029698. Its conflicting range filters are not copied.
    source: 'curated',
    board: 'kilter',
    name: 'Hovden Grendehus',
    lat: 59.5635815,
    lon: 7.3548335,
    address: 'Skulevegen 19, 4755 Hovden',
    city: 'Hovden',
    country: 'NO',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: null,
      size_label: '12x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public branch and address:
    // https://www.calgaryclimbing.com/
    // Board/layout/size/frame and coordinates: official manufacturer locator
    // StoreRocket id 33932768.
    source: 'curated',
    board: 'kilter',
    name: 'Calgary Climbing Centre Rocky Mountain',
    lat: 51.0876184,
    lon: -114.2424414,
    address: '10721 West Valley Rd SW, Calgary, AB T3B 5T2',
    city: 'Calgary',
    country: 'CA',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: null,
      size_label: '12x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public branch, address, board and regular hours:
    // https://www.highpointclimbing.com/locations/lincoln-mill
    // Layout/size/frame and coordinates: official manufacturer locator
    // StoreRocket id 22029570.
    source: 'curated',
    board: 'kilter',
    name: 'High Point Climbing Lincoln Mill',
    lat: 34.7471907,
    lon: -86.5823847,
    address: '1300 Meridian St N Unit D400, Huntsville, AL 35801',
    city: 'Huntsville',
    country: 'US',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: null,
      size_label: '12x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // The anonymous official Tension app endpoint identifies the board:
    // https://tensionboardapp2.com/pins?gyms=1
    // The venue's current expansion notice confirms two adjustable training
    // boards and its branch page confirms public access and the exact address:
    // https://kiipeilyareena.com/salmisaaren-uusi-laajennus-avataan-maanantaina-28-7-klo-13/
    // https://kiipeilyareena.com/en/locations/salmisaari/
    source: 'curated',
    board: 'tension',
    name: 'KiipeilyAreena Salmisaari',
    lat: 60.166129,
    lon: 24.904168,
    city: 'Helsinki',
    country: 'FI',
  },
  {
    // Current public climbing gym and exact address/hours:
    // https://beastfingersclimbing.com/contact
    // Board identity and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 33869056)
    source: 'curated',
    board: 'kilter',
    name: 'Beast Fingers',
    lat: 39.7294843,
    lon: -105.1264894,
    address: '11485 W 8th Ave Suite 130, Lakewood, CO 80215',
    city: 'Lakewood',
    country: 'US',
    walls: [],
  },
  {
    // Current public gym, exact address and regular hours:
    // https://318climbllc.wixsite.com/g-rockclimbing
    // Board/access/layout/size/frame and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029443)
    source: 'curated',
    board: 'kilter',
    name: '318 Climb',
    lat: 32.421234,
    lon: -93.7419578,
    address: '731 American Way, Shreveport, LA 71106',
    city: 'Shreveport',
    country: 'US',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: null,
      size_label: '8x12',
      adjustable: true,
      angle: null,
      min_angle: null,
      max_angle: null,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current public venue, address, Kilter size and 25-60 degree range:
    // https://boardroom.fit/
    // Coordinate and Original-layout corroboration:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 31920782)
    source: 'curated',
    board: 'kilter',
    name: 'The Board Room',
    lat: 22.27708,
    lon: 114.17568,
    address: '1301-02 Chinachem Johnston Plaza, 178-186 Johnston Rd, Wan Chai, Hong Kong',
    city: 'Wan Chai',
    country: 'CN',
    walls: [{
      wall_name: 'Kilter Board',
      layout: 'Original',
      size_id: null,
      size_label: '7x10',
      adjustable: true,
      angle: null,
      min_angle: 25,
      max_angle: 60,
      angle_increments: null,
      hold_set: null,
    }],
  },
  {
    // Current Quarry Bay branch and exact address/hours:
    // https://www.vitabeta.hk/contact/
    // Board identity and coordinates:
    // https://settercloset.com/pages/kb-locator (StoreRocket id 22029744)
    source: 'curated',
    board: 'kilter',
    name: 'Vita Beta Climbing Gym Quarry Bay',
    lat: 22.2919752,
    lon: 114.2075175,
    address: "Level 2, K11 HACC, K11 ATELIER King's Road, 728 King's Road, Quarry Bay",
    city: 'Hong Kong',
    country: 'CN',
    walls: [],
  },
  {
    // Current branch, address and Kilter Board:
    // https://www.rosebloc.com/brossard
    // The point is the existing branch-specific Tension venue and is
    // independently corroborated by Kilter's locator (StoreRocket id 22029823).
    source: 'curated',
    board: 'kilter',
    name: 'Rose Bloc Brossard',
    lat: 45.48457,
    lon: -73.46174,
    address: '1800 avenue Auguste, Greenfield Park, QC J4V 3R4',
    city: 'Brossard',
    country: 'CA',
    walls: [],
  },
];

export async function load() {
  return {
    entries: ENTRIES.map(entry => ({ ...entry })),
    meta: {
      entries: ENTRIES.length,
      verified_on: '2026-09-01',
      policy: 'official-venue-pages',
    },
  };
}
