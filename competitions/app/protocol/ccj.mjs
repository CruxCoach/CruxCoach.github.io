/**
 * CruxCoach Canonical JSON (CCJ) — see FEAT-058 §4.1.
 *
 * Two implementations in two languages have to produce the same bytes, or the
 * cross-client `state_hash` is decoration. The rules are deliberately narrow so
 * there is nothing to disagree about:
 *
 *   - object keys sorted ascending by UTF-16 code unit
 *   - no insignificant whitespace
 *   - integers only; a non-integer number is a programming error and throws
 *   - `null` and `undefined` are never emitted — an absent value is an absent key
 *   - strings escaped exactly as JSON.stringify escapes them
 *
 * The Kotlin port is `shared/.../domain/competition/Ccj.kt` in the app repo and
 * is pinned to the same vectors (`competition/vectors/ccj.json`).
 */

const encoder = new TextEncoder();

function canonicalString(value) {
  // JSON.stringify's string escaping already matches the rule in §4.1, and it
  // is well-formed (lone surrogates become \udXXX) since ES2019. Re-deriving it
  // by hand is how two implementations drift.
  return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {string} the canonical serialization
 */
export function ccj(value) {
  if (value === null || value === undefined) {
    throw new TypeError('CCJ: null/undefined must be omitted, not serialized');
  }
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'string') return canonicalString(value);
  if (type === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`CCJ: only integers are allowed, got ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`CCJ: integer ${value} is outside the safe range`);
    }
    // Object.is separates -0 from 0; -0 would serialize as "0" here anyway,
    // but rejecting it keeps the two implementations from having to agree on
    // an edge case neither of them should ever produce.
    if (Object.is(value, -0)) throw new TypeError('CCJ: -0 is not a valid value');
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => ccj(item)).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined && value[key] !== null);
    for (const key of keys) {
      if (!/^[a-z0-9_]+$/.test(key)) {
        throw new TypeError(`CCJ: object key ${JSON.stringify(key)} is not [a-z0-9_]+`);
      }
    }
    keys.sort();
    return `{${keys.map((key) => `${canonicalString(key)}:${ccj(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`CCJ: unsupported type ${type}`);
}

/** sha256 of the canonical serialization, lowercase hex. */
export async function ccjHash(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(ccj(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 of an already-canonical string, lowercase hex. */
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
