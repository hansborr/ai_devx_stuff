# harness module

Concepts: harness controls manifest, generated surfaces, hook wiring, registration checks, skill artifacts, harness diagnostics

## Purpose

This directory owns the implementation behind the top-level harness facades:
validating the control inventory against the live tree, projecting manifest
facets into committed generated artifacts, wiring hooks and shims for the
Claude/Codex/Copilot adapters, and assembling harness diagnostics reports.

`harness.controls.json` at the repo root is the control inventory authority.
It is hand-authored for every control kind except lint rules, which
[`generate-lint-rule-controls.ts`](./generate-lint-rule-controls.ts) derives
into the `harness.controls.lint-rules.generated.json` include;
[`harness-manifest.ts`](./harness-manifest.ts) joins the two halves for every
reader.

It does not own changed-file classification or smoke-subject mapping
([`scripts/path-policy/`](../path-policy/MODULE.md)), the shared AI hook
bodies (`scripts/ai-hooks/`), the verify-step runtime
(`scripts/verify/steps-lib.sh` interprets the step data generated here), or
the code-intel query family ([`scripts/code-intel/`](../code-intel/MODULE.md)).

## Data Flow

The manifest read seam is a three-module contract:
[`harness-manifest.ts`](./harness-manifest.ts) owns path + IO with no shape
opinion, [`harness-manifest-schema.ts`](./harness-manifest-schema.ts) owns the
Zod shape with no IO, and
[`harness-manifest-loader.ts`](./harness-manifest-loader.ts) is the one module
that joins them. New manifest consumers import from the loader;
[`manifest-contract-check.ts`](./manifest-contract-check.ts) keeps the
direct-reader allowlist shrink-only. The shared control-field vocabulary —
control kinds, categories, and repair kinds — lives in
[`control-field-validation.ts`](./control-field-validation.ts), imported by
the schema, the registration checks, and the generators; adding a control
kind means updating it too, and the schema test pins kind parity against it.

Downstream of that seam, the durable clusters are:

- **Generated-surface registration and freshness.**
  [`generated-surfaces.ts`](./generated-surfaces.ts) is the only sanctioned
  read path for the `generatedSurface` facet;
  [`generated-surface-dependencies.ts`](./generated-surface-dependencies.ts)
  derives walkable fixture dependencies as an additive projection, never a
  second registration surface. [`generate-verify-steps.ts`](./generate-verify-steps.ts)
  renders four committed artifacts from those same declarations under the one
  `bun run verify:steps` refresh command — the verify slot data, the freshness
  shell fragment, the classified-bun-scripts fragment, and the harness-check
  fixture manifest under `scripts/tests/`.
- **Hook wiring.** [`generate-hook-wiring.ts`](./generate-hook-wiring.ts)
  renders hook wiring for all three adapters — writing the Codex and Copilot
  hook configs whole but replacing only the `hooks` value inside the
  hand-authored `.claude/settings.json` — and reconciles the on-disk shims
  rendered by [`hook-shims.ts`](./hook-shims.ts);
  [`hook-wiring-schema.ts`](./hook-wiring-schema.ts) parses the facet and
  [`generate-hook-timeout-constants.ts`](./generate-hook-timeout-constants.ts)
  projects shared timeout constants.
- **One-artifact generators.** Command policy, config surfaces, the manifest
  JSON schema, the local ESLint plugin registry (discovered by
  [`local-rule-discovery.ts`](./local-rule-discovery.ts)), restricted disable
  rules, the pre-push scope trigger, and the agent-facing controls doc each
  have a `generate-*.ts` with a paired `--check` mode.
- **Skill artifacts.** [`generate-skill-artifacts.ts`](./generate-skill-artifacts.ts)
  projects skill overlays and smoke-subject blocks through
  [`skill-artifact-projection.ts`](./skill-artifact-projection.ts);
  [`check-skill-inventory.ts`](./check-skill-inventory.ts) diffs projection
  against disk.
- **Validation composition.** `scripts/harness-check.ts` composes fixture-copy
  closure ([`fixture-closure-check.ts`](./fixture-closure-check.ts)), the
  manifest read tripwire, registration checks
  ([`registration-check.ts`](./registration-check.ts)), preflight wiring,
  generated freshness, hook-wiring structure, porting-knob parity, pre-push
  scope, and CI gate parity ([`harness-gate-parity.ts`](./harness-gate-parity.ts)).
- **Diagnostics.** [`harness-diagnostics-output.ts`](./harness-diagnostics-output.ts)
  is the one emission kernel (validate, route, atomic write) every
  `HarnessDiagnostics` producer routes through;
  [`harness-audit-report.ts`](./harness-audit-report.ts) assembles and renders
  the fused audit report.

## External Entry Points

- The four top-level facades: `scripts/harness-check.ts`
  (`bun run harness:check`, the validation/freshness gate),
  `scripts/harness-audit.ts` (`bun run harness:audit`, report-only
  diagnostics), `scripts/harness-registration-check.ts`
  (`bun run harness:registration:check`, including `--explain`), and
  `scripts/harness-emit-envelope.ts` (stdin findings to envelope).
- Each generator pairs a refresh script with a `:check` alias (for example
  `harness:wiring`, `harness:command-policy`, `harness:skills:refresh`,
  `verify:steps`, `docs:harness-controls`); `harness:check` reaches every
  `:check` through the `generatedSurface` facet, so the aliases are the
  targeted repair commands.
- Imports used from outside the directory: every diagnostics producer
  family (`lint-agent`, `lint-ratchet`, `drift-ai`, `logs-audit`, plus the
  emit-envelope facade) routes envelopes through
  [`harness-diagnostics-output.ts`](./harness-diagnostics-output.ts), and
  `scripts/path-policy/` reads both the manifest leaf
  ([`harness-manifest.ts`](./harness-manifest.ts)) and the generated-output
  path constants ([`harness-paths.ts`](./harness-paths.ts)), and
  `scripts/lint-ratchet/` reads the manifest path from the former — changes to
  those surfaces reach beyond this directory.
- Two generated fragments in this directory are sourced by git hooks:
  `.husky/pre-commit` sources `generated-surface-freshness.generated.sh` and
  `.husky/pre-push` sources `pre-push-scope-trigger.generated.sh`.

## State Ownership

No runtime state. The directory owns the committed generated artifacts its
generators render and their freshness; each generator pairs with a `:check`
alias, and a generated artifact is repaired by rerunning its refresh script,
never by hand-editing. Generated output paths shared between a generator and
its validator live once in [`harness-paths.ts`](./harness-paths.ts).

Mixed ownership is field- or marker-delimited: hook wiring rewrites only the
`hooks` value in hand-authored `.claude/settings.json`, and skill artifact
projection rewrites only the generated smoke-subject block in hand-authored
`scripts/tests/test-skill-dispatch-wrappers.sh`. The settings file's
`permissions.deny` array is likewise hand-edited — `harness:command-policy`
only freshness-checks it against the command-policy rules' native projection,
so a deny-parity failure is repaired by editing the settings file (or the
rule's `nativePermissions` in `harness.controls.json`) and re-running the
check, not by any generator write.

## Test Seams

- Subject-named `*.test.ts` suites sit beside each module; run one with
  `bun run test:scripts:file -- <file>`.
- Generator suites keep typed scenario builders file-local; malformed fixtures
  and duplicate-control-ID cases stay as raw inline objects.
- Shell smokes cover the facades end to end:
  `scripts/tests/test-harness-check.sh`,
  `scripts/tests/test-generate-harness-controls.sh`, and
  `scripts/tests/test-harness-emit-envelope.sh` (run one with `bash <path>`).
- [`registration-explain.test.ts`](./registration-explain.test.ts) covers the
  `--explain` report model separately from the gate path.

## Gotchas

- `harness:audit` is report-only by contract: findings of any severity never
  change the exit code. Its exit-2 paths are CLI usage errors, envelope read,
  JSON, or schema failures, and report-write failures; `--help` exits 0.
  Preserve that non-gating contract when extending the audit path (header of
  `scripts/harness-audit.ts`).
- Bootstrap order: [`generate-local-plugin.ts`](./generate-local-plugin.ts)
  must run before any generator that imports `eslint.config.js` (notably
  `generate-lint-rule-controls.ts`); see both headers.
- [`harness-paths.ts`](./harness-paths.ts) is a deliberate import-nothing
  leaf shared by generators and validators; follow that pattern for new
  shared harness constants.
- [`hook-shims.ts`](./hook-shims.ts) turns manifest values into filesystem
  write targets, so it validates the exact per-adapter command grammar before
  deriving any path. That safety posture is a design requirement; its header
  states the accepted grammar and the rejected cases.
- A new module imported by a generator must be reflected in the relevant
  `generatedSurface` trigger paths and fixture closure; the fixture manifest
  that records it is refreshed by `bun run verify:steps`, not by anything
  named for `scripts/tests/`. Run `bun run harness:check` before committing
  changes here.
