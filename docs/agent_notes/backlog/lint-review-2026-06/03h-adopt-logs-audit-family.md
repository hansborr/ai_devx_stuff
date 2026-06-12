# 03h: Adopt Logs-Audit Modules

Status: Done (2026-06-12, landed in "refactor(lint): adopt logs-audit family
into normal lint")

Completion notes:

- `scripts/logs-audit.ts` and `scripts/logs-audit/**/*.ts` now join normal
  lint through `lintedScriptFiles`; `scripts/logs-audit/fixtures/**` stays out
  of the scripts tsconfig and the JSONL fixtures do not match the TypeScript
  re-include.
- Removed all logs-audit entries from `scriptDebtOverrideConfigs`: the
  relaxed CLI options block, the test relax block, and the unbacked
  `complexity` off. The probe surfaced real hidden findings; they were fixed
  with smaller argument parsing helpers, named numeric constants/stringified
  template values, caught-error `cause`, context objects for max-params
  helpers, and `vi.stubEnv` in the sidecar tests.
- Re-measure showed every production logs-audit file under the normal max-300
  cap, so the stale `scripts/logs-audit.ts` max-lines warn exception and the
  zero `ratchet/local-max-lines-logs-audit` ratchet were deleted (manifest,
  generated harness-controls doc, coverage map, baseline, and debt log
  updated). The large unit test remains normal-linted under the test tier where
  `local/max-lines` is intentionally off.
Order: 03h
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

`lintedScriptFiles` re-includes `scripts/logs-audit.ts` and
`scripts/logs-audit/**/*.test.ts` but NOT the five implementation modules:
`logs-audit-checks.ts`, `logs-audit-diagnostics.ts`,
`logs-audit-event-fields.ts`, `logs-audit-redaction.ts`,
`logs-audit-request-ids.ts`. `tsconfig.scripts.json` already includes
`scripts/logs-audit/**/*.ts`; `scripts/logs-audit/fixtures/**` stays
excluded.

Floors and suppressions:

- `ratchet/local-max-lines-logs-audit` (zero);
- `logs-audit.ts` in the `complexity: "off"` block — UNBACKED (no
  complexity ratchet covers it; probe expecting live findings);
- `logs-audit.ts` in the relaxed CLI block (fix-or-keep decision);
- `logs-audit/logs-audit.test.ts` in the test-file relax block.

## Scope

1. Widen the `lintedScriptFiles` entry to `scripts/logs-audit/**/*.ts`
   (keeping fixtures ignored); probe the full rule surface over the five
   modules and fix findings.
2. Remove the unbacked `complexity` off and the test relax entry; fix or
   take narrow line-scoped overrides.
3. Re-measure the family against the normal max-lines cap (the legacy map
   listed `logs-audit` among "large entrypoints"); split if over, then drain
   `ratchet/local-max-lines-logs-audit`.
4. Settle the relaxed-CLI-options entry.
5. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

All non-fixture `scripts/logs-audit/**` files plus `logs-audit.ts` are under
normal lint with no suppression entries; the logs-audit max-lines ratchet is
drained.

## Verification

Umbrella gate set, plus
`bash scripts/vitest.sh run scripts/logs-audit/logs-audit.test.ts` (and the
other logs-audit tests) after any splits.
