# 39. broadcast-registry.test.ts repeats a fake-io triplet 11x and hand-rolls per-event routing tests despite a REGISTRY_FIXTURES table

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: maintainability · Area: server · Severity: low · Size: S-M · Confidence: high
Theme: server-test-boilerplate · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
`broadcast-registry.test.ts` proves the socket broadcast boundary (payload schema validation, room resolution, typed emit, recipient filtering, and the `socket.broadcast` logging contract). The assertions are strong — exact `toHaveBeenCalledWith` on both `to(room)` and `emit(name, payload)` — but the file's *scaffolding* is heavily copy-pasted, which makes the routing block read as repetition rather than as a clear inventory of what each registry event does.

Two duplications stand out. First, the same three-line fake-io triplet — `const emit = vi.fn(); const to = vi.fn(() => ({ emit })); const io = { to } as unknown as AppSocketServer;` — is pasted into eight consecutive `it()` blocks of the `broadcast` describe and recurs eleven times file-wide. The `as unknown as AppSocketServer` cast (needed because the tests shape a minimal `{ to }` / `{ in }` / `{ fetchSockets }` stub instead of a real socket server) appears eighteen times. Second, the five campaign-scoped routing tests (`campaign:updated`, `character:updated`, `encounter:updated`, `map:layerUpdated`, `map:tokenUpdated`) are mechanically near-identical: build the fake io, call `broadcast`, assert `to(campaignRoom(id))` and `emit(name, payload)`. Each new registry event today means hand-authoring another near-duplicate `it()`.

What makes this notable rather than ordinary test verbosity: the file *already* has the right tool. A `REGISTRY_FIXTURES` table (`name`/`payload`/`expectedScope`) sits at the top and drives the logging-contract block via `it.each(REGISTRY_FIXTURES)`. So the data-driven pattern that would collapse the routing block is established in the same file — the routing block simply does not use it, leaving the routing assertions hand-duplicated five times beside a table that could generate them. This is a pure DRY/readability gap; coverage is already complete.

## Evidence
- `packages/server/src/socket/broadcast-registry.test.ts:255-257` — the `emit`/`to`/`io` fake-io triplet (`to` at :256). The same triplet recurs at :266-268, :280-282, :292-294, :304-306, :318-320, :332-334, :352-354 (8 occurrences inside the `broadcast` describe). Verified 11 occurrences file-wide (`to`-lines: 256, 267, 281, 293, 305, 319, 333, 353, 498, 537, 548), and the `as unknown as AppSocketServer` cast appears 18 times.
- `packages/server/src/socket/broadcast-registry.test.ts:303-343` — the `encounter:updated` (:303-315), `map:layerUpdated` (:317-329), and `map:tokenUpdated` (:331-343) routing tests are structurally identical, one `it()` per event (build triplet, `broadcast`, assert `to(campaignRoom)` + `emit`).
- `packages/server/src/socket/broadcast-registry.test.ts:24` — `REGISTRY_FIXTURES` table defined (`:24-50`) with `name`/`payload`/`expectedScope` for the five campaign-scoped events.
- `packages/server/src/socket/broadcast-registry.test.ts:494` — `it.each(REGISTRY_FIXTURES)` already drives the success-path logging contract (and again at :516 for the io-null skip log), proving the table can drive the routing assertions too.
- `packages/server/src/socket/map-broadcast.test.ts:9` — the identical `const to = vi.fn(() => ({ emit }))` triplet also recurs here (and :29), confirming the helper would pay off beyond a single file.

## Proposed direction
Two coverage-preserving cleanups, both within the test layer:

1. Extract a small `makeFakeIo()` helper that returns `{ io, to, emit }` with the `as unknown as AppSocketServer` cast localized to one site, then replace the inline triplet in each `it()`. This drops ~11 copy-pasted blocks to one helper call apiece and reduces ~18 cast sites toward a single boundary. Because `map-broadcast.test.ts` carries the same triplet (`:9`, `:29`), the helper is a candidate for a shared `../test/` socket-test utility — keep that as an optional follow-up so this finding stays single-file.

2. Drive the campaign-scoped routing assertions with `it.each(REGISTRY_FIXTURES)`, reusing `expectedScope`/`campaignRoom` to assert `to(campaignRoom(payload.campaignId))` and `emit(name, payload)`. New campaign-scoped registry events then get a routing test for free by adding a table row — the same property the logging-contract block already enjoys.

Estimated impact: collapses roughly eleven boilerplate blocks; new registry events become one table row instead of a hand-written `it()`; one cast site instead of ~18. No run-time win (these are fast pure-function tests with mocked io); the payoff is readability and drift resistance. Assertions stay exact `toHaveBeenCalledWith`, so nothing is weakened.

## Scope / caveats
Single-file, pure-readability cleanup with zero coverage gap and no defect-class risk — every `toHaveBeenCalledWith` stays exact and the same events stay exercised. `REGISTRY_FIXTURES` holds only the five campaign-scoped events, so `it.each` covers 5 of the 6 routing tests; `chat:newMessage` (which has a distinct room-resolution shape) stays an explicit `it()`. Keep all special-case `it()`s explicit — caller-room override (`:291`), null-io no-op (`:345`), schema-fail (`:351`), and the room-wide `notification:new` rejection (`:363`) — plus the `broadcastToUsers` tests whose ios are `{ in }`/`{ fetchSockets }`-shaped rather than the `{ to }` triplet; none fit the table or the `makeFakeIo()` helper as-is. Low-leverage: do it opportunistically when next editing this file, not as standalone churn. The optional cross-file `makeFakeIo()` extraction into `../test/` touches `map-broadcast.test.ts` and should be its own change if pursued. This is a DRY/readability finding, not duplication-of-production-code or dead-code (those belong to `docs/agent_notes/backlog/drift-ai-findings/`).
