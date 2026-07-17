# 25 — Drain the 182-entry knip dead-export floor toward zero

Status: Implemented (2026-07-12 on auto/25-knip-dead-export-drain; pending integration)
Track: T (tooling) · Priority: P3 · Size: M

## Evidence (verified 2026-07-11; re-verify before implementing)

- `sensor-knip-unused-exports.baseline.json:1-13` — v2 identity ledger, `summary.count` = 182 (`exports` 68, `types` 114). Every one of the 182 `entries[]` paths is under `scripts/` — zero entries in `packages/`. Breakdown by area: 147 `scripts/drift-ai` (across 65 distinct files), 11 `scripts/lint-ratchet`, 10 `scripts/harness`, 5 `scripts/path-policy`, plus 3 `scripts/lib`, 2 `scripts/codemods`, 2 in `client-test-isolation-classifier-types.ts`, and 2 singletons.
- `scripts/client-test-isolation-classifier-types.ts:1-14` — `MODULE_REGISTRY_MUTATION_METHOD_NAMES` is `export`ed but only referenced inside the same file (lines 10, 14); grep finds no external consumer. This is the dominant shape: drop the `export` keyword, no code deletion.
- `scripts/drift-ai/coldspots-args.ts:17,87,108` and `scripts/drift-ai/class-construction-types.ts:108,121` — same in-file-only pattern (`DEFAULT_COLDSPOT_WINDOW_DAYS`, `CLASS_RISKY_CONTEXTS`). But not all are drop-export: some symbols (e.g. `ClientTestIsolationMode`) have no in-file consumer either and are fully dead → delete. A minority (test-helper exports like `unknownProperty` in `scripts/codemods/lib/fixture-runner.test-helper.ts`) may be consumed by a surface knip's config excludes → justify-and-ignore, not delete.
- `docs/agent_notes/backlog/harness-review-2026-07/39-wire-or-drop-knip-jscpd.md` (Done 2026-07-02) wired the counted floor; `docs/agent_notes/backlog/lint-deep-dive-2026-07/61-knip-identity-baseline.md` (Implemented 2026-07-07) upgraded it to the v2 identity ledger. Neither leaf, and no other backlog leaf, files draining the tracked entries — confirmed by grepping the backlog for knip references.

Failure: The floor was built to be driven down, but it is frozen at 182 with 100% of the debt in the harness's own scripts and 147 entries (81%) inside drift-ai — the repo's flagship reference tool. For a public harness-engineering reference, a ratchet that only freezes debt and never reaches zero is theater, and the exported-but-unused symbols actively mislead readers about drift-ai's real public seams. No leaf owns the drain, so the number will sit at 182 indefinitely.

## Do

Run a triaged drain, batched by directory, largest area first (drift-ai → lint-ratchet → harness → path-policy → stragglers). For each of the 182 baselined symbols apply one of three dispositions:
- **Drop `export`** when the symbol is referenced only in its own file (the majority — e.g. `MODULE_REGISTRY_MUTATION_METHOD_NAMES`, `DEFAULT_COLDSPOT_WINDOW_DAYS`).
- **Delete** the declaration when it has no consumer anywhere (fully dead vestige of a past refactor).
- **Justify-and-ignore** in `knip.config.ts` (with a one-line reason) only for the rare symbol that is a real seam knip cannot see (dynamic import, config-referenced, test-helper consumed by an excluded surface). Do not use this to paper over drop/delete work.

After each directory batch, regenerate the baseline (`bun scripts/sensor-knip-unused-exports.ts --update`) and commit. This is not one commit — file it as one commit per area (≈5 commits). Execute via the autonomous-drain lane recipe (worktree lane + fast-commit marker) since the batches are independent and mechanical.

## Verify

```
# after each batch:
bun run sensor:knip-unused-exports
bun run test:scripts:file -- scripts/sensor-knip-unused-exports.test.ts
# focused typecheck/tests for touched dirs, e.g.:
bun run test -- scripts/drift-ai
# final gate before landing:
bun run verify:changed
```

## Acceptance

`sensor-knip-unused-exports.baseline.json` `summary.count` drops from 182 to ~0 (residual entries only where a `justify-and-ignore` disposition is recorded, each with a reason in `knip.config.ts`); the sensor still passes; no test or typecheck regression in the touched script areas.

Sources: scripts-quality
