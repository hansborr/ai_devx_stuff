# Document the AI-Hooks-Suite / Git-Commit-Quiet Chaining Deadlock

Status: Implemented
Date: 2026-08-25
Priority: P2
Size: S
Source: `test-fixtures-races-and-environment.md` — "Readiness is often
represented by sleep" (the two dated 2026-08-17/2026-08-18 deadlock
paragraphs)

## Problem

Two reproduced, expensive incidents are not documented anywhere in the repo:

- **2026-08-17 (unit 107-S2):** `bash scripts/ai-hooks/test.sh` chained with
  `git commit` in the same agent Bash call deadlocked for 20+ minutes. The
  harness's PreToolUse hook wraps any Bash command containing `git commit`
  in `git-commit-quiet.sh` — including everything before it in the same
  command string — so the wrapper's cross-worktree commit-queue lock
  (`scripts/ai-hooks/git-commit-quiet.sh:102-117`, "Cross-worktree commit
  queue" comment starting at line 102) is already held for the whole nested
  execution: unlike the per-worktree single-writer flock (lines 79-90, `flock
  -n 9`, fails fast with a `{"decision":"block",...}` response), the queue
  lock is git-common-dir-keyed and acquired through a *blocking* foreground
  poll loop (lines 140-146) bounded by `COMMIT_QUEUE_WAIT`, which defaults to the
  same `MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT` (2400 s) the land.sh incident
  below hit exactly. The suite's own fixtures spawn 20 nested
  `git-commit-quiet.sh` instances (`scripts/ai-hooks/test.sh`, grep
  `git-commit-quiet\.sh"`); 13 explicitly override `MUSI_COMMIT_QUEUE_LOCK` to
  a fixture-private path (grep `MUSI_COMMIT_QUEUE_LOCK=` in that file). Of the
  remaining 7, at least two are confirmed safe on inspection (one is a
  non-`git commit` passthrough that returns before the lock section runs at
  all, `test.sh:2719-2725`; one points its payload `cwd` at a separate,
  independently-`git init`ed fixture repo whose common-dir cannot collide,
  `test.sh:2727-2753`) — this leaf does not claim to have identified which
  invocation(s), if any, actually caused the 2026-08-17 hang. What matters for
  the doc fix is only that the *mechanism* is confirmed live (a nested
  wrapper invocation that does share the real repo's common-dir queues behind
  the outer wrapper's held lock for up to `COMMIT_QUEUE_WAIT`), not a full
  audit of every fixture. A wedged run must be killed, not waited out.
- **2026-08-18:** `nohup bash scripts/land.sh &` in the same Bash call as its
  `git commit` reproduced the identical shape: `land.sh`'s full sequential
  `bun run verify` includes `bun run test:scripts` → `test-ai-hooks`
  (`scripts/verify/steps.generated.sh:12` lists `scripts` as a verify slot;
  `package.json:57` maps `test:scripts` to `bash scripts/test-scripts.sh`,
  which runs `scripts/ai-hooks/test.sh`). The run hung in `test-ai-hooks` for
  ~35 minutes until the wrapper's 2400 s total timeout fired, reporting
  `exit: 2 (verify-failed)` with every other slot green and no failing
  assertion to read — a diagnostic signature easy to misread as a flake in
  one of that slot's *other* suites (the same run's independent
  `test-dependency-freshness` failure is unrelated, per
  `docs/guides/verify-gate-lifecycle.md` §5's separate readiness-race
  guidance). Relaunching the identical commit from a Bash call with no `git
  commit` in it landed green.

Neither `docs/ai-harness.md` nor `docs/guides/verify-gate-lifecycle.md`
names this failure mode. This is a real gap: `docs/guides/verify-gate-lifecycle.md`
§6 already tells agents to *chain* a manual bridge in one command —
"chain them in one command (`bun run verify && git commit …`)" (lines
293-297) — and `bun run verify` also runs `test-ai-hooks` as part of
`test:scripts`. Whether that specific recommended pattern shares the same
risk as the two reproduced incidents (both of which invoked the suite
directly or via a *backgrounded* `land.sh`, not via a foreground `bun run
verify && …`) is not established by the note's evidence and needs an
explicit answer, not a guess — see Open questions.

## Scope

- In `docs/guides/verify-gate-lifecycle.md` §6 ("Full-scan escalation, heap,
  and concurrent gates"), add one new bullet immediately after the existing
  "The manual-verify bridge is a chained sequence" bullet (lines 293-297)
  that: (a) names the two reproduced incidents and their exact commands,
  (b) states the mechanism (the whole Bash command is wrapped in
  `git-commit-quiet.sh` when it contains `git commit`, so anything before it
  — including the ai-hooks suite itself — runs inside the wrapper's own held
  lock), (c) gives the concrete rule: run `scripts/ai-hooks/test.sh`,
  `git add`, and `git commit` in separate Bash tool calls, and never
  background a full verify (`land.sh`, `bun run verify`) in the same call as
  a `git commit`, and (d) names the diagnostic signature (the commit-queue
  wait expiring at its ~2400 s `COMMIT_QUEUE_WAIT` bound, landing specifically
  in the `scripts` slot's `test-ai-hooks` case with every other slot green,
  and reported by the outer runner as a generic slot failure/timeout with no
  failing assertion to read) as contention to kill and retry from a
  commit-free Bash call, not a flake to wait out.
- Do not alter the existing "manual-verify bridge" bullet's recommended
  `bun run verify && git commit` pattern — neither incident reproduced that
  exact foreground, non-backgrounded form, and rewriting standing guidance
  on an untested inference would be worse than leaving the open question
  below for an owner to verify.
- No script or fixture change. `scripts/ai-hooks/test.sh`'s lock-isolation
  gaps (which invocations should be forced onto fixture-private
  `MUSI_COMMIT_QUEUE_LOCK` paths) are a separate, larger investigation —
  enumerating and fixing the non-overridden `git-commit-quiet.sh` invocations
  is not bounded without first confirming which of them can legitimately
  share the real queue-lock path (the cross-worktree commit-queue fixtures
  may need to, for the behavior they test) versus which are simply missing an
  override.

## Verification

- Read-only: confirm the new bullet renders correctly and cites live line
  numbers (`scripts/ai-hooks/git-commit-quiet.sh:79-90,102-146`,
  `scripts/verify/steps.generated.sh:12`, `package.json:57`). No test suite
  covers documentation prose; this is a docs-only change with no executable
  verification beyond `bun run docs:harness-controls:check` (confirms the
  guide is still registered and generated surfaces are unaffected) if that
  check happens to touch this file's frontmatter.

## Open questions

- Does `bun run verify && git commit` (the guide's own recommended
  foreground bridge pattern) carry the same deadlock risk, since `bun run
  verify` also runs `test-ai-hooks`? Neither reproduced incident used that
  exact foreground form (one ran the suite directly with no verify wrapper,
  the other backgrounded `land.sh` with `nohup … &`), so this leaf does not
  assume an answer. An owner should either reproduce the foreground-chained
  form directly, or audit whether `scripts/ai-hooks/test.sh`'s non-overridden
  `git-commit-quiet.sh` invocations can only be reached by a nested
  *backgrounded* or *directly-suite-invoking* wrapper (in which case the
  foreground `bun run verify && git commit` bridge is actually safe and the
  guide should say so explicitly, closing this question).
