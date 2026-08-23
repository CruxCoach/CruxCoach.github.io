import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyVenueLinks, classifyVenue, clearVenueLinkProperties, isCanonicalVenueUrl,
  loadVenueLinks, MATCH_RADIUS_M, nameSimilarity, normalizeName, normalizeVenueUrl,
  RESEARCH_STATUS, SHARED_URL_SITE_LIMIT_M, suspiciousParams, validateResearchEntry,
  validateVenueLink, venueKey,
} from './venue-links.mjs';
import { renderListPage } from './render-static.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINKS_FILE = join(REPO_ROOT, 'tools', 'venue-links.json');
const RESEARCH_FILE = join(REPO_ROOT, 'tools', 'venue-links-research.json');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const MAP_JS = join(REPO_ROOT, 'boards', 'map.js');

// ── fixtures ────────────────────────────────────────────────────────

function feature(lat, lon, name, props = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name, country: 'DE', boards: [{ board: 'kilter', address: 'X 1' }], ...props },
  };
}

function link(overrides = {}) {
  return {
    lat: 48.1234,
    lon: 11.5678,
    name: 'Boulderwelt München Ost',
    country: 'DE',
    website: 'https://www.boulderwelt-muenchen-ost.de/',
    verified: '2026-08-22',
    provenance: 'official-site',
    signals: ['name', 'street-address'],
    ...overrides,
  };
}

// ── URL policy ──────────────────────────────────────────────────────

test('normalizeVenueUrl accepts a plain https site unchanged', () => {
  assert.equal(normalizeVenueUrl('https://example.org/'), 'https://example.org/');
  assert.equal(normalizeVenueUrl('https://example.org/standorte/muenchen/'),
    'https://example.org/standorte/muenchen/');
});

test('normalizeVenueUrl supplies the root path and lowercases the host', () => {
  assert.equal(normalizeVenueUrl('https://Example.ORG'), 'https://example.org/');
});

test('normalizeVenueUrl strips fragments and campaign parameters', () => {
  assert.equal(
    normalizeVenueUrl('https://example.org/gym?utm_source=map&utm_medium=x&fbclid=abc#opening'),
    'https://example.org/gym',
  );
  assert.equal(
    normalizeVenueUrl('https://example.org/gym?id=7&gclid=zzz'),
    'https://example.org/gym?id=7',
    'a real parameter survives',
  );
});

test('normalizeVenueUrl refuses anything that is not a credential-free https URL', () => {
  const bad = [
    'http://example.org/',                       // no https
    'javascript:alert(1)',                       // not a navigation we would ever emit
    'data:text/html,<script>x</script>',
    'mailto:info@example.org',
    'ftp://example.org/',
    'https://user:pw@example.org/',              // credentials
    'https://example.org:8443/',                 // non-default port
    'https://192.168.1.10/',                     // IP literal
    'https://[2001:db8::1]/',
    'https://localhost/',                        // no dot, not public
    'https://intranet/',
    '//example.org/',                            // not absolute
    'example.org',
    'https://example.org/ path',                 // whitespace
    ' https://example.org/',
    `https://example.org/${'a'.repeat(400)}`,     // absurd length
  ];
  for (const url of bad) {
    assert.throws(() => normalizeVenueUrl(url), new RegExp('.'), `expected refusal: ${url}`);
  }
});

test('normalizeVenueUrl refuses social and aggregator hosts', () => {
  for (const url of [
    'https://www.facebook.com/somegym/',
    'https://instagram.com/somegym',
    'https://maps.app.goo.gl/abc',
    'https://linktr.ee/somegym',
    'https://bit.ly/3abc',
    'https://www.openstreetmap.org/node/1',
  ]) {
    assert.throws(() => normalizeVenueUrl(url), /social\/aggregator|unusable/, url);
  }
});

test('normalizeVenueUrl keeps a site hosted on a website builder', () => {
  // These are genuinely somebody's official site, unlike a social profile.
  assert.equal(normalizeVenueUrl('https://somegym.wixsite.com/gym'), 'https://somegym.wixsite.com/gym');
  assert.equal(normalizeVenueUrl('https://somegym.jimdosite.com/'), 'https://somegym.jimdosite.com/');
});

test('normalizeVenueUrl punycodes an internationalized host', () => {
  assert.equal(normalizeVenueUrl('https://klettern-münchen.de/'), 'https://xn--klettern-mnchen-8vb.de/');
});

test('isCanonicalVenueUrl only accepts the already-normalized form', () => {
  assert.equal(isCanonicalVenueUrl('https://example.org/'), true);
  assert.equal(isCanonicalVenueUrl('https://example.org'), false, 'missing root path');
  assert.equal(isCanonicalVenueUrl('https://example.org/#x'), false);
  assert.equal(isCanonicalVenueUrl('http://example.org/'), false);
  assert.equal(isCanonicalVenueUrl('javascript:alert(1)'), false);
});

test('suspiciousParams flags parameters a human should look at', () => {
  assert.deepEqual(suspiciousParams('https://example.org/?ref=partner'), ['ref']);
  assert.deepEqual(suspiciousParams('https://example.org/?id=3'), []);
});

// ── record schema ───────────────────────────────────────────────────

test('validateVenueLink accepts a well-formed record', () => {
  assert.deepEqual(validateVenueLink(link()), []);
});

test('validateVenueLink requires two independent signals', () => {
  assert.match(validateVenueLink(link({ signals: ['name'] }))[0], /at least 2 independent signals/);
  assert.match(
    validateVenueLink(link({ signals: ['name', 'brand'] }))[0],
    /at least 2 independent signals/,
    'name and brand are the same observation',
  );
  assert.deepEqual(validateVenueLink(link({ signals: ['brand', 'city'] })), []);
});

test('validateVenueLink makes a chain page name the specific location', () => {
  assert.match(
    validateVenueLink(link({ provenance: 'official-chain-page', signals: ['name', 'board-mention'] }))[0],
    /requires street-address, city or location-page/,
  );
  assert.deepEqual(
    validateVenueLink(link({ provenance: 'official-chain-page', signals: ['brand', 'city'] })),
    [],
  );
});

test('validateVenueLink rejects malformed metadata', () => {
  assert.match(validateVenueLink(link({ verified: '2026-13-01' }))[0], /real UTC date/);
  assert.match(validateVenueLink(link({ verified: '22.08.2026' }))[0], /real UTC date/);
  assert.match(validateVenueLink(link({ country: 'de' }))[0], /alpha-2/);
  assert.match(validateVenueLink(link({ provenance: 'guessed' }))[0], /provenance/);
  assert.match(validateVenueLink(link({ signals: ['vibes', 'city'] }))[0], /unknown signal/);
  assert.match(validateVenueLink(link({ lat: 91 }))[0], /lat/);
  assert.match(validateVenueLink(link({ source: 'osm' }))[0], /unknown field "source"/);
  assert.match(validateVenueLink(link({ website: 'https://example.org' }))[0], /not canonical/);
  assert.match(validateVenueLink(null)[0], /not an object/);
});

test('validateResearchEntry keeps rejected candidates well-described', () => {
  const base = {
    lat: 48.1, lon: 11.5, name: 'Somewhere', country: 'DE',
    status: 'ambiguous', checked: '2026-08-22', reason: 'two plausible sites',
  };
  assert.deepEqual(validateResearchEntry(base), []);
  assert.match(validateResearchEntry({ ...base, status: 'maybe' })[0], /status/);
  assert.match(validateResearchEntry({ ...base, reason: '' })[0], /reason/);
  assert.match(validateResearchEntry({ ...base, website: 'https://x.test/' })[0], /unknown field/);
  assert.ok(RESEARCH_STATUS.has('private') && RESEARCH_STATUS.has('closed'));
});

// ── name matching ───────────────────────────────────────────────────

test('normalizeName folds case, diacritics and punctuation', () => {
  assert.equal(normalizeName('Boulderwelt München-Ost'), 'boulderwelt munchen ost');
  assert.equal(normalizeName('Größenwahn e.V.'), 'grossenwahn e v');
});

test('nameSimilarity treats a legal suffix or a subset as the same venue', () => {
  assert.equal(nameSimilarity('Boulderwelt München Ost', 'Boulderwelt München Ost GmbH'), 1);
  assert.equal(nameSimilarity('Kletterzentrum Innsbruck', 'Kletterzentrum Innsbruck (KI)'), 1);
  assert.equal(nameSimilarity('Boulderwelt München Ost', 'Boulderwelt Munchen Ost'), 1);
});

test('nameSimilarity separates two different gyms in the same chain', () => {
  assert.ok(nameSimilarity('Boulderwelt München Ost', 'Boulderwelt München West') < 1);
  assert.ok(nameSimilarity('Bloc-Hütte Augsburg', 'Kletterhalle Rostock') < 0.5);
});

// ── classification ──────────────────────────────────────────────────

test('classifyVenue keeps home walls out of the linkable set', () => {
  assert.equal(classifyVenue({ boards: [{ board: 'kilter', address: 'X' }] }), 'commercial');
  assert.equal(classifyVenue({ boards: [{ board: 'moonboard', commercial: true }] }), 'commercial');
  assert.equal(classifyVenue({ boards: [{ board: 'moonboard', commercial: false }] }), 'private');
  assert.equal(
    classifyVenue({ boards: [{ board: 'moonboard', commercial: false }, { board: 'moonboard', commercial: false }] }),
    'private',
  );
  assert.equal(
    classifyVenue({ boards: [{ board: 'moonboard', commercial: false }, { board: 'kilter' }] }),
    'commercial',
    'a Kilter installation at the same address makes it a gym',
  );
  assert.equal(classifyVenue({ boards: [{ board: 'tension', username: 'someone' }] }), 'unknown');
  assert.equal(classifyVenue({}), 'unknown');
});

// ── matching ────────────────────────────────────────────────────────

test('applyVenueLinks attaches the URL but keeps the verification date internal', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.deepEqual(problems, []);
  assert.equal(stats.applied, 1);
  assert.equal(stats.countries, 1);
  assert.deepEqual(stats.by_provenance, { 'official-site': 1 });
  assert.equal(features[0].properties.website, 'https://www.boulderwelt-muenchen-ost.de/');
  assert.equal(features[0].properties.website_checked, undefined);
});

test('applyVenueLinks rematches a venue whose coordinate drifted', () => {
  // ~90 m north of the curated coordinate — well inside the tolerance.
  const features = [feature(48.1242, 11.5678, 'Boulderwelt München Ost')];
  const { stats, notes } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 1);
  assert.equal(stats.matched_by_proximity, 1);
  assert.match(notes.join('\n'), /coordinate drifted/);
});

test('applyVenueLinks drops a record whose venue moved out of range', () => {
  const features = [feature(48.2000, 11.5678, 'Boulderwelt München Ost')];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 0);
  assert.equal(stats.unmatched, 1);
  assert.match(problems[0], new RegExp(`no venue within ${MATCH_RADIUS_M} m`));
  assert.equal(features[0].properties.website, undefined);
});

test('applyVenueLinks refuses when two nearby venues answer to the same name', () => {
  const features = [
    feature(48.1240, 11.5678, 'Boulderwelt München Ost'),
    feature(48.1238, 11.5680, 'Boulderwelt München Ost'),
  ];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 0);
  assert.equal(stats.ambiguous, 1);
  assert.match(problems[0], /refusing to guess/);
});

test('applyVenueLinks refuses a coordinate that now belongs to another gym', () => {
  const features = [feature(48.1234, 11.5678, 'Kletterhalle Irgendwo')];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 0);
  assert.match(problems[0], /refusing to attach the link/);
  assert.equal(features[0].properties.website, undefined);
});

test('applyVenueLinks refuses a country mismatch', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost', { country: 'AT' })];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 0);
  assert.match(problems[0], /record says DE, venue is in AT/);
});

test('applyVenueLinks never links a private home setup', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost', {
    boards: [{ board: 'moonboard', commercial: false }],
  })];
  const { stats, problems } = applyVenueLinks(features, [link()]);
  assert.equal(stats.applied, 0);
  assert.equal(stats.private_refused, 1);
  assert.match(problems[0], /non-commercial home setup/);
  assert.equal(features[0].properties.website, undefined);
});

test('applyVenueLinks drops both records when two claim one venue', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const entries = [
    link(),
    // A second record 50 m away that resolves onto the very same venue.
    link({ lat: 48.1238, lon: 11.5678, website: 'https://example.org/other/' }),
  ];
  const { stats, problems } = applyVenueLinks(features, entries);
  assert.equal(stats.applied, 0);
  assert.equal(stats.ambiguous, 2);
  assert.match(problems[0], /same venue — dropping all of them/);
  assert.equal(features[0].properties.website, undefined);
});

test('applyVenueLinks counts an invalid record as rejected without touching the venue', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  const { stats, problems } = applyVenueLinks(features, [link({ website: 'http://insecure.test/' })]);
  assert.equal(stats.applied, 0);
  assert.equal(stats.rejected, 1);
  assert.match(problems[0], /must use https/);
  assert.equal(features[0].properties.website, undefined);
});

test('applyVenueLinks clears a link that is no longer curated', () => {
  const features = [feature(48.1234, 11.5678, 'Boulderwelt München Ost')];
  applyVenueLinks(features, [link()]);
  assert.ok(features[0].properties.website);
  applyVenueLinks(features, []);
  assert.equal(features[0].properties.website, undefined, 'removing the record removes the link');
  assert.equal(features[0].properties.website_checked, undefined);
});

test('clearVenueLinkProperties leaves everything else alone', () => {
  const features = [feature(48.1234, 11.5678, 'X', { wellpass: true, city: 'München' })];
  features[0].properties.website = 'https://example.org/';
  clearVenueLinkProperties(features);
  assert.equal(features[0].properties.website, undefined);
  assert.equal(features[0].properties.wellpass, true);
  assert.equal(features[0].properties.city, 'München');
});

test('venueKey matches the grouping precision the build uses', () => {
  assert.equal(venueKey(48.12344999, 11.5678), '48.1234|11.5678');
  assert.notEqual(venueKey(48.1234, 11.5678), venueKey(48.1235, 11.5678));
});

// ── static rendering ────────────────────────────────────────────────

const META = {
  venue_features: 1,
  per_board: { kilter: 1, tension: 0, grasshopper: 0, decoy: 0, soill: 0, touchstone: 0, aurora: 0, moonboard: 0, '12climb': 0 },
};

function renderOne(props, lang = 'en') {
  const f = feature(48.1234, 11.5678, props.name ?? 'Test Gym', props);
  return renderListPage([f], META, lang);
}

test('the directory renders a curated link as a safe external link', () => {
  const html = renderOne({ name: 'Test Gym', website: 'https://example.org/gym/', website_checked: '2026-08-22' });
  assert.match(html, /<a class="vsite" href="https:\/\/example\.org\/gym\/" target="_blank" rel="noopener" referrerpolicy="origin" aria-label="[^"]+">example\.org<\/a>/);
});

test('the directory drops the www prefix from the visible host but not the href', () => {
  const html = renderOne({ name: 'Test Gym', website: 'https://www.example.org/' });
  assert.match(html, /href="https:\/\/www\.example\.org\/"/);
  assert.match(html, />example\.org</);
});

test('the directory labels the link with the venue name in both languages', () => {
  assert.match(renderOne({ name: 'Test Gym', website: 'https://example.org/' }, 'en'),
    /aria-label="Test Gym — official website"/);
  assert.match(renderOne({ name: 'Test Gym', website: 'https://example.org/' }, 'de'),
    /aria-label="Test Gym — offizielle Website"/);
});

test('the directory refuses to render a URL that did not come through curation', () => {
  for (const website of [
    'javascript:alert(1)',
    'http://example.org/',
    'https://user:pw@example.org/',
    'https://example.org/"><script>alert(1)</script>',
  ]) {
    const html = renderOne({ name: 'Test Gym', website });
    assert.doesNotMatch(html, /class="vsite"/, `rendered a link for ${website}`);
    assert.doesNotMatch(html, /<script>alert/);
  }
});

test('the directory escapes a hostile venue name in text and in the aria-label', () => {
  const html = renderOne({ name: '"><img src=x onerror=alert(1)>', website: 'https://example.org/' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the directory says how many venues carry a verified link', () => {
  assert.match(renderOne({ name: 'Test Gym', website: 'https://example.org/' }, 'en'),
    /<strong>1<\/strong> of them link to a manually verified official website\./);
  assert.match(renderOne({ name: 'Test Gym', website: 'https://example.org/' }, 'de'),
    /manuell geprüfte offizielle Website/);
  assert.doesNotMatch(renderOne({ name: 'Test Gym' }, 'en'), /<p class="linked-note">/,
    'no sentence at all when nothing is linked');
});

// ── map popup ───────────────────────────────────────────────────────

const mapSource = readFileSync(MAP_JS, 'utf8');

function liftFunction(name) {
  const re = new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}}`);
  const src = mapSource.match(re)?.[0];
  assert.ok(src, `could not lift ${name}() out of boards/map.js`);
  return src;
}

function callSafeSiteUrl(raw) {
  const fn = new Function('raw', `${liftFunction('safeSiteUrl')}; return safeSiteUrl(raw);`);
  return fn(raw);
}

function callRenderSiteLine(props, lang = 'en') {
  const T = lang === 'de'
    ? { websiteLabel: 'Offizielle Website:' }
    : { websiteLabel: 'Official website:' };
  const body = [
    liftFunction('escapeHtml'),
    liftFunction('safeSiteUrl'),
    liftFunction('renderSiteLine'),
  ].join('\n');
  const fn = new Function('props', 'T', 'tf', `${body}; return renderSiteLine(props);`);
  return fn(props, T, (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k]));
}

test('the popup guard accepts only credential-free https URLs', () => {
  assert.ok(callSafeSiteUrl('https://example.org/'));
  for (const bad of [
    'http://example.org/', 'javascript:alert(1)', 'data:text/html,x',
    'https://user:pw@example.org/', 'https://example.org:8443/',
    'https://localhost/', 'https://10.0.0.1/', '', null, undefined,
  ]) {
    assert.equal(callSafeSiteUrl(bad), null, `popup accepted ${bad}`);
  }
});

test('the popup renders the link without internal verification metadata', () => {
  const html = callRenderSiteLine({ website: 'https://www.example.org/gym/', website_checked: '2026-08-22' });
  assert.match(html, /href="https:\/\/www\.example\.org\/gym\/"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.match(html, /referrerpolicy="origin"/);
  assert.match(html, />example\.org</);
  assert.doesNotMatch(html, /2026-08-22|class="checked"/);
});

test('the popup shows no link for uncurated or malformed values', () => {
  assert.equal(callRenderSiteLine({ website: 'javascript:alert(1)' }), '');
  assert.equal(callRenderSiteLine({}), '');
  const linked = callRenderSiteLine({ website: 'https://example.org/', website_checked: 'yesterday' });
  assert.match(linked, /href="https:\/\/example\.org\/"/);
  assert.doesNotMatch(linked, /yesterday|class="checked"/, 'internal metadata is never printed');
});

test('the popup translates its label', () => {
  assert.match(callRenderSiteLine({ website: 'https://example.org/' }, 'de'), /Offizielle Website:/);
  assert.match(callRenderSiteLine({ website: 'https://example.org/' }, 'en'), /Official website:/);
});

test('the popup website line escapes every value it interpolates', () => {
  // The map builds Leaflet popup content as HTML strings, so the escaping has
  // to be visible in the source of this one function — not merely in its
  // output for the inputs a test happens to try.
  const src = liftFunction('renderSiteLine');
  assert.match(src, /escapeHtml\(url\.href\)/, 'the href must be escaped');
  assert.match(src, /escapeHtml\(url\.hostname/, 'the visible host must be escaped');
  assert.doesNotMatch(src, /\+ *props\.website/, 'no raw property may reach the markup');
});

// ── the committed data ──────────────────────────────────────────────

function sharedVenue(name, lat, lon) {
  return {
    geometry: { coordinates: [lon, lat] },
    properties: { name, country: 'AT', boards: [{ board: 'kilter' }] },
  };
}

function sharedRecord(name, lat, lon, provenance) {
  return {
    lat, lon, name, country: 'AT', website: 'https://example.org/',
    verified: '2026-08-22', provenance, signals: ['name', 'city'],
  };
}

test('one URL over two distant venues is an advisory, never a build failure', () => {
  // Two of an operator's halls, 40 km apart, both claiming a single-location page.
  const features = [sharedVenue('Newton Graz', 47.06581, 15.43051),
                    sharedVenue('Newton Kapfenberg', 47.42831, 15.26809)];
  const entries = [sharedRecord('Newton Graz', 47.06581, 15.43051, 'official-site'),
                   sharedRecord('Newton Kapfenberg', 47.42831, 15.26809, 'official-site')];
  const { problems, notes } = applyVenueLinks(features, entries);
  assert.deepEqual(problems, [], 'a shared URL must not fail the build');
  const advisory = notes.filter(n => n.includes('covers venues'));
  assert.equal(advisory.length, 1);
  assert.match(advisory[0], /Newton Graz, Newton Kapfenberg/);
  assert.match(advisory[0], /official-chain-page/);
});

test('a chain page that says so draws no advisory', () => {
  const features = [sharedVenue('Newton Graz', 47.06581, 15.43051),
                    sharedVenue('Newton Kapfenberg', 47.42831, 15.26809)];
  const entries = [sharedRecord('Newton Graz', 47.06581, 15.43051, 'official-chain-page'),
                   sharedRecord('Newton Kapfenberg', 47.42831, 15.26809, 'official-chain-page')];
  const { notes } = applyVenueLinks(features, entries);
  assert.equal(notes.filter(n => n.includes('covers venues')).length, 0);
});

test('two upstream entries for one hall draw no distance advisory', () => {
  // Upstream splits a hall's Kilter and MoonBoard into entries metres apart; that
  // is not a second location and must not be reported as one.
  const features = [sharedVenue('Blockfabrik', 48.17000, 16.35000),
                    sharedVenue('Blockfabrik MoonBoard', 48.17015, 16.35010)];
  const entries = [sharedRecord('Blockfabrik', 48.17000, 16.35000, 'official-site'),
                   sharedRecord('Blockfabrik MoonBoard', 48.17015, 16.35010, 'official-site')];
  const { notes } = applyVenueLinks(features, entries);
  assert.equal(notes.filter(n => n.includes('covers venues')).length, 0);
  assert.equal(notes.filter(n => n.includes('venues share')).length, 1,
    'the plain shared-URL note still fires');
});

test('the distance that separates a second hall from a drifted coordinate is a named constant', () => {
  assert.equal(typeof SHARED_URL_SITE_LIMIT_M, 'number');
  assert.ok(SHARED_URL_SITE_LIMIT_M >= MATCH_RADIUS_M,
    'a venue that rematched by proximity must never also count as a second hall');
});

test('tools/venue-links.json validates as a whole', () => {
  const { entries, errors } = loadVenueLinks(LINKS_FILE);
  assert.deepEqual(errors, [], 'schema errors in the curated file');
  assert.ok(Array.isArray(entries));
});

test('every curated record resolves onto exactly one real venue', () => {
  if (!existsSync(GEOJSON_FILE)) return;
  const { entries } = loadVenueLinks(LINKS_FILE);
  const features = JSON.parse(readFileSync(GEOJSON_FILE, 'utf8')).features
    .map(f => ({ ...f, properties: { ...f.properties } }));
  const { stats, problems } = applyVenueLinks(features, entries);
  assert.deepEqual(problems, [],
    'a record no longer matches its venue — re-check its coordinates or drop it');
  assert.equal(stats.applied, entries.length);
  assert.equal(stats.unmatched, 0);
  assert.equal(stats.ambiguous, 0);
  assert.equal(stats.private_refused, 0);
  assert.equal(stats.rejected, 0);
});

test('tools/venue-links-research.json validates and stays out of production', () => {
  if (!existsSync(RESEARCH_FILE)) return;
  const research = JSON.parse(readFileSync(RESEARCH_FILE, 'utf8'));
  assert.ok(Array.isArray(research), 'the research log must be a JSON array');

  const errors = research.flatMap((e, i) => validateResearchEntry(e, i));
  assert.deepEqual(errors, []);

  const seen = new Set();
  for (const e of research) {
    const k = venueKey(e.lat, e.lon);
    assert.ok(!seen.has(k), `duplicate research entry for ${e.name}`);
    seen.add(k);
  }

  const { entries } = loadVenueLinks(LINKS_FILE);
  for (const e of entries) {
    assert.ok(!seen.has(venueKey(e.lat, e.lon)),
      `"${e.name}" is both curated and logged as rejected — it can only be one`);
  }
});

test('the committed geojson carries only links the curation would still accept', () => {
  if (!existsSync(GEOJSON_FILE)) return;
  const features = JSON.parse(readFileSync(GEOJSON_FILE, 'utf8')).features;
  const { entries } = loadVenueLinks(LINKS_FILE);
  const curated = new Map(entries.map(e => [venueKey(e.lat, e.lon), e]));

  let found = 0;
  for (const f of features) {
    const website = f.properties.website;
    if (website === undefined) continue;
    found++;
    assert.ok(isCanonicalVenueUrl(website),
      `${f.properties.name} carries a non-canonical website ${website}`);
    assert.notEqual(classifyVenue(f.properties), 'private',
      `${f.properties.name} is a private setup but carries a website link`);
    assert.equal(f.properties.website_checked, undefined,
      `${f.properties.name} leaks an internal verification date`);
  }
  assert.equal(found, curated.size,
    'boards.geojson and tools/venue-links.json disagree — rerun node tools/build-boards-data.mjs --overlays-only');
});
