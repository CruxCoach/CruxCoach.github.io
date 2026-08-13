/**
 * Real board climbs in a competition.
 *
 * A competition climb must point at a climb that exists, or the app cannot load
 * it onto the wall and the whole thing is a list of names. There is no board
 * catalogue on this website and building one would be a far larger project than
 * the competition feature, so the authoring path is the one CruxCoach already
 * has: **the share link**.
 *
 * Three forms are accepted, all of which a user can already produce from the
 * app's share button:
 *
 *   https://cruxcoach.org/c/<naddr>   a community climb. The naddr addresses a
 *                                     kind-30078 climb event, so its label,
 *                                     angle, board and hold set can be FETCHED
 *                                     and shown before the organizer commits.
 *   https://cruxcoach.org/c/<uuid>    a catalogue climb. There is no public
 *                                     event for it, so the organizer supplies
 *                                     the label and angle and the app resolves
 *                                     the uuid against its own database.
 *   <uuid>                            the same, pasted bare.
 *
 * A placeholder is refused outright: `00000001-0000-4000-8000-000000000000` and
 * friends are what an implementation produces when it has given up on wiring
 * the catalogue, and a competition built on them cannot be climbed.
 */
import { decodeNip19 } from './nostr-event.mjs';
import { KIND } from './competition.mjs';

/** Kilter's legacy 32-hex ids and modern dashed uuids both occur in the wild. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_UUID = /^[0-9a-f]{32}$/i;

/**
 * Placeholder shapes that must never reach a published competition.
 *
 * They parse as uuids, which is exactly why they need an explicit refusal: a
 * competition built on them publishes, validates, reduces and scores perfectly,
 * and then cannot be climbed.
 *
 * Four shapes, all of them things an implementation writes when it has given
 * up on wiring the catalogue:
 *
 *   00000000-0000-0000-0000-000000000000   all zero
 *   11111111-1111-1111-1111-111111111111   one digit repeated
 *   22222222-2222-4222-8222-222222222222   one digit repeated, wearing a
 *                                          version-4 nibble and a variant
 *                                          nibble so it looks like a real uuid
 *   0000000N-0000-4000-8000-000000000000   the counter the first version of
 *                                          the organizer form generated
 *
 * The third is the one worth spelling out. A genuine climb uuid is random, so
 * the chance of its thirty free hex digits all being the same is 16^-29 — this
 * refuses nothing anybody could really have.
 */
export function isPlaceholderUuid(value) {
  const normalized = String(value || '').toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(normalized)) return false;
  if (/^0+$/.test(normalized)) return true;
  if (/^(.)\1{31}$/.test(normalized)) return true;
  // 0000000N 0000 4000 8000 000000000000
  if (/^0{7}[0-9a-f]0{4}40{3}80{3}0{12}$/.test(normalized)) return true;
  // Every digit the same except the version nibble (13) and the variant
  // nibble (17), which is what makes it look like a v4 uuid.
  const free = normalized.slice(0, 12) + normalized.slice(13, 16) + normalized.slice(17);
  if (/^(.)\1{29}$/.test(free)) return true;
  return false;
}

export function normalizeUuid(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (UUID.test(trimmed) || LEGACY_UUID.test(trimmed)) return trimmed;
  return null;
}

/**
 * Parse whatever the organizer pasted.
 *
 * @returns {{ok: true, kind: 'community'|'catalogue', uuid: string, naddr?: string,
 *            setterPubkey?: string, dTag?: string} | {ok: false, error: string}}
 */
export function parseClimbRef(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'empty' };
  const text = input.trim();

  const naddrMatch = text.match(/(?:^|\/c\/)(naddr1[0-9a-z]+)/i)
    || text.match(/^nostr:(naddr1[0-9a-z]+)$/i);
  if (naddrMatch) {
    const decoded = decodeNip19(naddrMatch[1].toLowerCase());
    if (!decoded || decoded.type !== 'naddr') return { ok: false, error: 'damaged_link' };
    if (decoded.data.kind !== KIND) return { ok: false, error: 'wrong_kind' };
    // CruxCoach climb d-tags are `cruxcoach:climb:<pubkey-prefix>:<uuid>`.
    const parts = decoded.data.identifier.split(':');
    if (parts.length < 4 || parts[0] !== 'cruxcoach' || parts[1] !== 'climb') {
      return { ok: false, error: 'not_a_climb' };
    }
    const uuid = normalizeUuid(parts[parts.length - 1]);
    if (!uuid) return { ok: false, error: 'not_a_climb' };
    if (isPlaceholderUuid(uuid)) return { ok: false, error: 'placeholder' };
    return {
      ok: true,
      kind: 'community',
      uuid,
      naddr: naddrMatch[1].toLowerCase(),
      setterPubkey: decoded.data.pubkey,
      dTag: decoded.data.identifier,
    };
  }

  const fromUrl = text.match(/\/c\/([0-9a-fA-F-]{32,36})\/?$/);
  const candidate = fromUrl ? fromUrl[1] : text;
  const uuid = normalizeUuid(candidate);
  if (!uuid) return { ok: false, error: 'not_a_climb' };
  if (isPlaceholderUuid(uuid)) return { ok: false, error: 'placeholder' };
  return { ok: true, kind: 'catalogue', uuid };
}

/**
 * Read the details of a community climb out of its published event.
 *
 * This is what lets the organizer see what they are about to add — label,
 * setter grade, angle, board and size — rather than trusting a uuid they
 * pasted. The tags are the ones `NostrCommunityClimb` writes; see
 * `docs/nostr-architecture.md` §5.
 */
export function describeClimbEvent(event) {
  const tag = (name) => (event.tags || []).find((t) => t[0] === name);
  const labelled = (namespace) => (event.tags || [])
    .find((t) => t[0] === 'l' && t[2] === namespace)?.[1];

  let content = {};
  try { content = JSON.parse(event.content); } catch { /* name falls back below */ }

  const grade = tag('setter_grade');
  return {
    uuid: content.uuid || '',
    label: (content.name || '').trim(),
    description: (content.description || '').trim(),
    brand: tag('board_brand')?.[1] || '',
    boardLabel: labelled('com.cruxcoach.board') || '',
    size: labelled('com.cruxcoach.size') || '',
    layoutId: Number(tag('layout_id')?.[1] ?? NaN),
    setterGradeId: grade ? Number(grade[1]) : null,
    angle: grade && grade[2] !== undefined ? Number(grade[2]) : null,
    setterPubkey: event.pubkey,
  };
}

/**
 * Is this climb usable on the board the competition runs on?
 *
 * Board compatibility is the difference between "the app lights up the wall"
 * and "the app lights up the wrong wall". Brand and layout must match exactly;
 * a differing angle is allowed but reported, because most boards are adjustable
 * and the competition's angle is what the organizer set.
 *
 * @returns {{compatible: boolean, problems: string[], warnings: string[]}}
 */
export function checkBoardCompatibility(climb, board) {
  const problems = [];
  const warnings = [];
  if (!board) return { compatible: false, problems: ['no_board'], warnings };

  if (climb.brand && board.brand && climb.brand !== board.brand) problems.push('brand');
  if (Number.isFinite(climb.layoutId) && Number.isFinite(board.layout_id)
    && climb.layoutId !== board.layout_id) {
    problems.push('layout');
  }
  if (climb.size && board.size && climb.size !== board.size) {
    // A 12x12 climb on a 12x12-with-kickboard is usually fine; a 7x10 climb on
    // a 12x12 is not. We cannot tell without the layout data the app has, so
    // this is a warning the organizer confirms rather than a hard refusal.
    warnings.push('size');
  }
  if (Number.isFinite(climb.angle) && Number.isFinite(board.angle) && climb.angle !== board.angle) {
    warnings.push('angle');
  }
  return { compatible: problems.length === 0, problems, warnings };
}

/**
 * Turn accepted references into the `climbs` array a competition carries.
 *
 * Rejects duplicates: the same climb twice is either a paste error or a
 * competition where two rounds silently score the same problem.
 */
export function buildClimbList(entries) {
  const seen = new Set();
  const climbs = [];
  const errors = [];
  entries.forEach((entry, index) => {
    const uuid = normalizeUuid(entry.uuid);
    if (!uuid) { errors.push({ index, error: 'not_a_climb' }); return; }
    if (isPlaceholderUuid(uuid)) { errors.push({ index, error: 'placeholder' }); return; }
    if (seen.has(uuid)) { errors.push({ index, error: 'duplicate' }); return; }
    seen.add(uuid);
    const label = (entry.label || '').trim();
    if (!label) { errors.push({ index, error: 'no_label' }); return; }
    if (!Number.isInteger(entry.angle)) { errors.push({ index, error: 'no_angle' }); return; }
    climbs.push({
      id: `c${climbs.length + 1}`,
      climb_uuid: uuid,
      angle: entry.angle,
      label: label.slice(0, 60),
      points: Number.isInteger(entry.points) ? entry.points : 100,
      ...(entry.naddr ? { naddr: entry.naddr } : {}),
      ...(Number.isInteger(entry.zoneHold) && entry.zoneHold > 0 ? { zone_hold: entry.zoneHold } : {}),
      ...(entry.setter ? { setter: String(entry.setter).slice(0, 80) } : {}),
      ...(Number.isFinite(entry.difficulty) ? { difficulty: entry.difficulty } : {}),
      ...(Number.isFinite(entry.quality) ? { quality: entry.quality } : {}),
      ...(Number.isInteger(entry.ascents) ? { ascents: entry.ascents } : {}),
      source: entry.kind === 'community' ? 'community' : 'catalogue',
    });
  });
  return { climbs, errors };
}

/** A relay filter that fetches one community climb by its address. */
export function climbEventFilter(ref) {
  return {
    kinds: [KIND],
    authors: [ref.setterPubkey],
    '#d': [ref.dTag],
    limit: 1,
  };
}
