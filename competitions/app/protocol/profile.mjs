/**
 * Kind-0 profile metadata — NIP-01 §"Basic Event Kinds", field semantics NIP-24.
 *
 * A competition is a public thing with named people in it. Both roles must have
 * a real profile before they can create one or enter one, so that a leaderboard
 * shows people rather than a column of hex, and so that an organizer publishing
 * a public event has a checkable identity.
 *
 * DOM-free, like the rest of `protocol/`, so `node --test` exercises the shipped
 * code.
 *
 * Sources (accessed 2026-08-09):
 *   https://github.com/nostr-protocol/nips/blob/master/01.md
 *   https://github.com/nostr-protocol/nips/blob/master/24.md
 */
import { verifyEvent } from './nostr-event.mjs';

export const PROFILE_KIND = 0;

/** NIP-24 field names we read or write. Anything else is preserved untouched. */
export const KNOWN_FIELDS = [
  'name', 'display_name', 'about', 'picture', 'banner', 'website', 'nip05', 'lud16', 'lud06',
];

export const LIMITS = {
  name: 48,
  display_name: 48,
  about: 500,
  picture: 512,
  banner: 512,
  website: 512,
  nip05: 128,
  lud16: 128,
};

/** Content over this is not a profile; it is somebody using kind 0 as storage. */
export const MAX_CONTENT_BYTES = 8192;

/**
 * Validate the fields a user typed.
 *
 * A profile is "valid enough to compete" when it has a usable name. Everything
 * else is optional — demanding a picture or a NIP-05 to enter a bouldering comp
 * would be theatre.
 *
 * @returns {{ok: boolean, errors: Array<{field: string, message: string}>}}
 */
export function validateProfileFields(fields) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  const name = (fields?.name ?? '').trim();
  if (name.length === 0) fail('name', 'is required');
  if (name.length > LIMITS.name) fail('name', `must be at most ${LIMITS.name} characters`);
  // A name made of invisible characters is not a name, and it is what someone
  // reaches for when they want to appear on a public screen as nothing.
  if (name.length > 0 && /^[\s\u200b-\u200f\u2060\ufeff]+$/.test(name)) {
    fail('name', 'must contain visible characters');
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    if (field === 'name') continue;
    const value = fields?.[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') { fail(field, 'must be text'); continue; }
    if (value.length > limit) fail(field, `must be at most ${limit} characters`);
  }

  for (const field of ['picture', 'banner', 'website']) {
    const value = (fields?.[field] ?? '').trim();
    if (!value) continue;
    // https only: a profile picture over http is a mixed-content request from a
    // page served over TLS, and a website field is a link we hand to a user.
    if (!/^https:\/\/[^\s]+$/.test(value)) fail(field, 'must be an https:// URL');
  }

  const lud16 = (fields?.lud16 ?? '').trim();
  if (lud16 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lud16)) {
    fail('lud16', 'must look like name@example.com');
  }

  const nip05 = (fields?.nip05 ?? '').trim();
  if (nip05 && !/^[^\s@]*@[^\s@]+\.[^\s@]+$/.test(nip05)) {
    fail('nip05', 'must look like name@example.com');
  }

  // Every control character except tab/newline/return, which `about` may use.
  for (const field of KNOWN_FIELDS) {
    const value = fields?.[field];
    if (typeof value !== 'string') continue;
    const forbidden = field === 'about'
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
      : /[\u0000-\u001f\u007f]/;
    if (forbidden.test(value)) fail(field, 'must not contain control characters');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Parse a kind-0 event into a profile.
 *
 * Total: relay-controlled input never throws out of here. `ok:false` carries a
 * reason a screen can act on rather than a stack trace.
 */
export function parseProfileEvent(event) {
  if (!event || event.kind !== PROFILE_KIND) return { ok: false, error: 'wrong_kind' };
  if (typeof event.content !== 'string') return { ok: false, error: 'no_content' };
  if (event.content.length > MAX_CONTENT_BYTES) return { ok: false, error: 'too_large' };
  let content;
  try {
    content = JSON.parse(event.content);
  } catch {
    // A profile whose JSON is broken is not a profile, and the person owning it
    // needs to be told so rather than shown an empty name forever.
    return { ok: false, error: 'invalid_json' };
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, error: 'invalid_json' };
  }

  const fields = {};
  for (const key of KNOWN_FIELDS) {
    if (typeof content[key] === 'string') fields[key] = content[key];
  }
  const name = (fields.display_name || fields.name || '').trim();
  return {
    ok: true,
    profile: {
      pubkey: event.pubkey,
      createdAt: event.created_at,
      eventId: event.id,
      fields,
      /** Everything the author had, so a re-publish never drops their data. */
      raw: content,
      name,
      /** Usable for a competition: it has a name someone can read. */
      complete: name.length > 0,
    },
  };
}

/**
 * Pick the profile to trust out of what several relays returned.
 *
 * Newest `created_at` wins, ties broken by the lower event id so two clients
 * converge. Never first-answer: a relay that missed the last profile edit still
 * replies, and replying first does not make it current.
 *
 * @param {Array<object>} events raw kind-0 events, unverified
 * @param {string} pubkey the identity we are asking about
 */
export async function selectNewestProfile(events, pubkey) {
  const candidates = [];
  for (const event of events) {
    if (!event || event.pubkey !== pubkey || event.kind !== PROFILE_KIND) continue;
    let valid = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      valid = await verifyEvent(event);
    } catch {
      valid = false;
    }
    if (!valid) continue;
    candidates.push(event);
  }
  if (candidates.length === 0) return { found: false, conflicting: false };

  candidates.sort((a, b) => b.created_at - a.created_at
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const newest = candidates[0];
  // Two different profiles at the same second is a real thing when someone
  // edits from two devices. It is not an error, but the UI says which one it
  // took rather than picking silently.
  const conflicting = candidates.length > 1
    && candidates[1].created_at === newest.created_at
    && candidates[1].content !== newest.content;

  const parsed = parseProfileEvent(newest);
  if (!parsed.ok) return { found: true, invalid: parsed.error, conflicting };
  return { found: true, profile: parsed.profile, conflicting, stale: candidates.length > 1 };
}

/**
 * Build an unsigned kind-0 event.
 *
 * Unknown fields already on the profile are preserved: a competition sign-in
 * must never quietly delete somebody's NIP-05 or their banner because this form
 * did not have a box for it.
 */
export function buildProfileEvent(fields, createdAt, existingRaw = {}) {
  const validation = validateProfileFields(fields);
  if (!validation.ok) {
    throw new Error(`invalid profile: ${validation.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
  }
  const content = { ...existingRaw };
  for (const key of KNOWN_FIELDS) {
    const value = fields[key];
    if (value === undefined) continue;
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed === '') delete content[key];
    else content[key] = trimmed;
  }
  return {
    kind: PROFILE_KIND,
    created_at: createdAt,
    tags: [],
    content: JSON.stringify(content),
  };
}

/**
 * The name a competition should show for someone, without leaking contact
 * details.
 *
 * `display_name` then `name`, and never `nip05`, `lud16` or `website` — those
 * are contact information, and a leaderboard is not the place for them.
 */
export function competitionDisplayName(profile, fallbackPubkey = '') {
  const candidate = (profile?.fields?.display_name || profile?.fields?.name || '').trim();
  if (candidate) return candidate.slice(0, 48);
  return fallbackPubkey ? `${fallbackPubkey.slice(0, 8)}…` : '';
}
