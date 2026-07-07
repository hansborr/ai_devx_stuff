# 16. Ratchet collection scheduler leaves ESLint workers running after the first fatal error

Status: Parked — 2026-07-04 review pass: weakest leaf in the pack. The trigger is a rare fatal collection/config error inside an already-failing gate; the benefit is failure latency plus some wasted CPU; the cost is M-size AbortSignal plumbing. Revisit only if it bites in practice.
Lens: ratchet · Area: collection scheduler · Severity: low-med · Size: M · Confidence: high
Theme: robustness · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The parallel collection scheduler (harness-review-2026-07 leaf 15) rejects on
the first collection error, but in-flight ESLint child processes have no
abort path — they run to natural completion. A bad config or one failing
ratchet therefore produces unpredictable failure latency and keeps burning
CPU (relevant inside the parallel pre-commit gate, where those cores belong
to the test slots). Verified: the runner exposes no kill/abort hook and the
scheduler abandons rather than reaps in-flight jobs.

## Evidence
- `scripts/lint-ratchet/current-collection-scheduler.ts:66-110` — first-error rejection without cleanup. Verified 2026-07-04.
- `scripts/lint-ratchet/eslint-runner.ts:74-118` — spawn path with no AbortSignal/kill surface.

## Proposed direction
Thread an `AbortSignal` from the scheduler into the runner's spawn call
(`child_process` supports `signal` natively); on first fatal error, abort the
signal, await all settled promises, then reject. Add a test with a
deliberately failing ratchet plus a slow one, asserting the slow child is
killed (observable via its exit reason).

## Scope / caveats
- Do not abort on *finding* differences (those are results, not errors) —
  only on collection/config failures.
- One commit: signal plumbing + test.
