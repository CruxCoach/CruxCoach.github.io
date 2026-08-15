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

## Recommended browser-driven rehearsal (host + three entrants)

Use four separate browser profiles or one normal window plus three private
browser profiles. Tabs alone are not enough: they share the active key.

If the browser runs on a different computer, create both SSH forwards first.
The relay URL embedded in the page is loopback by design, so forwarding only
the HTTP port is not enough.

```bash
ssh -N \
  -L 8000:127.0.0.1:8000 \
  -L 7447:127.0.0.1:7447 \
  <ssh-user>@<ssh-host>
```

Keep that terminal open. On the remote machine, use two more terminals:

```bash
cd /home/myuser/worktrees/cruxcoach-pages-competitions
python3 -m http.server 8000 --bind 127.0.0.1
```

```bash
cd /home/myuser/worktrees/cruxcoach-pages-competitions
node tools/dev/run-competition-demo.mjs --port 7447 --manual
```

The demo prints four throwaway `nsec` values and the organizer, participant,
German and live-screen URLs. Open those URLs through `http://localhost:8000` on
your local computer. Never use these demo keys outside this loopback relay.

For each writable browser profile, choose **Use an existing nsec** (not
**Create a key here**), paste exactly one printed throwaway key, and create the
requested one-field profile. The import is masked, cleared immediately and held
in memory for this tab only. For a real identity, prefer NIP-07 or NIP-46.

The live screen gets no key and may be an ordinary fifth tab.

### Browser acceptance pass

Run this in order and keep the live screen visible. Every accepted host action
should appear in all relevant windows within about a second and survive reload.

1. **Identity boundary.** In one profile, try a damaged `nsec`; it must stay
   signed out and the field must clear. Import the organizer key, create the
   one-field profile, reload, and import it again. Open the organizer URL with
   Alice's key in a different profile: it may read and share, but must show no
   run controls.
2. **Registration decisions.** Alice, Bob and Carla each register with distinct
   nicknames and accept the terms. Host: accept Alice, waitlist Bob, reject
   Carla. Bob must show the waitlist position. Carla uses **Ask to enter again**;
   the new request must reappear for the host and can be accepted. Promote Bob
   from the waitlist.
3. **Withdrawal and recovery.** Bob presses **Withdraw**. Nothing changes merely
   because the intent exists; the host sees an open request and confirms it.
   Bob then shows **Withdrawn** and, while registration is open, can ask again.
   Accept that new request.
4. **Check-in.** Close registration and open check-in. Alice asks to check in;
   grant her open request. Check Bob in directly from the host console. Mark
   Carla as no-show and verify she is omitted from the seeded queue. Change the
   plan only by starting a fresh demo—no-show is an audit entry, not an undoable
   local checkbox.
5. **Queue and start.** For a newly created competition, accept/payment/check-in
   decisions create the stable order and schedule its first turn automatically;
   no seed button is expected. Start, then call the displayed climber when the
   signed opening time arrives. Legacy definitions without `queue_policy` still
   use the seed control. The
   same person must be “now” on host, participant and live screens; the next
   person and countdown must agree too.
6. **Deferral.** The current climber requests a deferral. Before the host acts,
   the standings and attempt allowance do not change. Grant it: they move back
   two slots, not to the end, and lose no attempt. A second consecutive request
   must not offer another valid grant.
7. **Attempts.** Record one **Fall**, one **Zone**, one **Top**, and one
   **Time up** across turns. Each action closes the turn; call the next climber.
   Verify attempts remaining and the leaderboard after every result. A timeout
   consumes exactly one attempt.
8. **Operations.** Publish an announcement and confirm it on participant and
   live screens. Pause: participant actions disappear with an explanation.
   Resume and continue. Disqualify one active entrant with a reason; the reason
   is mandatory and the entrant leaves the eligible queue.
9. **Round and finish.** Select the next climb, which advances the round and
   reseeds eligible entrants. Complete at least one result there, finish, then
   publish results. Reload every window: winner, ranks and audit-derived state
   must remain identical.
10. **Language and layout.** Repeat one participant window under `/de/`; state
    must be identical and only wording changes. Test the live screen at narrow
    phone width and full-screen projector width, keyboard-only focus, and with
    reduced motion enabled.

Use a separate `--manual` run to test **Cancel competition**, because cancellation
is intentionally terminal. A fee-bearing competition, participant-chosen unique
climbs, malformed/forked chains and provider failures are deterministic protocol
cases rather than safe localhost wallet exercises; run the automated coverage
listed below for those.

### Negative and integrity pass

```bash
scripts/check
node --test tools/competition-e2e.test.mjs tools/competition-reduce.test.mjs \
  tools/competition-lightning.test.mjs tools/competition-pages.test.mjs
```

These cover zero-relay publication, unauthorized authority writes, capacity,
paid/unpaid eligibility, verified and manual payment settlement, unique-climb
races and re-picking, all stable rejection codes, timeout/deferral limits,
correction, override, chain gap, fork selection, QR parsing, English/German
parity and the CSP/no-analytics boundary.

## The five-minute finished-state version

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
| **participant** | Open *Use an existing nsec* and paste Alice's throwaway `nsec`. The leaderboard highlights her row. |
| **organizer** | Open *Use an existing nsec* with the organizer throwaway `nsec`. You get the run controls; Alice does not. |
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

The app reads a competition from whichever relays the competition names, and it
will only ever accept a `ws://` URL when the host is loopback
(`CompetitionProtocol.isAllowedRelayUrl`). So the phone has to reach this relay
**at 127.0.0.1**, which is exactly what `adb reverse` is for.

`10.0.2.2` — the emulator's alias for the host — does not work and never did:
it is not loopback, so both clients refuse it. `CompetitionDevRelayPolicyTest`
pins that, so this page cannot drift back to suggesting it.

For the multi-role rehearsal, use a disposable emulator snapshot. In the app,
open **Settings → CruxCoach Account → Import key**, paste Alice's throwaway
`nsec`, verify the derived `npub`, and accept the explicit overwrite warning.
The import screen is screenshot-protected and masked by default. Do not import a
demo key over a real identity unless its recovery key is already backed up.

**1. Install the debug build.** Only the debug build permits cleartext to
loopback; the release APK forbids it, and a test asserts the difference.

```bash
cd CruxCoach
ANDROID_HOME=/home/myuser/android-sdk ./gradlew :androidApp:installDebug
```

**2. Point the phone's loopback at this machine.** Both ports: the relay, and
the static site if you want to open the pages on the device too.

```bash
adb reverse tcp:7447 tcp:7447     # the dev relay
adb reverse tcp:8000 tcp:8000     # the static site, if you want it on device
adb reverse --list                # confirms both
```

When the relay and site are on a remote SSH host, keep the two local SSH
forwards from the browser section running too. The path is device loopback →
`adb reverse` → local-computer loopback → SSH forward → remote loopback.

**3. Publish a competition whose relay is the loopback URL.** The demo script
already does this; if you are publishing by hand, the `relays` list must contain
`ws://127.0.0.1:7447` and nothing else, or the phone will read a different
competition from the public relays.

```bash
node tools/dev/run-competition-demo.mjs --port 7447 --stop-at running
```

The demo binds the relay to `127.0.0.1:7447` and publishes a competition whose
`relays` list is exactly that URL, which is what makes it readable from the
phone once `adb reverse` is in place.

**4. Open it on the phone**, by any of the three ways in — all three still work
and none of them is required:

```bash
# a. the App Link, as if the poster had been scanned by the system camera
adb shell am start -a android.intent.action.VIEW \
  -d "https://cruxcoach.org/comp/<naddr>"

# b. the in-app scanner: Competitions → "Scan a code", pointed at the QR on the
#    live screen. The camera permission is asked for here and nowhere else.

# c. paste: Competitions → the link field → the naddr or the full link
```

`<naddr>` is printed by the demo script and is the same string the live screen's
QR encodes.

**Without a device**, the deterministic substitute is the stronger check of the
two anyway, because it compares hashes rather than screenshots:

```bash
cd CruxCoach
ANDROID_HOME=/home/myuser/android-sdk ./gradlew :shared:testDebugUnitTest --tests '*Competition*'
```

That replays the same signed event streams cruxcoach.org replays and asserts the
same `state_hash`, the same reduced state and the same standings. If the app and
the website ever disagree about who won, this fails.

The scanner's own decode path is covered without a camera too — a QR is encoded,
rendered to luminance the way a sensor would, and read back:

```bash
cd CruxCoach
ANDROID_HOME=/home/myuser/android-sdk ./gradlew :androidApp:testDebugUnitTest \
  --tests '*CompetitionQrDecoderTest*'
```

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
  Maestro flows in `CruxCoach/flows/` cannot run and neither can the `adb`
  steps above — they are written to be executed, not to have been executed. The
  conformance test and the QR decoder test are the substitutes and cover the
  protocol and the decode path; they do not cover Compose rendering, the camera
  preview, or the permission dialog.
- **A real Lightning payment.** The paid path is exercised with a locally
  generated zapper key and locally signed receipt fixtures
  (`competitions/fixtures/vectors/zap.json`). That is a faithful test of our
  verification logic and an explicitly incomplete test of a provider's
  behaviour — which is the honest limit, since a zap receipt is a provider
  attestation and not a proof.
- **A real relay's rate limits.** The dev relay accepts everything a conformant
  client sends. The limits the protocol is designed around are recorded in
  FEAT-058 §16.2 from live NIP-11 probes.
