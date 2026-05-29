# Lint guidance fixes (R1–R7)

Landed on `feat/lint-improvements-v2` (7 commits, `da304a37`..`eb40127c`).
Implemented `/home/node/lint_system_implementation_plan.md`. Goal: make the
lint-ratchet / per-edit-hook guidance an agent actually reads steer toward the
*working* recovery action, without ever turning the advisory surfaces into gates.

## Invariant preserved

Per-edit hooks (`tidy-edited-file.sh`, `lint-coverage-check.sh`) and
`lint:ratchet` stay non-blocking in the edit loop — all new output is additive
(`ai_emit_additional_context` / exit 0). The `return 1` added inside
`ai_lint_coverage_check_file` is purely the main loop's internal "captured a
message" signal, not a hook exit code. Gates remain at verify/pre-commit/CI.
Codex (gpt-5.5) second-opinion review of the full branch: no P0/P1/P2 findings.

## Commits

- `da304a37` (R1) — new `scripts/lint-ratchet/recovery-command.ts` is the single
  source of truth for the update commands. Regression `howToFix`, the report
  footer, and CI footers now emit the working `… -- --allow-worse --reason
  "<why>"` form (the bare `lint:ratchet:update` *refuses* while a regression is
  present — `baseline-update.ts:decideLintRatchetUpdate`). `footerRecoveryLine`
  inverted so a mixed regression+improvement envelope shows the regression footer.
- `2ec24f08` (R2) — tidy hook adds a non-mutating `eslint -f json` pass after a
  clean `--fix` and emits a capped advisory naming residual warn-level rules
  (all warn-level rules here are non-autofixable, so post-fix read is sound).
- `a7fa85ce` (R4) — verify/pre-commit set `HARNESS_DIAGNOSTICS_OUTPUT` per ratchet
  step and render `lint:ratchet:report` on failure via
  `ai_ratchet_failure_excerpt` (output-filter.sh): success → rendered report;
  missing/empty envelope → crash note + raw tail; formatter non-zero → note +
  captured output + raw tail. Both gates wipe `LOG_DIR` per run, so no stale
  envelope can masquerade as 0 findings.
- `a2a0c668` (R3) — generic (third-party/core) findings carry
  `zeroBaselineDisposition.reason` into `why`; fixed the "then Reduce"
  capitalisation via `lowercaseFirst` at the mid-sentence concat sites only.
- `73d09782` (R6) — the two `vitest/expect-expect` option-mismatch reasons now
  name the `assertFunctionNames` option. (Disposition reason is not part of the
  config hash, so the committed baseline is unaffected.)
- `959f7020` (R5) — stop reminder appends `failing gate(s): <names>` read from
  per-step `meta/*.json` (`exit_code != 0`, sorted/deduped, derived from
  metadata not hard-coded), with a no-meta fallback to the generic line.
- `eb40127c` (R7) — coverage hook prints the tracking ruleId(s) from the baseline
  and emits a softer single-rule advisory for ESLint-ignored-but-ratcheted files
  instead of full suppression.

## Out of scope (intentional)

F6 (de-dup the triple-stated principle — harmless, would add fragile coupling);
making any per-edit surface block; a structured `guide`/`principle` field on the
finding schema (deferred unless the disposition reason proves insufficient).
