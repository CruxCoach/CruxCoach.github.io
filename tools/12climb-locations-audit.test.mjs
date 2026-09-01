import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditLocations, parseKml } from './12climb-locations-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const KML = `<?xml version="1.0"?><kml><Document>
<Placemark><name><![CDATA[Public&nbsp; Gym]]></name><Point><coordinates>11.5,48.1,0</coordinates></Point></Placemark>
<Placemark><name>School 1</name><Point><coordinates>12.5,49.1,0</coordinates></Point></Placemark>
</Document></kml>`;

test('parseKml keeps only public name and coordinate fields', () => {
  assert.deepEqual(parseKml(KML), [
    { name: 'Public&nbsp; Gym', lat: 48.1, lon: 11.5 },
    { name: 'School 1', lat: 49.1, lon: 12.5 },
  ]);
});

test('auditLocations reconciles reviewed rows and their map disposition', () => {
  const decisions = [
    { name: 'Public Gym', lat: 48.1, lon: 11.5, status: 'published' },
    { name: 'School 1', lat: 49.1, lon: 12.5, status: 'non-public' },
  ];
  const pins = [
    { name: 'Public Gym', lat: 48.1, lon: 11.5 },
    { name: 'School 1', lat: 49.1, lon: 12.5 },
  ];
  const audit = auditLocations(pins, decisions, [{ name: 'Public Gym', lat: 48.1, lon: 11.5 }]);
  assert.deepEqual(audit.counts, { published: 1, 'non-public': 1, unverified: 0, new: 0 });
  assert.equal(audit.new.length, 0);
  assert.equal(audit.missing.length, 0);
  assert.equal(audit.accidentally_published.length, 0);
});

test('auditLocations fails visibly on source drift and wrong publication', () => {
  const decisions = [{ name: 'Old Name', lat: 48.1, lon: 11.5, status: 'non-public' }];
  const pins = [
    { name: 'New Name', lat: 48.1, lon: 11.5 },
    { name: 'New Place', lat: 49.1, lon: 12.5 },
  ];
  const audit = auditLocations(pins, decisions, [{ name: 'Wrongly mapped', lat: 48.1, lon: 11.5 }]);
  assert.equal(audit.changed.length, 1);
  assert.equal(audit.new.length, 1);
  assert.equal(audit.accidentally_published.length, 1);
});

test('the complete committed disposition ledger agrees with production', () => {
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/12climb-location-decisions.json'), 'utf8'));
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  const venues = geojson.features.filter(feature => feature.properties.boards.some(row => row.board === '12climb'))
    .map(feature => ({ name: feature.properties.name, lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0] }));
  const audit = auditLocations(decisions.map(({ name, lat, lon }) => ({ name, lat, lon })), decisions, venues);
  assert.equal(decisions.length, 35);
  assert.deepEqual(audit.counts, { published: 6, 'non-public': 25, unverified: 4, new: 0 });
  assert.deepEqual(audit.malformed_decisions, []);
  assert.deepEqual(audit.missing_published, []);
  assert.deepEqual(audit.accidentally_published, []);
});
