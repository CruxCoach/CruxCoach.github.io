/**
 * `cruxcoach-competition/1` codec and validation — FEAT-058 §2, §3, §6, §16.
 *
 * Builders return UNSIGNED events. Signing is the signer layer's job, because
 * the three signer paths (NIP-07, NIP-46, local key) differ in everything
 * except the bytes they are handed.
 *
 * Parsers are total: they return `{ ok: false, error }` rather than throwing,
 * because every one of them runs against relay-controlled input and a thrown
 * exception in a subscription loop is a silently dropped competition.
 */
import { ccj } from './ccj.mjs';
import { addressOf, isHex32, tagValue, tagValues } from './nostr-event.mjs';
import { isAllowedRelayUrl } from './relay-url.mjs';
import { isPlaceholderUuid } from './climb-ref.mjs';

export const KIND = 30078;
export const NAMESPACE = 'com.cruxcoach.competition';
export const SCHEMA = 'cruxcoach-competition/1';
export const SCHEMA_MAJOR = 1;

/** Same ceiling as the app's NostrEventPolicy.MAX_FUTURE_SKEW_SECONDS. */
export const MAX_FUTURE_SKEW_SECONDS = 3600;
/** FEAT-058 §16.2 — half the tightest observed relay frame limit. */
export const MAX_EVENT_BYTES = 65536;

/** NIP-01 replaceable ordering: later timestamp, then lexicographically lower id. */
export function isNewerReplaceable(candidateCreatedAt, candidateId, currentCreatedAt, currentId) {
  return candidateCreatedAt > currentCreatedAt
    || (candidateCreatedAt === currentCreatedAt && candidateId < currentId);
}

export const DOC_TYPES = ['competition', 'log', 'snapshot', 'results', 'intent'];

export const LIFECYCLE = [
  'draft', 'published', 'registration_open', 'registration_closed',
  'checkin_open', 'running', 'paused', 'finished', 'cancelled',
];

export const LEGAL_TRANSITIONS = {
  draft: ['published', 'paused', 'finished', 'cancelled'],
  published: ['registration_open', 'paused', 'finished', 'cancelled'],
  registration_open: ['registration_closed', 'paused', 'finished', 'cancelled'],
  registration_closed: ['checkin_open', 'paused', 'finished', 'cancelled'],
  checkin_open: ['running', 'paused', 'finished', 'cancelled'],
  running: ['paused', 'finished', 'cancelled'],
  paused: ['running', 'finished', 'cancelled'],
  finished: [],
  cancelled: [],
};

export const LOG_OPS = [
  'lifecycle', 'registration_decision', 'payment_decision', 'claim_decision',
  'checkin', 'queue', 'defer_decision', 'attempt_result', 'complete_turn', 'correction',
  'override', 'announcement', 'disqualify', 'retire', 'prize_decision', 'config_update',
];

/**
 * Mutable configuration is deliberately a closed set. Identity, authority,
 * relay routing and lifecycle remain rooted in the signed definition/log.
 * Everything else is either presentation/operations-safe or can change who
 * may climb/how results score and is therefore labelled `scoring` in the log.
 */
export const SAFE_CONFIG_FIELDS = [
  'title', 'summary', 'description', 'eligibility', 'waiver',
  'participant_instructions', 'spectator_info', 'refund_policy', 'visibility',
  'venue', 'timezone', 'prize_claim_days',
];
export const SCORING_CONFIG_FIELDS = [
  'starts_at', 'ends_at', 'registration_opens_at', 'registration_closes_at',
  'checkin_opens_at', 'checkin_closes_at', 'capacity', 'waitlist_enabled',
  'fee_msat', 'fee_lnurl', 'waiver_required', 'board', 'divisions', 'climbs',
  'climb_pool', 'prizes', 'rules',
];
export const MUTABLE_CONFIG_FIELDS = [...SAFE_CONFIG_FIELDS, ...SCORING_CONFIG_FIELDS];

export function configPatchImpact(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const fields = Object.keys(patch);
  if (fields.length === 0 || fields.some((field) => !MUTABLE_CONFIG_FIELDS.includes(field))) return null;
  return fields.some((field) => SCORING_CONFIG_FIELDS.includes(field)) ? 'scoring' : 'safe';
}

export const INTENT_OPS = [
  'register', 'withdraw', 'checkin_request', 'defer_request',
  'climb_choice', 'attempt_report', 'payment_claim', 'prize_claim', 'prize_receipt',
];

/**
 * What can happen to a prize, in the public log.
 *
 * Deliberately thin. The claim itself, the payout destination and every contact
 * detail travel NIP-44 encrypted and never appear here — this is the status a
 * competition can show a room, and nothing more.
 */
/** The id shape shared by divisions, climbs and prizes. */
export const isSlug = (value) => /^[a-z0-9_]{1,24}$/.test(String(value ?? ''));

export const PRIZE_STATES = ['claimed', 'approved', 'paid', 'rejected', 'expired'];

/** How long a winner has to claim, when the organizer sets no deadline. */
export const DEFAULT_PRIZE_CLAIM_DAYS = 30;

export const QUEUE_ACTIONS = ['seed', 'seed_open', 'open_turn', 'close_turn', 'advance', 'skip_turn', 'reorder', 'next_climb', 'next_round'];
export const ATTEMPT_OUTCOMES = ['top', 'zone', 'fall', 'pass', 'timeout'];
export const CLIMB_SOURCES = ['organizer_set', 'participant_choice'];
export const UNIQUENESS = ['none', 'unique_per_competition'];
export const PROGRESSIONS = ['synchronous_rounds', 'asynchronous_turns'];
/** Absent means the legacy v1 host-authored `seed_open` queue. */
export const QUEUE_POLICIES = ['automatic', 'custom'];
export const SCORINGS = ['tops_then_attempts', 'achievement_points', 'points_sum', 'hardest_n'];
export const TIEBREAKS = ['fewest_attempts', 'most_zones', 'fewest_zone_attempts', 'earliest_finish', 'seed_order'];
export const VISIBILITIES = ['public', 'unlisted'];
export const PAYMENT_STATES = ['not_required', 'pending', 'settled', 'failed', 'expired', 'refunded'];

/** Registration and check-in are independent windows and may overlap. */
export function registrationWindowOpen(competition, status, at) {
  if (!Number.isInteger(at) || ['finished', 'cancelled'].includes(status)) return false;
  return at >= competition.registration_opens_at && at <= competition.registration_closes_at;
}

/** Check-in is independently scheduled and may overlap registration. */
export function checkinWindowOpen(competition, status, at) {
  if (!Number.isInteger(at) || ['finished', 'cancelled'].includes(status)) return false;
  return at >= competition.checkin_opens_at && at <= competition.checkin_closes_at;
}

/** The clock starts the competition; pause and terminal states are host overrides. */
export function competitionRunning(competition, status, at) {
  if (!Number.isInteger(at) || ['paused', 'finished', 'cancelled'].includes(status)) return false;
  return at >= competition.starts_at && at <= competition.ends_at;
}

/** Every wall-clock boundary that can change a competition screen without an event. */
export function effectiveTimeStateKey(competition, state, at) {
  if (!competition || !state || !Number.isInteger(at)) return '';
  return [
    state.status,
    registrationWindowOpen(competition, state.status, at) ? 1 : 0,
    checkinWindowOpen(competition, state.status, at) ? 1 : 0,
    competitionRunning(competition, state.status, at) ? 1 : 0,
    Number.isInteger(state.turn_opened_at) && at >= state.turn_opened_at ? 1 : 0,
    Number.isInteger(state.turn_deadline_at) && at >= state.turn_deadline_at ? 1 : 0,
  ].join(':');
}

/** `reason` is mandatory on these; an audit trail without a why is just a log. */
const REASON_REQUIRED_OPS = new Set(['correction', 'override', 'disqualify', 'retire', 'config_update']);

// ── d-tags (§3.2) ──

const COMP_ID_RE = /^[0-9a-f]{16}$/;
const NONCE_RE = /^[0-9a-f]{8}$/;

export function isCompId(value) {
  return typeof value === 'string' && COMP_ID_RE.test(value);
}

export function newCompId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newNonce() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const compDTag = (compId) => `cruxcoach:comp:${compId}`;
export const logDTag = (compId, seq) => `cruxcoach:comp:${compId}:log:${String(seq).padStart(6, '0')}`;
export const snapDTag = (compId, seq) => `cruxcoach:comp:${compId}:snap:${String(seq).padStart(6, '0')}`;
export const resultsDTag = (compId) => `cruxcoach:comp:${compId}:results`;
export const intentDTag = (compId, pubkey, nonce) =>
  `cruxcoach:comp:${compId}:intent:${pubkey.slice(0, 8)}:${nonce}`;

export const competitionAddress = (organizerPubkey, compId) =>
  addressOf({ kind: KIND, pubkey: organizerPubkey, identifier: compDTag(compId) });

/** Parse a d-tag back into `{ compId, kind, seq?, pubkeyPrefix?, nonce? }`. */
export function parseDTag(dTag) {
  if (typeof dTag !== 'string') return null;
  const parts = dTag.split(':');
  if (parts[0] !== 'cruxcoach' || parts[1] !== 'comp' || !isCompId(parts[2])) return null;
  const compId = parts[2];
  if (parts.length === 3) return { compId, kind: 'competition' };
  if (parts.length === 5 && (parts[3] === 'log' || parts[3] === 'snap')) {
    if (!/^\d{6}$/.test(parts[4])) return null;
    const seq = Number(parts[4]);
    if (seq < 1) return null;
    return { compId, kind: parts[3] === 'log' ? 'log' : 'snapshot', seq };
  }
  if (parts.length === 4 && parts[3] === 'results') return { compId, kind: 'results' };
  if (parts.length === 6 && parts[3] === 'intent') {
    if (!/^[0-9a-f]{8}$/.test(parts[4]) || !NONCE_RE.test(parts[5])) return null;
    return { compId, kind: 'intent', pubkeyPrefix: parts[4], nonce: parts[5] };
  }
  return null;
}

// ── validation (§16.1) ──

const LIMITS = {
  title: [1, 120],
  summary: [0, 140],
  description: [0, 4000],
  eligibility: [0, 2000],
  waiver: [0, 2000],
  participant_instructions: [0, 2000],
  spectator_info: [0, 2000],
  refund_policy: [0, 2000],
  display: [1, 48],
};

const RANGES = {
  capacity: [0, 500],
  climb_count: [1, 40],
  counted_climb_count: [1, 40],
  attempts_per_climb: [1, 20],
  turn_deadline_sec: [30, 1800],
  attempt_deadline_sec: [0, 1800],
  min_rest_sec: [0, 3600],
  defer_budget_per_round: [0, 5],
  max_consecutive_defers: [0, 5],
  defer_slots: [1, 10],
};

function err(list, field, message) {
  list.push({ field, message });
}

function checkText(errors, obj, field, required) {
  const value = obj[field];
  const [min, max] = LIMITS[field];
  if (value === undefined || value === '') {
    if (required || min > 0) err(errors, field, 'is required');
    return;
  }
  if (typeof value !== 'string') { err(errors, field, 'must be text'); return; }
  if (value.length < min) err(errors, field, `must be at least ${min} characters`);
  if (value.length > max) err(errors, field, `must be at most ${max} characters`);
  // Tab, newline and carriage return are fine in the long free-text fields;
  // every other C0 character (and DEL) is invisible or a terminal control
  // sequence, and has no business in a title that goes on a projector.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    err(errors, field, 'must not contain control characters');
  }
}

function checkInt(errors, obj, field, required = true) {
  const value = obj[field];
  if (value === undefined) {
    if (required) err(errors, field, 'is required');
    return;
  }
  if (!Number.isInteger(value)) { err(errors, field, 'must be a whole number'); return; }
  const range = RANGES[field];
  if (range && (value < range[0] || value > range[1])) {
    err(errors, field, `must be between ${range[0]} and ${range[1]}`);
  }
}

function checkEnum(errors, obj, field, allowed, required = true) {
  const value = obj[field];
  if (value === undefined) {
    if (required) err(errors, field, 'is required');
    return;
  }
  if (!allowed.includes(value)) err(errors, field, `must be one of: ${allowed.join(', ')}`);
}

/**
 * Validate a competition configuration.
 * @returns {{ ok: boolean, errors: Array<{field: string, message: string}> }}
 */
export function validateCompetitionConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: [{ field: '', message: 'no configuration given' }] };
  }

  if (!isCompId(config.comp_id)) err(errors, 'comp_id', 'must be 16 lowercase hex characters');
  if (!isHex32(config.authority)) err(errors, 'authority', 'must be a 32-byte hex public key');
  if (!Number.isInteger(config.authority_epoch) || config.authority_epoch < 1) {
    err(errors, 'authority_epoch', 'must be a whole number of at least 1');
  }

  checkText(errors, config, 'title', true);
  checkText(errors, config, 'summary', false);
  checkText(errors, config, 'description', false);
  checkText(errors, config, 'eligibility', false);
  checkText(errors, config, 'waiver', false);
  checkText(errors, config, 'participant_instructions', false);
  checkText(errors, config, 'spectator_info', false);
  checkText(errors, config, 'refund_policy', false);

  checkEnum(errors, config, 'visibility', VISIBILITIES);
  checkEnum(errors, config, 'status', LIFECYCLE);
  checkInt(errors, config, 'capacity');

  if (config.waiver_required === true && !config.waiver) {
    err(errors, 'waiver', 'is required when a waiver must be accepted');
  }

  for (const field of ['starts_at', 'ends_at', 'registration_opens_at', 'registration_closes_at',
    'checkin_opens_at', 'checkin_closes_at']) {
    if (config[field] !== undefined && !Number.isInteger(config[field])) {
      err(errors, field, 'must be a whole number of seconds since the epoch');
    }
  }
  // Registration and check-in are independent windows and may overlap. Each
  // window must be internally ordered. Either may remain open after start.
  const order = [
    ['registration_opens_at', 'registration_closes_at'],
    ['checkin_opens_at', 'checkin_closes_at'],
    ['registration_opens_at', 'starts_at'],
    ['checkin_opens_at', 'starts_at'],
    ['starts_at', 'ends_at'],
    ['registration_closes_at', 'ends_at'],
    ['checkin_closes_at', 'ends_at'],
  ];
  for (const [a, b] of order) {
    if (Number.isInteger(config[a]) && Number.isInteger(config[b]) && config[a] > config[b]) {
      err(errors, b, `must not be before ${a.replace(/_/g, ' ')}`);
    }
  }
  if (typeof config.timezone !== 'string' || !config.timezone) {
    err(errors, 'timezone', 'is required');
  }

  if (!config.venue || typeof config.venue !== 'object') {
    err(errors, 'venue', 'is required');
  } else {
    checkEnum(errors, config.venue, 'kind', ['physical', 'online']);
    if (config.venue.kind === 'physical' && !config.venue.name) {
      err(errors, 'venue.name', 'is required for a physical venue');
    }
  }

  if (!config.board || typeof config.board !== 'object') {
    err(errors, 'board', 'is required');
  } else {
    for (const field of ['brand', 'model', 'size']) {
      if (typeof config.board[field] !== 'string' || !config.board[field]) {
        err(errors, `board.${field}`, 'is required');
      }
    }
    if (!Number.isInteger(config.board.angle)) err(errors, 'board.angle', 'is required');
    if (!Number.isInteger(config.board.layout_id)) err(errors, 'board.layout_id', 'is required');
  }

  if (!Array.isArray(config.divisions) || config.divisions.length < 1 || config.divisions.length > 8) {
    err(errors, 'divisions', 'must have between 1 and 8 entries');
  } else {
    const ids = new Set();
    for (const division of config.divisions) {
      if (!division || !/^[a-z0-9_]{1,24}$/.test(division.id || '')) {
        err(errors, 'divisions', 'each division needs an id of [a-z0-9_], max 24 characters');
      } else if (ids.has(division.id)) {
        err(errors, 'divisions', `duplicate division id "${division.id}"`);
      } else {
        ids.add(division.id);
      }
      if (typeof division?.label !== 'string' || !division.label) {
        err(errors, 'divisions', 'each division needs a label');
      }
    }
  }

  const rules = config.rules;
  if (!rules || typeof rules !== 'object') {
    err(errors, 'rules', 'is required');
  } else {
    checkEnum(errors, rules, 'climb_source', CLIMB_SOURCES);
    checkEnum(errors, rules, 'selection_uniqueness', UNIQUENESS);
    checkEnum(errors, rules, 'progression', PROGRESSIONS);
    checkEnum(errors, rules, 'queue_policy', QUEUE_POLICIES, false);
    checkEnum(errors, rules, 'scoring', SCORINGS);
    checkInt(errors, rules, 'climb_count');
    checkInt(errors, rules, 'counted_climb_count', false);
    checkInt(errors, rules, 'attempts_per_climb');
    checkInt(errors, rules, 'turn_deadline_sec');
    checkInt(errors, rules, 'attempt_deadline_sec', false);
    checkInt(errors, rules, 'min_rest_sec');
    checkInt(errors, rules, 'defer_budget_per_round');
    checkInt(errors, rules, 'max_consecutive_defers');
    checkInt(errors, rules, 'defer_slots');
    if (rules.scoring === 'achievement_points') {
      const points = rules.score_points;
      if (!points || typeof points !== 'object') {
        err(errors, 'rules.score_points', 'is required for Zone / Top / Flash points');
      } else {
        for (const field of ['zone', 'top', 'flash']) {
          if (!Number.isInteger(points[field]) || points[field] < 0 || points[field] > 10000) {
            err(errors, `rules.score_points.${field}`, 'must be a whole number from 0 to 10000');
          }
        }
        if (['zone', 'top', 'flash'].every((field) => points[field] === 0)) {
          err(errors, 'rules.score_points', 'at least one achievement must award points');
        }
      }
    }
    if (!Array.isArray(rules.tiebreaks) || rules.tiebreaks.length === 0) {
      err(errors, 'rules.tiebreaks', 'needs at least one tiebreak');
    } else if (rules.tiebreaks.some((t) => !TIEBREAKS.includes(t))) {
      err(errors, 'rules.tiebreaks', `must be from: ${TIEBREAKS.join(', ')}`);
    }
    if (Number.isInteger(rules.defer_budget_per_round) && Number.isInteger(rules.max_consecutive_defers)
      && rules.max_consecutive_defers > rules.defer_budget_per_round) {
      err(errors, 'rules.max_consecutive_defers', 'cannot exceed the per-round budget');
    }
    if (rules.selection_uniqueness === 'unique_per_competition' && rules.climb_source !== 'participant_choice') {
      err(errors, 'rules.selection_uniqueness', 'only applies when participants choose their climbs');
    }
    if (Number.isInteger(rules.counted_climb_count) && Number.isInteger(rules.climb_count)
      && rules.counted_climb_count > rules.climb_count) {
      err(errors, 'rules.counted_climb_count', 'cannot exceed the available or selected climb count');
    }
    // A points format needs a points table, and the table lives on the
    // organizer's climb list. With participant-chosen climbs there is nothing
    // to look a point value up in, so every score would silently be zero — a
    // ranking that looks computed and is not.
    if ((rules.scoring === 'points_sum' || rules.scoring === 'hardest_n')
      && rules.climb_source !== 'organizer_set') {
      err(errors, 'rules.scoring', 'point scoring needs an organizer-set climb list with point values');
    }
  }

  if (rules?.climb_source === 'organizer_set') {
    if (!Array.isArray(config.climbs) || config.climbs.length < 1 || config.climbs.length > 40) {
      err(errors, 'climbs', 'must list between 1 and 40 climbs');
    } else {
      const ids = new Set();
      const uuids = new Set();
      for (const climb of config.climbs) {
        if (!climb || !/^[a-z0-9_]{1,24}$/.test(climb.id || '')) {
          err(errors, 'climbs', 'each climb needs an id of [a-z0-9_], max 24 characters');
        } else if (ids.has(climb.id)) {
          err(errors, 'climbs', `duplicate climb id "${climb.id}"`);
        } else {
          ids.add(climb.id);
        }
        const uuid = String(climb?.climb_uuid || '').toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
          && !/^[0-9a-f]{32}$/.test(uuid)) {
          err(errors, 'climbs', 'each climb needs a real board climb id');
        } else if (isPlaceholderUuid(uuid)) {
          // A competition built on placeholder ids cannot be climbed: the app
          // has nothing to load onto the wall. Refusing at validation means
          // such a competition can never be published, by either client.
          err(errors, 'climbs', 'contains a placeholder climb id, which no board can load');
        }
        if (!Number.isInteger(climb?.angle)) err(errors, 'climbs', 'each climb needs an angle');
        if (climb?.zone_hold !== undefined && (!Number.isInteger(climb.zone_hold) || climb.zone_hold < 1)) {
          err(errors, 'climbs', 'zone_hold must be a positive placement id');
        }
        if (typeof climb?.label !== 'string' || !climb.label.trim()) {
          err(errors, 'climbs', 'each climb needs a label');
        }
        if (uuids.has(uuid)) err(errors, 'climbs', 'lists the same climb twice');
        else uuids.add(uuid);
      }
      if (Number.isInteger(rules.climb_count) && config.climbs.length < rules.climb_count) {
        err(errors, 'climbs', `needs at least ${rules.climb_count} climbs so that many results can count`);
      }
      if (Number.isInteger(rules.counted_climb_count)
        && rules.counted_climb_count > config.climbs.length) {
        err(errors, 'rules.counted_climb_count', 'cannot exceed the organizer climb list');
      }
    }
  }
  if (rules?.climb_source === 'participant_choice') {
    if (config.climbs !== undefined) {
      err(errors, 'climbs', 'must be absent when participants choose their own climbs');
    }
    const pool = config.climb_pool;
    if (!pool || typeof pool !== 'object') {
      err(errors, 'climb_pool', 'is required when participants choose their own climbs');
    } else if (!Array.isArray(pool.options) || pool.options.length === 0) {
      err(errors, 'climb_pool', 'needs at least one climb for entrants to choose from');
    } else if (pool.options.length > 60) {
      err(errors, 'climb_pool', 'must offer at most 60 climbs');
    } else {
      const poolUuids = new Set();
      const poolIds = new Set();
      for (const option of pool.options) {
        if (!option || !/^[a-z0-9_]{1,24}$/.test(option.id || '')) {
          err(errors, 'climb_pool', 'each option needs an id of [a-z0-9_], max 24 characters');
        } else if (poolIds.has(option.id)) {
          err(errors, 'climb_pool', `duplicate option id "${option.id}"`);
        } else {
          poolIds.add(option.id);
        }
        const uuid = String(option?.climb_uuid || '').toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
          && !/^[0-9a-f]{32}$/.test(uuid)) {
          err(errors, 'climb_pool', 'each option needs a real board climb id');
        } else if (isPlaceholderUuid(uuid)) {
          err(errors, 'climb_pool', 'contains a placeholder climb id, which no board can load');
        } else if (poolUuids.has(uuid)) {
          err(errors, 'climb_pool', 'offers the same climb twice');
        } else {
          poolUuids.add(uuid);
        }
        if (!Number.isInteger(option?.angle)) err(errors, 'climb_pool', 'each option needs an angle');
        if (option?.zone_hold !== undefined && (!Number.isInteger(option.zone_hold) || option.zone_hold < 1)) {
          err(errors, 'climb_pool', 'zone_hold must be a positive placement id');
        }
        if (typeof option?.label !== 'string' || !option.label.trim()) {
          err(errors, 'climb_pool', 'each option needs a label');
        }
      }
      if (Number.isInteger(rules.climb_count) && pool.options.length < rules.climb_count) {
        err(errors, 'climb_pool', `needs at least ${rules.climb_count} climbs for this format`);
      }
      // `unique_per_competition` remains readable for legacy signed events.
      // New clients expose the complete pool and apply Best-N while scoring,
      // so pool capacity is never multiplied by participant capacity.
    }
  }

  if (!Number.isInteger(config.fee_msat) || config.fee_msat < 0) {
    err(errors, 'fee_msat', 'must be 0 or a whole number of millisatoshis');
  } else if (config.fee_msat > 0 && !config.fee_lnurl) {
    err(errors, 'fee_lnurl', 'is required when there is an entry fee');
  } else if (config.fee_msat === 0 && config.fee_lnurl) {
    err(errors, 'fee_lnurl', 'must be absent for a free competition');
  }

  if (Array.isArray(config.prizes)) {
    if (config.prizes.length > 10) err(errors, 'prizes', 'must have at most 10 entries');
    const prizeIds = new Set();
    const slots = new Set();
    const divisionIds = new Set((config.divisions || []).map((d) => d.id));
    const multiDivision = divisionIds.size > 1;

    for (const prize of config.prizes) {
      // A stable id, because a claim names the prize it is for and a claim that
      // named "second place" would follow the prize if the list were reordered.
      if (!isSlug(prize?.id)) {
        err(errors, 'prizes', 'each prize needs an id of [a-z0-9_], max 24 characters');
      } else if (prizeIds.has(prize.id)) {
        err(errors, 'prizes', `duplicate prize id "${prize.id}"`);
      } else {
        prizeIds.add(prize.id);
      }

      if (!Number.isInteger(prize?.rank) || prize.rank < 1 || prize.rank > 100) {
        err(errors, 'prizes', 'each prize needs a rank from 1 to 100');
      }
      if (!['cash', 'non_cash'].includes(prize?.kind)) err(errors, 'prizes', 'each prize is cash or non_cash');
      if (prize?.kind === 'cash'
        && (!Number.isInteger(prize.value_msat) || prize.value_msat <= 0)) {
        err(errors, 'prizes', 'a cash prize needs a value in millisatoshis');
      }

      // With more than one division, "first place" is ambiguous until it says
      // first place *of what*.
      if (multiDivision) {
        if (!prize?.division) {
          err(errors, 'prizes', 'with several divisions each prize needs a division');
        } else if (!divisionIds.has(prize.division)) {
          err(errors, 'prizes', `prize division "${prize.division}" is not a division of this competition`);
        }
      } else if (prize?.division && !divisionIds.has(prize.division)) {
        err(errors, 'prizes', `prize division "${prize.division}" is not a division of this competition`);
      }

      // Two prizes for one place would entitle two people to one payment.
      const slot = `${prize?.division || ''}#${prize?.rank}`;
      if (slots.has(slot)) {
        err(errors, 'prizes', 'two prizes cannot be for the same place in the same division');
      }
      slots.add(slot);
    }
  }

  if (config.prize_claim_days !== undefined
    && (!Number.isInteger(config.prize_claim_days)
      || config.prize_claim_days < 1 || config.prize_claim_days > 365)) {
    err(errors, 'prize_claim_days', 'must be a whole number of days from 1 to 365');
  }

  if (!Array.isArray(config.relays) || config.relays.length < 1 || config.relays.length > 8) {
    err(errors, 'relays', 'must list between 1 and 8 relays');
  } else if (config.relays.some((r) => !isAllowedRelayUrl(r))) {
    // See relay-url.mjs: wss:// anywhere, ws:// only for loopback.
    err(errors, 'relays', 'must all be wss:// URLs (ws:// only for localhost)');
  }

  return { ok: errors.length === 0, errors };
}

// ── builders (unsigned events) ──

function baseTags(dTag, type, alt) {
  return [
    ['d', dTag],
    ['L', NAMESPACE],
    ['l', type, NAMESPACE],
    ['cc-schema', SCHEMA],
    ['alt', alt],
  ];
}

export function buildCompetitionEvent(config, createdAt) {
  const validation = validateCompetitionConfig(config);
  if (!validation.ok) {
    throw new Error(`invalid competition: ${validation.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
  }
  const payload = { v: SCHEMA_MAJOR, type: 'competition', ...config };
  const tags = baseTags(
    compDTag(config.comp_id),
    'competition',
    `CruxCoach competition: ${config.title}`,
  );
  tags.push(['status', config.status]);
  tags.push(['visibility', config.visibility]);
  tags.push(['board_brand', config.board.brand]);
  if (Number.isInteger(config.starts_at)) tags.push(['starts', String(config.starts_at)]);
  if (Number.isInteger(config.ends_at)) tags.push(['ends', String(config.ends_at)]);
  tags.push(['authority', config.authority]);
  tags.push(['p', config.authority]);
  // An unlisted competition must not be findable by hashtag — that is the
  // entire difference between "unlisted" and "public" at the relay layer.
  if (config.visibility === 'public') {
    tags.push(['t', 'cruxcoach-competition']);
    tags.push(['t', 'climbing']);
  }
  return { kind: KIND, created_at: createdAt, tags, content: ccj(payload) };
}

/**
 * Replace the readable addressable definition even on relays that ignore
 * NIP-09. It deliberately classifies as the competition coordinate but is not
 * a valid Competition config, so old clients fail closed instead of rendering
 * a deleted event.
 */
export function buildCompetitionTombstoneEvent({ compId, deletedAt }) {
  return {
    kind: KIND,
    created_at: deletedAt,
    tags: [
      ['d', compDTag(compId)],
      ['L', NAMESPACE],
      ['l', 'competition', NAMESPACE],
      ['cc-schema', SCHEMA],
      ['alt', 'Deleted CruxCoach competition'],
      ['status', 'deleted'],
    ],
    content: ccj({
      v: SCHEMA_MAJOR, type: 'competition', comp_id: compId,
      deleted: true, deleted_at: deletedAt,
    }),
  };
}

/** NIP-09 request for the concrete definition; the newer tombstone survives. */
export function buildCompetitionDeletionRequest({ definitionEventId, at }) {
  if (!isHex32(definitionEventId)) throw new Error('definition event id is invalid');
  return {
    kind: 5,
    created_at: at,
    tags: [['e', definitionEventId], ['k', String(KIND)]],
    content: 'CruxCoach test competition cleanup',
  };
}

export function buildLogEvent({ compId, organizerPubkey, seq, prev, epoch, op, data, reason, at, actor = 'authority', subjects = [] }) {
  if (!LOG_OPS.includes(op)) throw new Error(`unknown log op ${op}`);
  if (REASON_REQUIRED_OPS.has(op) && !reason) throw new Error(`op ${op} requires a reason`);
  const payload = { v: SCHEMA_MAJOR, type: 'log', comp_id: compId, seq, prev, epoch, at, op, actor, data };
  if (reason) payload.reason = reason;
  const tags = baseTags(logDTag(compId, seq), 'log', `CruxCoach competition log entry ${seq}: ${op}`);
  tags.push(['a', competitionAddress(organizerPubkey, compId)]);
  tags.push(['seq', String(seq)]);
  tags.push(['prev', prev]);
  tags.push(['op', op]);
  tags.push(['epoch', String(epoch)]);
  for (const subject of subjects) tags.push(['p', subject]);
  return { kind: KIND, created_at: at, tags, content: ccj(payload) };
}

export function buildIntentEvent({ compId, organizerPubkey, authority, pubkey, nonce, op, data, at, expiration }) {
  if (!INTENT_OPS.includes(op)) throw new Error(`unknown intent op ${op}`);
  const payload = { v: SCHEMA_MAJOR, type: 'intent', comp_id: compId, op, at, nonce, data };
  const tags = baseTags(intentDTag(compId, pubkey, nonce), 'intent', `CruxCoach competition request: ${op}`);
  tags.push(['a', competitionAddress(organizerPubkey, compId)]);
  tags.push(['p', authority]);
  tags.push(['op', op]);
  if (Number.isInteger(expiration)) tags.push(['expiration', String(expiration)]);
  return { kind: KIND, created_at: at, tags, content: ccj(payload) };
}

export function buildSnapshotEvent({ compId, organizerPubkey, seq, epoch, head, stateHash, state, at }) {
  const payload = {
    v: SCHEMA_MAJOR, type: 'snapshot', comp_id: compId, seq, epoch,
    head, state_hash: stateHash, state,
  };
  const tags = baseTags(snapDTag(compId, seq), 'snapshot', `CruxCoach competition state snapshot at entry ${seq}`);
  tags.push(['a', competitionAddress(organizerPubkey, compId)]);
  tags.push(['seq', String(seq)]);
  tags.push(['epoch', String(epoch)]);
  return { kind: KIND, created_at: at, tags, content: ccj(payload) };
}

export function buildResultsEvent({ compId, organizerPubkey, finalSeq, head, stateHash, rulesetHash, standings, at }) {
  const payload = {
    v: SCHEMA_MAJOR, type: 'results', comp_id: compId,
    final_seq: finalSeq, head, state_hash: stateHash, ruleset_hash: rulesetHash,
    standings, published_at: at,
  };
  const tags = baseTags(resultsDTag(compId), 'results', 'CruxCoach competition final results');
  tags.push(['a', competitionAddress(organizerPubkey, compId)]);
  tags.push(['seq', String(finalSeq)]);
  return { kind: KIND, created_at: at, tags, content: ccj(payload) };
}

// ── parsing ──

function parsePayload(event) {
  if (event.content.length > MAX_EVENT_BYTES) return null;
  try {
    const payload = JSON.parse(event.content);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Envelope gate (§2.3). Everything downstream may assume these hold.
 * Signature/id verification is the caller's job and must have happened first —
 * this function deliberately does not take a "trust me" flag.
 *
 * @returns {{ ok: true, type: string, dTag: object, payload: object } | { ok: false, error: string }}
 */
export function classifyEvent(event, nowSeconds) {
  if (!event || event.kind !== KIND) return { ok: false, error: 'wrong kind' };
  if (!tagValues(event, 'L').includes(NAMESPACE)) return { ok: false, error: 'not a competition namespace' };
  const schema = tagValue(event, 'cc-schema');
  if (typeof schema !== 'string') return { ok: false, error: 'missing cc-schema tag' };
  const major = Number(schema.split('/')[1]);
  if (schema.split('/')[0] !== 'cruxcoach-competition' || !Number.isInteger(major)) {
    return { ok: false, error: `unreadable schema tag "${schema}"` };
  }
  if (major !== SCHEMA_MAJOR) {
    return { ok: false, error: `schema version ${major} needs a newer CruxCoach`, needsUpgrade: true };
  }
  if (Number.isInteger(nowSeconds) && event.created_at > nowSeconds + MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, error: 'created_at is too far in the future' };
  }
  const dTag = parseDTag(tagValue(event, 'd'));
  if (!dTag) return { ok: false, error: 'malformed d tag' };
  const labelled = (event.tags.find((t) => t[0] === 'l' && t[2] === NAMESPACE) || [])[1];
  if (labelled !== dTag.kind) {
    return { ok: false, error: `label "${labelled}" does not match d-tag shape "${dTag.kind}"` };
  }
  const payload = parsePayload(event);
  if (!payload) return { ok: false, error: 'content is not a JSON object' };
  if (payload.v !== SCHEMA_MAJOR) return { ok: false, error: 'payload version mismatch' };
  if (payload.type !== dTag.kind) return { ok: false, error: 'payload type does not match d-tag' };
  if (payload.comp_id !== undefined && payload.comp_id !== dTag.compId) {
    return { ok: false, error: 'payload comp_id does not match d-tag' };
  }
  return { ok: true, type: dTag.kind, dTag, payload };
}

/** Parse and fully validate a competition definition event. */
export function parseCompetitionEvent(event, nowSeconds) {
  const classified = classifyEvent(event, nowSeconds);
  if (!classified.ok) return classified;
  if (classified.type !== 'competition') return { ok: false, error: 'not a competition definition' };
  const { v, type, ...config } = classified.payload;
  const validation = validateCompetitionConfig(config);
  if (!validation.ok) {
    return { ok: false, error: `invalid competition: ${validation.errors[0].field} ${validation.errors[0].message}` };
  }
  return {
    ok: true,
    competition: config,
    organizerPubkey: event.pubkey,
    eventId: event.id,
    address: competitionAddress(event.pubkey, config.comp_id),
  };
}

/**
 * Parse a log entry and bind it to its competition. The binding is the whole
 * point: an entry that is well-formed but signed by someone who is not the
 * authority, or that points at a different competition, is not a log entry —
 * it is someone else's event that happens to look like one.
 */
export function parseLogEvent(event, competition, organizerPubkey, nowSeconds) {
  const classified = classifyEvent(event, nowSeconds);
  if (!classified.ok) return classified;
  if (classified.type !== 'log') return { ok: false, error: 'not a log entry' };
  if (event.pubkey !== competition.authority) {
    return { ok: false, error: 'not signed by the competition authority' };
  }
  if (tagValue(event, 'a') !== competitionAddress(organizerPubkey, competition.comp_id)) {
    return { ok: false, error: 'a-tag does not reference this competition' };
  }
  const payload = classified.payload;
  if (payload.seq !== classified.dTag.seq) return { ok: false, error: 'seq does not match d-tag' };
  if (!Number.isInteger(payload.seq) || payload.seq < 1) return { ok: false, error: 'seq must be a positive integer' };
  if (!isHex32(payload.prev)) return { ok: false, error: 'prev is not an event id' };
  if (!LOG_OPS.includes(payload.op)) {
    return { ok: false, error: `unknown operation "${payload.op}"`, needsUpgrade: true };
  }
  if (REASON_REQUIRED_OPS.has(payload.op) && !payload.reason) {
    return { ok: false, error: `operation "${payload.op}" is missing its mandatory reason` };
  }
  if (!payload.data || typeof payload.data !== 'object') return { ok: false, error: 'data is missing' };
  if (!Number.isInteger(payload.epoch) || payload.epoch < 1) return { ok: false, error: 'epoch is missing' };
  return { ok: true, entry: payload, eventId: event.id, createdAt: event.created_at };
}

export function parseIntentEvent(event, competition, organizerPubkey, nowSeconds) {
  const classified = classifyEvent(event, nowSeconds);
  if (!classified.ok) return classified;
  if (classified.type !== 'intent') return { ok: false, error: 'not an intent' };
  if (event.pubkey.slice(0, 8) !== classified.dTag.pubkeyPrefix) {
    return { ok: false, error: 'd-tag does not match the signer' };
  }
  if (tagValue(event, 'a') !== competitionAddress(organizerPubkey, competition.comp_id)) {
    return { ok: false, error: 'a-tag does not reference this competition' };
  }
  const payload = classified.payload;
  if (!INTENT_OPS.includes(payload.op)) {
    return { ok: false, error: `unknown request "${payload.op}"`, needsUpgrade: true };
  }
  if (payload.op === 'climb_choice') {
    const climbId = payload.data?.climb_id;
    if (competition.rules.climb_source !== 'participant_choice') {
      return { ok: false, error: 'climb choice is not enabled for this competition' };
    }
    if (!(competition.climb_pool?.options || []).some((climb) => climb.id === climbId)) {
      return { ok: false, error: 'climb choice is not in the competition pool' };
    }
  }
  if (payload.nonce !== classified.dTag.nonce) return { ok: false, error: 'nonce does not match d-tag' };
  return { ok: true, intent: payload, pubkey: event.pubkey, eventId: event.id, createdAt: event.created_at };
}
