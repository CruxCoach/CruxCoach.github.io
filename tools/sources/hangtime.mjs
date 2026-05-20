// Source adapter: @hangtime/climbing-boards (npm)
// Daily-updated GeoJSON dataset of Aurora-board + MoonBoard + 12climb locations,
// produced by Stevie-Ray/hangtime-climbing-boards via PowerSync (Aurora) + scrape
// (MoonBoard, 12climb). Unlicense (public-domain dedication).
//
// We classify by filename (one geojson per board) rather than marker-color, so
// any upstream color change doesn't silently mis-label markers.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = '@hangtime/climbing-boards';

const FILE_TO_BOARD = {
  'kilterboardapp.geojson':      'kilter',
  'tensionboardapp2.geojson':    'tension',
  'grasshopperboardapp.geojson': 'grasshopper',
  'decoyboardapp.geojson':       'decoy',
  'soillboardapp.geojson':       'soill',
  'touchstoneboardapp.geojson':  'touchstone',
  'auroraboardapp.geojson':      'aurora',
  'moonboard.geojson':           'moonboard',
  '12climb.geojson':             '12climb',
};

// Kilter wall.product_name → friendly layout label.
const KILTER_LAYOUT = {
  'Kilter Board Original': 'Original',
  'Kilter Board Homewall': 'Homewall',
};

// Kilter product_layout_uuid → official Kilter-app size label. Source of
// truth: androidApp/.../data/BoardConstants.kt::KILTER_SIZE_LABELS — kept
// verbatim so the website shows the same wording users see in the in-app
// board picker. Aurora's product_sizes catalog is frozen, so this map is
// stable; unmapped ids fall through to the raw upstream name.
const KILTER_SIZE_LABEL = {
  // Original (product_id=1)
  14: '10x7, no Kickboard',
  8: '12x8, with Kickboard',
  10: '12x12, with Kickboard',
  27: '12x12, no Kickboard',
  7: '14x12 Super Tall, with Kickboard',
  28: '12x16 Super Wide, with Kickboard',
  // Homewall (product_id=7) — naming reflects the LED kit
  17: 'Homewall 10x7 — Full Ride',
  18: 'Homewall 10x7 — Mainline',
  19: 'Homewall 10x7 — Auxiliary',
  21: 'Homewall 10x10 — Full Ride',
  22: 'Homewall 10x10 — Mainline',
  29: 'Homewall 10x10 — Auxiliary',
  23: 'Homewall 12x8 — Full Ride',
  24: 'Homewall 12x8 — Mainline',
  25: 'Homewall 10x12 — Full Ride',
  26: 'Homewall 10x12 — Mainline',
};

function pickCoord(props, geom) {
  const lat = props.latitude ?? props.Latitude ?? geom?.coordinates?.[1];
  const lon = props.longitude ?? props.Longitude ?? geom?.coordinates?.[0];
  return [typeof lat === 'number' ? lat : null, typeof lon === 'number' ? lon : null];
}

function pickName(props) {
  return (props.name ?? props.Name ?? props.title ?? '').toString().trim();
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function kilterWall(w) {
  const sizeId = toInt(w.product_layout_uuid);
  const isAdjustable = w.is_adjustable === 1 || w.is_adjustable === true;
  return {
    wall_name: emptyToNull(w.name),
    layout: KILTER_LAYOUT[w.product_name] ?? emptyToNull(w.product_name),
    size_id: sizeId,
    size_label: sizeId != null ? KILTER_SIZE_LABEL[sizeId] ?? null : null,
    adjustable: isAdjustable ? true : (w.is_adjustable === 0 || w.is_adjustable === false ? false : null),
    angle: toInt(w.angle),
    min_angle: toInt(w.min_angle),
    max_angle: toInt(w.max_angle),
    angle_increments: toInt(w.angle_increments),
    hold_set: toInt(w.accumulated_hold_set_value),
  };
}

function kilterAddress(props) {
  const parts = [props.address, props.postal_code, props.city]
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Parse the canonical MoonBoard variant out of the user-submitted Description.
// Order is significant: "school room" must beat "School Holds" (a hold-set
// name for the 2016 board), "mini" must beat the bare year 2020 (since the
// Mini variant launched in 2020), and otherwise more-specific year tokens
// trump less-specific ones. About 37% of MoonBoard entries carry one of
// these tokens; the rest stay null and surface as "Unknown" in the filter.
function parseMoonboardVariant(desc) {
  if (!desc) return null;
  const s = String(desc).toLowerCase();
  if (/\bschool[\s-]*room\b/.test(s)) return 'school-room';
  if (/\bmini\b/.test(s)) return 'mini-2020';
  if (/\b2024\b/.test(s)) return 'mb2024';
  if (/\b2019\b/.test(s)) return 'mb2019-masters';
  if (/\b2017\b/.test(s)) return 'mb2017-masters';
  if (/\b2016\b/.test(s)) return 'mb2016';
  return null;
}

// Wall angle in degrees if mentioned in the description. Accepts both "40°"
// and "40 degree(s)" / "40 deg".
function parseMoonboardAngle(desc) {
  if (!desc) return null;
  const m = String(desc).match(/\b(15|20|25|30|35|40|45|50)\s*(?:°|deg(?:ree)?s?)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

// Extract per-board richness. Returns a plain object that becomes one entry
// in the venue's boards[] array. All fields are optional; downstream code
// must tolerate missing values.
function extractBoardFields(board, props) {
  if (board === 'kilter') {
    const walls = Array.isArray(props.walls)
      ? props.walls.filter(w => w && w.is_listed !== 0).map(kilterWall)
      : [];
    return {
      address: kilterAddress(props),
      city: emptyToNull(props.city),
      country: emptyToNull(props.country),
      instagram: emptyToNull(props.instagram_username),
      walls,
    };
  }
  if (board === 'moonboard') {
    return {
      commercial: props.IsCommercial === true ? true : (props.IsCommercial === false ? false : null),
      led: props.IsLed === true ? true : (props.IsLed === false ? false : null),
      variant: parseMoonboardVariant(props.Description),
      angle: parseMoonboardAngle(props.Description),
      // Raw Description otherwise dropped: spam-prone user-submitted text.
    };
  }
  // Aurora-style boards (tension, grasshopper, decoy, soill, touchstone, aurora)
  // and 12climb: only `username` carries useful extra signal beyond name+coords.
  if (typeof props.username === 'string' && props.username.trim()) {
    return { username: props.username.trim() };
  }
  return {};
}

function extractEntry(file, board, feat) {
  const props = feat.properties ?? {};
  const [lat, lon] = pickCoord(props, feat.geometry);
  const name = pickName(props);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!name) return null;
  return {
    source: 'hangtime',
    board,
    name,
    lat,
    lon,
    ...extractBoardFields(board, props),
  };
}

function extractTarball() {
  const dir = mkdtempSync(join(tmpdir(), 'hangtime-'));
  execFileSync('npm', ['pack', `${PACKAGE}@latest`], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  const tgz = readdirSync(dir).find(f => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack produced no tarball in ${dir}`);
  execFileSync('tar', ['-xzf', tgz], { cwd: dir });
  const versionMatch = tgz.match(/-([\d.]+)\.tgz$/);
  return { root: join(dir, 'package'), version: versionMatch?.[1] ?? 'unknown' };
}

export async function load() {
  const { root, version } = extractTarball();
  const out = [];
  const counts = {};
  for (const [file, board] of Object.entries(FILE_TO_BOARD)) {
    const path = join(root, 'geojson', file);
    let raw;
    try { raw = readFileSync(path, 'utf-8'); }
    catch { console.warn(`[hangtime] missing ${file}`); continue; }
    const fc = JSON.parse(raw);
    let kept = 0, dropped = 0;
    for (const feat of fc.features) {
      const e = extractEntry(file, board, feat);
      if (e) { out.push(e); kept++; } else { dropped++; }
    }
    counts[board] = { kept, dropped };
  }
  return { entries: out, meta: { package: PACKAGE, version, counts } };
}
