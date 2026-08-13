# Competition UX and catalogue delivery decision

Research date: 2026-08-12. This note records the product and trust decisions
behind the Competition Beta. It is intentionally implementation-facing.

## What has to exist at creation time

The published competition protocol requires a title, organizer identity,
ordered registration/check-in/start/end times, venue, exact board, format,
capacity, at least one real compatible climb, and relay list. The creation
wizard asks for those before review. Description, public contact, address,
eligibility, waiver, participant/spectator instructions, refund policy, prizes,
extra divisions, fee, waitlist and advanced turn timing can be left at their
safe defaults. The current beta does not edit a published draft, so anything
that must be present publicly is added before the final review.

This follows the W3C WAI guidance to split long forms into logical stages,
show progress, identify optional stages, retain native fieldset/legend
semantics and mark required fields in both text and HTML:

- https://www.w3.org/WAI/tutorials/forms/multi-page/
- https://www.w3.org/WAI/tutorials/forms/instructions/
- https://www.w3.org/WAI/tutorials/forms/validation/

Climbing-specific state remains explicit because it changes what happens at
the wall: attempt count, queue/progression, climb selection, uniqueness,
scoring/tiebreaks, check-in and lifecycle. The terminology and ordering were
checked against the World Climbing 2026 Competition Rules and the USA Climbing
2025–2026 Boulder Rulebook. CruxCoach is not claiming federation compliance;
the sources are used to avoid hiding operational concepts that a real event
needs.

- https://images.ifsc-climbing.org/ifsc/image/private/fl_attachment/prd/jaq7awz9jmqwpddwnbpr
- https://usaclimbing.org/wp-content/uploads/2026/02/USA_Climbing_Rulebook_2025-2026.20260209.pdf

## Embedded climb browser

The production-safe browser is first-party UI over signed CruxCoach community
climb events. It accepts only verified kind-30078 events whose d-tag is in the
author-bound `cruxcoach:climb:<pubkey-prefix>:<uuid>` namespace, contains a real
UUID and label, and matches the selected board brand/layout. Relay content is
rendered exclusively with `textContent`; pasted links remain a fallback.

The existing `cruxcoach-blossom-sync` manifests are excellent app delivery but
are not a browser API. They point to SHA-256-addressed compressed SQLite chunks
for offline import. There is currently no small, documented, signed JSON climb
index contract that a dependency-free browser can safely stream. Downloading
and interpreting the full multi-board database in a browser would add tens of
megabytes, decompression/SQLite runtime and a much larger attack surface.

The safe next stage is a deterministic, compact JSON index built by the same
pipeline: one record per public climb with UUID, display label, board identity,
size, angle, grade and optional Nostr address; publish its SHA-256 and byte size
in a maintainer-signed manifest; fetch from two Blossom mirrors; cap bytes and
record count; verify the digest before parsing; then merge newer verified relay
events. Until that contract exists, the relay browser is the functional source
rather than an invented Blossom endpoint.

Blossom itself is appropriate for that future snapshot: BUD-01 retrieval is
content-addressed and clients are expected to verify hashes. NIP-B7 also
describes server discovery and hash-verified fallback:

- https://github.com/hzrd149/blossom
- https://nips.nostr.com/b7

## nsite and Napplets

NIP-5A/nsite maps paths in a static website manifest to Blossom hashes. It is a
good alternative publishing/availability path for the Competition site's own
static files, but does not define searchable climb records and therefore does
not solve the browser data model:

- https://nips.nostr.com/5a

Embedding a Napplet would execute a separately shipped application inside the
authoring experience. That conflicts with this site's same-origin CSP,
dependency-free runtime and narrow signer boundary, while adding no capability
that first-party rendering of signed records lacks. It is deliberately not
used for the organizer picker. A Napplet may be offered later as an external
competition viewer after its permissions, origin isolation and signer messages
have a stable specification and threat model.

## Web and Android alignment

Android already has the strongest wall interaction: every selected/current
climb resolves against the device catalogue and opens directly on the existing
board screen, with actionable wrong-board/not-downloaded states. Web now adopts
the app's visual hierarchical board picker and direct climb choice. Web remains
the host console because Android has no organizer creation/publishing stack;
adding a parallel partial form would create two sources of truth. Both clients
continue to share the protocol fixtures and participant actions.
