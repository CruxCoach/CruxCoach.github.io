import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadCurated } from './sources/curated.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const MAP_JS = join(REPO_ROOT, 'boards', 'map.js');

const boardIds = feature => feature.properties.boards.map(board => board.board);
const at = (features, lat, lon) => features.filter(feature => {
  const [featureLon, featureLat] = feature.geometry.coordinates;
  return featureLat.toFixed(4) === lat.toFixed(4) && featureLon.toFixed(4) === lon.toFixed(4);
});

test('curated source contains only the explicitly reviewed primary-source gaps', async () => {
  const { entries, meta } = await loadCurated();
  assert.equal(meta.verified_on, '2026-09-01');
  assert.deepEqual(entries.map(entry => [entry.name, entry.board]), [
    ['Boulderwelt München Ost', 'moonboard'],
    ['Boulderwelt Hamburg', 'moonboard'],
    ['Boardworks Climbing', 'moonboard'],
    ['Rock Haven Climbing Gym', 'moonboard'],
    ['The Front Climbing Club Ogden', 'moonboard'],
    ['Beyond Bouldering Thebarton', 'moonboard'],
    ['Boulder Co Christchurch', 'moonboard'],
    ['Gallery Bouldering', 'moonboard'],
    ['Hangdog Climbing Gym Wollongong', 'moonboard'],
    ['Social Climbing Coventry', 'moonboard'],
    ['Solo Escalade Toulouse', 'moonboard'],
    ['Rainbow Rocket Boulders', 'moonboard'],
    ['Double Dyno', 'moonboard'],
    ['TSV 1846 Nürnberg - Bouldern', 'tension'],
    ['Lezard', 'moonboard'],
    ["Portside Boulders O'Connor", 'moonboard'],
    ['Portside Boulders Willetton', 'moonboard'],
    ['Portside Boulders Joondalup', 'moonboard'],
    ['BolBol', 'moonboard'],
    ['Blue Bird BOULDERING GYM', 'moonboard'],
    ['ボルダリング＆クライミングパーク ひょうたん島 大垣店', 'moonboard'],
    ['WEST ROCK Fuchu', 'moonboard'],
    ['桜ヶ池クライミングセンター', 'moonboard'],
    ['カラフルロック Colorful Rock', 'moonboard'],
    ['ボルダTO9蒲郡店', 'moonboard'],
    ['ROCONESS', 'moonboard'],
    ['愛媛クライミングジム iTTE', 'moonboard'],
    ['アオロク ao_roc.climbing', 'moonboard'],
    ['カルコロ CAL-COLO', 'moonboard'],
    ['クラックス大阪 CRUX Osaka', 'moonboard'],
    ['하나클라이밍짐 Hana Climbing Gym', 'kilter'],
    ['디스커버리 클라임스퀘어 Climbsquare ICN', 'moonboard'],
    ['디스커버리 클라임스퀘어 Climbsquare ICN', 'tension'],
    ['오터클라이밍 OTTERCLIMBING', 'moonboard'],
    ['ICP Boulder Hall & Showroom', 'kilter'],
    ['ICP Boulder Hall & Showroom', 'tension'],
    ['BLOCK DOCK Petržalka', 'kilter'],
    ['BLOCK DOCK Rača', 'moonboard'],
    ['Spire Climbing + Fitness Training Center', 'kilter'],
    ['Far North Climbing Gym', 'kilter'],
    ['Iron Cliffs Gym', 'kilter'],
    ['Climbing SPACE', '12climb'],
    ['Funattic', '12climb'],
    ['Hyperion Kyiv', '12climb'],
    ['SK Dynamica', '12climb'],
    ['Team Touchstone', 'moonboard'],
    ['Pacific Pipe Climbing', 'moonboard'],
    ['Cliffs of Id', 'moonboard'],
    ['The Post Climbing', 'moonboard'],
    ['Hyperion Climbing', 'moonboard'],
    ['Class 5', 'touchstone'],
    ["Adventure Rock Walker's Point", 'kilter'],
    ['Latitude Climbing Norfolk', 'kilter'],
    ['Brooklyn Boulders Queensbridge', 'kilter'],
    ['Hangar 18 Arcadia', 'kilter'],
    ['Hangar 18 Riverside', 'kilter'],
    ['Hangar 18 Upland', 'kilter'],
    ["Block'Out Tours", 'kilter'],
    ['Hovden Grendehus', 'kilter'],
    ['Calgary Climbing Centre Rocky Mountain', 'kilter'],
    ['High Point Climbing Lincoln Mill', 'kilter'],
    ['KiipeilyAreena Salmisaari', 'tension'],
    ['Beast Fingers', 'kilter'],
    ['318 Climb', 'kilter'],
    ['The Board Room', 'kilter'],
    ['Vita Beta Climbing Gym Quarry Bay', 'kilter'],
    ['Rose Bloc Brossard', 'kilter'],
  ]);
  for (const entry of entries) {
    assert.equal(entry.source, 'curated');
    assert.ok(Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
    if (entry.board === 'moonboard') assert.equal(entry.commercial, true);
    if (entry.board === 'kilter') assert.ok(Array.isArray(entry.walls));
  }
});

test('committed map data includes the missing boards and merges the corrected venues', () => {
  const features = JSON.parse(readFileSync(GEOJSON, 'utf8')).features;

  const munichEast = at(features, 48.12578, 11.61108);
  assert.equal(munichEast.length, 1);
  assert.equal(munichEast[0].properties.name, 'Boulderwelt München Ost');
  assert.deepEqual(boardIds(munichEast[0]), ['moonboard']);
  assert.equal(munichEast[0].properties.wellpass, true);
  assert.equal(munichEast[0].properties.boards[0].led, true);
  assert.equal(munichEast[0].properties.boards[0].angle, 40);
  assert.equal(munichEast[0].properties.boards[0].variant, null);

  const hamburg = at(features, 53.55395, 10.02095);
  assert.equal(hamburg.length, 1);
  assert.deepEqual(new Set(boardIds(hamburg[0])), new Set(['kilter', 'moonboard']));

  const boardworks = at(features, 44.03913, -121.3032);
  assert.equal(boardworks.length, 1);
  assert.deepEqual(new Set(boardIds(boardworks[0])), new Set(['kilter', 'tension', 'grasshopper', 'decoy', 'moonboard']));
  assert.equal(boardworks[0].properties.city, 'Bend');
  assert.equal(boardworks[0].properties.hours, undefined);
  assert.equal(boardworks[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');
  assert.equal(at(features, 44.03909, -121.30325).length, 0);
  assert.equal(at(features, 44.03886, -121.30328).length, 0);

  const rockHaven = at(features, 45.52658504620519, -122.43448777322068);
  assert.equal(rockHaven.length, 1);
  assert.equal(rockHaven[0].properties.name, 'Rock Haven Climbing Gym');
  assert.equal(rockHaven[0].properties.city, 'Gresham');
  assert.equal(rockHaven[0].properties.website, 'https://www.rockhavenclimbing.com/');
  assert.equal(rockHaven[0].properties.hours, undefined);
  assert.equal(rockHaven[0].properties.boards[0].variant, 'mb2024');

  const frontOgden = at(features, 41.2311, -111.97512);
  assert.equal(frontOgden.length, 1);
  assert.deepEqual(new Set(boardIds(frontOgden[0])), new Set(['tension', 'moonboard']));
  assert.equal(frontOgden[0].properties.city, 'Ogden');
  assert.equal(frontOgden[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');
  assert.equal(frontOgden[0].properties.boards.find(board => board.board === 'moonboard').angle, 40);

  const calgaryOutdoor = at(features, 51.07767, -114.13419);
  assert.equal(calgaryOutdoor.length, 1);
  assert.deepEqual(new Set(boardIds(calgaryOutdoor[0])), new Set(['kilter', 'moonboard']));
  assert.equal(calgaryOutdoor[0].properties.hours, undefined);
  assert.equal(calgaryOutdoor[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');
  assert.equal(calgaryOutdoor[0].properties.boards.find(board => board.board === 'moonboard').angle, 40);
  assert.equal(at(features, 51.0779562, -114.1337454).length, 0);

  const climbSquare = at(features, 37.59289, 126.67303);
  assert.equal(climbSquare.length, 1);
  assert.equal(climbSquare[0].properties.name, '디스커버리 클라임스퀘어 Climbsquare ICN');
  assert.deepEqual(new Set(boardIds(climbSquare[0])), new Set(['kilter', 'moonboard', 'tension']));
  const climbSquareMoon = climbSquare[0].properties.boards.find(board => board.board === 'moonboard');
  assert.equal(climbSquareMoon.led, true);
  assert.equal(climbSquareMoon.variant, null);
  assert.equal(climbSquareMoon.angle, null);

  const otter = at(features, 35.1088403702862, 128.967159324406);
  assert.equal(otter.length, 1);
  assert.equal(otter[0].properties.name, '오터클라이밍 OTTERCLIMBING');
  assert.equal(otter[0].properties.city, 'Busan');
  assert.equal(otter[0].properties.website, undefined);
  assert.equal(otter[0].properties.hours, undefined);
  assert.equal(otter[0].properties.boards[0].variant, null);
  assert.equal(otter[0].properties.boards[0].led, null);
  assert.equal(otter[0].properties.boards[0].angle, null);

  for (const [name, lat, lon, boards] of [
    ['Beyond Bouldering Thebarton', -34.91386, 138.57631, ['kilter', 'tension', 'moonboard']],
    ['Boulder Co Christchurch', -43.53832, 172.59476, ['kilter', 'moonboard']],
    ['Social Climbing Coventry', 52.40906, -1.51112, ['tension', 'moonboard']],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(new Set(boardIds(venue[0])), new Set(boards));
    assert.equal(venue[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');
    assert.equal(venue[0].properties.hours.length, 7);
  }

  const gallery = at(features, 51.7474718, -1.2401007);
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].properties.name, 'Gallery Bouldering');
  assert.equal(gallery[0].properties.website, 'https://gallerybouldering.co.uk/');
  assert.deepEqual(gallery[0].properties.hours, [
    '07:00-22:00', '08:00-22:00', '07:00-22:00', '08:00-22:00',
    '08:00-22:00', '08:00-22:00', '08:00-22:00',
  ]);

  const hangdogWollongong = at(features, -34.436991, 150.886987);
  assert.equal(hangdogWollongong.length, 1);
  assert.equal(hangdogWollongong[0].properties.name, 'Hangdog Climbing Gym Wollongong');
  assert.equal(hangdogWollongong[0].properties.website, 'https://hangdog.com.au/');
  assert.equal(hangdogWollongong[0].properties.hours.length, 7);
  assert.equal(hangdogWollongong[0].properties.boards[0].variant, 'mb2024');

  const boulderHeads = at(features, -26.807137, 153.070112);
  assert.equal(boulderHeads.length, 1);
  assert.equal(boulderHeads[0].properties.city, 'Baringa');
  assert.deepEqual(new Set(boardIds(boulderHeads[0])), new Set(['tension', 'moonboard']));
  assert.equal(boulderHeads[0].properties.boards.find(board => board.board === 'moonboard').angle, 40);
  assert.equal(at(features, -26.80713, 153.07039).length, 0);

  const grandWall = at(features, 49.7016339, -123.1558121);
  assert.equal(grandWall.length, 1);
  assert.equal(grandWall[0].properties.boards[0].variant, 'mb2024');
  assert.equal(grandWall[0].properties.boards[0].led, true);
  assert.equal(grandWall[0].properties.hours, undefined);

  for (const [name, lat, lon] of [
    ['BOULDER HALL - Burgoberbach', 49.2386079, 10.6036822],
    ['DAV-Kletterzentrum Würzburg', 49.7967105, 9.902870300000002],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.boards[0].variant, 'mb2024');
    assert.equal(venue[0].properties.boards[0].angle, 40);
  }

  const rainbowRocket = at(features, 47.7387, 10.33247);
  assert.equal(rainbowRocket.length, 1);
  assert.deepEqual(new Set(boardIds(rainbowRocket[0])), new Set(['kilter', 'moonboard']));
  assert.equal(rainbowRocket[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');

  const soloToulouse = at(features, 43.62005, 1.42052);
  assert.equal(soloToulouse.length, 1);
  assert.equal(soloToulouse[0].properties.name, 'Solo Escalade Toulouse');
  assert.deepEqual(new Set(boardIds(soloToulouse[0])), new Set(['kilter', 'moonboard']));
  assert.equal(soloToulouse[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2024');
  assert.equal(soloToulouse[0].properties.boards.find(board => board.board === 'moonboard').led, null);
  assert.equal(soloToulouse[0].properties.hours, undefined);

  const tsvNuremberg = at(features, 49.4521018, 11.0766654);
  assert.equal(tsvNuremberg.length, 1);
  assert.deepEqual(new Set(boardIds(tsvNuremberg[0])), new Set(['moonboard', 'tension']));
  assert.equal(tsvNuremberg[0].properties.website, 'https://tsvbouldern.de/');
  assert.deepEqual(
    tsvNuremberg[0].properties.boards.filter(board => board.board === 'moonboard').map(board => board.variant),
    ['mb2024', 'mini-2020'],
  );
  assert.equal(tsvNuremberg[0].properties.hours, undefined);

  const doubleDyno = at(features, 39.2538197, 9.1132358);
  assert.equal(doubleDyno.length, 1);
  assert.equal(doubleDyno[0].properties.name, 'Double Dyno');
  assert.equal(doubleDyno[0].properties.website, 'https://www.doubledyno.it/');
  assert.equal(doubleDyno[0].properties.hours, undefined);

  const lezard = at(features, 45.6792606, 8.9475553);
  assert.equal(lezard.length, 1);
  assert.equal(lezard[0].properties.name, 'Lezard');
  assert.deepEqual(boardIds(lezard[0]), ['moonboard']);
  assert.equal(lezard[0].properties.website, 'https://www.lezardclimb.it/');
  assert.equal(lezard[0].properties.hours, undefined);

  for (const [name, lat, lon, boards, variant] of [
    ["Portside Boulders O'Connor", -32.0577678, 115.7856163, ['moonboard'], 'mb2024'],
    ['Portside Boulders Willetton', -32.0400023, 115.8865878, ['moonboard'], 'mb2019-masters'],
    ['Portside Boulders Joondalup', -31.75081, 115.76338, ['decoy', 'moonboard'], 'mb2024'],
    ['Portside Osborne Park', -31.91385, 115.81699, ['kilter', 'moonboard'], 'mb2016'],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(new Set(boardIds(venue[0])), new Set(boards));
    const moonboard = venue[0].properties.boards.find(board => board.board === 'moonboard');
    assert.equal(moonboard.variant, variant);
    assert.equal(moonboard.angle, 40);
    assert.equal(moonboard.led, true);
    assert.equal(venue[0].properties.hours.length, 7);
  }
  assert.equal(at(features, -31.91396, 115.8168689).length, 0);

  for (const [name, lat, lon, address] of [
    ['BolBol', 35.600647, 139.352181, '神奈川県相模原市緑区橋本4-9-28'],
    ['Blue Bird BOULDERING GYM', 36.263468, 139.347351, '群馬県太田市米沢町13番地'],
    ['ボルダリング＆クライミングパーク ひょうたん島 大垣店', 35.370733, 136.647393, '岐阜県大垣市東町4丁目1番地3'],
    ['WEST ROCK Fuchu', 35.662423, 139.462647, '東京都府中市分梅町5-9-1'],
    ['桜ヶ池クライミングセンター', 36.50025, 136.872064, '富山県南砺市立野原東1511'],
    ['カラフルロック Colorful Rock', 35.115149, 136.872711, '愛知県名古屋市港区須成町3丁目14番'],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.equal(venue[0].properties.boards[0].address, address);
    assert.equal(venue[0].properties.website.startsWith('https://'), true);
    assert.equal(venue[0].properties.hours.length, 7);
  }
  assert.equal(at(features, 36.50025, 136.872064)[0].properties.boards[0].angle, 40);
  assert.equal(at(features, 35.115149, 136.872711)[0].properties.boards[0].variant, 'mb2016');

  for (const [name, lat, lon, address, hasHours] of [
    ['ボルダTO9蒲郡店', 34.821599, 137.236109, '愛知県蒲郡市府相町一丁目110番地', false],
    ['ROCONESS', 38.001454, 140.624956, '宮城県白石市字兎作3-1', true],
    ['愛媛クライミングジム iTTE', 33.861438, 132.742492, '愛媛県松山市久万ノ台639-1', true],
    ['アオロク ao_roc.climbing', 35.983114, 140.642811, '茨城県鹿嶋市宮津台4752-10', true],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.equal(venue[0].properties.boards[0].address, address);
    assert.equal(venue[0].properties.website.startsWith('https://'), true);
    assert.equal(Boolean(venue[0].properties.hours), hasHours);
  }
  const roconess = at(features, 38.001454, 140.624956)[0].properties.boards[0];
  assert.equal(roconess.variant, 'mb2019-masters');
  assert.equal(roconess.led, true);

  const monolithe = at(features, 35.9461485, 139.4770721);
  assert.equal(monolithe.length, 1);
  assert.equal(monolithe[0].properties.name, 'モノリス川越店 Monolithe');
  assert.equal(monolithe[0].properties.boards[0].led, true);
  assert.equal(monolithe[0].properties.website, 'https://www.boulderinggym.jp/');
  assert.equal(monolithe[0].properties.hours.length, 7);

  const calColo = at(features, 34.78667, 135.81206);
  assert.equal(calColo.length, 1);
  assert.equal(calColo[0].properties.name, 'カルコロ CAL-COLO');
  assert.deepEqual(new Set(boardIds(calColo[0])), new Set(['kilter', 'moonboard']));
  assert.equal(calColo[0].properties.boards.find(board => board.board === 'moonboard').led, true);
  assert.equal(calColo[0].properties.boards.find(board => board.board === 'moonboard').variant, null);
  assert.equal(calColo[0].properties.hours.length, 7);

  const cruxOsaka = at(features, 34.75463, 135.4994);
  assert.equal(cruxOsaka.length, 1);
  assert.equal(cruxOsaka[0].properties.name, 'クラックス大阪 CRUX Osaka');
  assert.deepEqual(new Set(boardIds(cruxOsaka[0])), new Set(['grasshopper', 'moonboard']));
  assert.equal(cruxOsaka[0].properties.boards.find(board => board.board === 'moonboard').variant, null);
  assert.equal(cruxOsaka[0].properties.boards.find(board => board.board === 'moonboard').led, null);
  assert.equal(cruxOsaka[0].properties.hours.length, 7);
  assert.equal(at(features, 34.6645243, 135.5213199).length, 0);

  const hana = at(features, 36.3643697, 127.3247016);
  assert.equal(hana.length, 1);
  assert.equal(hana[0].properties.name, '하나클라이밍짐 Hana Climbing Gym');
  assert.deepEqual(new Set(boardIds(hana[0])), new Set(['kilter', 'moonboard']));
  assert.equal(hana[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2016');
  assert.deepEqual(hana[0].properties.boards.find(board => board.board === 'kilter').walls, []);
  assert.equal(hana[0].properties.hours.length, 7);

  const gravitaZero = at(features, 45.65702, 13.81049);
  assert.equal(gravitaZero.length, 1);
  assert.deepEqual(new Set(boardIds(gravitaZero[0])), new Set(['kilter', 'moonboard']));
  assert.equal(gravitaZero[0].properties.website, 'https://www.gravitazerotrieste.it/');
  assert.equal(gravitaZero[0].properties.boards.find(board => board.board === 'moonboard').variant, 'mb2019-masters');
  assert.equal(gravitaZero[0].properties.boards.find(board => board.board === 'moonboard').angle, 40);
  assert.equal(at(features, 45.6570925, 13.8102992).length, 0);

  const thalkirchen = at(features, 48.107, 11.54568);
  assert.equal(thalkirchen.length, 1);
  assert.deepEqual(new Set(boardIds(thalkirchen[0])), new Set(['kilter', 'moonboard']));
  assert.equal(at(features, 48.1067623, 11.5456929).length, 0);

  const gilching = at(features, 48.10135, 11.30113);
  assert.equal(gilching.length, 1);
  assert.deepEqual(new Set(boardIds(gilching[0])), new Set(['kilter', 'moonboard']));
  assert.equal(at(features, 48.1092285, 11.2899694).length, 0);

  const blockDockPetrzalka = at(features, 48.1312802, 17.0998312);
  assert.equal(blockDockPetrzalka.length, 1);
  assert.deepEqual(boardIds(blockDockPetrzalka[0]), ['kilter']);
  const blockDockRaca = at(features, 48.2146345, 17.1641254);
  assert.equal(blockDockRaca.length, 1);
  assert.deepEqual(boardIds(blockDockRaca[0]), ['moonboard']);
  assert.equal(at(features, 48.1485965, 17.1077478).length, 0);

  const spire = at(features, 45.67642, -111.14422);
  assert.equal(spire.length, 1);
  assert.deepEqual(new Set(boardIds(spire[0])), new Set(['kilter', 'tension']));
  assert.equal(at(features, 45.656304, -111.069708).length, 0);

  const fontWandsworth = at(features, 51.45496, -0.193);
  assert.equal(fontWandsworth.length, 1);
  assert.equal(fontWandsworth[0].properties.name, 'The Font Wandsworth');
  assert.equal(fontWandsworth[0].properties.hours, undefined);
  assert.equal(fontWandsworth[0].properties.website, 'https://www.the-font.co.uk/wandsworth');
  assert.deepEqual(fontWandsworth[0].properties.boards[0].walls, [{
    wall_name: 'Kilter Board',
    layout: 'Original',
    size_id: null,
    size_label: '16x12',
    adjustable: true,
    angle: null,
    min_angle: 15,
    max_angle: 60,
    angle_increments: null,
    hold_set: null,
  }]);

  for (const [name, lat, lon] of [
    ['Brooklyn Boulders Queensbridge', 40.7527726, -73.9405401],
    ['Hangar 18 Arcadia', 34.1432717, -118.0319401],
    ['Hangar 18 Riverside', 33.9460709, -117.446141],
    ['Hangar 18 Upland', 34.0938889, -117.6475],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(boardIds(venue[0]), ['kilter']);
  }

  for (const [name, lat, lon] of [
    ['Climbing SPACE', 50.4887793, 30.4906293],
    ['Funattic', 50.4464461, 30.4430291],
    ['Hyperion Kyiv', 50.4734096, 30.498501],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(boardIds(venue[0]), ['12climb']);
    assert.ok(venue[0].properties.website);
    assert.equal(venue[0].properties.hours.length, 7);
  }
  assert.equal(at(features, 50.416134, 30.4683816).length, 0);
  assert.equal(at(features, 50.472918, 30.5129492).length, 0);

  for (const [name, lat, lon, variant] of [
    ['Team Touchstone', 37.85118, -122.29303, 'mb2019-masters'],
    ['Pacific Pipe Climbing', 37.81644, -122.28852, 'mb2016'],
    ['Cliffs of Id', 34.0331, -118.3707, 'mb2024'],
    ['The Post Climbing', 34.16505, -118.15031, 'mb2019-masters'],
    ['Hyperion Climbing', 37.48421, -122.21474, 'mb2024'],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    const moonboard = venue[0].properties.boards.find(board => board.board === 'moonboard');
    assert.ok(moonboard, name);
    assert.equal(moonboard.variant, variant, name);
  }
  const cliffs = at(features, 34.0331, -118.3707)[0];
  assert.equal(cliffs.properties.boards[0].angle, 40);
  assert.equal(cliffs.properties.website, 'https://touchstoneclimbing.com/cliffs-of-id/');
  assert.equal(cliffs.properties.hours.length, 7);

  const class5 = at(features, 33.84909, -118.35149);
  assert.equal(class5.length, 1);
  assert.deepEqual(new Set(boardIds(class5[0])), new Set(['kilter', 'tension', 'touchstone']));
  assert.equal(at(features, 33.84918, -118.35146).length, 0);

  const gwpc = at(features, 37.81005, -122.27017)[0];
  const gwpcKilter = gwpc.properties.boards.find(board => board.board === 'kilter');
  assert.equal(gwpcKilter.walls[0].size_label, '12x12, with Kickboard');

  const touchstoneBoards = features.flatMap(feature => feature.properties.boards)
    .filter(board => board.board === 'touchstone');
  assert.equal(touchstoneBoards.length, 5);
  for (const board of touchstoneBoards) {
    assert.equal(board.adjustable, false);
    assert.equal(board.angle, 35);
    assert.equal(board.led, true);
  }

  const salmisaari = at(features, 60.166129, 24.904168);
  assert.equal(salmisaari.length, 1);
  assert.deepEqual(new Set(boardIds(salmisaari[0])), new Set(['kilter', 'tension']));
  assert.equal(salmisaari[0].properties.website, 'https://kiipeilyareena.com/en/locations/salmisaari/');
  assert.equal(salmisaari[0].properties.hours.length, 7);
  assert.equal(at(features, 60.16622370498926, 24.904248473015482).length, 0);

  const tilted = at(features, 49.30961, -123.03323);
  assert.equal(tilted.length, 1);
  assert.deepEqual(boardIds(tilted[0]), ['kilter']);
  assert.equal(at(features, 49.30953, -123.033253).length, 0);

  const adventure = at(features, 43.0249104, -87.9130311);
  assert.equal(adventure.length, 1);
  assert.equal(adventure[0].properties.name, "Adventure Rock Walker's Point");
  assert.deepEqual(new Set(boardIds(adventure[0])), new Set(['kilter', 'tension', 'moonboard']));
  assert.equal(at(features, 43.02566, -87.91254).length, 0);

  const latitude = at(features, 36.8659723, -76.2805601);
  assert.equal(latitude.length, 1);
  assert.deepEqual(boardIds(latitude[0]), ['kilter']);
  assert.equal(latitude[0].properties.website, 'https://latitudeclimbing.com/norfolk/');
  assert.equal(latitude[0].properties.hours.length, 7);

  const rockstar = at(features, 51.58198, -1.754);
  assert.equal(rockstar.length, 1);
  assert.deepEqual(new Set(boardIds(rockstar[0])), new Set(['kilter', 'moonboard']));
  assert.equal(at(features, 51.5822099, -1.753619).length, 0);

  const tours = at(features, 47.4325601, 0.6943276);
  assert.equal(tours.length, 1);
  assert.equal(tours[0].properties.name, "Block'Out Tours");
  assert.deepEqual(boardIds(tours[0]), ['kilter']);
  assert.equal(tours[0].properties.website, 'https://www.blockout.fr/tours/');
  assert.equal(tours[0].properties.hours.length, 7);
  assert.equal(tours[0].properties.boards[0].walls[0].min_angle, 0);
  assert.equal(tours[0].properties.boards[0].walls[0].max_angle, 70);

  const hovden = at(features, 59.5635815, 7.3548335);
  assert.equal(hovden.length, 1);
  assert.equal(hovden[0].properties.name, 'Hovden Grendehus');
  assert.deepEqual(boardIds(hovden[0]), ['kilter']);
  assert.equal(hovden[0].properties.website, 'https://www.bykle.kommune.no/tenester/kultur-og-fritid/kulturhus/hovden-grendehus/');
  assert.equal(hovden[0].properties.hours, undefined);
  assert.equal(hovden[0].properties.boards[0].walls[0].size_label, '12x12');

  const goeppingen = at(features, 48.70867, 9.67442);
  assert.equal(goeppingen.length, 1);
  assert.equal(goeppingen[0].properties.name, 'GriP Kletter & Vereinszentrum');
  assert.deepEqual(boardIds(goeppingen[0]), ['kilter']);
  assert.equal(goeppingen[0].properties.wellpass, true);

  for (const [lat, lon] of [
    [47.6786416, 9.8310068],
    [54.3385925, 10.1187506],
    [68.3432661, 16.8308976],
    [48.2080696, 16.3713095],
  ]) assert.equal(at(features, lat, lon).length, 0);

  const rockyMountain = at(features, 51.0876184, -114.2424414);
  assert.equal(rockyMountain.length, 1);
  assert.equal(rockyMountain[0].properties.name, 'Calgary Climbing Centre Rocky Mountain');
  assert.deepEqual(boardIds(rockyMountain[0]), ['kilter']);
  assert.equal(rockyMountain[0].properties.website, 'https://www.calgaryclimbing.com/');
  assert.equal(rockyMountain[0].properties.hours.length, 7);
  assert.equal(rockyMountain[0].properties.boards[0].walls[0].size_label, '12x12');

  const lincolnMill = at(features, 34.7471907, -86.5823847);
  assert.equal(lincolnMill.length, 1);
  assert.equal(lincolnMill[0].properties.name, 'High Point Climbing Lincoln Mill');
  assert.deepEqual(boardIds(lincolnMill[0]), ['kilter']);
  assert.equal(lincolnMill[0].properties.website, 'https://www.highpointclimbing.com/locations/lincoln-mill');
  assert.equal(lincolnMill[0].properties.hours.length, 7);

  const stationSquare = at(features, 40.43301, -80.00449);
  assert.equal(stationSquare.length, 1);
  assert.deepEqual(boardIds(stationSquare[0]), ['decoy']);
  assert.equal(stationSquare[0].properties.hours.length, 7);

  const nosotrosLakewood = at(features, 41.47324, -81.77932);
  assert.equal(nosotrosLakewood.length, 1);
  assert.deepEqual(boardIds(nosotrosLakewood[0]), ['kilter']);
  assert.equal(nosotrosLakewood[0].properties.boards[0].walls.length, 2);

  const alchemy = at(features, 30.48009, -84.29684);
  assert.equal(alchemy.length, 1);
  assert.deepEqual(boardIds(alchemy[0]), ['kilter']);

  const beastFingers = at(features, 39.7294843, -105.1264894);
  assert.equal(beastFingers.length, 1);
  assert.equal(beastFingers[0].properties.name, 'Beast Fingers');
  assert.deepEqual(boardIds(beastFingers[0]), ['kilter']);
  assert.equal(beastFingers[0].properties.website, 'https://beastfingersclimbing.com/');
  assert.equal(beastFingers[0].properties.hours.length, 7);
  assert.deepEqual(beastFingers[0].properties.boards[0].walls, []);

  const climb318 = at(features, 32.421234, -93.7419578);
  assert.equal(climb318.length, 1);
  assert.equal(climb318[0].properties.name, '318 Climb');
  assert.deepEqual(boardIds(climb318[0]), ['kilter']);
  assert.equal(climb318[0].properties.website, 'https://318climbllc.wixsite.com/g-rockclimbing');
  assert.equal(climb318[0].properties.hours.length, 7);
  assert.equal(climb318[0].properties.boards[0].walls[0].size_label, '8x12');

  const hongKongBoardRoom = at(features, 22.27708, 114.17568);
  assert.equal(hongKongBoardRoom.length, 1);
  assert.equal(hongKongBoardRoom[0].properties.name, 'The Board Room');
  assert.deepEqual(new Set(boardIds(hongKongBoardRoom[0])), new Set(['kilter', 'tension']));
  assert.equal(hongKongBoardRoom[0].properties.website, 'https://boardroom.fit/');
  assert.equal(hongKongBoardRoom[0].properties.hours, undefined);
  const hongKongKilter = hongKongBoardRoom[0].properties.boards.find(board => board.board === 'kilter');
  assert.equal(hongKongKilter.walls[0].min_angle, 25);
  assert.equal(hongKongKilter.walls[0].max_angle, 60);

  const player = at(features, 22.3424815, 114.1359859);
  assert.equal(player.length, 1);
  assert.equal(player[0].properties.name, 'The Player Climbinggym');
  assert.deepEqual(boardIds(player[0]), ['kilter']);
  assert.equal(player[0].properties.website, 'https://www.theplayerclimbing.com/');
  assert.equal(player[0].properties.hours.length, 7);
  assert.equal(at(features, 22.34366, 114.14026).length, 0);

  const honAtsugi = at(features, 35.442445280250666, 139.3634466153931);
  assert.equal(honAtsugi.length, 1);
  assert.equal(honAtsugi[0].properties.name, 'ディーボルダリング本厚 D Bouldering Hon-Atsugi');
  assert.deepEqual(boardIds(honAtsugi[0]), ['kilter']);
  assert.equal(honAtsugi[0].properties.hours.length, 7);
  assert.equal(at(features, 35.4425, 139.36599).length, 0);
  assert.equal(at(features, 35.2605615, 139.1656818).length, 0);

  const waveRockPnu = at(features, 35.2295856, 129.0888247);
  assert.equal(waveRockPnu.length, 1);
  assert.equal(waveRockPnu[0].properties.name, '웨이브락 클라이밍 Wave Rock Climbing (PNU)');
  assert.equal(waveRockPnu[0].properties.city, 'Busan');
  assert.equal(waveRockPnu[0].properties.boards[0].address, '2F Terrace Park, 51 Jangjeononcheoncheon-ro, Geumjeong-gu, Busan');
  assert.deepEqual(boardIds(waveRockPnu[0]), ['kilter']);
  assert.equal(waveRockPnu[0].properties.website, 'https://www.waverock.co.kr/pnu');
  assert.equal(waveRockPnu[0].properties.hours.length, 7);
  assert.equal(at(features, 35.22902, 129.08423).length, 0);
  assert.equal(at(features, 35.1811693, 129.1036435).length, 0);

  const vitaBetaQuarryBay = at(features, 22.2919752, 114.2075175);
  assert.equal(vitaBetaQuarryBay.length, 1);
  assert.equal(vitaBetaQuarryBay[0].properties.name, 'Vita Beta Climbing Gym Quarry Bay');
  assert.deepEqual(boardIds(vitaBetaQuarryBay[0]), ['kilter']);
  assert.equal(vitaBetaQuarryBay[0].properties.website, 'https://www.vitabeta.hk/contact/');
  assert.equal(vitaBetaQuarryBay[0].properties.hours.length, 7);
  assert.deepEqual(vitaBetaQuarryBay[0].properties.boards[0].walls, []);

  const roseBlocBrossard = at(features, 45.48457, -73.46174);
  assert.equal(roseBlocBrossard.length, 1);
  assert.deepEqual(new Set(boardIds(roseBlocBrossard[0])), new Set(['kilter', 'tension']));
  assert.equal(roseBlocBrossard[0].properties.website, 'https://www.rosebloc.com/brossard');
  assert.equal(roseBlocBrossard[0].properties.hours.length, 7);

  const stoneAgeNorth = at(features, 35.18458, -106.5756);
  assert.equal(stoneAgeNorth.length, 1);
  assert.deepEqual(boardIds(stoneAgeNorth[0]), ['kilter', 'kilter', 'tension']);
  assert.deepEqual(
    stoneAgeNorth[0].properties.boards.filter(board => board.board === 'kilter').map(board => board.walls[0].size_label),
    ['12x8, with Kickboard', '12x12, with Kickboard'],
  );
  assert.equal(at(features, 35.184391279939376, -106.57514876931646).length, 0);

  const briancon = at(features, 44.9129157, 6.6212888);
  assert.equal(briancon.length, 1);
  assert.equal(briancon[0].properties.name, 'Briançon escalade');
  assert.equal(briancon[0].properties.boards[0].address, 'Rue Marius Chancel, 05100, Briançon');
  assert.equal(briancon[0].properties.website, 'https://briancon-escalade.fr/');
  assert.equal(briancon[0].properties.hours, undefined);
  assert.equal(at(features, 44.899596273874344, 6.63972697236616).length, 0);

  const boulderoase = at(features, 48.66507970052178, 14.838631194315278);
  assert.equal(boulderoase.length, 1);
  assert.equal(boulderoase[0].properties.boards[0].walls[0].min_angle, 20);
  assert.equal(boulderoase[0].properties.boards[0].walls[0].max_angle, 70);

  for (const [lat, lon] of [
    [48.6526006, 14.8397076],
    [46.7730287, 6.6487804],
    [41.5474876, 2.0961689],
  ]) assert.equal(at(features, lat, lon).length, 0);

  const climbatAmman = at(features, 31.88255, 35.84339);
  assert.equal(climbatAmman.length, 1);
  assert.equal(climbatAmman[0].properties.boards[0].walls[0].adjustable, true);
  assert.equal(climbatAmman[0].properties.boards[0].walls[0].min_angle, 0);
  assert.equal(climbatAmman[0].properties.boards[0].walls[0].max_angle, 35);

  const longmont = at(features, 40.16257, -105.04174);
  assert.equal(longmont.length, 1);
  assert.equal(longmont[0].properties.website, 'https://climbingcollective.co/longmont');
  assert.equal(longmont[0].properties.hours.length, 7);
  assert.equal(longmont[0].properties.boards[0].walls[0].size_label, '14x12 Super Tall, with Kickboard');

  assert.equal(features.some(feature => feature.properties.name === 'Raccoon' && feature.properties.country === 'CR'), false);

  const climbSquareIcn = at(features, 37.59289, 126.67303);
  assert.equal(climbSquareIcn.length, 1);
  assert.equal(climbSquareIcn[0].properties.website, 'https://www.climbingsquare.kr/icn');
  assert.deepEqual(climbSquareIcn[0].properties.hours, [
    '10:00-23:00', '10:00-23:00', '10:00-23:00', '10:00-23:00',
    '17:00-23:00', '10:00-19:00', '10:00-19:00',
  ]);

  const level24 = at(features, 44.4831, 11.2621);
  assert.equal(level24.length, 1);
  assert.deepEqual(new Set(boardIds(level24[0])), new Set(['kilter', 'tension']));
  assert.equal(level24[0].properties.website, 'https://www.level24.it/');
  assert.equal(level24[0].properties.hours, undefined);
  assert.equal(at(features, 44.49092, 11.25031).length, 0);

  const centralRockCambridge = at(features, 42.3908, -71.1425);
  assert.equal(centralRockCambridge.length, 1);
  assert.equal(centralRockCambridge[0].properties.name, 'Central Rock Gym Cambridge');
  assert.deepEqual(new Set(boardIds(centralRockCambridge[0])), new Set(['kilter', 'tension', 'aurora', 'moonboard']));
  assert.equal(centralRockCambridge[0].properties.website, 'https://centralrockgym.com/cambridge/');
  assert.equal(centralRockCambridge[0].properties.hours.length, 7);
  for (const [lat, lon] of [
    [42.39436, -71.15172],
    [42.3908, -71.13989],
    [42.3938542, -71.150421],
  ]) assert.equal(at(features, lat, lon).length, 0);

  assert.equal(features.some(feature => feature.properties.name.includes('T-UP Climbing Gym A19')), false);

  const acme189 = at(features, 31.24216, 121.44032);
  assert.equal(acme189.length, 1);
  assert.equal(acme189[0].properties.name, 'Acme Climbing 189');

  const yeCenter = at(features, 20.6332963, -103.4365048);
  assert.equal(yeCenter.length, 1);
  assert.equal(yeCenter[0].properties.name, 'YE Escalada + Yoga Center');
  assert.deepEqual(boardIds(yeCenter[0]), ['kilter']);
  assert.equal(at(features, 20.61837, -103.43033).length, 0);

  const pampa = at(features, 2.19316, 102.23685);
  assert.equal(pampa.length, 1);
  assert.equal(pampa[0].properties.website, 'https://sgrh.swangarden.com/services/');
  assert.deepEqual(pampa[0].properties.hours, [
    '', '14:00-22:00', '14:00-22:00', '14:00-22:00',
    '14:00-22:00', '10:00-20:00', '10:00-20:00',
  ]);

  const bunkerKohTao = at(features, 10.07863798214502, 99.83063143857734);
  assert.equal(bunkerKohTao.length, 1);
  assert.equal(bunkerKohTao[0].properties.name, 'The Bunker Koh Tao');
  assert.equal(bunkerKohTao[0].properties.website, 'https://kohtao-rockclimbing.com/climb-in-koh-tao/');

  const gravityVaultMontclair = at(features, 40.8124034, -74.2163694);
  assert.equal(gravityVaultMontclair.length, 1);
  assert.equal(gravityVaultMontclair[0].properties.name, 'Gravity Vault Montclair');
  assert.deepEqual(new Set(boardIds(gravityVaultMontclair[0])), new Set(['kilter', 'moonboard']));
  assert.equal(gravityVaultMontclair[0].properties.website, 'https://gravityvault.com/locations/montclair-nj');
  assert.equal(gravityVaultMontclair[0].properties.hours.length, 7);
  assert.equal(at(features, 40.81398, -74.20759).length, 0);

  const tempe = at(features, 33.4004145, -111.9529012);
  assert.equal(tempe.length, 1);
  assert.deepEqual(new Set(boardIds(tempe[0])), new Set(['kilter', 'tension']));
  const tempeKilter = tempe[0].properties.boards.find(board => board.board === 'kilter');
  assert.equal(tempeKilter.walls[0].size_label, '12x16 Super Wide, with Kickboard');
  assert.equal(tempe[0].properties.website, 'https://boulderingproject.com/location/tempe/');
  assert.equal(tempe[0].properties.hours.length, 7);
  assert.equal(at(features, 33.4042, -111.95457).length, 0);

  const cruxSouth = at(features, 30.17515, -97.79041);
  assert.equal(cruxSouth.length, 1);
  assert.deepEqual(new Set(boardIds(cruxSouth[0])), new Set(['kilter', 'tension']));
  assert.equal(cruxSouth[0].properties.boards.find(board => board.board === 'kilter').address, '220 Ralph Ablanedo Dr Unit 100, 78748, Austin');
  assert.equal(cruxSouth[0].properties.website, 'https://www.cruxclimbingcenter.com/south-austin/');
  assert.equal(cruxSouth[0].properties.hours, undefined);
  assert.equal(at(features, 30.181421802025056, -97.79111214027573).length, 0);

  const hutTonsberg = at(features, 59.2800086, 10.316057);
  assert.equal(hutTonsberg.length, 1);
  assert.equal(hutTonsberg[0].properties.name, 'Høyt Under Taket Klatresenter Tønsberg');
  assert.equal(hutTonsberg[0].properties.city, 'Sem');
  assert.deepEqual(new Set(boardIds(hutTonsberg[0])), new Set(['kilter', 'moonboard']));
  assert.equal(hutTonsberg[0].properties.website, 'https://hoytundertaket.no/tonsberg/');
  assert.equal(hutTonsberg[0].properties.hours.length, 7);
  assert.equal(at(features, 59.28207, 10.32679).length, 0);
  assert.equal(at(features, 59.2799827, 10.3159612).length, 0);

  const momentumSandy = at(features, 40.564419, -111.8979183);
  assert.equal(momentumSandy.length, 1);
  assert.deepEqual(new Set(boardIds(momentumSandy[0])), new Set(['kilter', 'grasshopper']));
  assert.equal(momentumSandy[0].properties.boards.find(board => board.board === 'kilter').address, '220 W 10600 S, 84070, Sandy');
  assert.equal(momentumSandy[0].properties.website, 'https://momentumclimbing.com/sandy/');
  assert.equal(momentumSandy[0].properties.hours.length, 7);
  assert.equal(at(features, 40.56486, -111.89785).length, 0);
  assert.equal(at(features, 40.56449, -111.89789).length, 0);

  const movementDesignDistrict = at(features, 32.79005, -96.82311);
  assert.equal(movementDesignDistrict.length, 1);
  assert.deepEqual(new Set(boardIds(movementDesignDistrict[0])), new Set(['kilter', 'tension']));
  assert.equal(movementDesignDistrict[0].properties.website, 'https://movementgyms.com/design-district/');
  assert.equal(movementDesignDistrict[0].properties.hours.length, 7);

  const kraftreich = at(features, 47.266263, 11.900404);
  assert.equal(kraftreich.length, 1);
  assert.equal(kraftreich[0].properties.city, 'Aschau');
  assert.equal(kraftreich[0].properties.boards[0].address, 'Aufenfeldweg 10, 6274, Aschau');
  assert.equal(kraftreich[0].properties.wellpass, true);
  assert.equal(kraftreich[0].properties.website, 'https://www.kraftreich-aufenfeld.at/de/');
  assert.equal(kraftreich[0].properties.hours, undefined);
  assert.equal(at(features, 47.26657, 11.90066).length, 0);

  const xxlDresden = at(features, 51.01528, 13.808827);
  assert.equal(xxlDresden.length, 1);
  assert.deepEqual(xxlDresden[0].properties.boards[0].walls.map(wall => wall.size_label), [
    '12x16 Super Wide, with Kickboard',
    '12x12, with Kickboard',
  ]);
  for (const wall of xxlDresden[0].properties.boards[0].walls) {
    assert.equal(wall.min_angle, 20);
    assert.equal(wall.max_angle, 70);
  }
  assert.equal(xxlDresden[0].properties.website, 'https://www.xxl-klettern.de/');
  assert.equal(xxlDresden[0].properties.hours, undefined);
  assert.equal(at(features, 51.01574, 13.8046).length, 0);

  for (const [name, lat, lon, boards] of [
    ['Tufas Boulder Lounge', 39.97622, -75.144, ['kilter', 'tension']],
    ['Vestveggen Bergen Klatreklubb', 60.46987, 5.31369, ['kilter']],
    ['Momentum Climbing Sofia', 42.6655983, 23.37440014, ['kilter', 'quantum']],
    ['Movement The Hill Dallas', 32.88196, -96.76813, ['kilter', 'tension']],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(new Set(boardIds(venue[0])), new Set(boards));
    assert.ok(venue[0].properties.website, name);
    assert.equal(venue[0].properties.hours.length, 7, name);
  }

  for (const [name, lat, lon] of [
    ['1778 CLIMBING', 31.20949, 121.49864],
    ['Ascent 杭州顽攀攀岩', 30.188212, 120.210894],
    ['Kin:D', 37.2667603, 127.0014613],
    ['오루뭉 Orumung Climbing Gym', 33.324883, 126.8245979],
  ]) {
    const venue = at(features, lat, lon);
    assert.equal(venue.length, 1, name);
    assert.equal(venue[0].properties.name, name);
    assert.deepEqual(boardIds(venue[0]), ['kilter']);
  }

  const betaJingan = at(features, 31.24035, 121.44879);
  assert.equal(betaJingan.length, 1);
  assert.equal(betaJingan[0].properties.name, 'Beta Boulders Gym JingAn');
  assert.equal(betaJingan[0].properties.boards[0].walls[0].min_angle, 20);
  assert.equal(betaJingan[0].properties.boards[0].walls[0].max_angle, 50);

  const skLucky = at(features, 41.7169522, 44.7358542);
  assert.equal(skLucky.length, 1);
  assert.equal(skLucky[0].properties.name, 's.k.lucky');
  assert.equal(skLucky[0].properties.boards[0].walls[0].min_angle, 30);
  assert.equal(skLucky[0].properties.boards[0].walls[0].max_angle, 70);

  const climbUsMisa = at(features, 37.5627864, 127.1933404);
  assert.equal(climbUsMisa.length, 1);
  assert.equal(climbUsMisa[0].properties.name, '클라임어스 미사점 Climb Us Hanam Misa');
  assert.equal(climbUsMisa[0].properties.city, 'Hanam');
  assert.deepEqual(boardIds(climbUsMisa[0]), ['kilter']);

  for (const [lat, lon] of [
    [31.9543786, 35.9105776],
    [-6.1138942, 106.7853922],
    [40.1588713, -105.107395],
    [46.496264, 11.3559851],
    [9.887011856968725, -83.90448881843531],
    [9.8703962, -83.9405677],
    [30.2425899, 120.16929],
    [37.6248093, 126.6704112],
    [25.00201, 121.20233],
    [24.9721514, 121.2053963],
    [34.24118, 108.96707],
    [52.3765411, 4.871359],
    [-34.0274902, 151.0684636],
    [51.5711465, 5.0997929],
    [31.23069, 121.4277],
    [2.189594, 102.2500868],
    [10.0666868, 99.8297437],
    [39.9831168, -75.1376867],
    [60.4782741, 5.3138912],
    [42.6620646, 23.3662234],
    [32.8888947, -96.7670093],
    [40.5600056, -111.8959944],
    [32.7962626, -96.8224275],
    [47.2629903, 11.9012218],
    [47.2629056, 11.899269],
    [47.2666011, 11.8953282],
    [14.6161226, -61.0308231],
    [51.0155462, 13.8058261],
  ]) assert.equal(at(features, lat, lon).length, 0);

  assert.equal(at(features, 46.8753166, -96.7668897).length, 0);

  for (const [lat, lon] of [
    [41.484778, -81.7944535],
    [40.433068, -80.004656],
    [30.4333434, -84.2922747],
  ]) assert.equal(at(features, lat, lon).length, 0);
});

test('the map bypasses pre-Quantum service-worker cache entries', () => {
  const map = readFileSync(MAP_JS, 'utf8');
  assert.match(map, /fetch\('\/boards\/data\/boards\.geojson\?v=20260831-quantum9'\)/);

  for (const page of ['boards/index.html', 'de/boards/index.html']) {
    const html = readFileSync(join(REPO_ROOT, page), 'utf8');
    assert.match(html, /rel="preload" href="\/boards\/data\/boards\.geojson\?v=20260831-quantum9"/);
    assert.match(html, /map\.js\?v=20260831-3/);
  }
});
