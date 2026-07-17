# 05 — Generated-surface staleness regex is hand-maintained in pre-commit

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

## Evidence (verified 2026-07-11; re-verified in 2026-07-11 adversarial triage; re-verify before implementing)

- `.husky/pre-commit:187-188` (`warn_if_generated_surfaces_stale`) — a large
  hand-maintained regex enumerating ~20 concrete generated-surface paths
  (manifest, generator sources, schemas, generated outputs, hook-wiring
  targets), which must be kept in lockstep with the generators by hand.
- `scripts/harness-check.ts:199-214` (`GENERATED_FRESHNESS_OUTPUTS`, repo-root
  `scripts/`, not `scripts/harness/`) — the authoritative output→generator
  freshness table with 8 entries. The pre-commit regex and its warn calls
  (`.husky/pre-commit:191-195,199`) cover only 6 of them.
- **The predicted drift has already happened at HEAD:**
  `scripts/harness/generate-restricted-disable-rules.ts` (check script
  `lint:restricted-disable-rules:check`, `package.json:71`) and
  `scripts/path-policy/generate-smoke-subjects.ts` (check script
  `test:scripts:subjects:check`, `package.json:53`) are in
  `GENERATED_FRESHNESS_OUTPUTS` but absent from both the trigger regex and
  the warn-call list, so staging either generator's source produces no
  commit-time staleness warning.
- The check is WARN-only at commit time (`.husky/pre-commit:172-201`); real
  enforcement is `bun run harness:check` at land time (`scripts/land.sh:123`)
  and the scripts-slot smoke test (`scripts/tests/test-harness-check.sh`),
  so unwarned drift surfaces only at land or full-verify.
- Note: `harness.controls.json` records each generator as a control
  (`source` = generator path, `repairKind: autofix`) but does NOT carry the
  generators' *input* path lists (e.g. `.claude/settings.json`,
  `hook-wiring-schema.ts`) — those live only in the generator code and the
  hand regex. The single source therefore has to be a shared freshness table
  (inputs + outputs + check script per generator), not the manifest alone.

## Do

Single-source the freshness table: extract a per-generator record of
{trigger input paths, generated outputs, check script, warn label} into a
module consumed by `scripts/harness-check.ts` (replacing
`GENERATED_FRESHNESS_OUTPUTS`), and have an existing generator emit the
pre-commit trigger list + warn-call pairs into a sourced shell fragment,
following the established `scripts/verify/steps.generated.sh` /
`scripts/ai-hooks/hook-timeouts.generated.sh` pattern. Include the two
entries currently missing at HEAD (restricted-disable-rules,
smoke-subjects). Decide whether the commit-time check stays advisory or
blocks when a generator's source is staged without its output (advisory is
the current, defensible default; keep it unless a cheap block is free).

## Verify

```
bun run harness:check
bun run test:scripts:changed
```

Plus a manual probe: stage a whitespace-only edit to
`scripts/harness/generate-restricted-disable-rules.ts` with a deliberately
stale generated output and confirm the pre-commit WARN now fires.

## Acceptance

Adding or renaming a generated surface in the shared freshness table updates
both `harness:check` and the pre-commit staleness warning without touching
`.husky/pre-commit`, and the two surfaces currently missing at HEAD are
covered.
