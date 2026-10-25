// Curated Shiny Wall locations.
//
// Shiny Wall publishes no public location feed. The manufacturer's app lists
// the walls a gym has marked public; that list is the discovery source, but a
// gym only reaches the map once a public page or official address register
// pins it to a real, publicly accessible venue. Private home walls, test rows,
// trade-fair demo walls and members-only club rooms never qualify.
//
// Only Standard-family boards (Standard, Standard Full, Standard Max, Standard
// Max Full, Standard Mini) are listed: they share one hold layout per variant,
// which is what makes a venue useful to a visiting climber. Bespoke Custom and
// Lite walls are deliberately out of scope. Evidence and coordinate provenance
// stay in the source file and are not copied into the browser-facing GeoJSON.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_FILE = fileURLToPath(new URL('../shinywall-locations.json', import.meta.url));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

// The only model labels a record may publish. A closed list keeps free text
// (such as a gym's own wall names) out of the map.
export const MODELS = new Set([
  'Shiny Wall Standard',
  'Shiny Wall Standard Full',
  'Shiny Wall Standard Max',
  'Shiny Wall Standard Max Full',
  'Shiny Wall Standard Mini',
  'Shiny Wall Standard Mini Full',
]);

// Where a marker's coordinate comes from. `map-venue` reuses the coordinate of
// a venue already on the map so the Shiny Wall joins that venue's marker.
export const COORDINATE_SOURCES = new Set(['osm', 'cartociudad', 'catastro', 'ban', 'map-venue']);

function nonEmpty(value, field, where) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${where}: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function safeHttps(value, field, where) {
  const raw = nonEmpty(value, field, where);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${where}: ${field} is not a URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) {
    throw new Error(`${where}: ${field} must be a credential-free public HTTPS URL`);
  }
  return url.href;
}

export function parseLocations(doc) {
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.locations)) {
    throw new Error('shinywall-locations.json needs schema_version 1 and a locations array');
  }
  if (!DATE_RE.test(doc.checked_at ?? '')) {
    throw new Error('shinywall-locations.json checked_at must be YYYY-MM-DD');
  }

  const ids = new Set();
  const entries = doc.locations.map((row, index) => {
    const where = `shinywall.locations[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${where}: must be an object`);
    const id = nonEmpty(row.id, 'id', where);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error(`${where}: id must be unique kebab-case`);
    ids.add(id);

    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (typeof row.lat !== 'number' || typeof row.lon !== 'number'
      || !Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) {
      throw new Error(`${where}: invalid public coordinates`);
    }
    const country = nonEmpty(row.country, 'country', where);
    if (!COUNTRY_RE.test(country)) throw new Error(`${where}: country must be ISO-3166-1 alpha-2`);
    if (row.public !== true) {
      throw new Error(`${where}: only publicly accessible venues are publishable`);
    }

    if (!Array.isArray(row.models) || row.models.length === 0) throw new Error(`${where}: models must not be empty`);
    const models = row.models.map((model) => nonEmpty(model, 'model', where));
    for (const model of models) {
      if (!MODELS.has(model)) throw new Error(`${where}: unknown model "${model}"`);
    }
    if (new Set(models).size !== models.length) throw new Error(`${where}: duplicate model`);

    const coordinate = row.coordinate;
    if (!coordinate || typeof coordinate !== 'object' || !COORDINATE_SOURCES.has(coordinate.source)) {
      throw new Error(`${where}: coordinate.source must be one of ${[...COORDINATE_SOURCES].join(', ')}`);
    }
    nonEmpty(coordinate.ref, 'coordinate.ref', where);

    if (!Array.isArray(row.evidence) || row.evidence.length === 0) throw new Error(`${where}: evidence must not be empty`);
    row.evidence.forEach((proof, proofIndex) => {
      const proofWhere = `${where}.evidence[${proofIndex}]`;
      if (!proof || typeof proof !== 'object') throw new Error(`${proofWhere}: must be an object`);
      safeHttps(proof.url, 'url', proofWhere);
      nonEmpty(proof.claim, 'claim', proofWhere);
      if (!DATE_RE.test(proof.checked_at ?? '')) throw new Error(`${proofWhere}: checked_at must be YYYY-MM-DD`);
    });

    const entry = {
      source: 'shinywall',
      board: 'shinywall',
      name: nonEmpty(row.name, 'name', where),
      lat,
      lon,
      address: nonEmpty(row.address, 'address', where),
      city: nonEmpty(row.city, 'city', where),
      country,
      models,
    };
    if (row.website != null) entry.website = safeHttps(row.website, 'website', where);
    return entry;
  });

  return { entries, checkedAt: doc.checked_at };
}

export async function load() {
  const doc = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const { entries, checkedAt } = parseLocations(doc);
  return {
    entries,
    meta: {
      kind: 'curated-public-venue-allowlist',
      checked_at: checkedAt,
      locations: entries.length,
    },
  };
}
