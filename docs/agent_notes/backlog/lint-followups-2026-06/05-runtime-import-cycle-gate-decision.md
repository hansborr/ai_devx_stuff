# Implement The Runtime Import-Cycle Floor (Placement Decided)

Status: Done (2026-06-12, landed in "feat(lint): gate runtime import cycles
as a lint composite lane")
Order: 05
Source: lint-review-2026-06 leaf 05 verdict (ADOPT REPORT-ONLY / REJECT
ESLINT RULE, 2026-06-12). Requires leaf 04 of this pack. Placement
pre-decided at pack review, 2026-06-12 (maintainer sign-off) — see Scope.

## Context

The June verdict adopted `drift:ai --check import-cycles` as the
detector, kept it report-only ("existing findings mean
`--fail-on-findings` would block immediately"), and rejected
`import-x/no-cycle` on probe evidence (~40s runs, zero findings). The
structural-sensor precedent says gate only after low-noise report-only
output and repair text exist. After leaf 04, runtime cycles are at zero
and the sensor already emits repair text — the gate precondition is met
for runtime cycles only; type-only SCCs stay report-only evidence.

## Scope

- Placement (pre-decided 2026-06-12, do not re-litigate): wire the floor
  into the `lint` composite as a fourth parallel lane in
  `scripts/lint.sh`, alongside ShellCheck, config sensors, and ESLint.
  Rationale: the `lint` step is in all four generated step sets
  (`scripts/verify/steps.generated.sh`), so the floor is always-run with
  no new verify-step plumbing, and the ~1.2s detector wall time is masked
  by the ESLint lane. Doctor-only placement was rejected (diagnostic, not
  a gate — cannot satisfy "cannot land silently"); a changed-scope hook
  was rejected (hook complexity and changed-scope blind spots to save
  seconds that are parallel-masked anyway).
- If the sensor lacks a "fail on runtime cycles only" switch, adding that
  flag to `scripts/drift-ai/` is in scope; type-only findings must not
  trip it. A failing lane must surface the sensor's existing repair text
  so a red gate is actionable.
- Implement the placement; a deliberate two-file runtime cycle probe must
  fail the gate (the prior verdict used exactly this probe shape — add it
  under `packages/shared/src`, observe the failure, revert).
- Record the verdict (placement, runtime cost, probe result) in
  `evaluation-verdicts.md`.

## Definition Of Done

A new runtime import cycle cannot land silently: some always-run or
changed-scope gate fails on it with repair text, and type-only SCCs do
not produce failures.

## Verification

- Probe cycle fails the gate; probe reverted; gate green again.
- Gate runtime measured and recorded in the verdict entry.
- `bun run verify:changed` (or full `verify` if the gate joins it).

## Closing Notes (2026-06-12)

- Surprise vs the Scope text: the `lint` step is in all four generated
  step sets, but as two scripts — `scripts/lint.sh` (verify,
  verify:parallel, CI) and `scripts/lint-changed.sh` (verify:changed,
  pre-commit). The lane went into both so a runtime cycle cannot land via
  the local commit path either; `--scope current` everywhere keeps the
  floor whole-tree and identical across callers.
- The lane lives in its own wrapper, `scripts/lint-import-cycles.sh`
  (npm: `lint:import-cycles`), because the lint wrappers' sandbox smoke
  tests stub lanes by replacing lane scripts — a direct `bun drift-ai.ts`
  invocation broke `scripts/tests/test-lint-changed.sh` and
  `test-lint-dist-preflight.sh` (caught by the review subagent).
- The sensor lacked the runtime-only switch, so `--fail-on-runtime-cycles`
  was added (in scope per this leaf): parse-time requirement on
  `--check import-cycles`/`all`, trips on non-type-only import-cycles
  findings (including the graph-error diagnostic), fails closed on skip.
  Type-only SCCs stay report-only evidence, satisfying the DoD.
- Detector ~1.0s / lane ~1.25s wall; parallel-masked by ESLint (~60s
  composite). Probe result and full verdict in `evaluation-verdicts.md`.
