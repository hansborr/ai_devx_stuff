# Lint-coverage hook: throttle + genericize

Plan source: `/home/node/hook_noise_plan.md` (checked 2026-05-29).

## Goal

The PostToolUse `lint-coverage-check` hook fires on every edit batch that
touches a lintable file ESLint does not fully cover. On Codex `apply_patch`
storms it repeats the same advisory many times. Add a per-session throttle and
generic, map-pointing wording so the reminder stays useful without spamming.

## Shape

- Trigger surface unchanged: still post-edit, still contextual.
- Two independent tiers/counters, keyed by `session:<id>:repo:<realpath>` (or
  `repo:<realpath>` with no session id), sha256-hashed:
  - `ratchet.<key>` — files covered only by `lint:ratchet` single-rule floors.
  - `uncovered.<key>` — files with no ESLint coverage at all.
- State machine per tier (see plan §1): emit on no/garbage state, backward
  clock jump, age >= TTL, or `count+1 >= MAX`; otherwise suppress and bump the
  counter. Emit resets `{ts=now, count=0}`. Fail toward emitting on state IO
  errors.
- Env knobs: `AI_LINT_COVERAGE_TTL` (default 1800, `0` = always emit),
  `AI_LINT_COVERAGE_MAX_DETECTIONS` (default 10). Invalid values fall back.

## Files

- `common.sh`: `ai_payload_session_id`, `ai_now` (honours `AI_FAKE_NOW`).
- `cache.sh`: `AI_LINT_COVERAGE_STATE_DIR` + `ai_cache_init` mkdir.
- `lint-coverage-state.sh` (new): key/path/ttl/max/read/write/should_emit.
- `lint-coverage-check.sh`: structured tier lines, bucketing, per-tier
  throttle, bounded path lists, new map-pointing wording.
- `path-policy-smoke-subjects.ts`: add the new helper to `test-ai-hooks`.
- `ai-hooks/test.sh`: copy new deps into the fixture, dedicated state dir,
  detection tests under `AI_LINT_COVERAGE_TTL=0`, new state/throttle tests.

## Status

Implemented and verified (staged, not committed — awaiting owner).
- `bash scripts/ai-hooks/test.sh` green; `shellcheck --severity=warning` clean.
- `bun run verify:changed` OK (lint ratchet zero-baseline coverage-map
  format-check typecheck test scripts).
- Codex second-opinion review: no P0; one P1 fixed — the `should_emit` suppress
  branch now fails toward emitting when the increment write fails
  (`lint-coverage-state.sh`), rather than suppressing a repeat the counter can
  no longer release before TTL. Added regression tests for that path and for the
  backward-clock reset branch (closing the P2 test-gap note).

When this lands, fold the durable bits into `LOG.md` and delete this note.
