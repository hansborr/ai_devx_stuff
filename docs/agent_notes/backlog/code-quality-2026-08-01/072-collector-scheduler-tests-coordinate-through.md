# 72. Collector scheduler tests manufacture ordering, overlap, and pending workers out of millisecond wall-clock sleeps instead of driving the state machine directly

Status: Landed on fix/cq-072
Theme: deterministic concurrency tests · Area: tests · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet collector suite pins the bounded worker-pool and fail-fast
rejection contracts, but its nominal type-aware single-flight assertion is
vacuous because the fixture registry contains only one type-aware ratchet.
Three of its four scenarios establish their interesting interleavings by racing
real `setTimeout` timers a
few milliseconds apart. A 2 ms-per-index stagger is what makes later-registered
ratchets finish first; a 20 ms vs 5 ms split is what makes a type-aware worker
overlap the pool; a bare 5 ms sleep is what leaves healthy workers pending
while a sibling rejects. The semantic load of each test rides on timer
granularity: a reader cannot tell which scheduler transition is being asserted
without decoding the sleep arithmetic, and a loaded CI worker or coarse timer
that compresses a 2 ms gap silently inverts the very ordering the assertions
depend on. The suite is part of the root Vitest run that the commit gate
executes, so that timing coupling is a flake vector in exactly the place
flakes cost the most — and it is unnecessary, because the scheduler under test
is an explicit promise-completion state machine whose every transition fires
on worker-promise settlement, which a test can control directly.

## Evidence

- `tools/lint-ratchet/src/kernel/current-collector.test.ts:72-76` — the
  suite's only scheduling primitive is `delay(ms)`, a wall-clock `setTimeout`
  wrapper; there is no deferred promise, barrier, or fake-timer control.
- `tools/lint-ratchet/src/kernel/current-collector.test.ts:95` — the
  bounded-concurrency case encodes completion order as
  `await delay((fixtureRatchets.length - ratchetIndex) * 2)`: 2 ms of stagger
  per registry index is the entire mechanism behind the
  `expect(finishedIds).not.toStrictEqual(...)` ordering assertion at `:113`
  and the `maxInFlight` probe asserted to be exactly 3 at `:109`.
- `tools/lint-ratchet/src/kernel/current-collector.test.ts:135` — the
  type-aware single-flight case creates overlap with
  `await delay(typeAware ? 20 : 5)`, then asserts `maxInFlight` of 3 and
  `maxTypeAwareInFlight` of 1 at `:150-151`; however, `fixtureRatchets` contains
  only one type-aware entry (`:50`), so the single-flight assertion is vacuous.
- `tools/lint-ratchet/src/kernel/current-collector.test.ts:158` — the
  rejection case parks every non-failing worker on a real `await delay(5)`
  while the failing ratchet throws, so "rejects instead of returning partial
  results" (`:162-170`) is only exercised while those timers happen to still
  be pending.
- `tools/lint-ratchet/src/kernel/current-collection-scheduler.ts:79-117` —
  the behavior under test is a deterministic pump loop: every transition
  (start next runnable worker, decrement in-flight counts, resolve on
  `completed === ratchets.length`, fail-fast on rejection) fires from
  worker-promise settlement at `:103-115`, so the tests can drive each
  transition explicitly with promises they resolve or reject themselves.
- The fourth scenario (`current-collector.test.ts:173-190`, tracked-file
  matching) uses no timing and is fine as-is; three of four scenarios carry
  the coupling.

## Proposed direction

Rework the three timing-driven scenarios in
`tools/lint-ratchet/src/kernel/current-collector.test.ts` to gate mocked
workers on named deferred promises that the test releases or rejects
explicitly, asserting each scheduler transition without wall-clock delays.

Mechanically: replace the `delay` helper (`:72-76`) with a small test-local
worker gate — e.g. a map from ratchet id to a manually-constructed
`{ promise, resolve, reject }` deferred — and have the
`runEslintForFiles` mock (`:90`, `:126`, `:156`) await its ratchet's deferred
instead of a timer. Each scenario then reads as an explicit script: assert
which three ratchets have started (the suite already collects `startedIds`,
`:110-112`), release one, assert the next runnable ratchet starts and the
in-flight counts transition, and so on — completion order in the first test
becomes "the order the test released them", the type-aware cap in the second
first adds a second type-aware fixture ratchet, then holds the first and asserts
that the second does not start until the first is released, and the rejection test rejects `FAILING_RATCHET_ID`'s
deferred while holding the others, then releases them to avoid unhandled
leftovers. `await Promise.resolve()` / microtask flushes between release and
assertion are acceptable; `setTimeout` is not.

## Scope / caveats

- Test-only change: `current-collection-scheduler.ts` and
  `current-collector.ts` behavior must not change, and no test seam should be
  added to production code — the mocked `eslint-runner.js` boundary the suite
  already uses (`:7-12`) is sufficient.
- The fourth scenario (`:173-190`) and the suite's existing assertions on
  registry-order output and `sweepStaleCacheSiblings` call counts
  (`:114-117`) stay as-is; the rewrite changes how interleavings are
  produced, not what is asserted.
- Prefer explicit deferreds over `vi.useFakeTimers()`: fake timers would keep
  the misleading "time causes ordering" framing and interact poorly with the
  scheduler's promise-settlement pump; the point is to name the transitions.
- Focused run for TDD: `bun run test -- tools/lint-ratchet/src/kernel/current-collector.test.ts`
  (the root test orchestrator routes explicit test-file selectors to a single
  Vitest invocation, and `tools/lint-ratchet` is a registered root Vitest
  project).
- The `@musi/lint-ratchet` package is documented as portable/repo-agnostic
  (its `package.json` description); keep the rewritten tests free of
  `@musi/*` or repo-relative imports, as they are today.
- No sequencing edges: other leaves touch lint-ratchet acceptance suites
  (e.g. [067-lint-ratchet-acceptance-fixtures-emit-321.md](./067-lint-ratchet-acceptance-fixtures-emit-321.md),
  [068-one-lint-ratchet-acceptance-suite-serializes.md](./068-one-lint-ratchet-acceptance-suite-serializes.md))
  but none edits this kernel test file, so this leaf can land independently.
