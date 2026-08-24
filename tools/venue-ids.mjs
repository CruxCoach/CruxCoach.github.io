// Stable identifiers for venues and board installations.
//
// The map is rebuilt from upstream every night and re-derived from scratch each
// time. Nothing in `boards.geojson` was ever a name a person could point at: a
// venue was identified by its coordinates, so a corrected coordinate produced a
// *different* venue as far as anything downstream could tell. That is fine for
// a map nobody talks back to. It is not fine the moment a visitor reports "the
// board at this gym is gone" and an operator opens that report three days and
// two rebuilds later.
//
// So every venue carries `venue_id` and every board carries `instance_id`, and
// both survive a rebuild. Two mechanisms, in this order:
//
//   1. **Derivation.** The id is a hash of the venue key — the same
//      4-decimal (lat, lon) rounding the build already groups by. Deterministic,
//      needs no state, and identical on every machine and every run. A venue
//      whose coordinates do not move keeps its id forever with no bookkeeping.
//
//   2. **The ledger.** `tools/venue-ids.json` pins an id to a venue that *has*
//      moved. When upstream corrects a coordinate — or a curator does — the
//      derived id would change; a ledger record says "this venue, wherever it
//      now sits, is still v1_…". Matching reuses the proven resolution from
//      venue-links.mjs: exact key, else a single unambiguous venue within
//      250 m answering to the same name in the same country. Ambiguity refuses
//      rather than guesses, exactly as a wrong website link would.
//
// A board instance is identified within its venue by what is stable about it —
// which board system, and which wall — never by the details a report is likely
// to be *about*. A Kilter wall whose angle is corrected from 40° to 45° is the
// same wall; if the id moved, the correction would orphan the report asking for
// it.
//
// No DOM, no network, no filesystem beyond the explicit read in
// `loadVenueIdLedger()`, so `node --test` exercises all of it.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  distanceMeters,
  nameSimilarity,
  venueKey,
  MATCH_RADIUS_M,
  NAME_MATCH_MIN,
} from './venue-links.mjs';

// 48 bits of hash. With a few thousand venues the chance of any collision is
// around one in a hundred million, and `assignVenueIds` checks for one anyway
// rather than trusting the arithmetic.
const ID_HEX_LENGTH = 12;

export const VENUE_ID_RE = /^v1_[0-9a-f]{12}$/;
export const BOARD_INSTANCE_ID_RE = /^b1_[0-9a-f]{12}$/;

function shortHash(...parts) {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, ID_HEX_LENGTH);
}

/**
 * The derived id for a venue at these coordinates.
 *
 * The domain separator is versioned, so a future change to the derivation is a
 * `v2_` prefix and a ledger migration rather than a silent renumbering.
 */
export function deriveVenueId(lat, lon) {
  return `v1_${shortHash('cruxcoach/venue-id/v1', venueKey(lat, lon))}`;
}

// Fields that identify a board installation rather than describe it. `board` is
// which system it is; `wall_name`, `layout` and `size_id` are which wall. Angle,
// hold set, LED and commercial flags are all things a report may be asking us
// to change, so none of them may decide identity.
function boardDiscriminator(board) {
  if (board.board === 'kilter' && Array.isArray(board.walls) && board.walls.length > 0) {
    // Kilter entries carry one or more named walls; each is its own
    // installation as far as a reporter standing in front of one is concerned.
    return board.walls.map(wallDiscriminator);
  }
  if (board.username) return [`user:${String(board.username).trim().toLowerCase()}`];
  if (board.board === 'moonboard' && board.variant) return [`variant:${board.variant}`];
  return [''];
}

function wallDiscriminator(wall) {
  const parts = [];
  if (wall.wall_name) parts.push(`wall:${String(wall.wall_name).trim().toLowerCase()}`);
  if (wall.layout) parts.push(`layout:${String(wall.layout).trim().toLowerCase()}`);
  if (wall.size_id != null) parts.push(`size:${wall.size_id}`);
  return parts.join('|');
}

/**
 * Assign `instance_id` to every board object on a venue, in place.
 *
 * Two installations that are genuinely indistinguishable — same system, same
 * wall name, same layout, same size — get a positional suffix so their ids stay
 * distinct and stable as long as their order is. That order comes from the
 * upstream feed, which is the best available answer: nothing else about them
 * differs, so nothing else could tell them apart either.
 */
export function assignBoardInstanceIds(venueId, boards) {
  const used = new Map();
  for (const board of boards) {
    const discriminators = boardDiscriminator(board);
    // A multi-wall Kilter entry is one upstream row but several installations.
    // The row's id names the row; `walls[].instance_id` names each wall.
    const rowKey = discriminators.join('&');
    const occurrence = used.get(`${board.board}|${rowKey}`) ?? 0;
    used.set(`${board.board}|${rowKey}`, occurrence + 1);
    const suffix = occurrence === 0 ? '' : `#${occurrence}`;

    // The row and its walls are different things a reporter can point at, so
    // they are hashed under different roles. Without that, a Kilter entry with
    // exactly one wall would give the row and the wall the same id — which is
    // how the first version of this produced 1070 collisions.
    board.instance_id = `b1_${shortHash(
      'cruxcoach/board-instance/v1',
      venueId,
      'row',
      board.board,
      `${rowKey}${suffix}`,
    )}`;

    if (Array.isArray(board.walls)) {
      const wallUsed = new Map();
      for (const wall of board.walls) {
        const key = wallDiscriminator(wall);
        const seen = wallUsed.get(key) ?? 0;
        wallUsed.set(key, seen + 1);
        wall.instance_id = `b1_${shortHash(
          'cruxcoach/board-instance/v1',
          venueId,
          'wall',
          board.board,
          `${key}${seen === 0 ? '' : `#${seen}`}${suffix}`,
        )}`;
      }
    }
  }
  return boards;
}

// ── The identity ledger ─────────────────────────────────────────────

const LEDGER_KEYS = new Set(['id', 'lat', 'lon', 'name', 'country', 'previous', 'recorded', 'note']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function isValidIsoDate(value) {
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validate one ledger record. Returns human-readable problems; empty means the
 * record may be applied.
 */
export function validateLedgerEntry(entry, index = 0) {
  const where = `venue-ids[${index}]${entry && entry.name ? ` "${entry.name}"` : ''}`;
  const problems = [];
  const fail = (message) => problems.push(`${where}: ${message}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where}: not an object`];
  }
  for (const key of Object.keys(entry)) {
    if (!LEDGER_KEYS.has(key)) fail(`unknown field "${key}"`);
  }
  if (typeof entry.id !== 'string' || !VENUE_ID_RE.test(entry.id)) {
    fail('"id" must be a v1_ venue id');
  }
  if (typeof entry.lat !== 'number' || !Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) {
    fail('"lat" must be a number in [-90, 90]');
  }
  if (typeof entry.lon !== 'number' || !Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) {
    fail('"lon" must be a number in [-180, 180]');
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    fail('"name" must be a non-empty string');
  }
  if (typeof entry.country !== 'string' || !COUNTRY_RE.test(entry.country)) {
    fail('"country" must be an uppercase ISO-3166-1 alpha-2 code');
  }
  if (typeof entry.recorded !== 'string' || !isValidIsoDate(entry.recorded)) {
    fail('"recorded" must be a real UTC date as YYYY-MM-DD');
  }
  if (typeof entry.note !== 'string' || entry.note.trim() === '') {
    // A pin overrides a deterministic derivation. The next person to read this
    // file needs to know why, or they cannot tell a real correction from a
    // mistake somebody committed once.
    fail('"note" must say why this id is pinned');
  }
  if (entry.previous !== undefined) {
    if (!Array.isArray(entry.previous)) {
      fail('"previous" must be an array of {lat, lon} the venue used to sit at');
    } else {
      for (const [i, prev] of entry.previous.entries()) {
        if (!prev || typeof prev.lat !== 'number' || typeof prev.lon !== 'number') {
          fail(`"previous[${i}]" must have numeric lat and lon`);
        }
      }
    }
  }
  return problems;
}

export function loadVenueIdLedger(file) {
  if (!existsSync(file)) return { entries: [], errors: [], present: false };

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${file} must be a JSON array of venue-id records`);
  }

  const errors = [];
  raw.forEach((entry, i) => errors.push(...validateLedgerEntry(entry, i)));

  const seenIds = new Map();
  raw.forEach((entry, i) => {
    if (!entry || typeof entry.id !== 'string') return;
    if (seenIds.has(entry.id)) {
      errors.push(`venue-ids[${i}]: id ${entry.id} is already claimed by venue-ids[${seenIds.get(entry.id)}]`);
    } else {
      seenIds.set(entry.id, i);
    }
  });

  return { entries: raw, errors, present: true };
}

/**
 * Resolve one ledger record against the assembled features. Same discipline as
 * the website-link overlay: exact coordinate match first, then a single
 * unambiguous venue nearby answering to the same name in the same country.
 * Anything less certain refuses.
 */
function resolveLedgerEntry(entry, index, byKey, features) {
  const where = `venue-ids[${index}] "${entry.name}"`;
  const candidates = [entry, ...(entry.previous ?? [])];

  for (const point of candidates) {
    const exact = byKey.get(venueKey(point.lat, point.lon));
    if (exact) return { status: 'ok', feature: exact, how: 'exact' };
  }

  const near = features.filter((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    if (feature.properties.country !== entry.country) return false;
    if (nameSimilarity(entry.name, feature.properties.name) < NAME_MATCH_MIN) return false;
    return candidates.some(
      (point) => distanceMeters(point.lat, point.lon, lat, lon) <= MATCH_RADIUS_M,
    );
  });

  if (near.length === 0) {
    return {
      status: 'unmatched',
      reason: `${where}: no venue within ${MATCH_RADIUS_M} m of any recorded position answering to this name — stale record?`,
    };
  }
  if (near.length > 1) {
    return {
      status: 'ambiguous',
      reason: `${where}: ${near.length} venues match this name nearby — refusing to guess which keeps the id`,
    };
  }
  return { status: 'ok', feature: near[0], how: 'proximity' };
}

/**
 * Assign `venue_id` to every feature and `instance_id` to every board, in place.
 *
 * Ledger pins are applied first so a pinned id always wins over the derivation.
 * A derived id that would collide with a pinned one is reported as a problem
 * rather than silently overwritten — two venues sharing an id would merge two
 * different gyms' reports into one queue item.
 *
 * Returns { stats, problems }: counts safe for boards.meta.json (no names, no
 * coordinates) and human-readable problems for the build log.
 */
export function assignVenueIds(features, ledgerEntries = []) {
  const stats = { derived: 0, pinned: 0, unmatched: 0, ambiguous: 0, collisions: 0, defined: ledgerEntries.length };
  const problems = [];

  const byKey = new Map();
  for (const feature of features) {
    const [lon, lat] = feature.geometry.coordinates;
    byKey.set(venueKey(lat, lon), feature);
  }

  const pinnedFeatures = new Map();
  const claimed = new Set();
  ledgerEntries.forEach((entry, index) => {
    if (validateLedgerEntry(entry, index).length > 0) return;
    // Two records claiming one id would give two gyms the same identity, which
    // is the exact failure this whole file exists to prevent. `loadVenueIdLedger`
    // catches it in the committed file; this catches it wherever the entries
    // came from, because the check has to hold at the point of use.
    if (claimed.has(entry.id)) {
      stats.collisions++;
      problems.push(
        `venue-ids[${index}] "${entry.name}": id ${entry.id} is already pinned to another venue — refusing to give two venues one identity`,
      );
      return;
    }
    const result = resolveLedgerEntry(entry, index, byKey, features);
    if (result.status !== 'ok') {
      stats[result.status === 'ambiguous' ? 'ambiguous' : 'unmatched']++;
      problems.push(result.reason);
      return;
    }
    if (pinnedFeatures.has(result.feature)) {
      stats.collisions++;
      problems.push(
        `venue-ids[${index}] "${entry.name}": this venue is already pinned to ${result.feature.properties.venue_id} — two records cannot claim one venue`,
      );
      return;
    }
    pinnedFeatures.set(result.feature, entry.id);
    claimed.add(entry.id);
    result.feature.properties.venue_id = entry.id;
    stats.pinned++;
  });

  for (const feature of features) {
    if (!feature.properties.venue_id) {
      const [lon, lat] = feature.geometry.coordinates;
      const derived = deriveVenueId(lat, lon);
      if (claimed.has(derived)) {
        // The derived id equals an id pinned to a *different* venue. Either a
        // 48-bit collision or, far more likely, a ledger record that pinned an
        // id it should not have. Refusing is the only safe answer: an id that
        // means two gyms is worse than a venue with no id, because a report
        // filed against it would name the wrong place.
        stats.collisions++;
        problems.push(
          `venue "${feature.properties.name}": derived id ${derived} is already pinned to another venue — leaving this venue without an id`,
        );
        continue;
      }
      feature.properties.venue_id = derived;
      claimed.add(derived);
      stats.derived++;
    }
    assignBoardInstanceIds(feature.properties.venue_id, feature.properties.boards ?? []);
  }

  // Board instance ids are derived from the venue id, so a venue-id collision
  // would have propagated. Check the whole set once rather than trusting that.
  const instanceIds = new Set();
  for (const feature of features) {
    for (const board of feature.properties.boards ?? []) {
      for (const id of [board.instance_id, ...(board.walls ?? []).map((w) => w.instance_id)]) {
        if (!id) continue;
        if (instanceIds.has(id)) {
          stats.collisions++;
          problems.push(`board instance id ${id} is claimed twice — two installations would share reports`);
        }
        instanceIds.add(id);
      }
    }
  }

  return { stats, problems };
}

/** Properties this pass owns, cleared before every application. */
export function clearVenueIds(features) {
  for (const feature of features) {
    delete feature.properties.venue_id;
    for (const board of feature.properties.boards ?? []) {
      delete board.instance_id;
      for (const wall of board.walls ?? []) delete wall.instance_id;
    }
  }
}
