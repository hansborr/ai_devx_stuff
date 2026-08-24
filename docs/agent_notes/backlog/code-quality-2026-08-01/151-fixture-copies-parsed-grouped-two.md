# 151. Derive shell-closure copy groups from the canonical fixture sandbox model

Status: Landed on fix/cq-151
Theme: fixture copy modeling · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The fixture analyzer sends each smoke test's scoped shell through two
orchestration passes. One pass recognizes `cp` commands and groups copied shell
files for `# shellcheck source=` closure checks. The richer sandbox pass
separately recognizes the same copies, resolves their operands, attributes them
to roots, and groups them for smoke-metadata and static-import closure checks.

The two passes are not wholly independent tokenizers: they already share
command, expression, scope, and helper-call primitives. The duplicated boundary
is the orchestration over those primitives. It still means that a contributor
adding a supported copy spelling, loop/glob case, destination shape, or helper
composition must understand and align two interpretations of one shell edit.
Their capabilities have already diverged, making this a recurring correctness
and maintenance cost.

## Evidence

- `scripts/path-policy/fixture-shell-dependencies.ts:59-104` recognizes `cp`,
  tokenizes operands, derives a scripts-root destination, resolves sources,
  groups them by function scope plus fixture root, and merges helper
  contributions for shell closure.
- `scripts/path-policy/fixture-sandbox-model.ts:165-205` separately tokenizes
  the same `cp` source operands, resolves loop bindings, classifies files versus
  directories, and records unreadable operands.
- `scripts/path-policy/fixture-sandbox-model.ts:232-250` independently
  attributes the destination to a sandbox root and applies seeding annotations;
  `:282-350` performs scope/root grouping and helper-call merging.
- `scripts/path-policy/fixture-shell-dependencies.ts:222-237` sends the same
  `scopedLines` and assignments first through
  `collectCopiedShellSourcesByFixture` and then through
  `collectFixtureSandboxes`, using the resulting models for separate closure
  consumers.
- The passes share primitives rather than implementing two complete tokenizers:
  `fixture-shell-dependencies.ts:20-34` imports `commandOperands`,
  `resolveFixtureExpression`, `fixtureGroupKey`, and helper-source merging,
  while `fixture-sandbox-model.ts:33-51` imports the corresponding operand,
  grouping, helper, and loop utilities.
- `scripts/path-policy/fixture-copy-expressions.ts:123-143` deliberately resolves
  a `scripts/`-prefixed operand without an existence check so a deleted copied
  script reaches the closure walk's “does not exist” diagnostic.
- `scripts/path-policy/fixture-copy-expressions.ts:171-194` gives the sandbox
  path richer loop/glob and unreadable-operand handling;
  `:240-257` attributes non-`scripts/` destinations using the longest matching
  fixture root.
- `scripts/path-policy/fixture-sandbox-model.ts:174-203` skips sandbox-internal
  sources and records copied directories, behaviors absent from the shell-only
  pass.
- `scripts/path-policy/fixture-import-closure.ts:31-60` expands copied
  directories into executable entries, while `:77-90` skips
  `wholeTreeSeeded` and `composedIntoCaller` sandbox views. Those policies must
  not be accidentally inherited by shell closure.
- `scripts/path-policy/fixture-shell-dependencies.test.ts` is 803 lines at the
  pin, and `package.json:57-61` confirms its focused command is
  `bun run test:scripts:file -- scripts/path-policy/fixture-shell-dependencies.test.ts`.

## Proposed direction

Make `collectFixtureSandboxes` the single pass that recognizes `cp`, resolves
operands, attributes roots, and groups scope contributions. Delete
`parseFixtureCopyCommand` and
`collectCopiedShellSourcesByFixture` from
`fixture-shell-dependencies.ts`.

Extend the canonical sandbox facts to retain whether each copied source
targeted the sandbox's `scripts/` tree. Then derive each `FixtureCopyGroup`
from only those shell-closure-eligible `.sh` facts while retaining the existing
`functionScope + fixtureRoot` key. Filtering `FixtureSandbox.copiedFiles` alone
is insufficient because that set also includes sources copied to non-`scripts/`
destinations. Keep the shell-source and static
import-closure policies as separate consumers of this one parsed-facts stream;
this is model unification, not policy unification.

Have `collectSmokeFixtureFailures` call `collectFixtureSandboxes` once, then
feed the resulting `FixtureSeedingModel` to:

- existing seeding diagnostics and smoke-metadata checks;
- the derived shell groups and `collectFixtureClosureFailures`;
- existing sandbox/import-closure checks.

Use TDD to characterize every semantic delta before switching the source of
shell groups: loop/glob-resolved shell files, longest-match root attribution,
sandbox-internal source skipping, composed helper fragments, whole-tree-seeded
roots, copied directories containing shell files, and unreadable operands.
Default to current shell-closure behavior unless a whole-corpus comparison
demonstrates that a stricter sandbox-derived interpretation is intentional and
safe.

Keep a dedicated case for a nonexistent `scripts/**` operand. Although
`resolveFixtureOperand` delegates single paths to
`resolveFixtureExpression`, the nonexistent path falls through directory
detection into `copiedFiles`; it must still reach
`collectSourcedDependencyClosure` and produce the existing missing-file
diagnostic.

The acceptance check is the existing focused command
`bun run test:scripts:file -- scripts/path-policy/fixture-shell-dependencies.test.ts`,
whose live-smoke cases exercise `validateFixtureShellDependencies` across the
scripts corpus. Compare the complete ordered diagnostics before and after, not
only whether validation throws.

## Scope / caveats

- Do not change the three closure policies, seeding-annotation vocabulary,
  helper-call merge algorithm in `fixture-helper-calls.ts`, or the analyzer's
  public entry point.
- Derive groups from all sandbox views needed to preserve current shell
  behavior. In particular, do not automatically inherit import closure's
  `wholeTreeSeeded` or `composedIntoCaller` early return; current shell groups
  still check overlay shell copies and helper fragments.
- Do not expand copied directories into shell roots merely because the import
  consumer expands them. Characterize that difference and retain current
  behavior unless an explicit strictness change is justified.
- `collectFixtureSandboxes` emits unreadable-copy and stale-annotation failures.
  Reusing it must not duplicate, drop, or reorder the aggregate diagnostics
  asserted by the boundary suite.
- The live
  [2026-07-25 fixture-analyzer leaf](../code-quality-2026-07-25/49-path-policy-fixture-analyzer.md)
  already landed the directory orientation contract and shared-vocabulary work.
  Its proposed test split was permanently dropped, so this leaf uses the
  existing 803-line boundary suite as the parity harness and does not revive
  that split.
- This work does not wait on
  [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md);
  that leaf touches the smoke-subject query surface, not these copy-model
  orchestration passes.
