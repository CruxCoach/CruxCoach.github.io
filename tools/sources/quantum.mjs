// Curated Quantum Board locations.
//
// Unlike the broad Hangtime feed, the eWalls API does not expose a reliable
// board-to-venue relation. The source file is therefore a small, reviewable
// allowlist backed by public evidence. Evidence stays in the source file and
// is deliberately not copied into the browser-facing GeoJSON.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_FILE = fileURLToPath(new URL('../quantum-locations.json', import.meta.url));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

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
    throw new Error('quantum-locations.json needs schema_version 1 and a locations array');
  }
  if (!DATE_RE.test(doc.checked_at ?? '')) {
    throw new Error('quantum-locations.json checked_at must be YYYY-MM-DD');
  }

  const ids = new Set();
  const entries = doc.locations.map((row, index) => {
    const where = `quantum.locations[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${where}: must be an object`);
    const id = nonEmpty(row.id, 'id', where);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error(`${where}: id must be unique kebab-case`);
    ids.add(id);

    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) {
      throw new Error(`${where}: invalid public coordinates`);
    }
    const country = nonEmpty(row.country, 'country', where);
    if (!COUNTRY_RE.test(country)) throw new Error(`${where}: country must be ISO-3166-1 alpha-2`);
    if (row.public !== true || row.verification !== 'primary') {
      throw new Error(`${where}: only public locations verified by a primary source are publishable`);
    }
    if (!Array.isArray(row.models) || row.models.length === 0) throw new Error(`${where}: models must not be empty`);
    const models = row.models.map((model) => nonEmpty(model, 'model', where));
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) throw new Error(`${where}: evidence must not be empty`);
    row.evidence.forEach((proof, proofIndex) => {
      const proofWhere = `${where}.evidence[${proofIndex}]`;
      if (!proof || typeof proof !== 'object') throw new Error(`${proofWhere}: must be an object`);
      safeHttps(proof.url, 'url', proofWhere);
      nonEmpty(proof.claim, 'claim', proofWhere);
      if (!DATE_RE.test(proof.checked_at ?? '')) throw new Error(`${proofWhere}: checked_at must be YYYY-MM-DD`);
    });

    return {
      source: 'quantum',
      board: 'quantum',
      name: nonEmpty(row.name, 'name', where),
      lat,
      lon,
      address: nonEmpty(row.address, 'address', where),
      city: nonEmpty(row.city, 'city', where),
      country,
      models,
      website: safeHttps(row.website, 'website', where),
    };
  });

  return { entries, checkedAt: doc.checked_at };
}

export async function load() {
  const doc = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const { entries, checkedAt } = parseLocations(doc);
  return {
    entries,
    meta: {
      kind: 'curated-primary-source-allowlist',
      checked_at: checkedAt,
      locations: entries.length,
    },
  };
}

