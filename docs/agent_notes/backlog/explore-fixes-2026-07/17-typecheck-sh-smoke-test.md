# 17 — Smoke-test `scripts/typecheck.sh` (FIFO fan-out, traps, exit merge)

Status: Ready
Track: T (tooling) · Priority: P2 · Size: M

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/typecheck.sh` — 143 lines of branchy shell with zero direct test
  coverage: concurrent `tsc` runs over named FIFOs, `on_sigint`/`on_sigterm`
  traps (`:59-67`), reader-PID reaping (`cleanup_children`, `:43-57`), and
  exit-code reconciliation (`:133-140`).
- Its sibling `scripts/vitest.sh` — same architectural role — has 5 test
  references; `scripts/tests/test-typecheck.sh` does not exist.

## Do

Add `scripts/tests/test-typecheck.sh` driving the script with a fake `tsc`
via `MUSI_TSC_BIN` that returns controlled exit codes, covering: both lanes
green; build lane fails; scripts lane fails; both fail (which code wins);
and output interleaving stays intact. Register it wherever the shell smoke
suite requires (path-policy subjects, query run-order, test-test-scripts
ALL_SMOKE_TESTS — see the pattern used by recent smoke-test adds).

## Risk note

The FIFO/trap plumbing can hang a naive harness — give every case a hard
timeout and drain FIFOs the way `test-vitest*.sh` smokes do; crib their
scaffolding.

## Verify

```
bash scripts/tests/test-typecheck.sh && bun run test:scripts
```

## Acceptance

The smoke test exists, is registered, passes, and each exit-reconciliation
branch is pinned by at least one case.
