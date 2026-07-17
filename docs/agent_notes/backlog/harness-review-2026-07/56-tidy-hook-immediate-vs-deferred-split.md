# 56. tidy-edited-file.sh mixes urgent and style-tier lint feedback mid-edit; split immediate errors from a Stop-time residual-warning summary

Status: Done — `ai_stop_lint_warnings_*` immediate/deferred split in `stop-policy.sh`; per-edit residual warnings removed (`48ac51aa`).
Lens: hooks · Area: hooks-edit-loop · Severity: low-med · Size: M · Confidence: med
Theme: edit-loop-noise · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The post-edit tidy hook formats and eslint-fixes every edited file, then surfaces what is left as advisory `additionalContext`. Two issues pull in opposite directions. First, mid-edit noise: the residual-warning pass reports style-tier findings (unused vars, max-lines, complexity) after *every single edit*, including mid-refactor states where the "unused" variable is about to be used three edits later — the agent either chases churn or learns to ignore the channel. Second, under-signaling: the hook literally prints that these warnings "block `bun run lint`", i.e. it *knows* the repo gate will fail later, yet delivers that as the same whisper-quiet advisory tier as everything else, per-file, with no end-of-turn aggregation. The right split is: hard, act-now facts immediately; accumulating style debt once, at Stop time, over the whole change set.

## Evidence
- `scripts/ai-hooks/tidy-edited-file.sh:198-241` (`ai_tidy_run_file`) — prettier `--write` (`:207`), eslint `--fix` (`:213`); on tool failure prints `ERROR (non-blocking)` + bounded output (`:226-240`). (Codex's second opinion cited ~207-226; verified — the failure branch starts at 226, the residual-warning call sits at `:222`.)
- `scripts/ai-hooks/tidy-edited-file.sh:171-196` (`ai_tidy_emit_residual_warnings`) — the second, non-mutating `eslint -f json` pass; message at `:194`: "`%s has %s eslint warning(s) (these block \`bun run lint\`)`" — the hook self-documents that a later gate fails, then stays advisory.
- `scripts/ai-hooks/tidy-edited-file.sh:164-170` — comment confirming every warn-level rule in this config is non-autofixable, i.e. these findings will always recur on every subsequent edit of the file until hand-fixed.
- Delivery is per-edit `additionalContext` with no dedupe across edits of the same file (`:289`, `ai_emit_additional_context "PostToolUse"`); a 5-warning file edited 10 times reports 50 warning-lines of context.
- Stop-side reuse exists: `ai_stop_policy_messages` composes independent message sources (`scripts/ai-hooks/stop-policy.sh:655-695`); change-set state machinery (worktree fingerprint + one-shot markers per fingerprint/branch, `:29-33`, `:117-144`) is exactly the shape a once-per-change-set summary needs. Uncommitted paths are enumerable via `git status --porcelain`.
- Wiring/timeouts: tidy runs PostToolUse `Edit|Write`, timeout 120 (`.claude/settings.json:136-140`); the Stop hook has timeout 30 (`:154-161`) — the deferred pass must fit that budget.

## Proposed direction
Split the feedback by actionability:
- **Immediate (keep per-edit):** prettier/eslint *tool failures* (syntax errors — the current `:226-240` branch) and error-severity findings from the fix pass; these mean the file is broken now.
- **Deferred (move to Stop):** the warn-severity residual list. Drop the per-edit `ai_tidy_emit_residual_warnings` emission; add a new message source in `ai_stop_policy_messages` that runs `eslint -f json --no-warn-ignored` over a *capped* changed-path set (uncommitted eslint-supported files from `git status --porcelain`, cap ~10 files / warn if more), aggregates per-rule counts, and uses the existing fingerprint one-shot marker pattern so an unchanged change set is nudged once, not every turn.
Keep `AI_TIDY_*` env knobs; add a `.no-stop-lint-warnings` kill-switch in house style. Extend `scripts/ai-hooks/test-tidy.sh` and `test-stop-policy.sh` accordingly.

## Scope / caveats
The Stop-time pass spawns ESLint once per turn-with-changes — measure against the 30s Stop timeout on a realistic changed set before committing to the cap (raise the Stop wiring timeout via the manifest if needed rather than shrinking coverage silently). Restricted-import / type-danger rules must be confirmed error-severity (immediate tier) before the split — if any live at warn level, promote them in eslint config first or special-case them. Split into two commits if needed: (1) Stop-time summary added, (2) per-edit residual emission removed once the summary is proven.
