// Look for a week inside a page's own script bundle.
//   node tools/venue-hours-bundle.mjs "<lat>,<lon>=https://example.org" ...
//
// Some venues serve an empty shell and keep every word of the page inside a
// script bundle. That text is still the page — it is what the browser prints —
// so where the rendered HTML has no day beside a time, the bundle is worth
// reading. Same-origin scripts only, at most four per venue. Makes network
// requests, so it is never part of scripts/check.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DAY = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miércoles|jueves|viernes|sábado|domingo|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|måndag|tisdag|torsdag|lördag|maanantai|tiistai|keskiviikko|torstai|perjantai|lauantai|sunnuntai|poniedziałek|wtorek|środa|czwartek|piątek|sobota|niedziela|pondělí|úterý|středa|čtvrtek|pátek|neděle|hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap|luni|marți|miercuri|joi|vineri|sâmbătă|duminică|segunda|terça|quarta|quinta|sexta|hétköznap|hétvége|weekdays?|weekend|平日|土日|月曜|営業時間|orari|horario|horário|nyitvatartás|åpningstid|öppettider|aukioloajat|otevírací|godziny)/i;
const RANGE = /\b\d{1,2}[:.h]\d{2}\s*(?:-|–|—|to|bis|à|a|as|às|até|until|—)\s*\d{1,2}[:.h]?\d{0,2}\b|\b\d{1,2}\s*(?:am|pm)\s*(?:-|–|—|to)\s*\d{1,2}\s*(?:am|pm)\b|\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i;

const OUT = process.env.BH_DIR || 'venue-hours-bundle.out/';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const wait = ms => new Promise(r => setTimeout(r, ms));
async function get(url, ms = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal, redirect: 'follow' });
    const text = await res.text();
    return { status: res.status, text, final: res.url };
  } catch { return null; } finally { clearTimeout(t); }
}
const plain = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const key = arg.slice(0, i), url = arg.slice(i + 1);
  const lines = [`== ${key} ${url}`];
  const page = await get(url);
  if (!page || page.status >= 400) { lines.push(`   page ${page ? page.status : 'no-answer'}`); }
  else {
    const txt = plain(page.text);
    if (DAY.test(txt) && RANGE.test(txt)) lines.push('   rendered HTML already carries a day with a time — not a bundle case');
    else {
      const base = new URL(page.final);
      const srcs = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1])
        .map(s => { try { return new URL(s, base).href; } catch { return null; } })
        .filter(Boolean)
        .filter(u => new URL(u).host === base.host);
      if (!srcs.length) lines.push('   no same-origin script to read');
      for (const s of srcs.slice(0, 4)) {
        await wait(400);
        const js = await get(s, 45000);
        if (!js || js.status >= 400) { lines.push(`   ${s.slice(-40)} no-answer`); continue; }
        const hits = [];
        for (const m of js.text.matchAll(new RegExp(DAY.source, 'gi'))) {
          const win = js.text.slice(Math.max(0, m.index - 90), m.index + 220);
          if (!RANGE.test(win)) continue;
          const strings = [...win.matchAll(/"([^"\\]{2,60})"/g)].map(x => x[1]).filter(x => DAY.test(x) || RANGE.test(x));
          if (strings.length < 2) continue;
          const sig = strings.join('|');
          if (hits.some(h => h === sig)) continue;
          hits.push(sig);
        }
        if (hits.length) lines.push(`   ${s.slice(-44)} ${js.text.length}ch`, ...hits.slice(0, 8).map(h => `      ${h}`));
      }
    }
  }
  const body = lines.join('\n');
  console.log(body + '\n');
  writeFileSync(join(OUT, key.replace(/[^0-9A-Za-z]/g, '_') + '.txt'), body + '\n');
}
