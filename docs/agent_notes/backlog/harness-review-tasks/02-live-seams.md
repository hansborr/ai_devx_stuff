# Harness Review Tasks - Live Seams

These anchors were checked on 2026-06-01. Reconfirm with `rg` before editing.

## Module Docs And Service Facades

- `packages/server/src/services/character-live-state/MODULE.md`
  - Stale line to fix: mentions `index.ts` as the public facade.
- `packages/server/src/services/README.md`
  - Describes service module weight and facade expectations.
- Examples of named logic-bearing facades:
  - `packages/server/src/services/combat-actions/combat-actions.ts`
  - `packages/server/src/services/spell-casting/spell-casting.ts`
  - `packages/server/src/services/level-up/level-up.ts`

## Harness Freshness And Drift

- `scripts/drift-ai/harness-freshness.ts`
  - Owns `extractBacktickPathReferences`, `staleBacktickPathFindings`, guide
    discovery, and JSON/text formatting for the existing freshness check.
- `scripts/drift-ai/repo-ignore.ts`
  - Owns the `git check-ignore` probe and path normalization helpers.
- `scripts/drift-ai/check-registry.ts`
  - Owns drift check registration.
- `scripts/drift-ai/types.ts`
  - Owns `DriftReport`, `DriftFinding`, skipped-check shape, and schema version.
- `scripts/drift-ai/report-format.ts`
  - Owns text/JSON drift report rendering.

## Diagnostics Envelope

- `packages/shared/src/schemas/harness-diagnostics.ts`
  - Owns the Zod schema for `harness-diagnostics` envelopes.
  - `harnessDiagnosticToolSchema` currently names the accepted tool ids.
  - `summarizeHarnessFindings` already computes `summary.byControl`.
- `scripts/harness-emit-envelope.ts`
  - Generic CLI for validating and emitting one diagnostics envelope.
- `scripts/lint-ratchet/diagnostics.ts`
  - Existing example of building diagnostics findings from a tool.
- `scripts/lint-ratchet-report.ts`
  - Existing example of consuming one diagnostics envelope.

## logs:audit

- `scripts/logs-audit.ts`
  - Exports `LogsAuditReport`, `auditJsonlText`, `auditLogFiles`,
    `formatText`, and `formatJson`.
- `scripts/logs-audit-*.ts`
  - Check modules that produce log findings and should stay under the existing
    report contract.
- `scripts/logs-audit.test.ts`
  - Focused test suite for report behavior.

## Hooks And Rehydration

- `scripts/ai-hooks/stop-policy.sh`
  - Shared Stop-hook policy. Reads `$LOG_DIR/meta/wrapper.json`; caps e2e,
    async, and verify nudges.
- `scripts/ai-hooks/stop-reminder.sh`
  - Shared Stop-hook entrypoint.
- `scripts/ai-hooks/test-stop-policy.sh`
  - Focused Stop-policy test suite.
- `.claude/settings.json`
  - Claude hook registration.
- `.codex/hooks.json`
  - Codex hook registration.

## Skills And Feedforward

- `.codex/skills/ts-graph/SKILL.md`
- `.codex/skills/playwright-cli/SKILL.md`
- `.claude/skills/` may mirror selected skills depending on what is currently
  tracked. Reconfirm before editing.
- `scripts/ai-hooks/protected-files.sh`
  - Existing path-advisory mechanism.
- `scripts/ai-hooks/throttle-state.sh`
  - Shared advisory throttling.

## CI And Package Scripts

- `package.json`
  - Root script registry. Add new commands here before wiring CI.
- `.github/workflows/ci.yml`
  - Current CI has PR/push jobs only; no scheduled lane.
