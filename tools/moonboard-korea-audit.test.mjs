import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditCandidates, parseCandidates } from './moonboard-korea-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the parser discards map links and retains only discovery facts', () => {
  const csv = '지역,상호명,네이버지도링크,연도\n서울/경기 ,테스트 짐,"https://example.invalid/a,b",2024\n';
  assert.deepEqual(parseCandidates(csv), [{ region: '서울/경기', name: '테스트 짐', generation: 2024 }]);
});

test('the audit exposes source drift and accidental publication', () => {
  const candidates = [{ region: '강원', name: '현재 짐', generation: 2024 }];
  const decisions = [{ region: '강원', name: '이전 짐', generation: 2024, status: 'pending' }];
  const audit = auditCandidates(candidates, decisions, [{ name: '이전 짐' }]);
  assert.equal(audit.missing.length, 1);
  assert.equal(audit.stale.length, 1);
  assert.equal(audit.accidentallyPublished.length, 1);
});

test('every decided row carries explicit HTTPS provenance while pending rows claim none', () => {
  const candidates = [
    { region: '강원', name: '결정 짐', generation: 2024 },
    { region: '강원', name: '대기 짐', generation: 2016 },
  ];
  const decisions = [
    { region: '강원', name: '결정 짐', generation: 2024, status: 'unverified', note: 'Checked.', sources: [] },
    { region: '강원', name: '대기 짐', generation: 2016, status: 'pending', note: 'Not checked.' },
  ];
  assert.deepEqual(auditCandidates(candidates, decisions).malformed, [
    'decided decision 0 needs HTTPS sources',
    'pending decision 1 must not claim evidence',
  ]);
});

test('the committed Korean inventory accounts for the current open reconciliation queue', () => {
  const decisions = JSON.parse(readFileSync(join(ROOT, 'tools/moonboard-korea-decisions.json'), 'utf8'));
  const geojson = JSON.parse(readFileSync(join(ROOT, 'boards/data/boards.geojson'), 'utf8'));
  const venues = geojson.features.filter(feature => feature.properties.country === 'KR'
    && feature.properties.boards.some(row => row.board === 'moonboard'))
    .map(feature => ({ name: feature.properties.name }));
  const candidates = decisions.map(({ region, name, generation }) => ({ region, name, generation }));
  const audit = auditCandidates(candidates, decisions, venues);
  assert.equal(decisions.length, 56);
  assert.equal(new Set(decisions.map(row => row.name)).size, 55);
  assert.deepEqual(audit.counts, { pending: 27, published: 4, unverified: 24, 'social-only': 0, closed: 1, ambiguous: 0 });
  assert.deepEqual(audit.malformed, []);
  assert.deepEqual(audit.missingPublished, []);
  assert.deepEqual(audit.accidentallyPublished, []);
  assert.equal(audit.unknownMapVenues.length, 12);
});
