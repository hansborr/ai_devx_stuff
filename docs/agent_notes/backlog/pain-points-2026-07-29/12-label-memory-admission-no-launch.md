# Label Memory-Admission No-Launch Separately from Test Failure

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: M
Source: `gate-timeouts-and-load.md` — “Resolved-config and memory timing
assertions”

## Problem

Memory reservations are intentionally host-wide per UID
(`scripts/verify/memory-budget.sh:202-205,307-410`). A sibling lane can consume
the available headroom, and pre-commit caps its wait at 30 seconds while holding
the Git-common commit queue (`.husky/pre-commit:299-319`). Blocking the commit is
safe, but before this leaf the evidence claimed tests failed even when they
never ran.

Before this leaf, parallel admission timeout wrote “no slot was launched” but
assigned exit 1 to every pending slot; a non-timeout reservation error assigned
its synthetic reservation rc (`scripts/verify/steps-lib.sh:285-325`). The
parallel aggregator classified both as `Failed:` using the same integer channel
that carries real child exits (`scripts/lib/verify-engine.sh:858-910`).
Serial verification also appended any pre-launch reservation failure directly
to `MUSI_VERIFY_GATE_FAILED` (`scripts/lib/verify-engine.sh:721-727`). That path
is the default for `bun run verify`, and therefore for `land.sh`'s full-gate
backstop.

A lane's resource use could therefore turn another lane's unexecuted `test` and
`scripts` slots into apparent test failures. The persisted source records a
296-second commit-queue wait followed by both slots receiving this false-red
classification.

This leaf changes result vocabulary, not admission policy. The commit remains
blocked; the 30-second cap, shared reservation pool, queue ownership, and slot
commands remain unchanged.

## Scope

- Declare `MUSI_VERIFY_SLOT_NOT_RUN_EXIT=300` beside
  `MUSI_VERIFY_SLOT_SKIP_RC` in `scripts/verify/steps-lib.sh`. The value is
  outside `wait`'s 0-255 range and is written only by pre-launch memory
  admission branches, including timeout and other reservation errors. It is
  not a skip: the gate remains red.
- In parallel aggregation, classify a slot as not run only when its exit value
  is the sentinel and its recorded PID is empty. Sentinel plus PID is an
  invariant violation that emits an engine diagnostic and fails closed under
  `Failed:`. PID absence alone is insufficient because resolver and dist
  deferral errors are also PID-less and remain failures.
- In serial verification, apply the same launch-boundary rule: every
  reservation failure before the child spawn, including timeout rc 3 and
  admission rc 2, appends to the not-run list. A child that launches and exits
  3 remains failed.
- Aggregate not-run slots separately and print the single optional public line
  `Not run: <slots>` immediately after `Failed:`. Memory-blocked slot names do
  not appear under `Failed:`; existing resolver, registration, and dist
  deferral failures keep their current classification.
- Keep gate exit 1, failure run metadata, the `=== ... FAILED ===` banner, and
  the final `verify: failure logs: ...` footer unchanged. Withhold the success
  marker whenever either failed or not-run work exists. No step metadata or
  timing is synthesized for a slot that never launched; the existing launch
  structure already guarantees this.
- In `scripts/ai-hooks/commit-output.sh`, parse `Not run:` alongside `Failed:`
  and handle a summary when either list is non-empty. Render each not-run slot
  with its bounded resource-log excerpt, while keeping flaky-test guidance
  keyed only to real failed tasks.
- Document the three terminal categories in
  `docs/guides/verify-gate-lifecycle.md` §4. Do not change the Green-Output
  Policy, `harness.controls.json`, or generated harness-control docs; those
  surfaces do not govern red-result terminal grammar.
- Do not release/requeue the commit lock, lengthen the admission timeout, retry
  slots, change memory estimates, or treat an incomplete run as cacheable
  success.

## Acceptance

- A memory timeout or admission error before a slot launches blocks the gate
  and writes its resource log, but the slot does not appear under `Failed:`.
- `Not run: test scripts` appears in terminal and adapter summaries for an
  admission-only block, and each retained slot log identifies why no command
  launched.
- In a mixed case, a command that actually returns nonzero remains under
  `Failed:` while an unlaunched command remains under `Not run`.
- A launched child exiting 3 remains under `Failed:` even though 3 is also a
  serial admission return value. Sentinel plus a recorded PID also fails
  closed, with an engine diagnostic.
- No new success marker is written for the incomplete run. A retry executes the
  omitted slots when no matching older marker exists or `FORCE_VERIFY=1` is
  used.
- Not-run slots receive no per-step metadata or synthesized timings.
- The existing nonblocking commit-queue release assertion still passes.

## Resolved decisions

- Preserve the shared scheduler and blocking commit result. Relabeling
  unexecuted work is enough to stop sibling load from fabricating a test
  verdict; queue/retry policy is a separate, expensive decision.
- Classify by the launch boundary: all pre-launch memory admission failures,
  including non-timeout parallel errors and serial rc 2, are `Not run:`. Do not
  add separate “declined” and “admission subsystem broke” variants; the
  per-slot log retains the reason.
- Use an internal sentinel to carry no-launch state through the existing
  parallel arrays, but never present that sentinel as a command exit. Its
  unreachable value and PID-absence guard separate admission state from
  command outcome without threading a new status token through every runner.
- Keep the public gate contract binary. The run failed and the commit remains
  blocked, so the existing failure banner, footer, exit code, and run metadata
  remain truthful.

## Open questions

None.
