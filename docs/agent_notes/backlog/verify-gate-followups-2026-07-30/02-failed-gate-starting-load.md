# Attach Starting Host Load Only to Failed Gate Output

Status: Done — landed 2026-07-30 (`e21f1b1ab`)
Date: 2026-07-30
Priority: P1
Size: S
Source: owner-approved narrowing of the synthetic-load disposition in
[`pain-points-2026-07-29`](../pain-points-2026-07-29/01-sources-and-verdicts.md)

## Problem

Thirty-six orphaned `while :; do :; done` spinners held a 24-core box near load
37 for 10.4 hours. They destroyed two full sequential verification runs and,
after their working directory disappeared, the load looked like co-tenant
worktrees; an earlier pain-point entry recorded that wrong root cause. The
archive records the incident, cost, and corrected attribution at
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:732-751`.

A start-of-run load reading in a failed gate's output closes that attribution
gap at the moment someone is already reading the log. It must not become green
preamble: repeated noise on every passing run consumes agent context without
helping diagnose anything.

The prior proposal was broader. The closed pack dispositioned a generic
orphan/load `doctor` sensor as **External / insufficient-evidence** because the
reported process was not repository code and a general process/load doctor
would be platform-specific and broad
(`pain-points-2026-07-29/01-sources-and-verdicts.md:77`). This leaf is the
narrower failure-only evidence attachment, not a revival of the rejected
`doctor` proposal.

## Scope

- In the shared engine, capture the one-minute load average and online core
  count once in `musi_verify_gate_activate_runtime()` beside the start
  timestamp (`scripts/lib/verify-engine.sh:661-681`). Hold that immutable sample
  for the run; do not resample after the failure.
- Add one idempotent failure-evidence helper. Call it from
  `musi_verify_print_failure_summary()` (`scripts/lib/verify-engine.sh:106-143`)
  before the tail-proof `verify: failure logs:` footer, and from
  `musi_verify_gate_handle_signal()` (`:502-525`) before its timeout-budget
  footer. Use the nonzero EXIT dispatcher (`:226-246`) only as a guarded
  fallback for operational failures after runtime activation that bypass both
  normal failure paths.
- Emit exactly one concise line when a captured run fails, for example
  `starting load was 37 on 16 cores`. A successful run, including a marker hit,
  must emit no load line.
- Make sampling best-effort. An unavailable or malformed host reading must
  never change the existing exit status, slot classification, marker behavior,
  or failure wording.
- Do not add load thresholds, CPU arbitration, adaptive budgets, process
  scanning, warnings, or a `doctor` sensor. The sample is evidence attached to
  the run that suffered, never input to its verdict.
- Cover the contract in `scripts/tests/test-verify.sh`, including the existing
  tail-proof footer and signal paths. Extend a pre-commit fixture only if needed
  to prove the shared engine remains the single owner.

## Acceptance

- A fixture captures known load/core values, changes the live fixture values,
  then fails; output reports the captured starting values exactly once.
- Normal slot failure, memory-admission no-launch, registration failure, and
  watchdog termination each retain their existing verdict and include the
  failure-only sample exactly once.
- A fully passing run and a successful marker short-circuit contain no load or
  core line.
- A sampling failure neither fails a green gate nor changes a red gate's status.
- The standard failure summary still ends with its
  `verify: failure logs:` breadcrumb, and the timeout path retains its budget
  inspection footer.
- `doctor` output and implementation remain unchanged.

## Resolved decisions

- Capture at gate start and print only on failure. Post-failure sampling would
  not preserve the load that the run began under; green preamble would impose
  recurring context cost.
- Keep the reading diagnostic-only. Host load neither excuses a failing check
  nor authorizes a passing one.
- Do not wrap the owner's existing `uptime`/`vmstat`/`ps`/`top` workflow in
  `doctor`. This bounded attachment answers a different question: what load did
  this particular failed run start under?

## Open questions

None.
