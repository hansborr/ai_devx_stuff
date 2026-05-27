# Lint Process Pain Point Follow-Ups

Status: Complete
Order: 20
Source: `/tmp/pain_points.md` review on 2026-05-27

## Context

The lint-process improvement pass left several workflow pain points. A live
audit on 2026-05-27 found the concrete `missing-harness-ratchet` cross-import
regression fixed and complexity ratchet diagnostics improved, but most edit-loop
friction remains.

Completed on 2026-05-27. Edit-time complexity feedback remains intentionally
deferred unless it recurs; the other definition-of-done items landed in focused
commits.

This note keeps the follow-ups in recommended fix order. Promote one item at a
time unless two share the same small edit surface.

## Recommended Fix Order

1. Suppress ratcheted-file lint coverage hook noise (`#2`, `#6`).
   The `PostToolUse` lint-coverage hook still reports ratchet-covered files as
   "NOT covered by ESLint" because it only checks normal ESLint reach. Make the
   hook ratchet-aware, or change the message to a non-warning "ratcheted, not
   normal-linted" note for files covered by a ratchet entry. Keep genuinely
   unaccounted lintable files warning.

2. Document the staged `verify:changed` workflow (`#3`).
   Prefer a small `AGENTS.md` update over a new wrapper mode for now: tell agents
   to stage intended source-relevant changes before running `bun run
   verify:changed`, because changed verification intentionally aborts on
   unstaged or untracked source-relevant work. Do not add `--allow-unstaged` or
   `verify:worktree` unless this keeps recurring after the documentation hint.

3. Derive ratchet smoke identity keys (`#1`).
   `scripts/test-lint-ratchet.sh` still hardcodes generated config/cache key
   suffixes for local ratchets. Replace those literals with values derived from
   the current rule-source hash path generation, while preserving config-content
   fixture comparisons so accidental generated-config drift still fails.

4. Add a focused portable runtime import-boundary check (`#7`).
   The original bad import is gone, and the copied-runtime smoke still catches
   this class eventually. Add a smaller check that validates portable ratchet
   runtime files only import from the documented portable runtime set, approved
   package/shared schema files, or allowed Node/package modules. Keep the
   copied-runtime smoke as the end-to-end backstop.

5. Split the JSX RuleTester wrapper (`#5`).
   The JSX `type-assertion-boundary` test still wraps multiple fixtures in
   `expect(() => RuleTester.run(...)).not.toThrow()`. Remove the wrapper if the
   current ESLint/Vitest integration allows it, or split the JSX edge cases into
   smaller named `RuleTester.run` calls so failures identify the fixture.

6. Defer edit-time complexity feedback unless it recurs (`#4`).
   `lint:ratchet` now catches runtime complexity movement with better severity
   detail, and `verify:changed` runs the ratchet. Earlier feedback would be nice,
   but it should not outrank the noisy hook and hardcoded-key fixes. If promoted,
   start with documentation or a targeted changed-file helper rather than a broad
   editor hook.

## Definition Of Done

- Editing `scripts/lint-ratchet/baseline-update.ts` or
  `scripts/harness-check-validation.ts` no longer emits a misleading
  lint-coverage warning while still warning for unaccounted lintable files.
- `AGENTS.md` mentions staging intended changes before `bun run verify:changed`.
- Ratchet rule-source edits no longer require manually searching for generated
  cache/config key suffixes in `scripts/test-lint-ratchet.sh`.
- Portable runtime import mistakes fail in a focused check before the full copied
  runtime smoke.
- JSX type-assertion-boundary fixture failures point at a named case or a smaller
  RuleTester group.

## Verification

- `bash scripts/ai-hooks/test.sh` after hook changes.
- `bash scripts/test-lint-ratchet.sh` after ratchet smoke or import-boundary
  changes.
- `FORCE_VERIFY=1 bun run test -- --project=eslint-rules type-assertion-boundary.test.js`
  after RuleTester changes.
- `bun run format:changed:check`
