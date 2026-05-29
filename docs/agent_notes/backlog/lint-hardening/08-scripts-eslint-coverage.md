# Leaf 8: ESLint Coverage Over TypeScript Scripts

Status: Partially landed (drift slice); codemods deferred
Depends on: Leaf 1, unless the promoted slice explicitly runs
`bun run lint -- --max-warnings=0` and does not introduce warning-only
coverage.

## Problem

`eslint.config.js` ignores `scripts/**/*` and only re-includes
`scripts/code-intel/**/*.ts`. But `tsconfig.scripts.json` covers drift sensors,
codemods, logs audit, lint-changed, verify wrappers, and other TypeScript
scripts that handle production-critical workflows (migration safety,
suppression registers, doctor checks).

These scripts are exactly the surface where:

- AI agents are most likely to be the primary author.
- A bug in the script silently misreports something downstream.
- Existing local rules (`no-explicit-any`, `no-swallowed-errors`,
  `structured-logging`, `no-llm-artifacts`) would catch real issues.

## Decision

Expand ESLint coverage gradually over `scripts/**/*.ts` covered by
`tsconfig.scripts.json`. Use the existing `scripts/code-intel/**/*.ts`
re-include as the model: a dedicated config block points at the scripts
tsconfig so type-aware rules work.

## Rollout

1. Inventory `scripts/**/*.ts` that are covered by `tsconfig.scripts.json`.
   Group by purpose (codemods, drift sensors, doctor, verify wrappers,
   migration tools).
2. Add one group per leaf. Start with codemods (`scripts/codemods/`), then
   drift sensors (`scripts/drift/`), then top-level scripts.
3. For each group:
   - Add a config block in `eslint.config.js` analogous to the code-intel block.
   - Run lint as inventory; expect baseline cleanup.
   - Land the cleanup, then enable the block in the gate.
4. After the last group lands, remove the broad `scripts/**/*` ignore and
   keep only the still-excluded shell-script paths.

## Open Questions

- A few scripts may use Node `console.log` as their primary output channel
  (e.g., doctor output). Decide whether to scope `no-console: "off"` per
  group or align scripts with `script-logger.ts`. Today
  `packages/server/src/utils/script-logger.ts` is the explicit exception
  pattern.
- The `local/structured-logging` rule is currently server-scoped. Decide
  whether to extend to scripts or keep scripts on a thinner logging policy.

Default recommendation: CLI/reporting scripts may keep `console.log` as their
stdout interface when the command's documented behavior is text output.
Runtime/server code and scripts that emit operational logs should use the
structured logger pattern. Pick the default per script family after inventory
and record any family-level exception in `evaluation-verdicts.md`.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck` (covers `tsconfig.scripts.json`)
- `bun run test:scripts:changed` for any scripts touched.
- If a script group is deferred, scoped out, or lands with policy caveats,
  append a row to `evaluation-verdicts.md` before closing the slice.

## Implementation Result

### Codemods slice: deferred (see Leaf 8 codemod inventory)

Codemods slice evaluated on 2026-05-16 and stopped before enabling coverage.

- Temporary config: re-included `scripts/codemods/` and
  `scripts/codemods/**/*.ts`, kept `scripts/codemods/fixtures/**` ignored, and
  added a `scripts/codemods/**/*.ts` project block pointing at
  `./tsconfig.scripts.json`, analogous to the existing code-intel block.
- Inventory command: `bun run lint -- --max-warnings=0`.
- Result: 70 findings, 59 errors and 11 warnings. This exceeded the promoted
  slice's flood threshold.
- Largest categories: 17 `complexity` errors, 6 `max-params` errors, and
  5 `local/max-lines` errors across large codemod modules; repeated codemod
  test harness findings for void-expression callbacks, non-`Error` throws,
  and missing explicit assertions; smaller import/type-import and magic-number
  cleanup remains.
- Outcome: no ESLint config or codemod fixes landed. The temporary config was
  reverted, and the deferral was recorded in
  `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`.

### Drift slice: landed

Drift slice landed on 2026-05-16.

- Config: re-included `scripts/drift/` and `scripts/drift/**/*.ts` in
  `eslint.config.js`, and added `scripts/drift/**/*.ts` to the existing
  `tsconfig.scripts.json` ESLint block used by scripts outside package
  tsconfigs.
- Cleanup: fixed `scripts/drift/locator-usage.ts` baseline findings by
  converting numeric template-literal values with `String(...)`, extracting a
  named JSON indent constant, and documenting the standard Node
  `process.argv.slice(2)` offset with a targeted line-level suppression.
- Verification: `bun run lint -- --max-warnings=0`, `bun run typecheck`,
  `bun run test:scripts:changed`, and
  `bash scripts/eslint-disable-register.sh /workspace`.
- Outcome: drift sensors are now covered by the repo ESLint gate. Codemods
  remain deferred to a future refactor slice.
