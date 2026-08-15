/** Restart-safe relay-cleanup jobs. Contains public signed events only. */
import { KIND, compDTag } from './protocol/competition.mjs?v=20260814-7';
import { verifyEvent } from './protocol/nostr-event.mjs';
import { isAllowedRelayUrl } from './protocol/relay-url.mjs';

const PREFIX = 'cruxcoach:competition-cleanup:v1:';

function key(ownerPubkey, compId) { return `${PREFIX}${ownerPubkey}:${compId}`; }

function validHex(value, size) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
}

/** Durable storage is a precondition: deletion must never outrun its retry job. */
export class CleanupJobStore {
  constructor(storage) {
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = globalThis.localStorage; } catch { this.storage = null; }
    }
  }

  save(job) {
    if (!this.storage) throw new Error('Durable cleanup storage is unavailable.');
    const encoded = JSON.stringify(job);
    const storageKey = key(job.owner_pubkey, job.comp_id);
    this.storage.setItem(storageKey, encoded);
    if (this.storage.getItem(storageKey) !== encoded) {
      throw new Error('The cleanup retry job could not be saved.');
    }
  }

  remove(job) { this.storage?.removeItem(key(job.owner_pubkey, job.comp_id)); }

  get(ownerPubkey, compId) {
    try {
      return JSON.parse(this.storage?.getItem(key(ownerPubkey, compId)) || 'null');
    } catch { return null; }
  }

  list(ownerPubkey) {
    if (!this.storage) return [];
    const prefix = `${PREFIX}${ownerPubkey}:`;
    const jobs = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const storageKey = this.storage.key(index);
      if (!storageKey?.startsWith(prefix)) continue;
      try { jobs.push(JSON.parse(this.storage.getItem(storageKey))); } catch { /* corrupt item stays inert */ }
    }
    return jobs.filter((job) => job && job.owner_pubkey === ownerPubkey);
  }
}

export function newCleanupJob({ ownerPubkey, compId, title, definitionEventId, relays,
  tombstoneEvent, deletionEvent, updatedAt }) {
  return {
    version: 1,
    owner_pubkey: ownerPubkey,
    comp_id: compId,
    title,
    definition_event_id: definitionEventId,
    relays: [...relays],
    tombstone_event: tombstoneEvent,
    deletion_event: deletionEvent,
    outcomes: { tombstone: [], deletion: [] },
    updated_at: updatedAt,
  };
}

/** Reject locally tampered jobs before they can make the browser publish anything. */
export async function validateCleanupJob(job) {
  if (!job || job.version !== 1 || !validHex(job.owner_pubkey, 64)
    || !validHex(job.comp_id, 16) || !validHex(job.definition_event_id, 64)
    || !Array.isArray(job.relays) || job.relays.length === 0
    || new Set(job.relays).size !== job.relays.length
    || job.relays.some((url) => !isAllowedRelayUrl(url))) return false;
  const tombstone = job.tombstone_event;
  const deletion = job.deletion_event;
  if (!(await verifyEvent(tombstone).catch(() => false))
    || !(await verifyEvent(deletion).catch(() => false))
    || tombstone.pubkey !== job.owner_pubkey || deletion.pubkey !== job.owner_pubkey
    || tombstone.kind !== KIND || deletion.kind !== 5
    || !tombstone.tags.some((tag) => tag[0] === 'd' && tag[1] === compDTag(job.comp_id))
    || !deletion.tags.some((tag) => tag[0] === 'e' && tag[1] === job.definition_event_id)
    || !deletion.tags.some((tag) => tag[0] === 'k' && tag[1] === String(KIND))) return false;
  try {
    const content = JSON.parse(tombstone.content);
    return content.deleted === true && content.comp_id === job.comp_id;
  } catch { return false; }
}

function everyRelayAccepted(relays, outcomes) {
  const accepted = new Set(outcomes.filter((result) => result.ok).map((result) => result.url));
  return relays.every((url) => accepted.has(url));
}

function mergeOutcomes(relays, previous = [], latest = []) {
  return relays.map((url) => {
    const old = previous.find((result) => result.url === url);
    const current = latest.find((result) => result.url === url);
    return old?.ok ? old : (current || old || { url, ok: false, reason: 'not attempted' });
  });
}

/**
 * Re-publishes the retained event bytes. A job completes only when every exact
 * signed relay acknowledges both artifacts in one or more attempts.
 */
export async function executeCleanupJob(job, pool, store, now = () => Math.floor(Date.now() / 1000)) {
  if (!(await validateCleanupJob(job))) throw new Error('The saved cleanup job is invalid.');
  store.save(job);
  const tombstone = await pool.publish(job.tombstone_event);
  job = {
    ...job,
    outcomes: {
      ...job.outcomes,
      tombstone: mergeOutcomes(job.relays, job.outcomes?.tombstone, tombstone.results),
    },
    updated_at: now(),
  };
  store.save(job);
  const deletion = await pool.publish(job.deletion_event);
  job = {
    ...job,
    outcomes: {
      ...job.outcomes,
      deletion: mergeOutcomes(job.relays, job.outcomes?.deletion, deletion.results),
    },
    updated_at: now(),
  };
  store.save(job);
  const complete = everyRelayAccepted(job.relays, job.outcomes.tombstone)
    && everyRelayAccepted(job.relays, job.outcomes.deletion);
  if (complete) store.remove(job);
  return { job, tombstone, deletion, complete };
}
