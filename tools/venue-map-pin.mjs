// Read a candidate page's own map pin and compare it with the registry point.
//   node tools/venue-map-pin.mjs "<lat>,<lon>=https://example.org" ...
//
// A venue that prints no street often still says where it is: the map it
// embeds. That pin is the venue's own statement of its position, which is the
// second signal the address-less rows are missing — see "The map block is an
// address" in VENUE-LINKS.md. Makes network requests, so it is never part of
// scripts/check; distances are a finding to read, not a verdict.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const OUT = process.env.MP_DIR || 'venue-map-pin.out/';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const PATHS = ['', 'contact', 'contact-us', 'location', 'locations', 'visit', 'about', 'find-us', 'kontakt', 'anfahrt', 'contacto', 'contatti', 'hours'];

const wait = ms => new Promise(r => setTimeout(r, ms));
async function get(url, ms = 25000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal, redirect: 'follow' });
    return { status: res.status, text: await res.text() }; } catch { return null; } finally { clearTimeout(t); }
}
const R = 6371000, rad = d => d * Math.PI / 180;
const dist = (a, b, c, d) => { const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

// Every shape a page states its own position in. Order matters only for the label.
function pins(html) {
  const found = [];
  const push = (lat, lon, how) => {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    if (lat === 0 && lon === 0) return;
    found.push({ lat, lon, how });
  };
  for (const m of html.matchAll(/!3d(-?\d+\.\d{3,})!4d(-?\d+\.\d{3,})/g)) push(m[1], m[2], 'gmaps-embed');
  for (const m of html.matchAll(/[?&](?:ll|q|center|sll|daddr)=(-?\d+\.\d{3,})(?:,|%2C)(-?\d+\.\d{3,})/gi)) push(m[1], m[2], 'gmaps-query');
  for (const m of html.matchAll(/"mapLat"\s*:\s*(-?\d+\.\d{3,})\s*,\s*"mapLng"\s*:\s*(-?\d+\.\d{3,})/g)) push(m[1], m[2], 'squarespace');
  for (const m of html.matchAll(/"latitude"\s*:\s*"?(-?\d+\.\d{3,})"?\s*,\s*"longitude"\s*:\s*"?(-?\d+\.\d{3,})"?/g)) push(m[1], m[2], 'schema/json');
  for (const m of html.matchAll(/"lat"\s*:\s*"?(-?\d+\.\d{3,})"?\s*,\s*"l(?:ng|on|ongitude)"\s*:\s*"?(-?\d+\.\d{3,})"?/g)) push(m[1], m[2], 'json-latlng');
  for (const m of html.matchAll(/data-lat(?:itude)?=["'](-?\d+\.\d{3,})["'][\s\S]{0,120}?data-l(?:ng|on|ongitude)=["'](-?\d+\.\d{3,})["']/g)) push(m[1], m[2], 'data-attr');
  for (const m of html.matchAll(/marker=(-?\d+\.\d{3,})(?:,|%2C)(-?\d+\.\d{3,})/g)) push(m[1], m[2], 'osm-embed');
  for (const m of html.matchAll(/geo:(-?\d+\.\d{3,}),(-?\d+\.\d{3,})/g)) push(m[1], m[2], 'geo-uri');
  return found;
}

for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('='); const key = arg.slice(0, i); const url = arg.slice(i + 1).replace(/\/+$/, '');
  const [vlat, vlon] = key.split(',').map(Number);
  const lines = [`== ${key} ${url}`];
  const seen = new Set();
  for (const path of PATHS) {
    const target = path ? `${url}/${path}` : `${url}/`;
    await wait(250);
    const r = await get(target);
    if (!r || r.status >= 400) continue;
    for (const p of pins(r.text)) {
      const sig = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const d = dist(vlat, vlon, p.lat, p.lon);
      lines.push(`   ${d < 1000 ? String(Math.round(d)).padStart(5) + 'm' : (d / 1000).toFixed(0).padStart(5) + 'km'}  ${sig}  ${p.how}  ${path || '/'}`);
    }
    if (seen.size >= 6) break;
  }
  const body = lines.join('\n');
  console.log(body + '\n');
  writeFileSync(join(OUT, key.replace(/[^0-9A-Za-z]/g, '_') + '.txt'), body + '\n');
}
