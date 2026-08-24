# 224. Remove lint-ratchet compatibility APIs used only by tests

Status: Landed on fix/cq-224
Theme: Superseded lint-ratchet convenience APIs survive only in tests · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three compatibility shapes remain in the lint-ratchet API after their real
consumers moved to richer replacements: a singular debt-log append wrapper, a
string-only zero-baseline audit wrapper, and a registry validator overload that
accepts a bare set. Tests preserve all three, but production and example callers
use the batch append, result-returning audit, and options-object validator.

The extra exports and runtime normalization enlarge the governance and kernel
contracts without supporting a real adapter. They also split tests between
canonical and compatibility paths, making the older shapes look like supported
extension points and obscuring which API future callers should adopt.

## Evidence

- `tools/lint-ratchet/src/governance/debt-log-write.ts:113-142` — the canonical
  batch operation validates and appends an array, followed by the exported
  `appendValidatedDebtLogEntry` wrapper, which only boxes one entry into an
  array and delegates.
- `tools/lint-ratchet/src/governance/baseline-update-apply.ts:149-150` —
  production baseline update already calls
  `appendValidatedDebtLogEntries` with the complete batch.
- `tools/lint-ratchet/src/governance/zero-baseline.ts:304-312` — the
  string-returning `runLintRatchetZeroBaselineAudit` only awaits
  `runLintRatchetZeroBaselineAuditResult` and extracts `.report`.
- `scripts/lint-ratchet/modes.ts:86-96` — the adapter calls the
  result-returning operation because it needs both the report and
  `undocumentedRows`.
- `tools/lint-ratchet/src/governance/debt-log-write.test.ts:252-327` and
  `tools/lint-ratchet/src/governance/zero-baseline.test.ts:234-267` — dedicated
  tests still call the singular and string-only wrappers.
- Measurement — the exact non-documentation, non-test search
  `rg -n --glob '!docs/**' --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/*.spec.tsx' --glob '!tools/lint-ratchet/src/governance/debt-log-write.ts' --glob '!tools/lint-ratchet/src/governance/zero-baseline.ts' '\b(appendValidatedDebtLogEntry|runLintRatchetZeroBaselineAudit)\b' .`
  returned zero callers outside the two declarations.
- `tools/lint-ratchet/src/kernel/registry-validation.ts:70-85` — a duck-typed
  `has`/`forEach` predicate and normalizer convert the legacy `ReadonlySet`
  argument into `{ localRuleIds }`.
- `tools/lint-ratchet/src/kernel/registry-validation.ts:311-319` — the exported
  validator advertises the set-or-options union and normalizes it before
  validation.
- `tools/lint-ratchet/src/kernel/baseline.test.ts:2511-2515` — the valid-fixture
  test is the sole direct-set caller.
- Measurement — the exact non-test search
  `rg -n --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/*.spec.tsx' 'validateLintRatchetRegistry\([^,]+, \{' scripts tools examples`
  returned exactly three options-object callers:
  `scripts/lint-ratchet/modes.ts:120`,
  `scripts/lint-ratchet/check-registry.ts:74`, and
  `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:164`. The exact search
  `rg -n 'validateLintRatchetRegistry\([^,]+, new Set' scripts tools examples`
  returned only `baseline.test.ts:2514`.

## Proposed direction

Delete the three compatibility paths and retarget their tests to the canonical
APIs:

1. Remove `appendValidatedDebtLogEntry`. Update the focused debt-log tests to
   call `appendValidatedDebtLogEntries([entry], ...)`, preserving coverage of
   invalid-entry rejection, newline termination, tail deduplication, and
   unterminated-log separation.
2. Remove `runLintRatchetZeroBaselineAudit`. Update its focused tests to call
   `runLintRatchetZeroBaselineAuditResult`; inspect `.report` when testing
   rendered text and keep rejection assertions against the returned promise.
   Preserve the adapter's existing result-based behavior.
3. Remove `isReadonlyStringSet`, `normalizeRegistryOptions`, and the
   `ReadonlySet<string> | ValidateLintRatchetRegistryOptions` parameter union.
   Make the canonical parameter
   `ValidateLintRatchetRegistryOptions` with an empty-object default so existing
   no-second-argument callers remain valid. Change the sole direct-set test to
   pass `{ localRuleIds: new Set(...) }`.
4. Re-run the production, example, and test census before deleting each
   surface, then run the focused governance and kernel test files. Acceptance
   requires zero references to the removed names, no direct-set validator
   calls, and unchanged observable validation, debt-log, and audit-report
   behavior through the canonical APIs.

Keep the deletions and their test retargets in the same change so no
compatibility-only test continues to imply that a removed shape is supported.

## Scope / caveats

- Confirm the production and example consumer census immediately before
  deletion. If a real consumer has appeared, migrate it explicitly to the
  canonical API rather than silently breaking it.
- Coordinate the debt-log edit with
  [160-debt-log-union-uses-absence-discriminator.md](./160-debt-log-union-uses-absence-discriminator.md),
  which changes the same batch validation and append surface. Preserve its
  validation-before-append and mixed-vintage compatibility requirements.
- Coordinate the registry edit with
  [175-metric-strategy-registry-does-not-make.md](./175-metric-strategy-registry-does-not-make.md),
  which also narrows a test-only registry surface. Whichever lands second
  should rebase the focused kernel tests rather than restore either convenience
  API.
- Do not remove or weaken `appendValidatedDebtLogEntries`,
  `runLintRatchetZeroBaselineAuditResult`, or the options-object form of
  `validateLintRatchetRegistry`; those are the canonical production surfaces.
- Preserve no-argument registry validation through the empty-options default.
  The cleanup removes only the bare-set overload and its duck typing.
- No lint-ratchet behavior, debt-log format, registry rules, diagnostics,
  baseline format, report text, or exit semantics should change.
- There is no prior-pack residual for these compatibility APIs.
