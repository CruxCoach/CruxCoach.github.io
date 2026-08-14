# Mobile competition host UI contract

This contract keeps Android and Web operationally equivalent without making
their layouts identical. Both clients derive every label, count and available
action from the reduced competition log. Neither client introduces a local
competition state or changes protocol semantics.

## Persistent frame

The top of the host screen shows, in order:

1. competition title;
2. lifecycle state (`draft` through `cancelled`);
3. transport state (`live`, `connecting`, `offline`, or `stale`), separately;
4. accepted, checked-in and open-request counts.

Lifecycle and transport must never be merged. An offline running competition
is still running, but the UI must not claim that a write succeeded until its
existing publish path confirms it. State is communicated by text as well as
colour. Touch targets are at least 48 dp and the layout must remain usable at
320 CSS px / Android 9-era phone widths.

## Action priority

The first operational card answers “What must I do now?” and gives one action
the dominant treatment. Resolve ties in this order:

1. an open participant request that blocks the current turn;
2. build or rebuild the eligible start order;
3. call the first or next climber;
4. record the current attempt;
5. advance the lifecycle (open registration, check-in, start, resume);
6. administrative work.

Secondary actions may remain visible, but must not visually compete with the
dominant action. Finish, cancel and disqualify are never adjacent to scoring;
they live behind an explicit disclosure and require confirmation or a reason.
There are no disabled placebo controls: replace an unavailable action with a
short explanation.

## Lifecycle matrix

| State | Primary content | Primary control | Hidden or locked |
| --- | --- | --- | --- |
| Draft / published | event readiness | publish / open registration | turn controls |
| Registration | pending entries, capacity | resolve oldest request / close | turn controls |
| Check-in | arrivals, payment, no-shows | check in / seed queue / start | scoring |
| Running, no current climber | queue and next climber | call next climber | result controls |
| Running, active turn | current climber, boulder, deadline | Top / Zone / Fall / Timeout result group | lifecycle destruction |
| Paused | frozen current turn, next climber | resume | every scoring, advance and defer control |
| Finished | final standings, result publication, prizes | next outstanding completion task | queue and turn controls |
| Cancelled | cancellation truth and share | none | all competition writes |

The four result choices form one labelled group. None is preselected or fired
automatically. After a tap, show publishing progress, prevent accidental repeat
submission, and move to the next reduced state only after the normal writer path
reports success.

## Running layout

The live hero uses this visual order:

1. current climber;
2. current boulder;
3. countdown (tabular digits, no screen-reader announcement each second);
4. next climber;
5. the result group.

Below it, show a bounded queue followed by open requests. Entrant management,
sharing, scoring explanation, announcements, prize handling and audit details
remain fully available through secondary sections. Empty administrative
sections should collapse to a count or one sentence.

## Participant and projection alignment

The participant screen answers: “Am I up?”, “How many are ahead?”, “Which
boulder?”, then “How long?”. Its sticky bottom area contains one dominant board
action when one is executable. Defer is secondary and only appears when allowed.
Paused and terminal states replace actions with status copy.

Projection is read-only. Current climber, boulder and timer are largest; next is
second; queue, rotation and ranking follow. A finished projection removes active
queue and rotation. Offline/stale warnings describe transport freshness without
rewriting lifecycle truth.

Turn changes and errors may use an assertive accessibility announcement. The
countdown must not. German strings need room for roughly 35 percent more text;
essential actions must not depend on horizontal scrolling.
