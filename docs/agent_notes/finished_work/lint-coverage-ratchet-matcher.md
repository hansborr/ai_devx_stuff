# Lint-Coverage Hook Ratchet Matcher Consolidation

Date: 2026-05-29

Implemented `/home/node/lint-merge-debt/07-lint-coverage-ratchet-matcher-duplication.md`.

Collapsed the second ratchet glob implementation. The lint-coverage advisory hook
no longer embeds its own brace-expanding glob matcher; it asks the ratchet engine.

Notes:

- New CLI mode `bun scripts/lint-ratchet.ts --edit-ratchet-coverage <relpath>...`
  prints `ratchet-covered<TAB><relpath><TAB><comma-separated rule ids>` per
  matched path (no ESLint, no registry validation — `runUnvalidatedMode`).
- New module `scripts/lint-ratchet/ratchet-coverage.ts` parses the committed
  baseline structurally and matches via the canonical `matchesRatchet`. Matching
  is **baseline-driven** (the committed test's own `files`/`ignores`/`ruleId`) to
  preserve the old data source exactly; the live registry is never consulted for
  matching. Missing/malformed baseline → no rows, so the hook degrades to its
  uncovered behavior.
- `matchesRatchet` in `scripts/lint-ratchet/ratchet-globs.ts` was widened from
  `LintRatchetConfig` to a structural `RatchetGlobScope` (`{ files, ignores }`)
  so a baseline test can be passed directly; `LintRatchetConfig` is a subtype so
  every existing caller is unaffected.
- `scripts/ai-hooks/lint-coverage-check.sh`: `ai_lint_coverage_is_ratchet_covered`
  now shells out to the CLI mode (requires `bun`, like the sibling
  ratchet-regression hook) and parses the single row, replacing ~130 lines of
  embedded JavaScript.
- Tests: `scripts/test-lint-ratchet.sh` gains a `--edit-ratchet-coverage` fixture
  block (match, ignores exclusion, no-match, multi-path, malformed + missing
  baseline). `scripts/ai-hooks/test-lint-coverage.sh` carries the PATH-injected
  fake `bun` coverage (mirroring the ratchet-regression fake-bun pattern) plus a
  degrade-on-failure test; the aggregate `scripts/ai-hooks/test.sh` invokes that
  focused suite. `scripts/lint-ratchet-output.test.ts` adds the new module to its
  fixture copy list.
- Verification: `bash scripts/test-lint-ratchet.sh`; `bash scripts/ai-hooks/test.sh`;
  `FORCE_VERIFY=1 bun run verify:changed` (lint, ratchet, zero-baseline,
  coverage-map, format-check, typecheck, test, scripts) — all green.

Deliberately left for later (not this issue): the deferred "cached baseline
floor context" signal
(`docs/agent_notes/finished_work/lint-followups-2026-06.md`; old watchlist
details live only in git history)
and batching the hook's per-uncovered-file `bun` spawns into one call.
