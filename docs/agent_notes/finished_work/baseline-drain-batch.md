# Baseline Drain Batch

Date: 2026-05-21
Branch: `feature/lint-hardening-baseline-drain-audit` (merged as 9d0d1f9b)

## Summary

Four focused drain commits removed 39 ratchet items from
`lint-ratchet.baseline.json` (`128 -> 89` total findings). All four
landed under one branch with a clean codex review (no P0/P1/P2/P3
findings) and merged into `main` as a non-ff merge.

Audit driving this work: `/tmp/codex-drain-audit-report.md` (codex,
2026-05-21). The audit ranked five drain targets; this branch covered
the top three message-count ratchets plus a focused complexity slice of
the fourth.

## Commits

- `94acaa01` `fix(lint): drain magic-number ratchet for top-level scripts`
  - `ratchet/core-no-magic-numbers-top-level-scripts` `15 -> 0`
  - Named byte multipliers, exit codes, `process.argv` offsets,
    table/glob widths in `sensor-blob-size.ts`,
    `harness-emit-envelope.ts`, `lint-coverage-map-check.ts`.
- `a4edd234` `fix(lint): drop async from sync code-intel tests`
  - `ratchet/typescript-eslint-require-await-script-singletons` `11 -> 0`
  - Dropped `async` from purely sync test/helper callbacks in
    `scripts/code-intel.test.ts`. Promise-shaped fakes use explicit
    `Promise.resolve` / `Promise.reject` to keep daemon transport
    contracts.
- `713eabcc` `fix(lint): drain codemod test throw + expect ratchets`
  - `ratchet/typescript-eslint-only-throw-error-codemod-tests` `7 -> 0`
  - `ratchet/vitest-expect-expect-codemod-tests` `5 -> 0`
  - Wrapped captured non-`Error` throws as `new Error(...)` while
    preserving string/JSON diagnostic payloads. Added `runFixture` to
    `assertFunctionNames` in `scripts/lint-ratchet-config.ts:495`.
- `f0a04cc4` `refactor(drift-ai): split parseArgs into focused option helpers`
  - `ratchet/core-complexity-drift-ai`: `parseArgs` complexity `49 -> 6`;
    file max complexity `49 -> 18`.
  - Extracted same-file helpers `parseScopeOption`, `parseCheckOption`,
    `parseOutputOption`, `validateChunkOptions`,
    `validateScopeOptions`, `cliOptionsFromParsed`. CLI behavior and
    report JSON schema preserved byte-for-byte; spot-checked
    `bun run drift:ai --help` and `--scope current --check imports
    --output json | head -20` against `main`.

## Verification

Each commit ran the standard gates before landing:

- `bun run lint -- --max-warnings=0`
- `bun run lint:shell`, `lint:config-sensors`, `lint:ratchet`,
  `lint:ratchet:check-baseline`
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`

Plus per-commit spot checks (CLI byte-for-byte for Drains 1 and 4;
direct Vitest runs for Drains 2 and 3).

Branch-level: `codex review --base main` returned
"behavior-preserving refactors and test/lint-ratchet cleanup. Focused
script tests, lint ratchet, and typecheck all pass without revealing
regressions." (`/tmp/codex-drain-review.log`)

## Backlog citations

- Leaf 38: `docs/agent_notes/backlog/lint-followups/38-top-level-script-project-lint-adoption.md`
- Leaf 40: `docs/agent_notes/backlog/lint-followups/40-logs-audit-and-drift-entrypoint-lint-adoption.md`
- Leaf 35: `docs/agent_notes/backlog/lint-followups/35-codemod-test-harness-lint-adoption.md`
- Leaf 32: `docs/agent_notes/backlog/lint-followups/32-drift-ai-under-ceiling-lint-adoption.md`

## Deferred / open

- `ratchet/core-complexity-drift-ai` still has 9 items (the parseArgs
  outlier is gone; remaining items are `comments.ts:87` `classifyLine`
  21, `runDriftAi` 18, `parseSuppressionDiff` 17, `buildReport` 16,
  plus smaller items). Audit target #4 only drained the outlier per the
  prompt scope.
- `ratchet/core-complexity-codemods` (24 items, 343 weight) — audit
  target #5, deferred. Recommended next branch.
- `local-max-lines-*` ratchets — not touched; audit recommended
  against starting these without dedicated time for module splits.

## Process notes

- One drain prompt per ratchet, delegated to codex sequentially on the
  same branch. Each prompt was self-contained with explicit
  constraints, baseline citation, expected drop, and abort plan.
- The `expect-expect` half of Drain 3 added one assertion helper name
  to the rule's `assertFunctionNames`; this is a config-level escape
  rather than a code change. Acceptable per the audit's note "Do not
  weaken assertions just to satisfy `expect-expect`."
- Drain 4 was scoped narrowly (parseArgs only, not the whole ratchet)
  to keep behavioral risk bounded on an unattended overnight branch.
