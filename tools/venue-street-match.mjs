// Does a candidate print the street or postcode the coordinate itself sits on?
//   node tools/venue-street-match.mjs "<lat>,<lon>=https://example.org" ...
//
// Most open venues have no upstream address, so a candidate that prints one has
// nothing to be matched against. The coordinate is the missing half: reverse
// geocoding it gives the road and the postcode of the point, which is a fact
// about the point rather than a claim about a website — see "The coordinate
// knows its own street" in VENUE-LINKS.md. A match is a finding to read, not a
// verdict: a postcode covering a whole town says only what the town already
// said. Makes network requests, so it is never part of scripts/check, and it
// asks Nominatim once per venue at its one-request-a-second rate.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const NOMINATIM_UA = 'cruxcoach-venue-audit/1.0 (+https://cruxcoach.org)';
const PATHS = ['', 'contact', 'contact-us', 'kontakt', 'contacto', 'contatti', 'location', 'about'];

// Keep every script's letters: stripping to [a-z0-9] turns a Chinese or Arabic
// road name into the empty string, and every page contains that.
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, ua, ms = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua }, signal: ac.signal, redirect: 'follow' });
    return { status: res.status, text: await res.text() };
  } catch { return null; } finally { clearTimeout(timer); }
}

for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  const key = arg.slice(0, eq);
  const url = arg.slice(eq + 1).replace(/\/+$/, '');
  const [lat, lon] = key.split(',');
  const rev = await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, NOMINATIM_UA);
  if (!rev || rev.status !== 200) { console.log(`${key}  could not be geocoded`); continue; }
  const a = JSON.parse(rev.text).address || {};
  const road = a.road || '';
  const postcode = a.postcode || '';
  console.log(`== ${key} ${url}\n   the point is on ${road || '(no road)'} ${postcode || '(no postcode)'}`);
  const needle = fold(road);
  const pc = fold(postcode);
  // Three characters of road name is a coincidence waiting to happen.
  if (needle.length < 4 && pc.length < 4) { console.log('   nothing long enough to look for'); continue; }
  let found = false;
  for (const path of PATHS) {
    await wait(250);
    const r = await get(path ? `${url}/${path}` : `${url}/`, UA);
    if (!r || r.status >= 400) continue;
    const text = fold(r.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' '));
    if (needle.length >= 4 && text.includes(needle)) { console.log(`   road "${road}" on /${path}`); found = true; }
    if (pc.length >= 4 && text.includes(pc)) { console.log(`   postcode "${postcode}" on /${path}`); found = true; }
    if (found) break;
  }
  if (!found) console.log('   neither appears on the pages read');
  await wait(1100);
}
