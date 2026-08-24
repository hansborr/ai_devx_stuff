# 243. Correct prototype headers that deny registered advisory commands

Status: Landed on fix/cq-243
Theme: Prototype source headers deny their now-registered advisory commands · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Source headers are important ownership cues in the large, flat drift-ai
analyzer subsystem. Three still describe pre-wiring milestones and state that
four live prototype advisory commands do not exist.

Those false current-state statements invite maintainers to re-plan completed
work and misclassify production command behavior as library- or test-only.
They also obscure the intended layering: inventory and configuration modules
remain finding-free libraries, while separate command modules own parsing,
execution, and advisory rendering.

## Evidence

- `scripts/drift-ai/config.ts:116-121` — says no check, subcommand, or advisory
  reads the coverage artifact declarations.
- `scripts/drift-ai/coverage-evidence-command.ts:40-57` — resolves those
  declarations, reads the artifacts, builds an advisory, and renders it.
- `scripts/drift-ai/coverage-unused-correlation-command.ts:46-71` — independently
  reads `config.coverage.artifacts`, correlates them with unused exports, and
  renders another advisory.
- `scripts/drift-ai/clone-candidates.ts:5-10` — describes the generator as
  library/test-only, says no advisory is registered, and assigns wiring to a
  later task.
- `scripts/drift-ai/class-construction.ts:1-6` — likewise says the inventory has
  no subcommand or advisory row and assigns user-facing output to a later task.
- `scripts/drift-ai/prototype-subcommands.ts:49-60` — the production handler
  registry exposes `coverage-evidence`, `coverage-unused-exports`,
  `clone-candidates`, and `class-construction`.

Reproduce the counts with `rg -l 'no check, subcommand, or|library/test-only' scripts/drift-ai/{config,clone-candidates,class-construction}.ts | wc -l` for the stale headers and `rg -c '^\s+"?(coverage-evidence|coverage-unused-exports|clone-candidates|class-construction)"?:' scripts/drift-ai/prototype-subcommands.ts` for the registered handlers.

## Proposed direction

Rewrite only the three stale milestone headers:

1. In `config.ts`, state that `coverage.artifacts` remains a top-level evidence
   source rather than a finding-producing check, and name its current
   consumption by the registered coverage prototype commands.
2. In `clone-candidates.ts`, describe the module as the high-recall inventory
   library beneath the registered `clone-candidates` command and its advisory
   layer. Preserve the distinction from the live near-duplicates check.
3. In `class-construction.ts`, describe the module as the finding-free class
   inventory beneath the registered `class-construction` command and its
   advisory layer.

Verify every rewritten statement against the corresponding command module and
`PROTOTYPE_SUBCOMMAND_HANDLERS`. No command behavior, handler registration,
task-coordinate qualification, or test logic should change.

## Scope / caveats

- Limit the edit to the three claims contradicted by the registered handlers.
  Preserve useful algorithm, cap, caveat, and layer-boundary commentary around
  them.
- Do not revive the 60-plus coordinate-qualification sweep or trim the headers
  in `routes/upload-routes.ts` or
  `scripts/harness/harness-diagnostics-output.ts`. Prior-pack
  [code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md](../code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md)
  (CQ25-168) remains binding for those refused changes.
- Prior-pack
  [code-quality-2026-07-25/28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md)
  (CQ25-35) schedules a future `scripts/drift-ai/MODULE.md`, but a directory
  map does not repair false source-local ownership statements.
- [147-major-harness-implementation-directories.md](./147-major-harness-implementation-directories.md)
  covers local module maps for `scripts/harness/` and `scripts/code-intel/`,
  not these drift-ai prototype headers.
