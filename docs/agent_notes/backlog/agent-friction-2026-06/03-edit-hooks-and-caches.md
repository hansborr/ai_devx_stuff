# 03 — Edit-time hook noise & PreToolUse caches (D1, D2, D3, H1, H2)

> Proposals only — not implemented. Verified against current HEAD.
> Hook source lives in `scripts/ai-hooks/`; `.claude/hooks/*.sh` are thin shims
> that `exec` them. Wiring (`.claude/settings.json`): PostToolUse Edit|Write →
> prisma-generate, doc-length, tidy-edited-file, lint-coverage-check,
> ratchet-regression-check; PreToolUse Bash → no-direct-db, git-commit-quiet,
> bun-run-quiet.

Reusable infrastructure already present (today *unused* by the tidy hook):
`throttle-state.sh` (session+repo keyed, atomic, TTL), `ai_throttle_key`/
`AI_THROTTLE_STATE_DIR` (`cache.sh:15`), and a working Stop hook
(`stop-reminder.sh` → `ai_stop_policy_messages`, `stop-policy.sh:654`). `session_id`
reaches the source hook (shim execs with stdin intact; `ai_payload_session_id`,
`common.sh:24-27`). These are the building blocks for the per-turn reconciliation
the fixes below need.

---

## D1 — Tidy hook reports unused/complexity/max-lines errors on *intermediate* multi-edit states

**Status: not addressed.**

**Evidence.** `tidy-edited-file.sh` runs per Edit; for each path it runs
`prettier --write` then `eslint --fix --no-warn-ignored` (lines 207-215). On a
non-zero eslint exit it prints `… ERROR (non-blocking)` + a 30-line tail
(lines 226-241). Non-autofixable error rules (`no-unused-vars`,
`@typescript-eslint/no-unused-vars`, `complexity`, `local/max-lines`) hit that
path. There is **no throttle / turn awareness** (contrast `lint-coverage-check.sh:208-218`,
which gates emission via `ai_throttle_should_emit`); the only escape is the blunt
`SKIP_TIDY_HOOK=1` (line 248). So "add a type/import in edit 1, use it in edit 2"
shows an alarming error block for a state about to be fixed.

**Root-cause fix — defer the transient classes to the turn boundary.**

1. In `ai_tidy_run_file`, on non-zero exit, partition errors via an
   `eslint -f json` pass. **Note (Codex review):** the existing
   `ai_tidy_emit_residual_warnings` (line 176) is *not* reusable as-is — it drops
   its JSON output when eslint exits non-zero. Add a separate JSON diagnostic
   collector that captures eslint stdout on exit 1 (a dedicated `eslint -f json`
   invocation whose output is parsed regardless of exit code). Partition into:
   - **deferred ("mid-change-transient")**: `no-unused-vars`,
     `@typescript-eslint/no-unused-vars`, `complexity`, `local/max-lines`,
     `@typescript-eslint/max-lines` — a config var `AI_TIDY_DEFERRED_RULES`.
   - **always-surface**: everything else (real type errors, syntax,
     `no-restricted-imports`, …).
2. If the only errors are deferred, suppress the ERROR block this turn (or emit
   one line: `tidy: N deferred lint signal(s), will recheck at turn end`), and
   record the affected paths in per-session state under `$AI_THROTTLE_STATE_DIR`.
3. Add a Stop-hook tier (`ai_stop_tidy_status` in `stop-policy.sh`, wired into
   `ai_stop_policy_messages` :654) that re-runs `eslint -f json` once over the
   recorded paths and surfaces anything that survived. **Hard caps are
   mandatory (Codex review):** the Stop hook has a **30 s timeout**
   (`.claude/settings.json:149`) and the standing policy is that Stop must not
   launch long verification (`stop-policy.sh:211`). So bound this strictly — cap
   the path set (e.g. 25, like `AI_LINT_COVERAGE_MAX_PATHS`) **and** add a wall
   budget (e.g. abort the recheck after ~10 s and emit "rechecked N of M paths;
   run `bun run lint:changed`"). If even a capped eslint pass risks the 30 s
   budget on large turns, fall back to surfacing the *recorded* deferred findings
   from per-session state without re-running (cheaper, still better than silent
   per-Edit noise).

Net: real errors still appear instantly per-Edit; "unused/too-long/too-complex"
only appear once the agent stops, by which point intermediates are resolved.

**Why not doc-only.** `SKIP_TIDY_HOOK=1` suppresses *all* tidy feedback including
real errors and the autofix, is per-command not per-turn, and the agent rarely
knows in advance which sequence will be multi-edit.

**Effort:** M. **Risk:** med (hot per-Edit path + new Stop tier; keep
`test-tidy.sh` assertions green and the always-surface class instant).

---

## D2 — Stale type-aware lint output right after editing the eslint config

**Status: not addressed.**

**Evidence.** `scripts/**/*.ts` are type-aware (strictTypeChecked at
`eslint-config/base-configs.js:69-71`; `project: ./tsconfig.scripts.json` at
`eslint-config/script-configs.js:144-150`). Each tidy invocation spawns a fresh
eslint (no cross-invocation program cache), so the reported 16 phantom "Unsafe
member access on a type that cannot be resolved" errors are a **first-build
type-resolution failure**: editing `eslint-config/shared-policy.js` mid-turn and
then triggering tidy on another file makes eslint reload the just-mutated flat
config in a transient shape, breaking type resolution for the next file; a clean
re-run later (config consistent) passes — matching the log exactly.

> **Hypothesis (Codex review):** the "scripts are type-aware" half is verified,
> but the "first-build type-resolution failure on transient config" mechanism is
> an *inference*. Before implementing config-edit deferral, capture a minimal
> repro (edit `shared-policy.js`, trigger tidy on a `scripts/lint-ratchet/*.ts`
> file, save the eslint JSON + the clean re-run) so the trigger and the exact
> rule set to defer are confirmed, not guessed.

**Root-cause fix — config-edit-aware deferral (shares D1 infra).**

1. `ai_tidy_config_edited_this_turn`: when any path edited this turn matches
   `eslint.config.js`, `eslint-config/**`, `**/*.d.ts`, or `tsconfig*.json`,
   persist a per-session flag.
2. When set, treat **type-aware** rule errors (`@typescript-eslint/no-unsafe-*`,
   etc.) as deferred (same channel as D1) — suppress + record + re-check at Stop,
   by which point the config has settled. Non-type-aware errors still surface.
3. Optional one-liner: `tidy: eslint config changed this turn — type-aware
   findings on <path> deferred to turn end to avoid stale resolution.`

This is friendlier than a cache-bust: there is no shared on-disk
typescript-eslint cache to clear, and forcing a cold type-program rebuild per
Edit would be slow.

**Effort:** M (rides on D1's per-session state + Stop re-check). **Risk:** med
(must classify type-aware vs syntactic rules correctly).

---

## D3 — Real `tsc`-only errors on `scripts/**` surface only at the slow typecheck gate

**Status: partial — the log's "not type-aware on scripts/**" premise is
outdated** (eslint *is* type-aware there). The real, still-open gap is that the
tidy hook runs eslint, not `tsc`: a genuine TS compile error with no
corresponding eslint rule (wrong return type, missing property, arg-count
mismatch) is not flagged until `bun run typecheck`/verify.

**Root-cause fix — single incremental project check at the turn boundary.**
Prefer the Stop-hook variant: if any `scripts/**/*.ts` was edited this turn (the
D1/D2 recorded-paths set), run `tsc -p tsconfig.scripts.json --incremental` once
at Stop, using a hook-owned `.tsbuildinfo` under `$AI_STATE_ROOT`; surface
failures as a bounded, **non-blocking** advisory. Per-Edit incremental `tsc` is
the faster-feedback but heavier alternative; only pursue if Stop-time latency is
unacceptable. Gate behind `AI_TIDY_TYPECHECK` (default off) initially.

**Why not doc-only.** "Run `bun run typecheck` after scripts edits" is exactly
the slow step the ask wants to shorten.

**Effort:** M (Stop incremental project check) – L (robust per-file). **Risk:**
med–high (tsc perf + `.tsbuildinfo` correctness; must stay non-blocking so it can
never wedge the edit loop).

---

## H1 — Test cache skips a *broader* command (different files) as cached OK

**Status: Superseded by a revised candidate.** Initial argv scoping landed in `f6b8d10d`, but
the post-`--` sorting assumption still collides and argv markers still share a
script log. The verified completion plan is
[`../ai-harness-audit-2026-07-21/03-bun-cache-identity-and-artifacts.md`](../ai-harness-audit-2026-07-21/03-bun-cache-identity-and-artifacts.md).

**Evidence.** `bun-run-quiet.sh:140-142` keys the marker on `SCRIPT_SAFE`
(script name only, `policy.sh:285-312`); the cache key is the worktree
fingerprint (`ai_worktree_fingerprint`, `verify-metadata.sh:13-25`) — **argv
after the script name is not part of the key**. So `bun run test -- fileA` and
`bun run test -- fileA fileB` share marker `last.test`; on an unchanged worktree
the broad command replays the narrow run's "cached OK" without running the wider
set. Only `FORCE_VERIFY=1` escapes (lines 52-55, 154).

**Root-cause fix — include normalized argv in the key.**
1. Add `ai_bun_argv_fingerprint` (in `policy.sh`/`cache.sh`): take the part of
   `CMD` after `bun run <script>`, strip the `FORCE_VERIFY=1` prefix (already
   handled), normalise whitespace, and `sha256sum`. **Do not blindly sort the
   whole tail (Codex review):** the wrapper accepts general script args
   (`AI_WRAPPED_BUN_RE`, `policy.sh:23`), so reordering can alias semantically
   different option/operand orders. Hash the **exact** normalized argv tail; only
   sort the file operands that appear *after* a `--` separator (a safely-parsed
   file list), leaving options in place. Correctness over dedup cleverness.
2. Bake it into the marker filename (`last.$SCRIPT_SAFE.$ARGV_FP`) — cleaner than
   an in-marker field and avoids cross-argv collisions. Update the path
   derivation (lines 140-142) and `ai_read_bun_marker`/`ai_write_bun_marker`
   (`cache.sh:25-79`). Keep the no-arg case as its own fingerprint so bare
   `bun run test` still caches.

**Trade-off.** Two different argv covering the same tests won't dedupe —
acceptable (correctness over cleverness). More (tiny, TTL-bounded) marker files.

**Effort:** S–M. **Risk:** low–med (touches the marker schema covered by
`test-cache.sh:243-298` — update those in lockstep).

---

## H2 — Failed command (bad flag) cached, blocking the corrected command

**Status: Superseded with H1** by
[`../ai-harness-audit-2026-07-21/03-bun-cache-identity-and-artifacts.md`](../ai-harness-audit-2026-07-21/03-bun-cache-identity-and-artifacts.md).

**Evidence.** `bun-run-quiet.sh:236-238` writes the marker for any real exit
(<128), **including non-zero**; on replay a cached failure re-emits as
`decision:block` with the old tail (lines 162-165). A bad flag then a corrected
command share `last.test` + the same worktree fingerprint → the corrected command
replays the failure.

**Root-cause fix.**
1. The H1 argv key already fixes it (corrected argv → different marker → fresh
   run). This is the clean fix.
2. (Optional, defensive) Detect usage/argv errors (e.g. `CACError: Unknown
   option`, already referenced at `test-cache.sh:193`) and skip
   `ai_write_bun_marker` for them (mirroring the existing skip of signal exits
   ≥128 at line 236), so re-running the *exact* bad command can't replay-block.

**Note.** Caching genuine non-zero results on an unchanged worktree is
intentional and should stay (avoids re-running a known-red suite); the fix is
argv-scoping, not "never cache failures."

**Effort:** S (rides on H1). **Risk:** low.

## Critical files
`scripts/ai-hooks/tidy-edited-file.sh`, `scripts/ai-hooks/bun-run-quiet.sh`,
`scripts/ai-hooks/cache.sh`, `scripts/ai-hooks/stop-policy.sh`,
`scripts/ai-hooks/throttle-state.sh`, and the hook tests `test-tidy.sh` /
`test-cache.sh`.
