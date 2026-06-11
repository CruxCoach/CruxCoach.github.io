// Static-HTML generation for the boards map, so the venue data is visible to
// crawlers that don't execute JavaScript (ChatGPT, Claude, Perplexity et al.
// read HTML snapshots only). build-boards-data.mjs calls these after writing
// boards.geojson:
//
//   - renderListPage()  → boards/list.html (en) and de/boards/list.html (de),
//                         a full static directory of every venue grouped by
//                         country.
//   - renderStatsBlock() → the inner HTML injected between the
//                          <!-- GENERATED:board-stats --> markers in
//                          boards/index.html and de/boards/index.html.
//
// Both take a `lang` ('en' | 'de') and read every user-facing string from the
// STRINGS table below, so the nightly rebuild keeps both language versions
// fresh from the same data.
//
// Output is a pure function of the venue data only — NO build timestamp — so
// re-running on an unchanged dataset produces byte-identical HTML and the
// nightly cron never makes a no-op commit. Volatile metadata (build time)
// stays in boards.meta.json, which the page already links to.

// board id → human label, in the project's preferred spelling.
export const BOARD_LABELS = {
  kilter: 'Kilter Board',
  tension: 'Tension Board',
  moonboard: 'MoonBoard',
  grasshopper: 'Grasshopper',
  decoy: 'Decoy',
  soill: 'So iLL',
  touchstone: 'Touchstone',
  aurora: 'Aurora',
  '12climb': '12climb',
};

// All user-facing text per language. Board names, layout names and brand
// words (Wellpass, OpenStreetMap) stay untranslated by design.
const STRINGS = {
  en: {
    unknownLocation: 'Unknown location',
    thBoardSystem: 'Board system',
    thVenues: 'Venues',
    tfootDistinct: 'Distinct venues',
    statsIntro: (total, countries) => `The map currently plots <strong>${total} venues</strong>
      across <strong>nine board systems</strong> in <strong>${countries} countries</strong>.
      Counts per system (a gym with two boards is counted once per system):`,
    listTeaser: (listHref, total) => `Prefer a plain list? <a href="${listHref}">Browse the full directory of
      all ${total} venues, grouped by country →</a>`,
    listTitle: 'All Climbing Board Locations Worldwide — Full Directory | CruxCoach',
    listMetaDesc: (total, countries) => `A complete, text-based directory of every Kilter Board, Tension Board and MoonBoard location on the CruxCoach map — ${total} venues across ${countries} countries, listed by country.`,
    listOgTitle: 'All Climbing Board Locations Worldwide — Full Directory',
    listOgDesc: (total, countries) => `${total} Kilter Board, Tension Board and MoonBoard venues across ${countries} countries, listed by country.`,
    listPageDesc: (total, countries) => `Complete text directory of ${total} Kilter Board, Tension Board, MoonBoard and other training-board venues across ${countries} countries.`,
    bcHome: 'Home',
    bcMap: 'Board Map',
    bcList: 'Full Directory',
    navMap: 'Interactive map',
    navHome: 'Home',
    h1: 'All climbing board locations worldwide',
    lede: (mapHref, total, countries, perBoardSentence) => `A complete, text-based directory of every venue on the
      <a href="${mapHref}">CruxCoach climbing board map</a>: <strong>${total} venues</strong>
      across <strong>${countries} countries</strong> and nine board systems
      (${perBoardSentence}). Use the <a href="${mapHref}">interactive map</a> to
      search by location and filter; this page lists everything as plain text.`,
    jumpToCountry: 'Jump to a country',
    backToMap: '← Back to the interactive map',
    footerCopyright: '© 2026 CruxCoach Contributors. Site CC-BY-4.0. Data CC-BY-4.0. Hosted by Codeberg e.V.',
    footerLinks: '<a href="/support.html">Support</a> · <a href="/imprint.html">Imprint</a> · <a href="/privacy.html">Privacy</a>',
  },
  de: {
    unknownLocation: 'Unbekannter Ort',
    thBoardSystem: 'Board-System',
    thVenues: 'Standorte',
    tfootDistinct: 'Standorte gesamt',
    statsIntro: (total, countries) => `Die Karte verzeichnet derzeit <strong>${total} Standorte</strong>
      über <strong>neun Board-Systeme</strong> in <strong>${countries} Ländern</strong>.
      Zähler pro System (eine Halle mit zwei Boards zählt einmal pro System):`,
    listTeaser: (listHref, total) => `Lieber eine einfache Liste? <a href="${listHref}">Zum vollständigen Verzeichnis
      aller ${total} Standorte, nach Land gruppiert →</a>`,
    listTitle: 'Alle Kletterboard-Standorte weltweit — Gesamtverzeichnis | CruxCoach',
    listMetaDesc: (total, countries) => `Ein vollständiges, textbasiertes Verzeichnis aller Kilter-Board-, Tension-Board- und MoonBoard-Standorte auf der CruxCoach-Karte — ${total} Standorte in ${countries} Ländern, nach Land gelistet.`,
    listOgTitle: 'Alle Kletterboard-Standorte weltweit — Gesamtverzeichnis',
    listOgDesc: (total, countries) => `${total} Kilter-Board-, Tension-Board- und MoonBoard-Standorte in ${countries} Ländern, nach Land gelistet.`,
    listPageDesc: (total, countries) => `Vollständiges Textverzeichnis von ${total} Kilter-Board-, Tension-Board-, MoonBoard- und weiteren Trainingsboard-Standorten in ${countries} Ländern.`,
    bcHome: 'Start',
    bcMap: 'Board-Karte',
    bcList: 'Gesamtverzeichnis',
    navMap: 'Interaktive Karte',
    navHome: 'Start',
    h1: 'Alle Kletterboard-Standorte weltweit',
    lede: (mapHref, total, countries, perBoardSentence) => `Ein vollständiges, textbasiertes Verzeichnis aller Standorte auf der
      <a href="${mapHref}">CruxCoach-Kletterboard-Karte</a>: <strong>${total} Standorte</strong>
      in <strong>${countries} Ländern</strong> und neun Board-Systemen
      (${perBoardSentence}). Nutze die <a href="${mapHref}">interaktive Karte</a>, um
      nach Ort zu suchen und zu filtern; diese Seite listet alles als reinen Text.`,
    jumpToCountry: 'Zum Land springen',
    backToMap: '← Zurück zur interaktiven Karte',
    footerCopyright: '© 2026 CruxCoach Contributors. Site CC-BY-4.0. Daten CC-BY-4.0. Gehostet bei Codeberg e.V.',
    footerLinks: '<a href="/de/support.html">Unterstützen</a> · <a href="/de/imprint.html">Impressum</a> · <a href="/de/privacy.html">Datenschutz</a>',
  },
};

// Per-language page URLs. The geojson download stays language-neutral.
const PAGES = {
  en: {
    htmlLang: 'en',
    homeHref: '/',
    mapHref: '/boards/',
    listHref: '/boards/list.html',
    homeUrl: 'https://cruxcoach.org/',
    mapUrl: 'https://cruxcoach.org/boards/',
    listUrl: 'https://cruxcoach.org/boards/list.html',
    datasetId: 'https://cruxcoach.org/boards/#dataset',
  },
  de: {
    htmlLang: 'de',
    homeHref: '/de/',
    mapHref: '/de/boards/',
    listHref: '/de/boards/list.html',
    homeUrl: 'https://cruxcoach.org/de/',
    mapUrl: 'https://cruxcoach.org/de/boards/',
    listUrl: 'https://cruxcoach.org/de/boards/list.html',
    datasetId: 'https://cruxcoach.org/de/boards/#dataset',
  },
};

// Both list pages carry the full hreflang cluster (x-default → en).
const LIST_HREFLANG = `<link rel="alternate" hreflang="en" href="${PAGES.en.listUrl}">
<link rel="alternate" hreflang="de" href="${PAGES.de.listUrl}">
<link rel="alternate" hreflang="x-default" href="${PAGES.en.listUrl}">`;

const DISPLAY_NAMES = {
  en: new Intl.DisplayNames(['en'], { type: 'region' }),
  de: new Intl.DisplayNames(['de'], { type: 'region' }),
};

function countryName(code, lang) {
  if (!code) return STRINGS[lang].unknownLocation;
  try {
    return DISPLAY_NAMES[lang].of(code) || code;
  } catch {
    return code; // non-ISO / unresolved codes (e.g. user-region edge cases)
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n, lang) {
  return n.toLocaleString(lang);
}

// Stable, locale-aware comparators so output is deterministic regardless of
// the order features arrive in.
const COLLATORS = {
  en: new Intl.Collator('en', { sensitivity: 'base', numeric: true }),
  de: new Intl.Collator('de', { sensitivity: 'base', numeric: true }),
};

// Per-board venue counts (>0 only), highest first. Sums exceed the venue total
// because a multi-board gym is counted once per board it hosts.
function boardCounts(meta) {
  return Object.entries(meta.per_board)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => ({ board, label: BOARD_LABELS[board] ?? board, count: n }));
}

// distinct ISO country codes present in the dataset.
function countryCodes(features) {
  const set = new Set();
  for (const f of features) {
    if (f.properties.country) set.add(f.properties.country);
  }
  return set;
}

function boardCountsTable(meta, lang) {
  const S = STRINGS[lang];
  const rows = boardCounts(meta)
    .map(({ label, count }) => `      <tr><td>${esc(label)}</td><td>${fmt(count, lang)}</td></tr>`)
    .join('\n');
  return `<table class="board-counts">
    <thead><tr><th scope="col">${S.thBoardSystem}</th><th scope="col">${S.thVenues}</th></tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><td>${S.tfootDistinct}</td><td>${fmt(meta.venue_features, lang)}</td></tr></tfoot>
  </table>`;
}

// Inner HTML for the <!-- GENERATED:board-stats --> region in the map page
// of the given language.
export function renderStatsBlock(features, meta, lang = 'en') {
  const S = STRINGS[lang];
  const P = PAGES[lang];
  const nCountries = countryCodes(features).size;
  return `<p>
      ${S.statsIntro(fmt(meta.venue_features, lang), fmt(nCountries, lang))}
    </p>
    ${boardCountsTable(meta, lang)}
    <p>
      ${S.listTeaser(P.listHref, fmt(meta.venue_features, lang))}
    </p>`;
}

// board id badges for a single venue, e.g. "Kilter Board · MoonBoard".
function venueBoards(props) {
  const seen = [];
  for (const b of props.boards || []) {
    const label = BOARD_LABELS[b.board] ?? b.board;
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
}

// Group features by country, returning [{ code, name, venues[] }] sorted by
// venue count (desc) then country name; venues within a country sorted by name.
function groupByCountry(features, lang) {
  const collator = COLLATORS[lang];
  const groups = new Map();
  for (const f of features) {
    const code = f.properties.country || '';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(f);
  }
  const out = [];
  for (const [code, venues] of groups) {
    venues.sort((a, b) => collator.compare(a.properties.name, b.properties.name));
    out.push({ code, name: countryName(code, lang), venues });
  }
  out.sort((a, b) => b.venues.length - a.venues.length || collator.compare(a.name, b.name));
  return out;
}

function anchorFor(code) {
  return 'c-' + (code || 'unknown').toLowerCase();
}

export function renderListPage(features, meta, lang = 'en') {
  const S = STRINGS[lang];
  const P = PAGES[lang];
  const groups = groupByCountry(features, lang);
  const nCountries = fmt(countryCodes(features).size, lang);
  const total = fmt(meta.venue_features, lang);

  const toc = groups
    .map(g => `<li><a href="#${anchorFor(g.code)}">${esc(g.name)}</a> <span class="muted">(${fmt(g.venues.length, lang)})</span></li>`)
    .join('\n        ');

  const sections = groups.map(g => {
    const items = g.venues.map(f => {
      const p = f.properties;
      const city = p.city ? ` <span class="muted">— ${esc(p.city)}</span>` : '';
      const boards = venueBoards(p)
        .map(b => `<span class="bt">${esc(b)}</span>`)
        .join(' ');
      return `        <li><strong>${esc(p.name)}</strong>${city} ${boards}</li>`;
    }).join('\n');
    return `    <section aria-labelledby="${anchorFor(g.code)}">
      <h2 id="${anchorFor(g.code)}">${esc(g.name)} <span class="muted">(${fmt(g.venues.length, lang)})</span></h2>
      <ul class="venues">
${items}
      </ul>
    </section>`;
  }).join('\n\n');

  // Per-board sentence for the intro — concrete statistics are the strongest
  // evidence-backed lever for getting cited by generative engines.
  const perBoardSentence = boardCounts(meta)
    .map(({ label, count }) => `${label} (${fmt(count, lang)})`)
    .join(', ');

  const inLanguage = lang === 'en' ? '' : `
      "inLanguage": "${lang}",`;

  return `<!doctype html>
<html lang="${P.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${S.listTitle}</title>
<meta name="description" content="${S.listMetaDesc(total, nCountries)}">
<meta name="theme-color" content="#141312">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${P.listUrl}">
${LIST_HREFLANG}
<meta property="og:title" content="${S.listOgTitle}">
<meta property="og:description" content="${S.listOgDesc(total, nCountries)}">
<meta property="og:url" content="${P.listUrl}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://cruxcoach.org/assets/icon-512.png">
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
<link rel="alternate icon" type="image/png" href="/assets/icon-512.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": "${P.listUrl}#page",
      "name": "${S.listOgTitle}",
      "url": "${P.listUrl}",${inLanguage}
      "description": "${S.listPageDesc(total, nCountries)}",
      "isPartOf": { "@type": "WebSite", "name": "CruxCoach", "url": "https://cruxcoach.org/" },
      "about": { "@id": "${P.datasetId}" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "${S.bcHome}", "item": "${P.homeUrl}" },
        { "@type": "ListItem", "position": 2, "name": "${S.bcMap}", "item": "${P.mapUrl}" },
        { "@type": "ListItem", "position": 3, "name": "${S.bcList}", "item": "${P.listUrl}" }
      ]
    }
  ]
}
</script>
<style>
  :root {
    --bg: #141312; --bg-soft: #1f1d1a; --fg: #f0ede6; --fg-soft: #c0bcb2;
    --fg-mute: #807a70; --rule: #2c2925; --accent: #e07a4f; --max: 64rem;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Helvetica Neue", sans-serif;
    font-size: 17px; line-height: 1.55; color: var(--fg); background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color .15s; }
  a:hover, a:focus { border-bottom-color: var(--accent); }
  h1, h2, h3 { font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 0.6em; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); letter-spacing: -0.02em; }
  h2 { font-size: 1.3rem; margin-top: 2.5rem; padding-top: 0.6rem; border-top: 1px solid var(--rule); }
  p { margin: 0 0 1em; }
  .container { max-width: var(--max); margin: 0 auto; padding: 0 1.5rem; }
  header { border-bottom: 1px solid var(--rule); padding: 1rem 0; }
  header .container { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .brand { font-weight: 700; font-size: 1.1rem; color: var(--fg); border-bottom: 0; }
  nav { margin-left: auto; display: flex; gap: 1.25rem; font-size: 0.95rem; }
  nav a { color: var(--fg-soft); border-bottom: 0; }
  nav a:hover { color: var(--accent); }
  main { padding: 2.5rem 0 1rem; }
  .lede { font-size: 1.15rem; color: var(--fg-soft); max-width: 44rem; }
  .muted { color: var(--fg-mute); font-weight: 400; }
  table.board-counts { border-collapse: collapse; margin: 1.5rem 0; font-size: 0.95rem; }
  table.board-counts th, table.board-counts td { text-align: left; padding: 0.35rem 1.5rem 0.35rem 0; border-bottom: 1px solid var(--rule); }
  table.board-counts td:last-child, table.board-counts th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  table.board-counts tfoot td { font-weight: 600; color: var(--fg); border-bottom: 0; border-top: 2px solid var(--rule); }
  .toc { columns: 2 16rem; gap: 2rem; list-style: none; padding: 0; margin: 2rem 0; font-size: 0.95rem; }
  .toc li { margin-bottom: 0.3rem; break-inside: avoid; }
  ul.venues { list-style: none; padding: 0; margin: 0 0 1rem; }
  ul.venues li { padding: 0.35rem 0; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
  ul.venues strong { color: var(--fg); font-weight: 600; }
  .bt { display: inline-block; font-size: 0.72rem; color: var(--fg-mute); border: 1px solid var(--rule); border-radius: 4px; padding: 0.05em 0.4em; margin-left: 0.25rem; white-space: nowrap; }
  .backlink { display: inline-block; margin: 1.5rem 0; }
  footer { border-top: 1px solid var(--rule); padding: 2rem 0 3rem; margin-top: 2rem; color: var(--fg-mute); font-size: 0.85rem; }
  footer .container { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; justify-content: space-between; }
</style>
</head>
<body>

<header>
  <div class="container">
    <a href="${P.homeHref}" class="brand">CruxCoach</a>
    <nav>
      <a href="${P.mapHref}">${S.navMap}</a>
      <a href="${P.homeHref}">${S.navHome}</a>
    </nav>
  </div>
</header>

<main>
  <div class="container">
    <h1>${S.h1}</h1>
    <p class="lede">
      ${S.lede(P.mapHref, total, nCountries, esc(perBoardSentence))}
    </p>

    ${boardCountsTable(meta, lang)}

    <h2 style="border-top:0;margin-top:1.5rem;padding-top:0">${S.jumpToCountry}</h2>
    <ul class="toc">
        ${toc}
    </ul>

${sections}

    <p class="backlink"><a href="${P.mapHref}">${S.backToMap}</a></p>
  </div>
</main>

<footer>
  <div class="container">
    <span>${S.footerCopyright}</span>
    <span>${S.footerLinks}</span>
  </div>
</footer>

</body>
</html>
`;
}

// Replace the inner HTML between a pair of named generated-content markers.
// Returns { html, replaced }. Leaves the file untouched (replaced:false) if the
// markers aren't present, so a hand-edit that drops them fails loud, not silent.
export function injectBetweenMarkers(html, name, inner) {
  const start = `<!-- GENERATED:${name} START`;
  const end = `<!-- GENERATED:${name} END -->`;
  const startIdx = html.indexOf(start);
  const endIdx = html.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { html, replaced: false };
  }
  // Keep the full start-marker line (it carries a "do not edit" note); replace
  // only what's between the end of that comment and the end marker.
  const startClose = html.indexOf('-->', startIdx);
  const before = html.slice(0, startClose + 3);
  const after = html.slice(endIdx);
  return { html: `${before}\n    ${inner}\n    ${after}`, replaced: true };
}
