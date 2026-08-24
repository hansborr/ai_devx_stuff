# Run a Registration Preflight in Fast-Commit Mode

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P2
Size: L
Risk: medium-high
Source:
`/home/node/persist/musi/pain_points/harness-registration-and-generated-surfaces.md`;
Claude memory
`autonomous-drain-lane-recipe.md`; lint-messaging audit residual finding

## Problem

Fast-commit intentionally skips the `test` and `scripts` pre-commit slots. That
makes multi-commit lanes affordable, but it also postpones cheap structural
registration failures until the full land gate: stale verify-slot metadata, an
unclassified package script, a missing local-rule or doctor-check entry, stale
skill mirror/subject registration, or malformed generated-surface metadata.

The full behavioral suites and their behavioral snapshots should remain
deferred. The avoidable pain is a deterministic registration typo that existing
pure/static harness authorities could reject before creating the commit.

## Evidence

- [`harness.controls.json`](../../../../harness.controls.json) marks exactly the
  pre-commit `test` and `scripts` slots `fastCommitSkip`; those values generate
  `MUSI_FAST_COMMIT_SKIP_SLOTS` in
  [`scripts/verify/steps.generated.sh`](../../../../scripts/verify/steps.generated.sh).
- [`scripts/verify/steps-lib.sh`](../../../../scripts/verify/steps-lib.sh) applies
  that generated skip set only for the `pre_commit` consumer. Manual/full
  verification correctly remains unchanged.
- [`.husky/pre-commit`](../../../../.husky/pre-commit) runs generated-surface
  freshness as advisory warnings, rejects source-relevant unstaged work, and
  then permits a native marker or verify bridge to skip slots. A registration
  admission check placed after those short-circuits could still be bypassed.
- [`scripts/harness-check.ts`](../../../../scripts/harness-check.ts) joins pure
  registration checks with spawned freshness commands, its own fixture/import
  closure, hook behavior checks, and unrelated documentation/snapshot checks.
  Running the whole command is neither the intended scope nor a reliable budget.
- [`scripts/harness/harness-gate-parity.ts`](../../../../scripts/harness/harness-gate-parity.ts)
  and [`scripts/harness/harness-check-validation.ts`](../../../../scripts/harness/harness-check-validation.ts)
  already contain focused structural authorities and repair-oriented messages.

## Structural preflight scope

- Extract one registration-only failure collector and make `harness:check` and a
  new `harness:registration:check` entrypoint call the same typed functions over
  the same parsed `harness.controls.json`. Do not create another manifest,
  expected-ID table, package-script classifier, verify-slot list, or trigger
  list.
- Include only deterministic structural registration:
  - manifest/control shape, source and package-script references, verify-slot
    validity, and freshness of the pure-rendered verify registration fragments;
  - package-script parity and generated Bun-hook classification registration;
  - local ESLint rule, lint overlay, ratchet, and doctor-check ID parity;
  - after leaf 08, skill target/mirror and marked smoke-subject projection
    freshness through its non-spawning check core; and
  - generated-surface schema, repair/check script existence, trigger/output and
    Bun-hook metadata, plus freshness of generated registration fragments that
    the pre-commit hook consumes.
- Explicitly exclude spawned generator/check commands, generated-output behavior
  beyond the registration fragments above, `checkFixtureCopyClosure` and the
  harness-check smoke's self-fixture/import closure, porting-knob/documentation
  checks, pre-push/CI behavioral snapshots, hook behavior probes, and unrelated
  guide assertions. Those remain intentionally deferred to `scripts`, full
  `harness:check`, and land/full verify.
- Keep all unit/integration suites, shell smokes, databases, browsers, services,
  and other behavioral probes deferred. The preflight is structural
  registration, not a renamed subset of the `scripts` slot.

## Hook lifecycle

- Run the preflight once, and only once, for a source-relevant commit whose
  fast-commit marker is active. It runs after the existing unstaged/untracked
  rejection and source-relevance decision.
- Add a first-class pre-cache admission seam to the shared gate engine instead
  of an ad hoc shell subprocess. Run it under the existing cross-worktree lock,
  watchdog/process cleanup, log directory, run fingerprint, and failure-summary
  machinery, before native-marker and verify-bridge evaluation. A marker or
  bridge may skip the expensive slots only after registration admission passes;
  neither may skip the preflight itself.
- Preserve fast-commit provenance exactly: failure creates no pending success,
  marker-hit success still records skipped `test`/`scripts` debt, and a valid
  full-verify bridge keeps its current no-debt behavior. The registration log
  must not be presented as behavioral-slot evidence.
- Capture the same staged/worktree fingerprint before and after admission and
  fail closed if its inputs change. Keep the preflight in the existing lock and
  watchdog cleanup path so concurrent commits, timeout, and signal behavior do
  not fork another protocol.
- Write one `registration.log` and one failure summary. In fast mode, suppress
  only advisory generated-surface warnings whose invariant is now blocking in
  this preflight; retain non-overlapping advisories and the normal-mode warning
  path. Do not print both a warning and a blocking copy of the same finding.
- Add a self-wiring tripwire, owned by full `harness:check`, that fails if the
  direct pre-cache admission call, ordering, package script, control, or
  registration-fragment coverage disappears. The hook must not depend on a
  stale generated fragment to decide whether its own admission check exists.

## Acceptance

- Focused core tests inject one defect for every included class and prove
  `harness:check` and `harness:registration:check` return the same finding and
  exact repair command. They also prove excluded spawned, self-fixture,
  documentation, and behavioral checks are not invoked.
- Marker-on integration fixtures prove the preflight runs exactly once after
  unstaged rejection, blocks before commit creation, writes one log/diagnostic,
  and still records `test` and `scripts` as skipped after success.
- Marker-hit and verify-bridge fixtures prove registration admission still runs
  exactly once before either short-circuit. Cache, bridge, fingerprint,
  watchdog, lock, log, and fast-provenance outcomes retain their existing
  contracts.
- Marker-off integration fixtures prove the preflight does not run and the
  normal pre-commit path is unchanged. A source-relevant unstaged fixture proves
  rejection occurs before the checker; a docs-only fast-marker fixture proves
  neither admission nor skipped-slot provenance runs.
- A self-wiring fixture removes or reorders the hook call and fails full
  `harness:check` with the exact repair. No path/name is added to a new hook
  trigger list when a verify slot, controlled package script, generated-surface
  record, local rule, doctor ID, or skill file is introduced.
- Before enabling the gate, record the command inventory plus one cold run and
  ten warm runs on the standard dev container. The hard sub-timeout is 5.0s;
  the cold run must be at most 5.0s and warm p95 at most 2.0s. Check in the
  measured values and command used. A miss requires optimization or a narrower
  structural seam, never silent invariant removal. Owner decision 2026-07-22:
  this seconds-scale per-commit cost is approved — fast mode exists to avoid
  ten-plus-minute verify runs, not to shave seconds.

## Boundaries and sequencing

- Land leaf 08 first so this preflight reuses its generated skill check rather
  than preserving `skillWiring.smokeSubjects` or inventing a second inventory.
- Do not turn fast-commit back into full verification or weaken the full land
  gate, fast-commit provenance, pre-push requirement, marker identity, or bridge
  contract.
- Do not copy checker logic, control IDs, verify slots, Bun-script classes, or
  changed-path triggers into shell. The manifest and existing typed
  loaders/checkers remain authoritative.

## Implementation record — 2026-07-22

The implementation uses one typed, non-spawning registration collector shared
by `harness:check` and `harness:registration:check`. The collector reads the
manifest once, calls the existing per-field/parity authorities, renders the
three hook-consumed verify registration fragments in process, and calls leaf
08's in-process skill projection/check core. Full `harness:check` then layers
the intentionally deferred spawned generators, fixture/import closure,
documentation, porting, CI, and hook-behavior checks on top. This was the
simplest design that preserved one finding/repair authority without turning
fast mode into a subset of the `scripts` slot.

The shared gate engine owns an optional pre-cache admission callback. For a
source-relevant fast-mode commit, the hook selects that callback after its
unstaged rejection and source-relevance decision. The engine runs it once under
the existing verification/commit-queue locks, log root, process-tree cleanup,
overall watchdog, and start/final fingerprint providers before native-marker or
verify-bridge evaluation. The hook applies the separate hard sub-timeout with
`timeout --foreground --signal=TERM --kill-after=1s 5s`. This keeps timeout
policy visible in the adapter while the engine owns lifecycle mechanics.

Command inventory for the admission is exactly one child command:

```sh
bun run harness:registration:check
```

That command spawns no generators, tests, shells, services, browsers, or
databases. Its in-process inventory is manifest/package parsing; local ESLint
configuration and ratchet registry imports; control/source/script, verify-slot,
package-script, local-rule/overlay/ratchet/doctor parity; generated-surface
schema and script metadata; pure byte rendering of `steps.generated.sh`, the
generated-surface freshness fragment, and the generated Bun classifier; and
leaf 08 skill mirror plus marked smoke-subject projection diffs.

Timing was measured in the standard dev container with Bun 1.3.14 by launching
the exact command in eleven fresh child processes from one Bun driver, recording
the first as cold and the following ten as warm. The measured cold run was
0.966s. Warm runs were 0.961s, 0.964s, 0.980s, 0.959s, 0.979s, 0.966s, 0.947s,
0.953s, 0.960s, and 0.962s; nearest-rank warm p95 was 0.980s. Both are within
the 5.0s cold/sub-timeout and 2.0s warm-p95 budgets.

Independent behavioral assertions, spawned generated-output checks, fixture
closure, documentation/porting/CI checks, and hook behavior probes remain late
tripwires in full `harness:check`, `scripts`, or full verification. They were
deliberately not moved into fast admission.

Post-implementation review hardened four lifecycle boundaries. Fast mode is
now snapshotted once under the acquired locks and that value binds admission,
fingerprinting, slot resolution, and skipped-slot provenance. Admission backs
up and restores the complete prior verification evidence directory—not only
wrapper metadata—on marker/bridge hits, admission failures, timeout, and
interrupt, while preserving the current registration log. The registration
collector now renders the harness-check fixture copy manifest as the fourth
verify fragment and its skill core explicitly covers smoke-subject projections,
so fast-mode advisory suppression is limited to invariants admission actually
blocks; docs-only commits retain their advisories because admission is
unreachable. Status 124 also emits a concise retry diagnostic.
