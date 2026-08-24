# 122. The portable lint-ratchet package hard-codes Musi's `bun run` command vocabulary through its kernel and governance remediation output

Status: Landed on fix/cq-122
Theme: portable-kernel host-vocabulary injection · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet package presents itself as a portable engine: adopters inject
repository paths through `LintRatchetEngineContext`, and the doc comment on that
type promises "the engine has zero Musi bindings"
(`tools/lint-ratchet/src/kernel/engine-context.ts:5-11`). The promise holds for
paths but not for words. Every remediation string the kernel and governance
layers print — run summaries, gate failures, drift diagnostics, debt-accounting
errors — spells out Musi's operational commands as literals: 17 `bun run
lint:ratchet:*` strings across eleven non-test modules, several exported as
module-level constants. An adopter who copies the package and runs it under npm,
pnpm, or differently named scripts gets confidently wrong recovery instructions
("run `bun run lint:ratchet:update`") from an engine they cannot rebind without
editing package source. The in-repo demo, which exists to prove copyability,
only prints correct output because its `package.json` copies Musi's script names
verbatim — it demonstrates the coupling rather than the portability.

The cost cuts both ways. For adopters, the flagship portable artifact of a
public harness-engineering reference requires source edits to produce usable
output. For Musi, renaming any `lint:ratchet:*` script is an eleven-module,
seventeen-site change spread through parsing, validation, recovery, drift
classification, and remediation — plus a persisted-file contract, because the
update command is written into the committed baseline's `regenerate` annotation
and staleness-checked against the same constant on every parse. One hard-coded
baseline filename also survives in the kernel spec despite the overridable
default the engine context already provides.

## Evidence

- 17 `bun run lint:ratchet` literals in non-test package sources, re-counted at
  the pin: 11 across 5 kernel files and 6 across 6 governance files
  (`grep -rn "bun run lint:ratchet" tools/lint-ratchet/src --include="*.ts"
  --exclude="*.test.ts" --exclude="*.spec.ts"`).
- Kernel sites: `tools/lint-ratchet/src/kernel/baseline-constants.ts:10`
  (`export const LINT_RATCHET_BASELINE_REGENERATE = "bun run lint:ratchet:update"`),
  `kernel/baseline-spec.ts:116-117` (merge-driver installer + update commands),
  `kernel/baseline-validation.ts:58,213` (stale rule-source hash and nondeterministic-JSON failure messages),
  `kernel/recovery-command.ts:7,12` (exported `RATCHET_UPDATE_COMMAND` /
  `RATCHET_REGRESSION_UPDATE_COMMAND`, composed into
  `REGRESSION_RECOVERY_FOOTER` at `:14`), `kernel/rule-source-drift.ts:84,89,96,101`
  (four drift-classification remediation strings).
- Governance sites: `tools/lint-ratchet/src/governance/retire-update.ts:28`,
  `governance/trend.ts:10` (`ALL_HISTORY_COMMAND = "bun run lint:ratchet:trend -- --all"`),
  `governance/baseline-debt-accounting-format.ts:72`,
  `governance/baseline-debt-accounting-git.ts:161`,
  `governance/zero-baseline.ts:299`, `governance/propose.ts:237` (registry-paste
  hint ending "then run bun run lint:ratchet:update").
- The regenerate annotation is a persisted contract, not just display text:
  `kernel/baseline-spec.ts:112` writes it into the baseline via
  `lintRatchetBaselineRegenerateForVersion`, and
  `kernel/baseline-validation.ts:169-172` warns "baseline regenerate annotation
  is stale" whenever the committed value differs from
  `LINT_RATCHET_BASELINE_REGENERATE`.
- `kernel/baseline-spec.ts:115` hard-codes `baselineFile:
  "lint-ratchet.baseline.json"` even though
  `kernel/engine-context.ts:47` already exports an overridable
  `DEFAULT_BASELINE_FILENAME` for exactly this name.
- The target injection shapes already exist in miniature:
  `BaselineConflictMarkerRemediation` (`kernel/group-baseline.ts:14`) is a
  structured filename+commands bag threaded through the spec, and
  `governance/baseline-debt-accounting-format.ts:63-67` already accepts
  adapter-supplied `baselineName`/`debtLogName` parameters — while the command
  in the same message (`:72`) stays literal.
- Both adapters exist and construct their own contexts today: Musi's
  `scripts/lint-ratchet/engine-binding.ts` (builds `musiLintRatchetBinding` /
  `musiLintRatchetContext`) and
  `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts`, whose header
  calls itself "the demo's whole binding to the portable engine".
- Musi-side consumers import the command constants straight from the package:
  `scripts/lint-ratchet/default-mode.ts:12`, `scripts/lint-ratchet/report.ts:15-17`,
  `scripts/lint-ratchet/diagnostics.ts:10` all import from
  `@musi/lint-ratchet/kernel/recovery-command.js`.
- All the hard-coded spellings correspond to real root scripts today
  (`lint:ratchet:update`, `lint:ratchet:install-merge-driver`,
  `lint:ratchet:trend` in the root `package.json`) — the strings are correct
  for Musi and wrong for everyone else, which is why nothing fails in-repo.

## Proposed direction

Generalize the package's existing injection idiom rather than inventing a new
one. The layering rule `engine-context.ts` already encodes carries over:
host-neutral *filenames* (`lint-ratchet.baseline.json`, debt-log) keep kernel
`DEFAULT_*` constants with override; *command spellings* get no kernel default
at all — the vocabulary is a required binding each adapter constructs once.
Musi's `scripts/lint-ratchet` supplies the current `bun run lint:ratchet:*`
strings; `examples/lint-ratchet-demo` supplies its own, which is the
copyability proof. Slice 1 = steps 1-3 (kernel + Musi adapter); slice 2 =
steps 4-5 (governance + demo + guard test).

1. **Define the vocabulary type in the kernel.** Add a
   `LintRatchetWorkflowVocabulary` interface mirroring the already-structured
   `BaselineConflictMarkerRemediation` shape (`kernel/group-baseline.ts:14`)
   and the `LintRatchetEngineContext` pattern
   (`kernel/engine-context.ts:13-17`). Fields: `updateCommand`, an allow-worse
   update template built from the existing
   `RATCHET_REGRESSION_REASON_PLACEHOLDER` (`kernel/recovery-command.ts:9-10`),
   `installMergeDriverCommand`, `trendAllCommand`, plus the registry-paste hint
   `governance/propose.ts:237` needs. No defaults for any command field.
2. **Thread the kernel (slice 1).** `lintRatchetBaselineSpec` gains a
   vocabulary parameter — `lintRatchetBaselineSpec(versionPolicy, vocabulary)`
   — and uses it to fill `conflictMarkerRemediation`
   (`kernel/baseline-spec.ts:114-118`) and the `regenerate` annotation (`:112`);
   while there, make `:115` consume the context-resolved baseline filename
   instead of its own literal. The `recovery-command.ts` constants
   (`RATCHET_UPDATE_COMMAND`, `RATCHET_REGRESSION_UPDATE_COMMAND`,
   `REGRESSION_RECOVERY_FOOTER`) become functions of the vocabulary.
   `baseline-validation.ts` and `rule-source-drift.ts` take it through their
   existing parameters. Critical contract point: the regenerate annotation is
   written into the committed baseline and staleness-checked at
   `kernel/baseline-validation.ts:169-172`, so the write path and the
   validation path must consume the *same* binding, and Musi's adapter must
   supply byte-identical strings to today's literals — otherwise every gate run
   either churns the committed baseline or falsely reports it stale.
3. **Bind Musi's adapter and repoint its consumers.** Construct the vocabulary
   once next to `musiLintRatchetContext` in
   `scripts/lint-ratchet/engine-binding.ts`, then switch
   `scripts/lint-ratchet/{default-mode,report,diagnostics}.ts` from importing
   package constants to importing the adapter's own binding. This is an
   adapter-visible API change within the same repo — fine to do in one slice.
4. **Thread governance and convert the demo (slice 2).** `retire-update.ts`,
   `zero-baseline.ts`, `baseline-debt-accounting-{format,git}.ts`, `trend.ts`,
   and `propose.ts` take the vocabulary via their existing context/paths
   parameters. Convert
   `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts` to supply its
   own command spellings — the second adopter is the proof the binding works.
5. **Guard the boundary.** Add a package-level test asserting no `bun run`
   literal survives in non-test kernel/governance sources, so the layer
   ratchets instead of eroding. It must land in the same change as the last
   conversion (step 4), not before.

## Scope / caveats

- **Out of scope:** renaming Musi's actual bun scripts; the deferred
  testId→ratchetId rename (prior-pack CQ25-74); and any structured-error
  refactor that moves *all* message assembly into the adapter — the vocabulary
  binding is the chosen approach, not wholesale prose relocation.
- **Persisted-file risk.** The regenerate annotation is the one place a wrong
  binding corrupts state rather than just printing badly: if the write side and
  the staleness validator end up bound to different vocabulary instances, or
  the Musi adapter's strings drift from the committed baseline by even
  whitespace, every gate run reports a stale annotation or forces a baseline
  rewrite. Pin the Musi strings with an exact-equality test against today's
  literals.
- **No half-converted state.** Threading 11 modules mechanically risks some
  remediation paths printing bound commands while others print residual
  literals; the step-5 guard test is the backstop and must land with the final
  conversion.
- **Expect broad, shallow test churn.** Many package tests assert exact
  remediation strings. Update the expected strings; do not weaken assertions to
  substring matches, which would mask future leakage.
- **Prior pack:** CQ25-12 landed `repairKind` and scripts-tsconfig inference
  and separately deferred the testId naming question; it did not rule on host
  command or filename bindings, so this leaf is verified residual scope, not a
  reopen. CQ25-133's refusal covered only the `allowEmpty` move.
- **Sequencing:** no hard dependencies. Soft edges: land before — or explicitly
  rebase-coordinate with — any future CQ25-74 (testId→ratchetId) work, which
  touches the same kernel modules; light file adjacency with
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md)
  in `scripts/lint-ratchet/` — do not run the two lanes concurrently, to avoid
  adapter-file merge conflicts. This leaf echoes the "Musi policy inside a
  reusable core" pattern of
  [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md)
  but shares no artifacts with it.
- Soft edge to
  [188-let-lint-ratchet-proposal-previews-evaluate.md](./188-let-lint-ratchet-proposal-previews-evaluate.md):
  both modify `tools/lint-ratchet/src/governance/propose.ts`; serialize or
  explicitly rebase-coordinate them so workflow-vocabulary threading and
  third-party preview changes share the final proposal option, binding,
  remediation-hint, and formatting paths.
