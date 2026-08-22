#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY curation aid for tools/osm-venues.json.
 *
 * It prints OpenStreetMap objects near a venue so a person can decide whether
 * one of them IS that venue. It deliberately cannot decide that itself and it
 * writes nothing, anywhere: the value of the curated match file is that every
 * row in it was looked at, and a script that "found a good enough candidate"
 * would destroy exactly that. What it prints is evidence — name, distance,
 * the classifying tag, the address, whether opening hours are even tagged —
 * and the answer is still a human's.
 *
 * Two candidates of similar quality is not a tie to be broken by distance. It
 * is a rejection with reason "ambiguous", which is a valid, recordable outcome.
 *
 *   node tools/dev/osm-candidates.mjs --country DE --limit 10
 *   node tools/dev/osm-candidates.mjs --name "Boulderwelt"
 *   node tools/dev/osm-candidates.mjs --key 48.1070|11.5457
 *
 * Reads the public Overpass API; run it sparingly and never from a test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCuratedMatches, venueLooksPrivate } from '../osm-hours.mjs';
import { venueKey } from '../venue-key.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEOJSON_FILE = join(REPO_ROOT, 'boards', 'data', 'boards.geojson');
const CURATED_FILE = join(REPO_ROOT, 'tools', 'osm-venues.json');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const USER_AGENT =
  'CruxCoachPages/1.0 (opening-hours curation; +https://cruxcoach.org/; contact https://cruxcoach.org/imprint.html)';

const DEFAULTS = {
  radius: 250, limit: 12, batch: 6, delayMs: 3000, timeoutMs: 60000,
  retries: 3, backoffMs: 30000, endpoint: OVERPASS,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS, country: null, name: null, key: null, includeCurated: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--country': opts.country = String(argv[++i]).toUpperCase(); break;
      case '--name': opts.name = String(argv[++i]).toLowerCase(); break;
      case '--key': opts.key = String(argv[++i]); break;
      case '--radius': opts.radius = Number(argv[++i]); break;
      case '--limit': opts.limit = Number(argv[++i]); break;
      case '--batch': opts.batch = Number(argv[++i]); break;
      case '--delay-ms': opts.delayMs = Number(argv[++i]); break;
      case '--include-curated': opts.includeCurated = true; break;
      case '--endpoint': opts.endpoint = String(argv[++i]); break;
      case '--retries': opts.retries = Number(argv[++i]); break;
      default:
        process.stderr.write(`unknown option: ${argv[i]}\n`);
        process.exit(2);
    }
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function selectVenues(opts) {
  const data = JSON.parse(readFileSync(GEOJSON_FILE, 'utf-8'));
  const { accepted, rejected } = loadCuratedMatches(CURATED_FILE);
  const decided = new Set([...accepted, ...rejected].map((e) => e.key));

  const out = [];
  for (const feature of data.features ?? []) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = venueKey(lat, lon);
    const props = feature.properties ?? {};
    if (!opts.includeCurated && decided.has(key)) continue;
    if (opts.key && key !== opts.key) continue;
    if (opts.country && props.country !== opts.country) continue;
    if (opts.name && !String(props.name ?? '').toLowerCase().includes(opts.name)) continue;
    const privacy = venueLooksPrivate(feature);
    if (privacy.private) continue; // home walls are never candidates
    out.push({ key, lat, lon, name: props.name ?? '', city: props.city ?? props.city_nearest ?? '', country: props.country ?? '', privacy });
    if (out.length >= opts.limit) break;
  }
  return out;
}

function overpassQuery(venues, radius) {
  const around = (filter) => venues
    .map((v) => `  nwr(around:${radius},${v.lat},${v.lon})${filter};`)
    .join('\n');
  return `[out:json][timeout:60];
(
${around('["leisure"~"^(sports_centre|climbing|fitness_centre|sports_hall)$"]')}
${around('["sport"~"climbing"]')}
${around('["shop"="sports"]')}
);
out tags center;`;
}

// Overpass answers 429 (slot exhausted) and 504 (query timed out) under load.
// Both mean "come back later", so they are waited out rather than hammered.
async function overpass(query, opts) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'text/plain' },
      body: query,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status === 504;
    if (!retryable || attempt >= opts.retries) throw new Error(`Overpass HTTP ${res.status}`);
    const wait = opts.backoffMs * (attempt + 1);
    process.stderr.write(`[candidates] HTTP ${res.status} — waiting ${wait / 1000}s\n`);
    await sleep(wait);
  }
}

function summarize(element) {
  const t = element.tags ?? {};
  const kind = ['leisure', 'sport', 'shop', 'amenity']
    .filter((k) => t[k])
    .map((k) => `${k}=${t[k]}`)
    .join(' ');
  const address = [t['addr:street'], t['addr:housenumber'], t['addr:city']].filter(Boolean).join(' ');
  return {
    id: `${element.type}/${element.id}`,
    name: t.name ?? '(unnamed)',
    kind,
    address,
    opening_hours: t.opening_hours ?? null,
    check_date: t['check_date:opening_hours'] ?? null,
    lat: element.lat ?? element.center?.lat,
    lon: element.lon ?? element.center?.lon,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const venues = selectVenues(opts);
  if (!venues.length) {
    process.stdout.write('no venues match that selection (already curated ones are skipped)\n');
    return;
  }
  process.stderr.write(`[candidates] ${venues.length} venue(s), radius ${opts.radius} m\n`);

  for (let i = 0; i < venues.length; i += opts.batch) {
    const batch = venues.slice(i, i + opts.batch);
    let body;
    try {
      body = await overpass(overpassQuery(batch, opts.radius), opts);
    } catch (err) {
      process.stderr.write(`[candidates] batch failed: ${err.message}\n`);
      await sleep(opts.delayMs);
      continue;
    }
    const elements = (body.elements ?? []).map(summarize).filter((e) => e.lat != null);

    for (const venue of batch) {
      process.stdout.write(`\n=== ${venue.name} — ${venue.city}, ${venue.country}\n`);
      process.stdout.write(`    venue key ${venue.key} @ ${venue.lat}, ${venue.lon} (${venue.privacy.reason})\n`);
      const near = elements
        .map((e) => ({ ...e, m: Math.round(haversineKm(venue.lat, venue.lon, e.lat, e.lon) * 1000) }))
        .filter((e) => e.m <= opts.radius)
        .sort((a, b) => a.m - b.m);
      if (!near.length) {
        process.stdout.write('    no candidate objects within the radius\n');
        continue;
      }
      for (const c of near) {
        process.stdout.write(`    ${String(c.m).padStart(4)} m  ${c.id.padEnd(16)} ${c.name}\n`);
        process.stdout.write(`             ${c.kind}${c.address ? ` | ${c.address}` : ''}\n`);
        process.stdout.write(`             opening_hours: ${c.opening_hours ?? '—'}`);
        process.stdout.write(c.check_date ? `  (check_date ${c.check_date})\n` : '\n');
      }
    }
    await sleep(opts.delayMs);
  }
  process.stdout.write('\nDecide by hand. Two plausible objects means status "rejected", reason "ambiguous".\n');
}

main().catch((err) => {
  process.stderr.write(`[candidates] ${err.stack ?? err.message}\n`);
  process.exit(1);
});
