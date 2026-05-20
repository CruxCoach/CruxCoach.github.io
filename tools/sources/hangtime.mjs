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

function pickCoord(props, geom) {
  const lat = props.latitude ?? props.Latitude ?? geom?.coordinates?.[1];
  const lon = props.longitude ?? props.Longitude ?? geom?.coordinates?.[0];
  return [typeof lat === 'number' ? lat : null, typeof lon === 'number' ? lon : null];
}

function pickName(props) {
  return (props.name ?? props.Name ?? props.title ?? '').toString().trim();
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
      const props = feat.properties ?? {};
      const [lat, lon] = pickCoord(props, feat.geometry);
      const name = pickName(props);
      if (lat === null || lon === null) { dropped++; continue; }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { dropped++; continue; }
      if (!name) { dropped++; continue; }
      out.push({
        source: 'hangtime',
        board,
        name,
        lat,
        lon,
        username: typeof props.username === 'string' ? props.username : undefined,
      });
      kept++;
    }
    counts[board] = { kept, dropped };
  }
  return { entries: out, meta: { package: PACKAGE, version, counts } };
}
