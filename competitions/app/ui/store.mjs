/**
 * The live view of one competition.
 *
 * Fetches the definition, follows the authority log, reduces, and tells the
 * page when the state changed. Every screen — organizer, participant, projector
 * — reads from this, so the three can never disagree about what is happening.
 *
 * DOM-free, so it is exercised by `node --test` against the loopback relay
 * rather than by clicking.
 */
import { verifyEvent } from '../protocol/nostr-event.mjs';
import {
  KIND, NAMESPACE, competitionAddress, competitionRunning, compDTag,
  parseCompetitionEvent, parseLogEvent,
} from '../protocol/competition.mjs?v=20260813-2';
import { hashableState, reduce } from '../protocol/reduce.mjs';
import { computeStandings } from '../protocol/scoring.mjs?v=20260813-1';
import { ccjHash } from '../protocol/ccj.mjs';
import { usesDevelopmentRelay } from '../protocol/relay-url.mjs';

export class CompetitionStore {
  /**
   * @param {object} options
   * @param {import('../protocol/relay-pool.mjs').RelayPool} options.pool
   * @param {string} options.organizerPubkey
   * @param {string} options.compId
   * @param {() => number} [options.now] epoch seconds
   */
  constructor({ pool, organizerPubkey, compId, now }) {
    this.pool = pool;
    this.organizerPubkey = organizerPubkey;
    this.compId = compId;
    this.now = now || (() => Math.floor(Date.now() / 1000));
    this.address = competitionAddress(organizerPubkey, compId);

    this.competition = null;
    /** Immutable signed chain root; `competition` is the effective live config. */
    this.definitionCompetition = null;
    this.competitionEventId = null;
    /** @type {Map<string, {entry: object, eventId: string, createdAt: number}>} */
    this.entries = new Map();
    this.state = null;
    this.standings = [];
    this.stateHash = null;
    this.chainBreakAt = null;
    this.problems = [];
    this.listeners = new Set();
    this.subscriptions = [];
    this.reducing = false;
    this.dirty = false;
    /** Local transport freshness only; never part of the reduced/event state. */
    this.lastSyncedAt = 0;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  snapshot() {
    return {
      competition: this.competition,
      competitionEventId: this.competitionEventId,
      state: this.state,
      standings: this.standings,
      stateHash: this.stateHash,
      chainBreakAt: this.chainBreakAt,
      problems: [...this.problems],
      developmentRelay: usesDevelopmentRelay(this.pool.urls),
      entryCount: this.entries.size,
      connectedRelays: this.pool.connectedUrls.length,
      relayCount: this.pool.urls.length,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  /**
   * Every accepted log entry, in sequence order.
   *
   * The organizer console needs this to know which decisions it has already
   * published: a denied claim changes no state, so without a way to see the
   * decision already in the log the console would republish the same refusal
   * on every render.
   */
  logEntries() {
    return [...this.entries.values()]
      .map((parsed) => parsed.entry)
      .sort((a, b) => a.seq - b.seq);
  }

  note(problem) {
    // Kept and surfaced rather than logged and forgotten: "some events were
    // dropped" is exactly the situation a competition screen must not hide.
    if (!this.problems.includes(problem)) this.problems.push(problem);
  }

  /**
   * Fetch the definition. Resolves to `{ ok, error, needsUpgrade }`.
   *
   * A definition that never arrives is reported rather than retried forever:
   * "loading…" that never ends is indistinguishable from a broken link.
   */
  async loadCompetition({ timeoutMs = 8000 } = {}) {
    const { events, complete } = await this.pool.query([{
      kinds: [KIND],
      authors: [this.organizerPubkey],
      '#d': [compDTag(this.compId)],
      limit: 1,
    }], { timeoutMs });

    if (events.length === 0) {
      return { ok: false, error: complete ? 'not_found' : 'unreachable' };
    }
    // Newest wins, never first-answer: a relay that missed the last edit still
    // answers, and answering first does not make it current.
    const newest = events.reduce((best, e) => (e.created_at > best.created_at ? e : best));
    if (!(await verifyEvent(newest).catch(() => false))) return { ok: false, error: 'invalid_signature' };

    const parsed = parseCompetitionEvent(newest, this.now());
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, needsUpgrade: Boolean(parsed.needsUpgrade) };
    }
    this.definitionCompetition = parsed.competition;
    this.competition = parsed.competition;
    this.competitionEventId = newest.id;
    this.lastSyncedAt = this.now();
    await this.recompute();
    return { ok: true, competition: parsed.competition };
  }

  /** Ingest one candidate log event. Returns true when it was accepted. */
  async ingest(event) {
    if (!this.competition) return false;
    if (this.entries.has(event.id)) return true;
    let valid = false;
    try {
      valid = await verifyEvent(event);
    } catch {
      valid = false;
    }
    if (!valid) {
      this.note('rejected_signature');
      return false;
    }
    const parsed = parseLogEvent(event, this.competition, this.organizerPubkey, this.now());
    if (!parsed.ok) {
      this.note(parsed.needsUpgrade ? 'needs_upgrade' : 'rejected_entry');
      return false;
    }
    this.entries.set(event.id, parsed);
    this.lastSyncedAt = this.now();
    return true;
  }

  /** Relay transport changed. Screens may update a local offline hint. */
  connectionChanged() {
    this.emit();
  }

  /** Re-reduce and notify. Coalesces bursts so a backfill re-renders once. */
  async recompute() {
    if (this.reducing) { this.dirty = true; return; }
    this.reducing = true;
    try {
      do {
        this.dirty = false;
        const { state, chainBreakAt } = reduce({
          competition: this.definitionCompetition,
          competitionEventId: this.competitionEventId,
          entries: [...this.entries.values()],
        });
        this.state = state;
        this.competition = state.effective_config || this.definitionCompetition;
        this.chainBreakAt = chainBreakAt;
        this.standings = computeStandings(state, this.competition);
        // eslint-disable-next-line no-await-in-loop
        this.stateHash = await ccjHash(hashableState(state));
      } while (this.dirty);
    } finally {
      this.reducing = false;
    }
    this.emit();
  }

  /**
   * Follow the log: everything already published, then everything new.
   *
   * One subscription, not one per page section — 20 concurrent subscriptions is
   * the tightest relay budget observed, and a page that opens several
   * competitions would blow through it.
   */
  async follow() {
    if (!this.competition) throw new Error('load the competition first');
    let pendingBatch = false;
    const scheduleRecompute = () => {
      if (pendingBatch) return;
      pendingBatch = true;
      queueMicrotask(async () => {
        pendingBatch = false;
        await this.recompute();
      });
    };

    const subscription = this.pool.subscribe([{
      kinds: [KIND],
      authors: [this.competition.authority],
      '#a': [this.address],
    }], {
      onEvent: async (event) => {
        if (await this.ingest(event)) scheduleRecompute();
      },
      onEose: () => scheduleRecompute(),
    });
    this.subscriptions.push(subscription);
    await subscription.ready;
    return subscription;
  }

  /** Participant intents addressed to the authority — the organizer console needs these. */
  async followIntents(onIntent) {
    const subscription = this.pool.subscribe([{
      kinds: [KIND],
      '#a': [this.address],
      '#p': [this.competition.authority],
    }], { onEvent: onIntent });
    this.subscriptions.push(subscription);
    await subscription.ready;
    return subscription;
  }

  close() {
    for (const subscription of this.subscriptions) subscription.close();
    this.subscriptions = [];
    this.listeners.clear();
  }

  // ── convenience views for the screens ──

  participant(pubkey) {
    return this.state?.participants.find((p) => p.pubkey === pubkey) || null;
  }

  /** Whose turn it is right now, or null. */
  currentClimber() {
    if (!this.state || this.state.cursor < 0) return null;
    return this.state.order[this.state.cursor] || null;
  }

  nextClimber() {
    if (!this.state || this.state.cursor < 0) return null;
    return this.state.order[this.state.cursor + 1] || null;
  }

  /** How many climbers are ahead of `pubkey` in this round, or null. */
  climbersBefore(pubkey) {
    if (!this.state) return null;
    const index = this.state.order.indexOf(pubkey);
    if (index === -1) return null;
    const cursor = this.state.cursor < 0 ? 0 : this.state.cursor;
    return Math.max(0, index - cursor);
  }

  attemptsLeft(pubkey, climbId) {
    if (!this.state || !this.competition) return 0;
    const participant = this.participant(pubkey);
    if (!participant) return 0;
    const record = participant.climbs.find((c) => c.climb_id === climbId);
    const used = record ? record.attempts_used : 0;
    if (record?.outcome === 'top') return 0;
    return Math.max(0, this.competition.rules.attempts_per_climb - used);
  }

  defersLeft(pubkey) {
    if (!this.state || !this.competition) return 0;
    const participant = this.participant(pubkey);
    if (!participant) return 0;
    return Math.max(0, this.competition.rules.defer_budget_per_round - participant.defers_used_this_round);
  }

  /**
   * Whether a defer button should exist at all.
   *
   * The control is absent rather than present-and-disabled when it cannot be
   * used: a disabled button that never explains itself is a worse answer than
   * no button plus a sentence.
   */
  canDefer(pubkey) {
    if (!this.state || !competitionRunning(this.competition, this.state.status, this.now())) return false;
    if (this.currentClimber() !== pubkey) return false;
    const participant = this.participant(pubkey);
    if (!participant) return false;
    return this.defersLeft(pubkey) > 0
      && participant.consecutive_defers < this.competition.rules.max_consecutive_defers;
  }

  /**
   * Whether this climber may act right now.
   *
   * Every condition the reducer would apply to their next attempt, checked
   * before a control is drawn — an attempt the reducer is going to reject is
   * worse than no button, because the climber believes it counted.
   */
  mayAct(pubkey, nowSeconds = this.now()) {
    if (!this.state || !this.competition) return false;
    if (!competitionRunning(this.competition, this.state.status, nowSeconds) || this.state.paused) return false;
    if (this.currentClimber() !== pubkey) return false;
    const participant = this.participant(pubkey);
    if (!participant) return false;
    if (participant.registration !== 'accepted') return false;
    if (participant.checkin !== 'checked_in') return false;
    if (participant.result !== 'active') return false;
    if (this.competition.fee_msat > 0 && participant.payment !== 'settled') return false;
    const rest = this.competition.rules.min_rest_sec || 0;
    if (rest > 0 && participant.last_attempt_at > 0
      && nowSeconds - participant.last_attempt_at < rest) {
      return false;
    }
    return true;
  }

  /**
   * The climbs this person may still attempt, with what is left on each.
   *
   * Participant-choice entrants may try the whole pool. Scoring later keeps
   * only their best N results.
   */
  remainingClimbs(pubkey) {
    if (!this.state || !this.competition) return [];
    const participant = this.participant(pubkey);
    if (!participant) return [];
    const source = this.competition.rules.climb_source === 'participant_choice'
      ? (this.competition.climb_pool?.options || []).filter((climb) =>
        this.competition.rules.selection_uniqueness !== 'unique_per_competition'
          || participant.selections.includes(climb.id))
      : (this.competition.climbs || []);
    return source
      .map((climb) => ({
        id: climb.id,
        label: climb.label || climb.id,
        angle: climb.angle,
        attemptsLeft: this.attemptsLeft(pubkey, climb.id),
        outcome: participant.climbs.find((c) => c.climb_id === climb.id)?.outcome || 'none',
      }))
      .filter((climb) => climb.attemptsLeft > 0);
  }

  /** Seconds left on the open turn, or null when no turn is open. */
  secondsToDeadline(nowSeconds = this.now()) {
    if (!this.state || this.state.cursor < 0 || !this.state.turn_deadline_at) return null;
    return Math.max(0, this.state.turn_deadline_at - nowSeconds);
  }

  /** True when the reduced state can be trusted enough to show standings. */
  get trustworthy() {
    return Boolean(this.state) && this.state.chain_complete && !this.state.fork_detected;
  }
}

export const NAMESPACE_TAG = NAMESPACE;
