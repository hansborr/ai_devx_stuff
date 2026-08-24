# 253. Converge typecheck fan-out on the shared parallel runner

Status: Landed on fix/cq-253
Theme: Converge typecheck fan-out on the shared live-output parallel runner · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The typecheck facade privately maintains the same shell process lifecycle as
the shared live-output parallel runner: temporary FIFOs, stream readers,
signal cleanup, child waits, and aggregation of multiple exit statuses. Its
only material difference is retaining each lane's output for TypeScript
diagnostic excerpts.

A lifecycle correction in the shared runner therefore does not protect
typecheck. Contributors must reason about two implementations of the subtle
cleanup and wait protocol, and a change to either copy can leave the gates
handling signals, readers, or conflicting failures differently.

## Evidence

- `scripts/typecheck.sh:20-114` — typecheck owns temporary state, child and
  reader cleanup, INT/TERM traps, FIFO-backed prefixed streams, child launch,
  and per-lane logs.
- `scripts/lib/parallel-runner.sh:20-119` — the shared runner independently
  owns the same initialization, child cleanup, signal handling, FIFO stream,
  PID, label, and launch lifecycle.
- `scripts/typecheck.sh:120-163` — diagnostic extraction, excerpt truncation,
  and TypeScript-specific failure presentation are the genuine typecheck-only
  behavior.
- `scripts/typecheck.sh:178-233` — typecheck launches four lanes, waits for
  every child and reader, reports each failed lane, preserves a common nonzero
  status, and falls back to 1 when failed lanes disagree.
- `scripts/lib/parallel-runner.sh:130-164` — the shared runner separately
  implements that same common-status-or-1 aggregation rule after waiting for
  every lane.
- `scripts/tests/test-typecheck.sh:113-203` — the typecheck smoke suite already
  pins all four prefixed lanes, diagnostic reporting, common failure-code
  propagation, and the disagreement fallback.
- `scripts/tests/test-parallel-runner.sh:93-182` — the shared-runner smoke suite
  pins multi-child completion, prefixed output, per-lane failure reporting,
  and both matching and differing nonzero statuses.

## Proposed direction

Extend `scripts/lib/parallel-runner.sh` with the smallest optional seam that
lets a caller retain each lane's prefixed stream and perform lane-specific
failure reporting after all children and readers have been waited. Keep the
existing unlogged lint callers on their current API and output behavior.

Have the runner continue owning temporary storage, FIFOs, reader and child PID
arrays, traps, cleanup, wait ordering, and aggregate exit calculation. For a
logged lane, record its log path alongside its label and PID and append the
same prefixed text that reaches the terminal. Expose each completed lane's
label, exit status, and optional log path to a caller-provided failure reporter
only after the shared wait lifecycle is complete; retain the existing generic
failure message when no reporter is supplied.

Rewrite `scripts/typecheck.sh` as a consumer of that surface:

1. Initialize the shared runner and register its four existing TypeScript
   commands as logged lanes.
2. Wait through the shared runner and use its aggregate exit status.
3. For each failed lane, invoke typecheck's existing diagnostic filtering and
   excerpt presentation against that lane's retained log.
4. Leave only compiler resolution, TypeScript diagnostic excerpting, and
   typecheck-specific wording in the facade.

Extend the shared-runner smoke coverage for optional log capture and custom
failure reporting. Keep the typecheck smoke cases as end-to-end
characterization of lane prefixes, diagnostic
excerpts, and matching-versus-conflicting exit codes.

## Scope / caveats

- Preserve current INT/TERM exit codes, EXIT cleanup, lane headings and
  prefixes, reader wait ordering, aggregation behavior, and diagnostic
  excerpts. This is lifecycle convergence, not a redesign of gate output.
- Log retention must be opt-in. Existing lint callers should not acquire
  per-lane files or typecheck-specific reporting policy.
- Keep TypeScript diagnostic matching, excerpt length, and presentation in
  `scripts/typecheck.sh`; the shared runner should expose mechanism, not learn
  TypeScript semantics.
- [204-decompose-the-stateful-bash-verification-engine.md](./204-decompose-the-stateful-bash-verification-engine.md)
  exclusively decomposes `scripts/lib/verify-engine.sh`. Do not fold this work
  into that verification-engine split; coordinate only if both changes touch
  shared harness fixtures or dependency inventories.
- `scripts/lib/parallel-runner.sh:4-9` expressly separates this direct
  live-output lifecycle from verify/pre-commit orchestration and per-step
  metadata. Preserve that boundary.
- No prior-pack residual applies to this convergence.
