# Edit-time per-file lint-ratchet feedback — landed

Status: landed on branch `feat/lint-improvements-v2`. Supersedes the
`in_progress/per-file-ratchet-edit-feedback.md` plan and the brainstorm in
commit `bfce61da` (the brainstorm still carries the verified file:line citations
for the engine and coverage-hook branch logic).

## What shipped

A fresh minimal-TS regression detector wired into a PostToolUse advisory hook:
"this edit currently introduces or worsens a ratcheted finding in this file."
Type-aware ratchets are intentionally out of scope (verify/commit stays
authoritative). The deferred cached-baseline-context signal stays parked in
`backlog/lint-ratchet-cached-baseline-context.md`.

## Phase 0 (gate) — re-confirmed PASS

Warm single-file ESLint with the edited file as a positional arg, the ratchet
object unchanged (same config/cache hash), and NO `sweepStaleCacheSiblings`
call: 366–386 ms warm, the canonical config/cache sibling survived, and a
following `bun run lint:ratchet` stayed warm with no stale siblings. No
throwaway script committed.

## Engine

- `scripts/lint-ratchet/eslint-runner.ts`: extracted `runEslintForFiles(ratchet,
  ruleSourceHash, files)` (writes config + cache args, spawns ESLint, NO sweep).
  `runEslint` now sweeps then delegates with `ratchet.files`. The edit-check path
  uses `runEslintForFiles` with the unchanged ratchet object — the only
  cache-safe shape.
- `scripts/lint-ratchet/current-collector.ts`: factored message
  filtering/fatal-parse/metric parsing into `itemsFromResults`; exported
  `collectCurrentForRatchet(ratchet, ruleSourceHash, files)`.
- `scripts/lint-ratchet/edit-check.ts` (new):
  - `discoverEditCheckTargets(paths)` — `matchesRatchet` filtered to
    `usesEslintCache(r) === true` (minimal-TS only), deterministic order by path
    then ratchet id.
  - `runEditCheckRegressions(targets, concurrency)` — structural baseline parse,
    per-ratchet config/rule-source hash check (drift → soft skip, never a false
    regression), single-ratchet `compareCurrentToBaseline` via the façade,
    bounded concurrency, mid-edit parse error → soft skip. Emits regressions only
    (improvements are not surfaced at edit time).
- CLI (`cli.ts` + `modes.ts`): two modes, dispatched before the registry
  preflight/validate gate so they stay fast and resilient on the hot path:
  - `bun scripts/lint-ratchet.ts --edit-check-targets <relpath>...`
    → `target<TAB>relpath<TAB>testId<TAB>ruleId`
  - `bun scripts/lint-ratchet.ts --edit-check --targets-file <file>`
    → `regression<TAB>relpath<TAB>testId<TAB>ruleId<TAB>reason<TAB>line<TAB>baselineCount<TAB>currentCount`
      plus a `checked<TAB>relpath` row per (file,ratchet) ESLint actually ran, so
      the hook can tell a genuinely-clean lint from a soft skip (drift / missing
      baseline / parse error emit no `checked` row).
  - `AI_RATCHET_REGRESSION_CONCURRENCY` (default 3) bounds parallel ESLint in the
    runner.

## Hook

- `scripts/ai-hooks/ratchet-regression-check.sh` + thin wrappers
  `.claude/hooks/` and `.codex/hooks/`. Registered as the LAST PostToolUse hook:
  `Edit|Write` in `.claude/settings.json`, `apply_patch` in `.codex/hooks.json`,
  timeout 60s. Strictly advisory; exits 0 on any tooling failure.
- Two-step: discovery (no ESLint) → drop suppressed/cached targets →
  lint only survivors. This is why the CLI contract is split.
- Edited-path extraction was factored into `scripts/ai-hooks/edited-paths.sh`
  (`ai_edited_payload_paths`), now shared by `lint-coverage-check.sh` and the new
  hook — no fourth glob/path matcher.
- Throttle reuses `lint-coverage-state.sh` (same state dir + session/repo key)
  with a distinct per-(file,rule) tier `ratchetreg:<sha1(relpath)>:<sha1(ruleId)>`
  so the two hooks can never collide. Added side-effect-free
  `ai_lint_coverage_would_emit` (read-only probe) for throttle-before-lint; the
  writing `ai_lint_coverage_should_emit` is called ONLY after a regression is
  confirmed, so a clean lint never burns an emit slot. Re-warn cadence is
  TTL-governed.
- Content-hash cache under `$AI_STATE_ROOT/ratchet-regression-content`: token =
  `sha1(file content | sorted matching ratchet ids)`, so identical re-saves (and
  only those) skip ESLint, while a newly-matching ratchet forces a re-check. The
  cache is written ONLY when the engine confirmed it linted the file's full
  matched target set (`matched == checked` count) — a soft skip or a
  throttle-dropped target never caches, so it is re-checked once that clears
  (closes the two codex P1 findings). Regression rows are parsed with a
  non-whitespace (\x1f) separator so an empty `line` field is not collapsed.
- Env knobs: `AI_RATCHET_REGRESSION_TTL=1800`, `AI_RATCHET_REGRESSION_MAX=10`,
  `AI_RATCHET_REGRESSION_MAX_TARGETS=3` (per-edit cap; dropped targets noted),
  `AI_RATCHET_REGRESSION_CONCURRENCY=3`. Kill switch: `touch .no-edit-lint`.

## Tests

- `scripts/test-lint-ratchet.sh`: discovery, no-match, fresh `new-path`,
  worsening (`increased-count`), improvements omitted, type-aware skipped,
  baseline/hash-drift soft skip.
- `scripts/ai-hooks/test.sh`: `ai_lint_coverage_would_emit` unit checks, Claude
  Edit + Codex apply_patch path extraction, deleted/node_modules skipped,
  content-identical re-saves skip the lint step, throttle-before-lint drops a
  suppressed target, per-(file,rule) tiering, advisory + exit-0 on engine
  failure, `.no-edit-lint` kill switch. Driven by a fake `bun` on PATH so the
  bash logic is isolated from the real engine.

## Not done / future

- Phase 3 (type-aware ratchets at edit time) — only if the minimal-TS blind spot
  proves material.
- Cached baseline context — `backlog/lint-ratchet-cached-baseline-context.md`.
