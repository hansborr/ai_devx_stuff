# Leaf 5: Ratchet Cleanup Batch

Status: Resolved 2026-05-19 — items landed and deferred items listed in the resolution note
Source: `docs/agent_notes/backlog/lint-ratchet-followups.md`

## Problem

PR 4 landed the ratchet, but review left small clarity, smoke, and test
robustness items. They are not prerequisites for correctness, but they should
be handled before the ratchet surface grows much larger.

## Scope

Keep this as one small cleanup batch unless any item starts changing behavior
deeply. Split if the first implementation crosses into cache or baseline
semantics already covered by Leaves 1 and 2.

## Candidate Work

- Change failing regression output from `lint:ratchet OK` to a failure label
  before exit code 1.
- Add shell smoke coverage for usage/config exit code 2:
  - unknown arguments,
  - `--allow-worse` outside update mode,
  - missing `--reason`,
  - blank `--reason`.
- Replace the nested optional-line ternary in `addFinding` with a small
  `minDefined` helper.
- Extract the 12-character cache hash prefix into a named constant.
- Consider sweeping stale
  `node_modules/.cache/eslint-ratchet/<id>-<hash>/` directories when cache
  keys change.
- Refactor `parseBaselineTest` to avoid duplicate narrowing conditions.
- Make `scripts/test-lint-ratchet.sh` mutate JSON structurally instead of
  relying on a layout-sensitive `perl` replacement.
- Move or delete
  `docs/agent_notes/in_progress/lint-hardening-review-followup-pr-4-custom-ratchet-plan.md`
  if present under its actual path after confirming the durable PR 4 summary is
  complete.
- Refresh verify-wrapper descriptions in `harness.controls.json` and generated
  harness docs so they mention the ratchet step accurately.

## Exit Criteria

- Ratchet CLI output and smokes cover the known review nits.
- Test fixtures are less layout-sensitive.
- No behavior change weakens ratchet enforcement.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run test:scripts:changed`

## Resolution

Commit: `chore(lint): drain ratchet cleanup batch leaf 05`

Landed:

- Refactored `parseBaselineTest` to use parsed/narrowed locals for rule id,
  mode, target, metric, config hash, and optional rule-source hash instead of
  duplicating validation conditions in the return guard.

Already done or skipped:

- Failure label before exit code 1: already done; default regressions print
  `lint:ratchet FAIL` before exiting 1.
- Shell smoke for usage/config exit code 2: already done; the smoke covers
  unknown args, invalid mode combinations, `--allow-worse` outside update mode,
  missing reason, and blank reason cases.
- `minDefined` helper: already done and used by `addFinding`.
- Named constant for 12-character cache hash prefix: already done as
  `CACHE_HASH_PREFIX_LENGTH`.
- Cache-sweep behavior: skipped per Leaf 05 scope guard; this commit made no
  cache behavior change. The current branch already contains prior
  `sweepStaleCacheSiblings` support, so no new destructive cleanup behavior was
  added here.
- Structural JSON mutation in `test-lint-ratchet.sh`: already done with
  `bun -e` JSON parsing/stringifying; no `perl` JSON mutation remains.
- Move/delete PR 4 plan doc: skipped because the in-progress plan file is
  already absent and the durable PR 4 summary exists in `finished_work/`.
- Verify-wrapper ratchet descriptions: already done in `harness.controls.json`
  and the generated harness controls doc; both verify entries mention
  `lint:ratchet`.
