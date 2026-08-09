# Localhost runbook — CruxCoach Competitions (FEAT-058)

Run a whole competition on this machine, with real signatures, and watch the
organizer console, a participant's phone view and the projector agree.

**Nothing here touches a public relay and nothing spends a satoshi.** The
development relay refuses to bind anything but a loopback address, keeps
everything in memory, and the demo competition has a fee of zero. The identities
are throwaway keys printed to your terminal.

---

## What you need

Node 22 or newer, and Python 3 for the static file server. Nothing else — this
repository has no `package.json` and installs nothing.

```bash
node --version     # v22 or newer
python3 --version
```

---

## The five-minute version

Two terminals, in this order.

**Terminal 1 — the relay and a finished competition:**

```bash
cd cruxcoach-pages
node tools/dev/run-competition-demo.mjs
```

It prints throwaway keys, runs a competition from publish to final results, and
then leaves the relay running with a block of URLs at the end. Leave it up.

**Terminal 2 — serve the site:**

```bash
cd cruxcoach-pages
python3 -m http.server 8000
```

Now open the URLs the first terminal printed. They already carry
`?relay=ws://127.0.0.1:…`, which is the *only* way these pages will ever talk to
a loopback relay, and every screen shows an orange **"Development relay — this
is not a real competition"** banner while it is in use.

| Screen | What to look for |
|---|---|
| **live screen** | Standings, the winner, and the join QR. Resize the window: it is built to be read from across a room. |
| **participant** | Sign in with *Create a key here* and paste Alice's `nsec`. The leaderboard highlights her row. |
| **organizer** | Sign in with the organizer `nsec`. You get the run controls; sign in as Alice instead and you do not. |
| **German** | The same competition under `/de/`. Same code, same state, different words. |

---

## Watching it happen live

The interesting run is the one that has not finished yet.

```bash
node tools/dev/run-competition-demo.mjs --stop-at running
```

This stops with the first climber's turn open. Now:

1. Open the **live screen** on one window and the **participant** view (signed in
   as whoever the script says is up first) on another.
2. Open the **organizer** console signed in with the organizer key.
3. In the organizer console press **Top**. Both other windows update within a
   second, without a reload.
4. Press **Call the next climber**. Watch "climbers before you" change on the
   participant view.
5. On the participant view for the climber whose turn is open, press **Defer my
   turn**. They move back two places — not to the end — and the hint above the
   button says so before it is pressed. Their attempt count does not change.
6. Press it again. The control is gone, replaced by "No deferrals left this
   round". It is not a greyed-out button.

Other stopping points: `published`, `registration_open`, `checkin_open`,
`finished`.

---

## Proving the integrity behaviour

These are the two failure modes a competition screen must never hide, and both
are reachable by hand.

**A gap in the record.** Start the demo with `--dump`, stop the relay, and
restart it having removed one log event from the dump — or more simply, run the
fixture stream in the test suite:

```bash
node --test tools/competition-reduce.test.mjs
```

`chain-break` is the stream that pins it: reduction stops at the gap, the
standings are not shown, and the participant view says which entry it is waiting
for. A leaderboard computed over a record with a hole is worse than no
leaderboard.

**A fork.** `fork-and-correction` in the same suite has two entries signed at the
same position. Every client picks the same branch, says so, and refuses to treat
the results as final.

---

## The Android app against the same relay

The app ships with public relays compiled in, so it reads a competition from
whichever relays the competition names. Point it at this one by publishing a
competition whose `relays` list is the loopback URL — which is exactly what the
demo script does — and running the app on the same machine (an emulator reaches
the host loopback at `10.0.2.2`).

Without a device attached this is the deterministic substitute, and it is the
stronger check of the two, because it compares hashes rather than screenshots:

```bash
cd CruxCoach
ANDROID_HOME=/home/myuser/android-sdk ./gradlew :shared:testDebugUnitTest --tests '*Competition*'
```

That replays the same seven signed event streams cruxcoach.org replays and
asserts the same `state_hash`, the same reduced state and the same standings. If
the app and the website ever disagree about who won, this fails.

---

## Regenerating the shared fixtures

The fixtures are the contract between the two repositories.

```bash
node tools/dev/build-competition-fixtures.mjs
```

Then update the pinned digest in **both** places, or the side you forgot will
fail:

- `tools/competition-fixtures.test.mjs` → `FIXTURES_MANIFEST_SHA256`
- the app's `shared/src/androidUnitTest/.../CompetitionFixtures.kt` → `MANIFEST_SHA256`

and copy `competitions/fixtures/` into the app's
`shared/src/commonTest/resources/competition/`.

---

## Running the relay on its own

```bash
node tools/dev/relay.mjs --port 7447
node tools/dev/relay.mjs --port 7447 --dump /tmp/competition-stream.jsonl
```

It speaks NIP-01, verifies every signature and event id, implements the
regular / replaceable / ephemeral / addressable storage rules, and answers a
NIP-11 document. It will refuse to start on a non-loopback host, which is the
point: it has no authentication, no rate limiting and no persistence.

---

## What this does not cover

- **A physical phone.** There is no device attached to this machine, so the
  Maestro flows in `CruxCoach/flows/` cannot run. The conformance test above is
  the substitute and covers the protocol; it does not cover Compose rendering.
- **A real Lightning payment.** The paid path is exercised with a locally
  generated zapper key and locally signed receipt fixtures
  (`competitions/fixtures/vectors/zap.json`). That is a faithful test of our
  verification logic and an explicitly incomplete test of a provider's
  behaviour — which is the honest limit, since a zap receipt is a provider
  attestation and not a proof.
- **A real relay's rate limits.** The dev relay accepts everything a conformant
  client sends. The limits the protocol is designed around are recorded in
  FEAT-058 §16.2 from live NIP-11 probes.
