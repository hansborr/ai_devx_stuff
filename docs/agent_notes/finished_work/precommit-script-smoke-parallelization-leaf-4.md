# Pre-commit Perf Leaf 4: Script Smoke Parallelization

## Summary

`scripts/test-scripts.sh` now runs selected smoke tests with bounded
parallelism by default. The default concurrency is `min(4, nproc)`, falling
back to `4`, and `MUSI_SCRIPTS_CONCURRENCY` can override it for tests and
debugging. `MUSI_SCRIPTS_CONCURRENCY=1` keeps the previous single-stream,
halt-on-first-failure behavior.

Parallel mode writes each smoke's stdout/stderr to
`${MUSI_SCRIPTS_LOG_DIR:-/tmp/musi-test-scripts-logs}/<smoke>.log`, prints a
start line and finish line for each smoke, and summarizes passed/failed smokes
after all active children finish. On failure, the runner stops launching new
smokes, lets already-running smokes finish, and prints the last 30 lines of
each failed smoke log inline.

Signal handling now prevents new startups after `SIGINT`/`SIGTERM`, forwards
the signal to active smoke wrappers, waits for them, and exits `130`/`143`.
The smoke command boundary resets `INT`/`TERM` dispositions so forwarded
signals are not ignored by backgrounded shell children.

## Resource Isolation

The selected-smoke audit found no pair that must be grouped for shared
`/tmp/musi-pre-commit.lock` or `/tmp/musi-pre-commit-logs` access. The
verify/pre-commit smokes already override lock, marker, and log paths into
fixture repos or `mktemp` roots. Git commits happen inside sandbox repos.

The audit did identify non-reentrant single-smoke internals that remain safe
because each appears at most once in a selected run: `test-code-intel` touches
the repo code-intel daemon state, `test-lint-ratchet` writes sweeper decoys
under `node_modules/.cache/eslint-ratchet`, `test-lint-config-sensors` primes
the hadolint wrapper cache, and `test-doctor-json` uses fixed doctor temp
filenames. The real-doc generator smokes temporarily mutate different generated
files and restore them; they are not killed on ordinary smoke failure.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-test-scripts.sh`
- `MUSI_SCRIPTS_CONCURRENCY=1 bun run test:scripts:changed`
- `MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-ratchet.ts" bash scripts/test-scripts.sh --changed`
  passed with `test-lint-ratchet OK (204s)`.
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`

## Followups (post-merge codex review)

- **P3 — parallel runner can launch extra smokes after an unobserved failure**
  (`scripts/test-scripts.sh:472-475`). `musi_scripts_wait_for_one` reaps a
  single child per call; if a sibling has already failed but `wait -n`
  happens to surface a successful child first, `STOP_STARTING` stays `0` and
  the next `musi_scripts_fill_slots` launches another smoke. The aggregate
  pass/fail is still correct — only the "stop launching after first failure"
  contract leaks. Worst case: ~195s of extra ratchet smoke work. Fix idea:
  after each `wait_for_one`, drain any other already-exited PIDs
  (`wait -n` in a non-blocking loop with `kill -0`) before deciding whether
  to top up slots. Deferred per the rules in
  `docs/agent_notes/AGENTS.md`-derived workflow ("Fix P0/P1; P2+ stay in
  notes").
