/**
 * Publishing side: the authority's log entries and a participant's intents.
 *
 * The split matters. A participant publishes *intents* — requests. Only the
 * authority publishes *decisions*, and only decisions become state. Code that
 * blurs the two produces a screen showing someone as registered because they
 * asked to be.
 */
import { finalizeEvent } from './protocol/nostr-event.mjs';
import {
  buildCompetitionDeletionRequest, buildCompetitionEvent,
  buildCompetitionTombstoneEvent, buildIntentEvent, buildLogEvent,
  buildResultsEvent, buildSnapshotEvent, configPatchImpact, newNonce, parseIntentEvent,
} from './protocol/competition.mjs?v=20260814-6';
import { applyEntry, hashableState } from './protocol/reduce.mjs?v=20260814-4';
import { ccj, ccjHash } from './protocol/ccj.mjs';

/** How often the authority publishes a state snapshot (FEAT-058 §6.3). */
export const SNAPSHOT_EVERY = 25;

const LIFECYCLE_OPS = new Set(['lifecycle']);

export class PublishError extends Error {
  constructor(message, { attempted, accepted, results }) {
    super(message);
    this.name = 'PublishError';
    this.attempted = attempted;
    this.accepted = accepted;
    this.results = results;
  }
}

/**
 * Sign and publish, and treat "no relay took it" as the failure it is.
 *
 * A publish that no relay accepted has not happened. Reporting it as success
 * is how an organizer ends up believing they opened registration while every
 * entrant sees a competition that never opened.
 */
export async function signAndPublish(pool, signer, draft) {
  const event = await signer.signEvent(draft);
  const result = await pool.publish(event);
  if (result.accepted === 0) {
    throw new PublishError('No relay accepted the event.', result);
  }
  return { event, ...result };
}

/**
 * The authority's writer.
 *
 * `seq` and `prev` come from the store's reduced head, never from a local
 * counter: a local counter and a relay that dropped an entry disagree, and the
 * chain is what makes that disagreement visible instead of silent.
 */
export class AuthorityWriter {
  /**
   * @param {object} options
   * @param {import('./ui/store.mjs').CompetitionStore} options.store
   * @param {import('./protocol/relay-pool.mjs').RelayPool} options.pool
   * @param {{pubkey: string, signEvent: Function}} options.signer
   * @param {() => number} [options.now]
   */
  constructor({ store, pool, signer, now }) {
    this.store = store;
    this.pool = pool;
    this.signer = signer;
    this.now = now || (() => Math.floor(Date.now() / 1000));
    this.entriesSinceSnapshot = 0;
    /** Serialises writes: two entries racing for the same seq is a self-inflicted fork. */
    this.queue = Promise.resolve();
  }

  get competition() {
    return this.store.competition;
  }

  assertAuthorised() {
    if (!this.competition) throw new Error('The competition has not loaded yet.');
    if (this.signer.pubkey !== this.competition.authority) {
      throw new Error('You are not the authority for this competition.');
    }
  }

  /**
   * Append one log entry.
   *
   * Serialised through a promise chain because two entries built from the same
   * head would claim the same `seq` — which every client would then correctly
   * report as a fork, caused entirely by us.
   */
  append(op, data, { reason, subjects = [], actor = 'authority', validate } = {}) {
    const run = async () => {
      this.assertAuthorised();
      const state = this.store.state;
      if (!state) throw new Error('The competition state has not been reduced yet.');
      if (!this.store.trustworthy) {
        // A locally contiguous prefix is not enough: an unfinished multi-relay
        // backfill may still reveal its next entry or a fork. Extending that
        // prefix would turn uncertain transport history into a permanent fork.
        throw new Error('The complete, conflict-free relay record is required before writing.');
      }
      const resolvedData = typeof data === 'function' ? data(state) : data;
      if (validate) validate(state, resolvedData);

      const draft = buildLogEvent({
        compId: this.competition.comp_id,
        organizerPubkey: this.store.organizerPubkey,
        seq: state.seq + 1,
        prev: state.head,
        epoch: state.epoch,
        op,
        data: resolvedData,
        reason,
        at: this.now(),
        actor,
        subjects,
      });
      const published = await signAndPublish(this.pool, this.signer, draft);

      // Apply our own event immediately rather than waiting for the relay echo:
      // the console must not appear frozen for a round trip, and ingest is
      // idempotent so the echo changes nothing.
      await this.store.ingest(published.event);
      await this.store.recompute();

      this.entriesSinceSnapshot += 1;
      if (this.entriesSinceSnapshot >= SNAPSHOT_EVERY || LIFECYCLE_OPS.has(op)) {
        await this.publishSnapshot().catch(() => {
          // A snapshot is an optimisation. Failing to publish one must not
          // fail the decision that just succeeded.
        });
      }
      return published;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async publishSnapshot() {
    const state = this.store.state;
    if (!state || state.seq === 0) return null;
    const hashable = hashableState(state);
    const draft = buildSnapshotEvent({
      compId: this.competition.comp_id,
      organizerPubkey: this.store.organizerPubkey,
      seq: state.seq,
      epoch: state.epoch,
      head: state.head,
      stateHash: await ccjHash(hashable),
      state: hashable,
      at: this.now(),
    });
    this.entriesSinceSnapshot = 0;
    return signAndPublish(this.pool, this.signer, draft);
  }

  /**
   * Publish the final, immutable results.
   *
   * Refused while the record is incomplete or forked: a final standing computed
   * from a record we know is wrong is worse than no final standing.
   */
  async publishResults() {
    this.assertAuthorised();
    const state = this.store.state;
    if (!state) throw new Error('The competition state has not been reduced yet.');
    if (state.status !== 'finished') throw new Error('Finish the competition before publishing results.');
    if (!this.store.trustworthy) {
      throw new Error('The complete, conflict-free relay record is required before publishing results.');
    }

    const draft = buildResultsEvent({
      compId: this.competition.comp_id,
      organizerPubkey: this.store.organizerPubkey,
      finalSeq: state.seq,
      head: state.head,
      stateHash: await ccjHash(hashableState(state)),
      rulesetHash: await ccjHash(this.competition.rules),
      standings: this.store.standings.map((row) => ({
        rank: row.rank,
        pubkey: row.pubkey,
        display: row.display,
        division: row.division,
        tops: row.tops,
        zones: row.zones,
        attempts: row.attempts,
        points: row.points,
        finished_at: row.finished_at,
      })),
      at: this.now(),
    });
    return signAndPublish(this.pool, this.signer, draft);
  }

  /**
   * Best-effort relay cleanup after cancellation.
   *
   * Relay OK means that the marker/request was accepted, never that every
   * physical copy disappeared. Both result sets stay visible to the host UI so
   * it can offer retry without claiming stronger guarantees than NIP-09 gives.
   */
  async deleteCompetition() {
    this.assertAuthorised();
    if (this.store.state?.status !== 'cancelled') {
      throw new Error('Cancel the competition before requesting relay deletion.');
    }
    const definitionEventId = this.store.competitionEventId;
    if (!definitionEventId) throw new Error('The competition definition id is missing.');
    const at = this.now();
    const tombstoneEvent = await this.signer.signEvent(buildCompetitionTombstoneEvent({
      compId: this.competition.comp_id,
      deletedAt: at,
    }));
    const tombstone = await this.pool.publish(tombstoneEvent);
    const deletionEvent = await this.signer.signEvent(buildCompetitionDeletionRequest({
      definitionEventId,
      at: Math.max(at, this.now()),
    }));
    const deletion = await this.pool.publish(deletionEvent);
    return { tombstone, deletion };
  }

  // ── named operations, so screens never hand-build a `data` object ──

  setStatus(status) {
    return this.append('lifecycle', { status, at: this.now() });
  }

  decideRegistration(pubkey, decision, {
    division, display, waitlistPosition, reason, intentId,
  } = {}) {
    const data = { pubkey, decision };
    if (division !== undefined) data.division = division;
    if (display !== undefined) data.display = display;
    if (waitlistPosition !== undefined) data.waitlist_position = waitlistPosition;
    if (intentId) data.intent_id = intentId;
    return this.append('registration_decision', data, { reason, subjects: [pubkey] });
  }

  decidePayment(pubkey, state, { zapReceiptId, amountMsat, zapperPubkey } = {}) {
    const data = { pubkey, state };
    if (zapReceiptId) data.zap_receipt_id = zapReceiptId;
    if (Number.isInteger(amountMsat)) data.amount_msat = amountMsat;
    // Recorded so the audit trail stays checkable after the organizer rotates
    // their Lightning address.
    if (zapperPubkey) data.zapper_pubkey = zapperPubkey;
    return this.append('payment_decision', data, { subjects: [pubkey] });
  }

  /**
   * A prize's public status.
   *
   * Carries no payout detail on purpose — the destination stayed encrypted
   * between the winner and this console, and putting it here would publish it
   * next to their name for good.
   */
  decidePrize(prizeId, pubkey, state, reason) {
    const data = { prize_id: prizeId, state };
    if (pubkey) data.pubkey = pubkey;
    return this.append('prize_decision', data, { reason, subjects: pubkey ? [pubkey] : [] });
  }

  decideClaim(pubkey, climbId, decision, reason) {
    return this.append('claim_decision', { pubkey, climb_id: climbId, decision, reason }, { subjects: [pubkey] });
  }

  checkIn(pubkey, state = 'checked_in', intentId) {
    const data = { pubkey, state };
    if (intentId) data.intent_id = intentId;
    return this.append('checkin', data, { subjects: [pubkey] });
  }

  seed(order) {
    return this.append('queue', { action: 'seed', order });
  }

  /** Establish the deterministic order and open its first eligible turn. */
  seedAndOpen(order) {
    return this.append('queue', { action: 'seed_open', order });
  }

  openTurn(index) {
    return this.append('queue', { action: 'open_turn', index });
  }

  closeTurn() {
    return this.append('queue', { action: 'close_turn' });
  }

  advance() {
    return this.append('queue', { action: 'advance' });
  }

  skipTurn() {
    return this.append('queue', { action: 'skip_turn' });
  }

  nextClimb(climbId) {
    return this.append('queue', { action: 'next_climb', climb_id: climbId });
  }

  nextRound() {
    return this.append('queue', { action: 'next_round' });
  }

  decideDefer(pubkey, decision, reason, intentId) {
    const data = { pubkey, decision, reason };
    if (intentId) data.intent_id = intentId;
    return this.append('defer_decision', data, { subjects: [pubkey] });
  }

  recordAttempt(pubkey, climbId, outcome, attemptNo, intentId) {
    const data = {
      pubkey, climb_id: climbId, outcome, attempt_no: attemptNo,
    };
    if (intentId) data.intent_id = intentId;
    return this.append('attempt_result', data, { subjects: [pubkey] });
  }

  /** Record the open climber's attempt and open the next eligible turn atomically. */
  completeTurn(pubkey, climbId, outcome, attemptNo, intentId) {
    const data = {
      pubkey, climb_id: climbId, outcome, attempt_no: attemptNo,
    };
    if (intentId) data.intent_id = intentId;
    return this.append('complete_turn', data, {
      subjects: [pubkey],
      validate: (state, resolvedData) => {
        const candidate = structuredClone(state);
        const before = candidate.rejected.length;
        applyEntry(candidate, {
          seq: state.seq + 1, epoch: state.epoch, at: this.now(), op: 'complete_turn', data: resolvedData,
        }, this.competition);
        if (candidate.rejected.length > before) {
          const error = new Error(candidate.rejected.at(-1).code);
          error.code = candidate.rejected.at(-1).code;
          throw error;
        }
      },
    });
  }

  announce(text) {
    return this.append('announcement', { text });
  }

  updateConfig(patch, reason) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new Error('A reason is required for every competition edit.');
    }
    const impact = configPatchImpact(patch);
    if (!impact) throw new Error('The configuration patch is empty or changes an immutable field.');
    return this.append('config_update', (state) => ({
      revision: state.config_revision + 1, patch, impact,
    }), {
      reason: reason.trim(),
      validate: (state, data) => {
        const candidate = structuredClone(state);
        const before = candidate.rejected.length;
        applyEntry(candidate, {
          seq: state.seq + 1, epoch: state.epoch, at: this.now(), op: 'config_update',
          reason: reason.trim(), data,
        }, this.competition);
        if (candidate.rejected.length > before) {
          const error = new Error(candidate.rejected.at(-1).code);
          error.code = candidate.rejected.at(-1).code;
          throw error;
        }
      },
    });
  }

  disqualify(pubkey, reason) {
    return this.append('disqualify', { pubkey }, { reason, subjects: [pubkey] });
  }

  retire(pubkey, reason) {
    return this.append('retire', { pubkey }, { reason, subjects: [pubkey] });
  }

  override(op, data, reason, subjects = []) {
    return this.append('override', { op, data }, { reason, subjects, actor: 'organizer_override' });
  }

  correct(supersedesSeq, replacement, reason, subjects = []) {
    return this.append('correction', { supersedes_seq: supersedesSeq, replacement }, { reason, subjects });
  }

  /**
   * The default seeding order (FEAT-058 §9.1): ascending by
   * `sha256(compId || pubkey)`. Advisory — the order that counts is the one in
   * the log — but reproducible, so any client can check it.
   */
  static async defaultOrder(compId, pubkeys) {
    const scored = [];
    for (const pubkey of pubkeys) {
      // eslint-disable-next-line no-await-in-loop
      scored.push({ pubkey, hash: await ccjHash({ k: `${compId}${pubkey}` }) });
    }
    scored.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
      || (a.pubkey < b.pubkey ? -1 : 1));
    return scored.map((s) => s.pubkey);
  }
}

/** Publish the competition definition itself (organizer-signed, not authority-signed). */
export async function publishCompetition(pool, signer, config, now = Math.floor(Date.now() / 1000)) {
  const draft = buildCompetitionEvent(config, now);
  return signAndPublish(pool, signer, draft);
}

/** A participant's request. Never state — the authority's answer is. */
export class EntrantWriter {
  constructor({ pool, signer, competition, organizerPubkey, now, storage }) {
    this.pool = pool;
    this.signer = signer;
    this.competition = competition;
    this.organizerPubkey = organizerPubkey;
    this.now = now || (() => Math.floor(Date.now() / 1000));
    /** Reused per intent lane so a retry replaces rather than duplicates. */
    this.nonces = new Map();
    this.storage = storage === undefined ? globalThis.localStorage : storage;
  }

  /**
   * A nonce per (competition, operation lane, signer), surviving a reload.
   *
   * Held in memory only, a refresh produced a fresh nonce — so registering
   * again added a *second* live request instead of replacing the first. On the
   * paid path that is worse than untidy: the zap request carries the
   * registration's nonce and the organizer checks a receipt against it, so a
   * nonce that changed would strand a payment already made.
   */
  nonceFor(scope) {
    const key = `cruxcoach:comp:nonce:${this.signer.pubkey.slice(0, 8)}:${this.competition.comp_id}:${scope}`;
    if (this.nonces.has(scope)) return this.nonces.get(scope);

    let nonce = null;
    try {
      nonce = this.storage?.getItem(key) || null;
    } catch {
      // Private mode, or storage disabled. In-memory is the fallback, and the
      // consequence is exactly the old behaviour rather than a failure.
    }
    if (!nonce) {
      nonce = newNonce();
      try {
        this.storage?.setItem(key, nonce);
      } catch { /* as above */ }
    }
    this.nonces.set(scope, nonce);
    return nonce;
  }

  send(op, data, { expiration, nonceScope = op } = {}) {
    const draft = buildIntentEvent({
      compId: this.competition.comp_id,
      organizerPubkey: this.organizerPubkey,
      authority: this.competition.authority,
      pubkey: this.signer.pubkey,
      nonce: this.nonceFor(nonceScope),
      op,
      data,
      at: this.now(),
      expiration,
    });
    return signAndPublish(this.pool, this.signer, draft);
  }

  register({ division, display, waiverAccepted, selections: _legacySelections }) {
    if (this.competition.waiver_required && !waiverAccepted) {
      throw new Error('You have to accept the terms before registering.');
    }
    const data = { division, display, waiver_accepted: Boolean(waiverAccepted) };
    return this.send('register', data);
  }

  withdraw() {
    return this.send('withdraw', {});
  }

  requestCheckIn() {
    return this.send('checkin_request', {});
  }

  /** Short-lived by nature, so it carries a NIP-40 expiration. */
  requestDefer(climbId, deadlineAt) {
    return this.send('defer_request', { climb_id: climbId }, { expiration: deadlineAt });
  }

  /** Prepare or replace the participant's next boulder choice. */
  chooseClimb(climbId) {
    return this.send('climb_choice', { climb_id: climbId });
  }

  reportAttempt(climbId, outcome, attemptNo) {
    return this.send('attempt_report', { climb_id: climbId, outcome, attempt_no: attemptNo });
  }

  /**
   * Ask for a prize.
   *
   * `ciphertext` is already NIP-44 encrypted to the organizer by the caller —
   * this writer never sees a payout destination in the clear, and neither does
   * any relay.
   */
  claimPrize(prizeId, ciphertext) {
    return this.send('prize_claim', { prize_id: prizeId, enc: ciphertext }, {
      nonceScope: `prize_claim:${prizeId}`,
    });
  }

  /**
   * Say the money arrived.
   *
   * The only evidence about a payout that comes from the side that was paid.
   * Optional by nature: a winner who never sends one is not evidence of
   * anything, and the organizer's screen says so rather than assuming.
   */
  acknowledgePrize(prizeId) {
    return this.send('prize_receipt', { prize_id: prizeId, received: true }, {
      nonceScope: `prize_receipt:${prizeId}`,
    });
  }

  claimPayment(zapReceiptId, bolt11) {
    const data = { zap_receipt_id: zapReceiptId };
    if (bolt11) data.bolt11 = bolt11;
    return this.send('payment_claim', data);
  }
}

export { parseIntentEvent, ccj };
