# Claude Cache-Budget Verification Plan

Status: Archived. Slices 1, 2, 3, and 4 landed; conditional follow-ups moved
to `../backlog/cache-budget-followups.md`. Slice 1
added `run-meta.json` writers in pre-commit and `verify.sh`, captured Vitest
JSON timings for `test:changed`, and taught `verify:logs budget` to summarize
wrapper, step, budget, and slow-test timing data. Slice 2 added the explicit
slow-test tier: per-package vitest configs exclude `**/*.slow.test.*`, a
dedicated `vitest.slow.config.ts` plus `bun run test:slow` /
`bun run verify:slow` run the slow tier with `MUSI_RUN_SLOW_TESTS=1`, and
`scripts/test-changed.sh` prints a hint when a `*.slow.test.*` file changes.
Sentinel fixtures in `packages/shared/src/test-tier-sentinel*.test.ts` plus
`scripts/test-test-slow.sh` keep the wiring honest from
`bun run verify:changed`. Slice 3a lowered the verify and pre-commit hard
timeout from 540s to 240s, introduced `MUSI_INTERACTIVE_TIMEOUT` /
`MUSI_INTERACTIVE_WARN_AFTER` (with `MUSI_VERIFY_TIMEOUT` retained as a
back-compat override), added a soft-budget warn line at 210s, and made the
watchdog branch print log paths plus a `bun run verify:logs budget` pointer
before exiting 124. Slice 3b coupled verify lock wait and execution to one
budget, set Claude's bun hook to a 25s lock wait plus 210s command watchdog
with a 280s settings backstop, and refreshed the hook whitelist. Slice 3c made
Stop hooks cached-result readers only and set this repo's Claude/Codex Stop
hook configs to a 30s local budget. Slice 4 added explicit detached
verification commands with
repo-keyed state under `/tmp/musi-verify-async/<repo-key>/`, per-run private
logs/markers, a `MUSI_ASYNC_VERIFY_TIMEOUT` default of 1800s, 7-day status GC,
and Stop-hook async status reporting.

Measurements captured 2026-05-03:

- `verify:changed` wrapper: 127s, `serial-verify`, exit 0, budget state OK
  under warn=210s and hard=240s, from
  `FORCE_VERIFY=1 bun run verify:changed`.
- `verify:changed` wrapper after this doc update: 127s, `serial-verify`, exit
  0, budget state OK.
- Latest step timings: lint 0s, typecheck 5s, `test:changed` 110s, script
  smoke tests 12s.
- Latest Vitest changed run: 447 files, 6,475 passed and 2 skipped tests,
  109.55s reported duration.
- Slow-test signal across the two samples stayed far below tiering thresholds:
  slowest file observed was `packages/server/src/routers/auth-rate-limit.test.ts`
  at 3.924s; slowest case observed was its login rate-limit test at 2.791s.
- Measurement conclusion: `test:changed` is the long pole, but this sample
  does not justify moving whole files into a slow tier under the current
  >20s file or >10s case selection criteria. Typecheck does not need to jump
  ahead of slice 3 based on this sample.
- Slice 3b/3c smoke: `bash scripts/test-verify.sh`,
  `bash scripts/test-ai-hooks.sh`, and `bash scripts/test-test-scripts.sh`
  passed after adding lock/watchdog and cached-stop coverage. A fixture run
  with `FORCE_VERIFY=1 MUSI_INTERACTIVE_TIMEOUT=2` exited 124 and wrote no
  success marker.
- Final slice 3 `verify:changed`: 133s, `serial-verify`, exit 0, budget state
  OK under warn=210s / hard=240s. Steps: lint 0s, typecheck 5s,
  `test:changed` 109s, script smoke tests 19s.

## Problem

Claude Code now invalidates the session cache after roughly 5 minutes. Repo
hooks and automatic verification should therefore avoid tool calls that run
past about 4 minutes, leaving margin for hook overhead and result
serialization. The current repo has useful verification infrastructure, but
several defaults still assume a much larger ceiling:

- `.husky/pre-commit` and `scripts/verify.sh` default `MUSI_VERIFY_TIMEOUT` to
  540s.
- `.claude/hooks/bun-run-quiet.sh` can spend up to 500s waiting for the bun
  lock, then another 520s executing the command.
- `.claude/settings.json` / `.codex/hooks.json` include hook timeouts above
  the cache budget.
- `scripts/ai-hooks/stop-policy.sh` can run e2e from the stop hook with a
  560s timeout.
- `verify.sh` writes Vitest JSON timings, and `verify:logs slow-tests` can
  summarize them, but pre-commit currently runs `test:changed` without the
  JSON sidecar.

The most recent retained pre-commit logs in `/tmp/musi-pre-commit-logs` showed
`test:changed` running 447 files in 173.96s with 2 skipped tests. That is under
4 minutes but close enough that cold typecheck, broader diffs, parallel
pre-commit contention, or e2e-in-stop-hook behavior can still break the budget.

## Policy

1. Agent-facing automatic checks must either finish within 240s or stop
   cleanly with a short, actionable message and log paths.
2. Commit gates must fail closed on timeout. They must not return success while
   verification continues in the background.
3. Manual async verification is allowed, but it must be explicit and report
   state through repo commands.
4. Slow tests should stay runnable and discoverable, but they should not run
   in default hooks, `test`, `test:changed`, or `verify:changed`.
5. Timing tests remain separate from slow tests. `RUN_TIMING_TESTS=1` continues
   to mean "run timing-sensitive assertions", not "run slow tests".
   A single test should never require both `RUN_TIMING_TESTS=1` and
   `MUSI_RUN_SLOW_TESTS=1` to run.

## Plan

### 1. Make Runtime Data Reliable

Goal: know which step consumes the budget before excluding tests or changing
watchdogs broadly.

- Add JSON timing capture to pre-commit's `test:changed` command, matching
  `scripts/verify.sh`:
  `--reporter=dot --reporter=json --outputFile.json="$LOG_DIR/test-timings.json"`.
- Add lightweight JSON step metadata under `/tmp/musi-pre-commit-logs`, for
  example `run-meta.json`, containing step name, mode (`parallel-precommit` or
  `serial-verify`), start time, end time, elapsed seconds, exit code, and
  command.
- For pre-commit's parallel steps, wrap each child so lint, typecheck, test,
  and scripts each write their own elapsed time before exiting.
- Record wrapper elapsed time separately from child elapsed time. Pre-commit
  runs lint, typecheck, test, and scripts in parallel, so child timings from
  that mode are contention-influenced and are not directly comparable to
  serial `verify` / `verify:changed` step durations.
- Extend `bun run verify:logs` with a `budget` view that prints:
  - latest wrapper elapsed time,
  - per-step elapsed time, grouped by parallel-precommit vs serial-verify mode,
  - top slow Vitest files and cases when a timing sidecar exists,
  - whether the latest run exceeded 210s warning or 240s hard budget.
- Keep `verify:logs slow-tests` as a local signal only. Do not make slow-test
  reporting itself gate commits.

Verification for this slice:

- `bash scripts/test-verify.sh`
- `bash scripts/test-verify-logs.sh`
- `bash scripts/test-dependency-freshness.sh`
- `FORCE_VERIFY=1 bun run verify:changed`
- `bun run verify:logs budget`
- `bun run verify:logs slow-tests`

2026-05-03 measurement status: complete. The representative serial
`verify:changed` sample finished in 127s with `verify:logs budget` reporting
state OK.

### 2. Add Explicit Slow-Test Tiering

Goal: default test runs stay focused while expensive coverage remains easy to
invoke.

- Adopt a whole-file convention: `*.slow.test.ts` and `*.slow.test.tsx`.
- In each package Vitest config, exclude `**/*.slow.test.*` by default so IDE
  runners, `test`, `test:changed`, and `verify:changed` share the same default
  behavior without env-dependent config branches.
- Add package scripts:
  - `test:slow`: runs the explicit slow tier with `MUSI_RUN_SLOW_TESTS=1`,
    using a dedicated slow Vitest config or repo wrapper path that includes
    only `*.slow.test.{ts,tsx}` files.
  - `verify:slow`: runs default verification plus `test:slow`, intended for
    async or deliberate local confidence, not hooks.
- Defer per-test helpers (`slowIt`, `slowDescribe`, tags, or similar) until
  there is a concrete runner design proving helper-gated cases are skipped by
  default and included by `test:slow`. Whole-file slow tests are the initial
  tier.
- Keep the existing `RUN_TIMING_TESTS` gates in auth timing-oracle tests. Do
  not migrate those to `MUSI_RUN_SLOW_TESTS` unless they are slow for reasons
  unrelated to timing sensitivity.
- Teach `scripts/test-changed.sh` to detect changed `*.slow.test.*` files and
  print a clear hint:
  `slow tests changed; run MUSI_RUN_SLOW_TESTS=1 bun run test:slow`.
- Do not add a same-directory slow-sibling hint in this pass. It is likely too
  noisy in broad service directories; rely on the explicit changed-slow-test
  hint until there is an import-aware heuristic.

Selection criteria for marking tests slow:

- A file repeatedly appears in the top slow-file list and costs more than 20s
  alone, or
- A test case repeatedly costs more than 10s and cannot be made cheap, or
- The test intentionally exercises high-contention, rate-limit, large-fixture,
  or e2e-like behavior outside the normal unit/integration budget.
- Timing-oracle tests are excluded from this criterion by default. Keep them on
  `RUN_TIMING_TESTS=1` unless measurement shows they are also slow for reasons
  unrelated to timing sensitivity.

2026-05-03 measurement status: no current whole-file candidates met these
criteria. The slowest file was 3.924s and the slowest case was 2.791s, so slice
2 should focus on adding the explicit tiering mechanism and changed-slow-test
hint rather than moving existing files based on this sample alone.

2026-05-03 implementation status: slice 2 landed. The mechanism is in place
even though no production tests have been moved into the slow tier yet — the
two sentinel fixtures (`test-tier-sentinel.test.ts` and
`test-tier-sentinel.slow.test.ts`) document and verify the contract, and a
new test will move into the slow tier the next time the slow-file or
slow-case threshold is triggered.

Verification for this slice:

- `bun run test`
- `bun run test:changed`
- `bun run test:slow` (the wrapper sets `MUSI_RUN_SLOW_TESTS=1`)
- `bash scripts/test-test-slow.sh` (smoke proving default runs exclude a
  `.slow.test.ts` fixture, that `test:slow` includes it, and that
  `test-changed.sh` emits the slow-test hint when a slow file changes)

### 3. Enforce the Interactive Budget

Goal: after timing capture and obvious slow-test tiering, agent-facing commands
cannot exceed the cache budget by default.

- [x] Introduce shared budget env names with conservative defaults:
  - `MUSI_INTERACTIVE_WARN_AFTER=210`
  - `MUSI_INTERACTIVE_TIMEOUT=240`
  - keep `MUSI_VERIFY_TIMEOUT` as an override alias for compatibility.
- [x] Update `scripts/verify.sh`:
  - default hard timeout becomes 240s,
  - warning line appears if elapsed exceeds 210s,
  - timeout exits 124 with log paths and `verify:logs budget` instructions.
- [x] Update `.husky/pre-commit`:
  - default hard timeout becomes 240s,
  - timeout fails closed and leaves no success marker,
  - no backgrounding or detached verification from the commit gate.
- [x] Couple `scripts/verify.sh`'s lock wait and post-lock watchdog to a single
  deadline so contention plus execution cannot exceed the interactive budget
  end-to-end. Slice 3a tightened both knobs to 240s independently, but a
  contender that waits ~239s on the lock can still get a fresh 240s window of
  execution for a worst case near 480s. Either subtract waited time from the
  post-lock budget, or drop the verify lock wait to the same short cap slice
  3b applies to `bun-run-quiet.sh`.
- [x] Update `.claude/hooks/bun-run-quiet.sh`:
  - lower command execution watchdog to fit under 240s,
  - lower lock wait drastically, for example 20-30s, and return a denial with
    the existing Monitor/flock wait command instead of holding the tool call
    for hundreds of seconds,
  - lower the matching `.claude/settings.json` hook `timeout` (currently 1100)
    to roughly 280s as a backstop so the harness contract is self-evident and
    a wedged script cannot outlive its self-kill window.
- [x] Update `scripts/ai-hooks/policy.sh` so the agent hook wrappers recognize the
  new and preferred verification commands: `verify`, `verify:changed`,
  `test:slow`, `verify:slow`, and the async status/tail/stop commands that
  should remain short. Long-running async start commands may be allowed raw only
  if they return immediately and print the status command.
- [x] Update Codex hooks to mirror the policy where applicable:
  - keep the existing short pre/post tool hook timeouts,
  - reduce the 600s Codex Stop hook timeout after e2e stop behavior is changed.
- [x] Remove long-running work from stop hooks:
  - stop hooks may read cached e2e/verify results,
  - stop hooks may remind the agent to run async verification,
  - stop hooks should not launch e2e or full verification with a multi-minute
    timeout.

Do not do this slice before slice 1. Only enforce the new default after at
least one representative serial `verify:changed` sample is under the 210s warn
threshold. The 2026-05-03 sample satisfies this gate at 127s. If typecheck
alone regularly exceeds 210s warm or 240s cold in later samples, address
typecheck first instead of accepting flaky timeouts.

2026-05-03 slice 3a status: landed. `scripts/verify.sh` and `.husky/pre-commit`
default to `MUSI_INTERACTIVE_TIMEOUT=240` (with `MUSI_VERIFY_TIMEOUT` retained
as a back-compat override) and emit a soft-budget warn when elapsed exceeds
`MUSI_INTERACTIVE_WARN_AFTER=210`. The watchdog now prints `logs:` and
`inspect: bun run verify:logs budget` before exiting 124, and a fresh
`FORCE_VERIFY=1 bun run verify:changed` sample landed at 134s with
`verify:logs budget` reporting state OK under warn=210s / hard=240s. Slices 3b
and 3c (hook + stop-policy changes) are now landed.

2026-05-03 slice 3a deferred finding (codex review of `1815bfeb`, P2): in
`scripts/verify.sh` the lock wait and post-lock watchdog are independent
240s windows, so a contender that waits up to `LOCK_WAIT` and then runs for
`TIMEOUT` can take ~480s end to end and still appear under budget. The slice
3a defaults capped both stages but did not couple them, so the worst case
sums two cache-budget windows. Pre-commit is unaffected (its `flock -n` exits
immediately on contention). The fix is tracked as a bullet in slice 3b above
and will be addressed alongside the bun-run-quiet hook tightening, since both
are about contention behavior under the new envelope.

2026-05-03 slice 3b/3c status: landed. `verify.sh` keeps a 240s default lock
wait but subtracts waited time from the post-lock watchdog. Claude's
`bun-run-quiet.sh` defaults to `AI_BUN_LOCK_WAIT=25` and `AI_BUN_TIMEOUT=210`;
`.claude/settings.json` backs it with a 280s timeout. Stop hooks no longer run
e2e or full verification; they only read fresh cached e2e markers and remind on
cached failures. This repo configures Claude and Codex Stop hooks with a 30s
local timeout for parity and loop safety; this is not a Claude Code platform
limit, since Claude hook timeouts are configurable.

Verification for this slice:

- Existing hook smoke tests.
- New smoke tests for timeout messages and lock-wait behavior.
- A short-timeout fixture run such as `MUSI_INTERACTIVE_TIMEOUT=2` to prove
  children are killed and no success marker is written.

### 4. Add Manual Async Verification

Goal: provide local CI-like confidence without spending the current agent tool
call budget.

Add a small async verifier, not a full CI system:

- `bun run verify:async`: starts a detached `bun run verify` job and returns
  immediately.
- `bun run verify:async:changed`: starts detached `bun run verify:changed`.
- `bun run verify:async:slow`: starts detached slow/default verification.
- `bun run verify:async:status`: prints running/pass/fail, PID, command,
  started time, elapsed time, HEAD, worktree fingerprint, exit code, and log
  directory.
- `bun run verify:async:tail`: tails the latest async log.
- `bun run verify:async:stop`: terminates a stale async job.

Implementation shape:

- Use a repo-keyed state directory under `/tmp/musi-verify-async/`.
- Record `pid`, `started_at`, `command`, `head`, `worktree_fingerprint`,
  `log_dir`, `exit_code`, and `finished_at`.
- Use the existing verification lock so async jobs do not race with pre-commit
  or foreground verify.
- Give async runs their own log directory and marker paths. Do not use the
  default `/tmp/musi-pre-commit-logs` lifecycle, because foreground
  `verify.sh` and pre-commit wipe that directory and `verify:logs budget` must
  not confuse detached-run timings with the latest interactive run.
- Do not let async verification write pre-commit success markers.
- Do not inherit the 240s interactive timeout for detached jobs. Add an explicit
  async timeout, for example `MUSI_ASYNC_VERIFY_TIMEOUT`, with a larger default
  suitable for full and slow confidence checks. Interactive commands that start,
  stop, tail, or check status still use the 240s budget.
- Add async state and log garbage collection. `verify:async:status` should
  prune finished entries and dead-PID state older than a small retention window,
  for example 7 days, and report when it prunes stale state.
- Teach stop hooks to report a pending async job status in one short message
  instead of launching verification themselves.

Verification for this slice:

- Script smoke tests for start/status/tail/stop.
- A fake short command fixture so tests do not depend on a real long verify.

2026-05-03 implementation status: slice 4 landed. Workspace scripts now expose
`verify:async`, `verify:async:changed`, `verify:async:slow`,
`verify:async:status`, `verify:async:tail`, and `verify:async:stop`.
Detached runs store state under `/tmp/musi-verify-async/<repo-key>/`, with one
log directory per run, and use private verify markers so they do not update
`/tmp/musi-verify-last`, `/tmp/musi-verify-changed-last`, or pre-commit
markers. The async hard timeout is `MUSI_ASYNC_VERIFY_TIMEOUT`, defaulting to
1800s so a full verify plus the explicit slow tier has room outside the
interactive 240s tool-call budget. `verify:async:slow` deliberately runs the
existing `verify:slow` umbrella only; e2e remains separate because it has
different environment requirements and failure handling than lint/typecheck/
Vitest confidence checks. Per-test slow helpers remain deferred; this slice
keeps the whole-file slow-test tier only.

2026-05-03 slice 4 follow-up: the initial async Stop reporter emitted a
message on every Stop event, including for already-passed runs, and had no
kill switch. Codex's first run-through of slice 4 generated 856 Stop events
in a single session and trapped the agent in a notify loop. The fix tightened
`ai_stop_async_verify_status` to mirror the e2e reporter: passing runs are
silent, the `.no-stop-async-verify` kill switch suppresses the reporter, and
repeats are bounded by `AI_STOP_ASYNC_MAX_NOTIFY` (default 2) per
(state-file, exit-code) pair so a stale finished run cannot fire forever.
Stop-hook reporters added in future slices must mirror the same three
properties: kill switch, skip-success (or skip-non-actionable), and
per-state dedup counter.

### 5. Optimize Typecheck If Measurements Require It

Goal: avoid treating tests as the only problem if TypeScript is the long pole.

- Capture warm and cold `bun run typecheck` duration in the new budget report,
  using serial verify timings for typecheck-specific conclusions. Parallel
  pre-commit child timings are useful for wall-clock budget pressure, but CPU
  contention means they should not be treated as isolated typecheck cost.
- If typecheck regularly exceeds 210s warm or 240s cold, investigate before
  reducing confidence:
  - `tsc -b --verbose` to confirm project-reference behavior,
  - placement and reuse of `tsconfig.tsbuildinfo`,
  - whether client `noEmit` / composite settings are preventing useful build
    caching,
  - whether generated or seed-heavy paths should be excluded from typecheck,
  - whether a changed-file typecheck mode is feasible without weakening the
    default pre-commit contract.
- Only after typecheck is measured and improved should the hard 240s timeout
  be considered stable.

## Non-Goals

- Do not build a matrix runner or GitHub Actions replacement in this pass.
- Do not allow commits to land while verification is still running.
- Do not hide failing slow tests forever. Slow tests must have an explicit
  command and should be mentioned when touched.
- Do not merge timing-oracle semantics into slow-test semantics.

## Acceptance Criteria

- Default hook and manual verification tool calls finish under 240s or fail
  closed with log paths.
- `bun run verify:logs budget` shows enough timing data to identify the slow
  step without rerunning.
- Slow tests are skipped by default and runnable through `bun run test:slow`.
- Changed slow tests produce a clear manual follow-up hint.
- Stop hooks no longer launch multi-minute test runs.
- Manual async verification can run full or slow confidence checks without
  occupying the current Claude/Codex tool call.

## Open Questions

- Resolved for slice 4: `verify:async:slow` does not include e2e; e2e should
  remain a separate future async command because it has different environment
  requirements and failure-handling expectations.
- Deferred: if per-test slow helpers become necessary later, choose between
  Vitest tags and a repo-owned wrapper convention in a dedicated runner design;
  this slice stays whole-file only.
