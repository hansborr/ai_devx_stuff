# Align Async Lint Repairs Under the Real Server Config

Status: Proposed — split P2 repair compatibility from P3 rule expansion
Date: 2026-07-21
Priority: P2

## Problem

`local/no-async-array-callbacks` recommends
`await Promise.all(items.map(async ...))`; server lint immediately rejects that
dynamic pattern with `local/no-unbounded-promise-all`. Its async-map message
also lists four consuming combinators without distinguishing completion/error
semantics.

The fan-out rule's prose says "Promise combinators" while guarding only
`all`/`allSettled`. Its current analysis also conflates consuming an
already-created promise collection with the eager mapper expression that
actually starts work.

## P2 repair-compatibility slice

- Rewrite async-callback repairs to distinguish bounded parallelism, dynamic
  server work, and semantics-preserving sequential alternatives.
- Do not group `Promise.all` with `allSettled` as "await every operation":
  `Promise.all` is fail-fast, while `allSettled` waits for every settlement.
- Do not introduce a production concurrency helper. Pin the clean contract with
  a local `mapWithConcurrency(items, limit, fn)` fixture.
- Align both rules on shadowed `Promise` bindings. Apply the same global-binding
  discipline to future `Array.from` analysis.
- Add a deterministic full-resolved-config repair-compatibility fixture for
  interacting local rules, separate from the model message evaluation.
- Update the hand-maintained async-rule inventory in `docs/ai-harness.md` and
  generated guidance.

## P3 capacity-rule redesign

Before expanding coverage, rename `no-unbounded-promise-all` to match a broader
capacity invariant and distinguish eager mapper construction from consumption
of pre-created promises. Then decide method-specific policy for `all`,
`allSettled`, `race`, `any`, and `Array.from(..., async mapper)`.

Do not obtain coverage by merely adding method names to the current analyzer:
that would inherit false positives for already-started promise collections and
would misattribute where work begins. Limiting eager starts for `race`/`any`
also changes scheduling and may change the winner, so there is no mechanical
semantics-preserving repair.

## Acceptance

- Every suggested server repair is green under the simultaneously enabled
  production config. Fixtures distinguish `all` and `allSettled` completion and
  error semantics.
- The P2 slice covers bounded helpers, sequential alternatives, client/server
  scope, and shadowed globals.
- The P3 redesign owns `race`/`any`, `Array.from`, static collections, and
  pre-created-promise negatives.
- Live `meta.messages` plus `messageId` assertions own diagnostics; `meta.docs`
  plus `docs:lint-guidance:check` own generated guidance. No parallel literal
  message snapshot is introduced.
