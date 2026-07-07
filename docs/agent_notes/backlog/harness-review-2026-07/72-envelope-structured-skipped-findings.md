# 72. `lint:agent:local-rules` drops skipped non-local findings to a stderr count instead of putting them in the diagnostics envelope

Status: Done — implemented in 3f8cf2ab (2026-07-02); envelope emits structured lint/skipped-non-local findings.
Lens: reference-fitness · Area: diagnostics · Severity: med · Size: S-M · Confidence: high
Theme: complete-envelope-contract · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Historical Problem
The machine-readable diagnostics contract is the harness's flagship idea: producers emit one validated `HarnessDiagnostics` JSON envelope, and consumers (`harness:audit`, future dashboards) never parse prose. `bun run lint:agent:local-rules` honors this for `local/*` rules and parser errors, but any non-local ESLint finding on the same files is *dropped from the envelope entirely* — it survives only as an aggregate count in a human-oriented stderr note ("skipped N non-local finding(s) — see `bun run lint` for the full view"). An envelope consumer therefore sees an incomplete picture with no structured signal that anything was omitted: no count, no per-rule identity, nothing. For a reference repo demonstrating a diagnostics contract, the envelope should carry its own completeness disclosure as structured entries (e.g. severity `info`, a dedicated "skipped-non-local" control) so one artifact tells the whole story.

Resolved by 3f8cf2ab: skipped non-local lint findings now emit structured `lint/skipped-non-local` diagnostics.

## Evidence
- `/workspace/scripts/lint-agent-envelope.ts:157-184` — `buildLintAgentEnvelope` counts skipped non-local messages into a bare `skippedNonLocal` number (lines 162-173) and returns it *beside* the envelope, not in it.
- `/workspace/scripts/lint-agent-envelope.ts:121` — `if (!ruleId.startsWith(LOCAL_RULE_PREFIX)) return undefined;` — the per-finding drop point (rule identity and location are discarded here).
- `/workspace/scripts/lint-agent.ts:100-109` — the count surfaces only as a stderr suffix on the OK line; the JSON on stdout/`--output` never mentions it. Header comment (lines 8-9) documents the choice: "Non-local findings are counted on stderr and skipped — they have no structured metadata to surface."
- `/workspace/packages/shared/src/schemas/harness-diagnostics.ts:40-85,145-153` — `harnessFindingSchema` and `harnessDiagnosticsSchema` are `.strict()`; findings require `control` (regex `^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+$`), `why`, `howToFix`, `repairKind`; envelope allows only `version`/`tool`/`findings`/`summary`.
- Consumers of the schema: `/workspace/scripts/harness-audit.ts:211` (validates every input envelope), `/workspace/scripts/lint-agent.ts:80` (self-validation), plus `scripts/harness/harness-diagnostics-output.ts` and `scripts/harness-emit-envelope.ts` producers.

## Proposed direction
Prefer the additive shape: emit each skipped non-local message as a real finding with severity `info`, control `lint/skipped-non-local` (fits the existing control-id regex), `ruleId`/`path`/`line` preserved, `why` = "non-local rule; no structured local metadata", `howToFix` pointing at `bun run lint`, `repairKind: "manual"`. That requires **no schema change** — summary/`byControl` math already absorbs it — and `harness:audit` groups them for free. Add the `lint/skipped-non-local` control to `harness.controls.json` so the id is honest against the manifest (the schema's error message claims control ids match manifest ids). Alternative (heavier): an envelope-level `skipped` field — rejected by default because both schemas are `.strict()`, so it forces a `HARNESS_DIAGNOSTICS_SCHEMA_VERSION` bump rippling through every producer, `harness-audit`, and their tests. If per-finding volume is a worry, a capped emission (first N + one rollup finding carrying the remainder count) keeps envelopes bounded.

## Scope / caveats
One small commit for the findings-based option: `lint-agent-envelope.ts` + its test, one manifest entry, and a `docs/generated/harness-controls.md` regeneration (`bun run docs:harness-controls`). Keep the stderr note for humans. Watch exit-code semantics: skipped entries must stay `info` so `summary.blocking` (the exit-1 trigger, `lint-agent.ts:111-113`) is unchanged. Two corrections from verification: the script is `lint:agent:local-rules` (`package.json:61`), not `bun run lint:agent` — "lint:agent" is only the envelope `tool` id — and skipped findings are not "printed/returned separately" as the review claimed; only an aggregate count survives, on stderr.
