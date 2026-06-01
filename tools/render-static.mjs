// Static-HTML generation for the boards map, so the venue data is visible to
// crawlers that don't execute JavaScript (ChatGPT, Claude, Perplexity et al.
// read HTML snapshots only). build-boards-data.mjs calls these after writing
// boards.geojson:
//
//   - renderListPage()  → boards/list.html, a full static directory of every
//                         venue grouped by country.
//   - renderStatsBlock() → the inner HTML injected between the
//                          <!-- GENERATED:board-stats --> markers in
//                          boards/index.html.
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

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code) {
  if (!code) return 'Unknown location';
  try {
    return COUNTRY_NAMES.of(code) || code;
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

function fmt(n) {
  return n.toLocaleString('en');
}

// Stable, locale-aware comparator so output is deterministic regardless of the
// order features arrive in.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

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

function boardCountsTable(meta) {
  const rows = boardCounts(meta)
    .map(({ label, count }) => `      <tr><td>${esc(label)}</td><td>${fmt(count)}</td></tr>`)
    .join('\n');
  return `<table class="board-counts">
    <thead><tr><th scope="col">Board system</th><th scope="col">Venues</th></tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><td>Distinct venues</td><td>${fmt(meta.venue_features)}</td></tr></tfoot>
  </table>`;
}

// Inner HTML for the <!-- GENERATED:board-stats --> region in boards/index.html.
export function renderStatsBlock(features, meta) {
  const nCountries = countryCodes(features).size;
  return `<p>
      The map currently plots <strong>${fmt(meta.venue_features)} venues</strong>
      across <strong>nine board systems</strong> in <strong>${fmt(nCountries)} countries</strong>.
      Counts per system (a gym with two boards is counted once per system):
    </p>
    ${boardCountsTable(meta)}
    <p>
      Prefer a plain list? <a href="/boards/list.html">Browse the full directory of
      all ${fmt(meta.venue_features)} venues, grouped by country →</a>
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
function groupByCountry(features) {
  const groups = new Map();
  for (const f of features) {
    const code = f.properties.country || '';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(f);
  }
  const out = [];
  for (const [code, venues] of groups) {
    venues.sort((a, b) => collator.compare(a.properties.name, b.properties.name));
    out.push({ code, name: countryName(code), venues });
  }
  out.sort((a, b) => b.venues.length - a.venues.length || collator.compare(a.name, b.name));
  return out;
}

function anchorFor(code) {
  return 'c-' + (code || 'unknown').toLowerCase();
}

export function renderListPage(features, meta) {
  const groups = groupByCountry(features);
  const nCountries = countryCodes(features).size;
  const total = fmt(meta.venue_features);

  const toc = groups
    .map(g => `<li><a href="#${anchorFor(g.code)}">${esc(g.name)}</a> <span class="muted">(${fmt(g.venues.length)})</span></li>`)
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
      <h2 id="${anchorFor(g.code)}">${esc(g.name)} <span class="muted">(${fmt(g.venues.length)})</span></h2>
      <ul class="venues">
${items}
      </ul>
    </section>`;
  }).join('\n\n');

  // Per-board sentence for the intro — concrete statistics are the strongest
  // evidence-backed lever for getting cited by generative engines.
  const perBoardSentence = boardCounts(meta)
    .map(({ label, count }) => `${label} (${fmt(count)})`)
    .join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All Climbing Board Locations Worldwide — Full Directory | CruxCoach</title>
<meta name="description" content="A complete, text-based directory of every Kilter Board, Tension Board and MoonBoard location on the CruxCoach map — ${total} venues across ${fmt(nCountries)} countries, listed by country.">
<meta name="theme-color" content="#141312">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="https://cruxcoach.org/boards/list.html">
<meta property="og:title" content="All Climbing Board Locations Worldwide — Full Directory">
<meta property="og:description" content="${total} Kilter Board, Tension Board and MoonBoard venues across ${fmt(nCountries)} countries, listed by country.">
<meta property="og:url" content="https://cruxcoach.org/boards/list.html">
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
      "@id": "https://cruxcoach.org/boards/list.html#page",
      "name": "All Climbing Board Locations Worldwide — Full Directory",
      "url": "https://cruxcoach.org/boards/list.html",
      "description": "Complete text directory of ${total} Kilter Board, Tension Board, MoonBoard and other training-board venues across ${fmt(nCountries)} countries.",
      "isPartOf": { "@type": "WebSite", "name": "CruxCoach", "url": "https://cruxcoach.org/" },
      "about": { "@id": "https://cruxcoach.org/boards/#dataset" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://cruxcoach.org/" },
        { "@type": "ListItem", "position": 2, "name": "Board Map", "item": "https://cruxcoach.org/boards/" },
        { "@type": "ListItem", "position": 3, "name": "Full Directory", "item": "https://cruxcoach.org/boards/list.html" }
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
    <a href="/" class="brand">CruxCoach</a>
    <nav>
      <a href="/boards/">Interactive map</a>
      <a href="/">Home</a>
    </nav>
  </div>
</header>

<main>
  <div class="container">
    <h1>All climbing board locations worldwide</h1>
    <p class="lede">
      A complete, text-based directory of every venue on the
      <a href="/boards/">CruxCoach climbing board map</a>: <strong>${total} venues</strong>
      across <strong>${fmt(nCountries)} countries</strong> and nine board systems
      (${esc(perBoardSentence)}). Use the <a href="/boards/">interactive map</a> to
      search by location and filter; this page lists everything as plain text.
    </p>

    ${boardCountsTable(meta)}

    <h2 style="border-top:0;margin-top:1.5rem;padding-top:0">Jump to a country</h2>
    <ul class="toc">
        ${toc}
    </ul>

${sections}

    <p class="backlink"><a href="/boards/">← Back to the interactive map</a></p>
  </div>
</main>

<footer>
  <div class="container">
    <span>© 2026 CruxCoach Contributors. Site CC-BY-4.0. Data CC-BY-4.0. Hosted by Codeberg e.V.</span>
    <span><a href="/support.html">Support</a> · <a href="/imprint.html">Imprint</a> · <a href="/privacy.html">Privacy</a></span>
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
