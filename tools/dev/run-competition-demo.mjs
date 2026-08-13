#!/usr/bin/env node
/**
 * Run a whole competition on a loopback relay, and leave it running.
 *
 * This is the thing the runbook tells a reviewer to start. It brings up the dev
 * relay, publishes a competition, registers two entrants, and then either drives
 * the competition to a finish or stops at a chosen point so the organizer,
 * participant and projector pages can be opened against live state.
 *
 *   node tools/dev/run-competition-demo.mjs                 # run to the finish and stay up
 *   node tools/dev/run-competition-demo.mjs --stop-at running
 *   node tools/dev/run-competition-demo.mjs --manual       # browser-driven, 3 entrants
 *   node tools/dev/run-competition-demo.mjs --port 7447 --dump /tmp/stream.jsonl
 *   node tools/dev/run-competition-demo.mjs --exit          # for CI: run and quit
 *
 * Nothing here touches a public relay or moves a satoshi. The relay refuses to
 * bind anything but loopback, and the only Lightning in the script is a fee of
 * zero.
 */
import { startDevRelay } from './relay.mjs';
import { RelayPool } from '../../competitions/app/protocol/relay-pool.mjs';
import { CompetitionStore } from '../../competitions/app/ui/store.mjs';
import { AuthorityWriter, EntrantWriter, publishCompetition } from '../../competitions/app/authority.mjs';
import { KeyVaultSession } from '../../competitions/app/signer/local-key.mjs';
import { createLocalSigner } from '../../competitions/app/signer/signers.mjs';
import { newCompId, compDTag, KIND, parseIntentEvent } from '../../competitions/app/protocol/competition.mjs';
import { naddrEncode, nsecEncode } from '../../competitions/app/protocol/nostr-event.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const STOP_POINTS = ['published', 'registration_open', 'checkin_open', 'running', 'finished'];
const stopAt = arg('stop-at', 'finished');
const manual = flag('manual');
if (!STOP_POINTS.includes(stopAt)) {
  console.error(`--stop-at must be one of: ${STOP_POINTS.join(', ')}`);
  process.exit(2);
}

const step = (message) => console.log(`\n▸ ${message}`);
const detail = (message) => console.log(`   ${message}`);

function newSigner(label) {
  const session = new KeyVaultSession({ storage: null });
  const { nsec } = session.generate();
  const signer = createLocalSigner(session);
  // Printed on purpose: these are throwaway keys for a loopback demo, and a
  // reviewer needs one to sign in as an entrant on the website.
  detail(`${label}: ${signer.pubkey.slice(0, 16)}…  nsec ${nsec}`);
  return signer;
}

const now = () => Math.floor(Date.now() / 1000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('CruxCoach competition demo — loopback only, no public relay, no payment.');

  const relay = await startDevRelay({
    port: Number(arg('port', '7447')),
    dumpPath: arg('dump', undefined),
    quiet: true,
  });
  step(`Development relay listening on ${relay.url}`);

  step('Test identities (throwaway, printed so you can sign in as them)');
  const organizer = newSigner('organizer');
  const alice = newSigner('alice   ');
  const bob = newSigner('bob     ');
  const carla = newSigner('carla   ');

  const compId = newCompId();
  const startsAt = now() + 900;
  const config = {
    comp_id: compId,
    authority: organizer.pubkey,
    authority_epoch: 1,
    title: 'Kellerwand Demo Session',
    summary: 'Two problems, three attempts each, three climbers.',
    description: 'A localhost demonstration of the CruxCoach competition protocol.',
    organizer: { name: 'CruxCoach demo', contact: 'demo@example.invalid' },
    visibility: 'public',
    status: 'draft',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    registration_opens_at: now(),
    registration_closes_at: startsAt - 600,
    checkin_opens_at: startsAt - 600,
    checkin_closes_at: startsAt,
    starts_at: startsAt,
    ends_at: startsAt + 7200,
    capacity: 8,
    waitlist_enabled: true,
    venue: { kind: 'physical', name: 'Kellerwand Bouldern', address: 'Beispielweg 3' },
    board: { brand: 'kilter', model: 'kilterboard-og', layout_id: 1, size: '12x12', angle: 40 },
    divisions: [{ id: 'open', label: 'Open' }],
    eligibility: 'Anyone running this demo.',
    waiver: 'I understand that climbing is dangerous and I take part at my own risk.',
    waiver_required: true,
    participant_instructions: 'Warm up on the slab first.',
    spectator_info: 'The live screen is at /competitions/live.html.',
    refund_policy: 'Not applicable — entry is free.',
    fee_msat: 0,
    prizes: [{ id: 'place_1', rank: 1, kind: 'non_cash', label: 'Chalk bag' }],
    rules: {
      climb_source: 'organizer_set',
      climb_count: 2,
      selection_uniqueness: 'none',
      progression: 'synchronous_rounds',
      attempts_per_climb: 3,
      turn_deadline_sec: 120,
      attempt_deadline_sec: 0,
      min_rest_sec: 0,
      defer_budget_per_round: 1,
      max_consecutive_defers: 1,
      defer_slots: 2,
      scoring: 'tops_then_attempts',
      tiebreaks: ['fewest_attempts', 'most_zones', 'earliest_finish', 'seed_order'],
      late_entry_allowed: false,
    },
    climbs: [
      // Real-shaped uuids, not the all-same-digit placeholders both validators
      // now refuse. Nothing here can load them either — a demo has no board
      // database — but the demo has to build the same kind of competition an
      // organizer does, or it stops being a rehearsal of anything.
      { id: 'c1', climb_uuid: '3f8a1c24-5b6d-4e71-9a03-2c7d8e4f5061', angle: 40, label: 'Qualifier 1', points: 100 },
      { id: 'c2', climb_uuid: '7b2e9d15-4c8a-4f36-8d52-1e9a3b7c4d08', angle: 40, label: 'Qualifier 2', points: 150 },
    ],
    relays: [relay.url],
    created_at: now(),
    revision: 1,
  };

  const pool = new RelayPool([relay.url]);
  step('Publishing the competition');
  const published = await publishCompetition(pool, organizer, config, now());
  detail(`accepted by ${published.accepted} of ${published.attempted} relays`);

  const naddr = naddrEncode({ identifier: compDTag(compId), pubkey: organizer.pubkey, kind: KIND });
  const store = new CompetitionStore({ pool, organizerPubkey: organizer.pubkey, compId, now });
  const loaded = await store.loadCompetition();
  if (!loaded.ok) throw new Error(`could not read back the competition: ${loaded.error}`);
  await store.follow();
  const writer = new AuthorityWriter({ store, pool, signer: organizer, now });

  const intents = [];
  await store.followIntents((event) => {
    const parsed = parseIntentEvent(event, store.competition, organizer.pubkey, now());
    if (parsed.ok) intents.push(parsed);
  });

  const effectiveStop = manual ? 'registration_open' : stopAt;
  const reached = (status) => STOP_POINTS.indexOf(status) <= STOP_POINTS.indexOf(effectiveStop);

  await writer.setStatus('published');
  if (reached('registration_open')) {
    step('Opening registration');
    await writer.setStatus('registration_open');

    for (const [signer, display] of manual ? [] : [[alice, 'Alice'], [bob, 'Bob'], [carla, 'Carla']]) {
      const entrant = new EntrantWriter({
        pool, signer, competition: store.competition, organizerPubkey: organizer.pubkey, now,
      });
      await entrant.register({ division: 'open', display, waiverAccepted: true });
      detail(`${display} sent a registration request`);
    }
    // Requests are not state. The organizer decides.
    for (let i = 0; i < 40 && intents.length < 3 && !manual; i++) await wait(50);
    for (const intent of intents) {
      await writer.decideRegistration(intent.pubkey, 'accepted', {
        division: intent.intent.data.division,
        display: intent.intent.data.display,
        intentId: intent.eventId,
      });
      detail(`accepted ${intent.intent.data.display}`);
    }
  }

  if (reached('checkin_open')) {
    step('Closing registration and opening check-in');
    await writer.setStatus('registration_closed');
    await writer.setStatus('checkin_open');
    for (const signer of [alice, bob, carla]) await writer.checkIn(signer.pubkey);
    detail('all entrants checked in');
  }

  let order = [];
  if (reached('running')) {
    step('Seeding the running order and starting');
    order = await AuthorityWriter.defaultOrder(compId, [alice.pubkey, bob.pubkey, carla.pubkey]);
    await writer.seed(order);
    await writer.setStatus('running');
    await writer.announce('Climb 1 is open. Three attempts each.');
    await writer.openTurn(0);
    detail(`first up: ${store.state.order[0].slice(0, 12)}…`);
  }

  if (reached('finished') && stopAt === 'finished') {
    step('Running the competition');
    // A deferral first, so the recorded stream contains one.
    await writer.decideDefer(store.state.order[0], 'granted');
    detail('the first climber deferred: back two places, no extra attempts');

    for (const climbId of ['c1', 'c2']) {
      if (climbId !== 'c1') {
        await writer.nextClimb(climbId);
        await writer.nextRound();
        await writer.seed(order);
      }
      for (let index = 0; index < store.state.order.length; index++) {
        const pubkey = store.state.order[index];
        await writer.openTurn(index);
        const outcome = index === 0 ? 'top' : 'zone';
        await writer.recordAttempt(pubkey, climbId, outcome, 1);
        await writer.closeTurn();
        detail(`${climbId}: ${pubkey.slice(0, 8)}… ${outcome}`);
      }
    }

    step('Finishing and publishing the results');
    await writer.setStatus('finished');
    await writer.publishResults();
    for (const row of store.standings) {
      detail(`${row.rank}. ${row.display || row.pubkey.slice(0, 8)} — ${row.tops} tops, ${row.attempts} attempts`);
    }
  }

  step('State');
  detail(`status      ${store.state.status}`);
  detail(`log entries ${store.state.seq}`);
  detail(`state hash  ${store.stateHash}`);
  detail(`complete    ${store.state.chain_complete}  fork ${store.state.fork_detected}`);
  detail(`stored events on the relay: ${relay.events().length}`);
  if (manual) detail('manual mode  open the browser roles and drive every decision from the UI');

  const base = `http://localhost:8000`;
  const relayParam = `?relay=${encodeURIComponent(relay.url)}`;
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Open these (serve the repo with: python3 -m http.server 8000)');
  console.log('');
  console.log(`  live screen   ${base}/competitions/live.html${relayParam}#${naddr}`);
  console.log(`  participant   ${base}/competitions/join.html${relayParam}#${naddr}`);
  console.log(`  organizer     ${base}/competitions/organizer.html${relayParam}#${naddr}`);
  console.log(`  German        ${base}/de/competitions/join.html${relayParam}#${naddr}`);
  console.log('');
  console.log('  Open "Use an existing nsec" and paste one throwaway nsec above per browser profile.');
  console.log('  The import is session-only. Create the requested one-field profile on the dev relay.');
  console.log('');
  console.log(`  join link     https://cruxcoach.org/comp/${naddr}`);
  console.log('──────────────────────────────────────────────────────────────');

  if (flag('exit')) {
    store.close();
    pool.close();
    await relay.close();
    return;
  }

  console.log('\nRelay is still running. Stop with Ctrl-C.');
  const stop = async () => {
    store.close();
    pool.close();
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await main();
