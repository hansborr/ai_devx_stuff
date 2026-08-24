# Bound Agent Backends to the Wrapper Lifetime

Status: Cancelled — owner decision 2026-07-22; retained as an evidence record
Date: 2026-07-21
Priority: — (was P1)
Size: — (was L)
Risk: high
Source:
`/home/node/persist/musi/pain_points/agent-cli-and-external-reviews.md` —
orphaned Codex processes

> **Cancelled.** The owner declined this lifecycle redesign on 2026-07-22. Do
> not schedule or implement it. The analysis below is retained because it
> documents the SIGKILL/orphan contract and the manual recovery path.

## Problem

`agent-run.sh` now handles catchable wrapper termination well, but its
`SIGKILL` and external-wrapper-death contract still permits the backend process
group to survive. A surviving Codex backend can continue changing a lane for
hours, leave an empty answer file, and hold the worktree's fd 9 lock after the
task that launched it has disappeared. Recovery is manual: identify the dead
run, kill the logged backend process group, and then inspect the lane for
residue.

This is not a missing signal trap. `SIGKILL` is untrappable, and the existing
TERM/INT/HUP propagation, process-group targeting, PID-capture recovery, and
KILL escalation already cover the cooperative paths. The missing owner is a
deliberately high-risk lifecycle redesign: a small process that survives the
orchestration shell, directly owns and reaps the backend, and enforces a
wrapper-specific deadline even if the wrapper cannot run cleanup. It must
preserve the launch, status, lock, and recovery contracts that currently live
in one shell while moving process ownership across an IPC boundary.

## Evidence

- `.claude/skills/agent-cli/scripts/agent-run.sh:1254-1265` launches backends
  under `setsid` and targets their process group. Lines 1334-1350 close the
  Codex PID-capture race.
- `.claude/skills/agent-cli/scripts/agent-run.sh:1409-1462` propagates
  TERM/INT/HUP, waits through a grace period, escalates to KILL, and reaps the
  backend. Its comment correctly states that wrapper `SIGKILL` cannot take this
  path.
- `scripts/tests/test-skill-dispatch-wrappers.sh:2304-2341` currently pins the
  residual behavior: after `kill -KILL "$SIGK_WRAPPER"`, the backend must
  remain alive and keep the next work dispatch locked out until the test kills
  the backend group manually.
- `.claude/skills/agent-cli/SKILL.md:68-70` and
  `.claude/skills/agent-cli/references/trailer-contract.md:68-95` document the
  resulting orphan probe and manual process-group cleanup.
- The field report behind this leaf observed the backend and
  `codex-code-mode` child continuing well past the caller's interactive
  timeout, re-dirtying the lane after the task record had vanished.

## Scope

- Put backend launch behind one shared lifecycle supervisor used by every
  adapter. The supervisor must be outside the backend's dedicated `setsid`
  process group, be the direct parent that can `wait`/reap the backend leader,
  and remain alive when the orchestration shell is killed. Use one supervisor
  event loop to observe child exit, wrapper-channel EOF, and the deadline; do
  not fork independent watchdogs whose cleanup and signal decisions can race.
- Give the wrapper and supervisor a private liveness/status channel with an
  exact framed protocol. Wrapper-end EOF identifies wrapper death without a
  reusable-PID guess. Supervisor messages must distinguish launch failure from
  a verified backend leader/group identity and must return the child's exact
  wait disposition (normal exit code or terminating signal), followed by one
  terminal cleanup state. Reject malformed, duplicate, or out-of-order states;
  never infer a group from a bare PID or partially written file.
- Hold the worktree lock fd 9 only in the wrapper and supervisor. Explicitly
  close it, plus every liveness/status descriptor, in the backend launch child
  before `exec`, so no backend or descendant can prolong lock ownership. The
  supervisor retains fd 9 through normal reaping or forced tree cleanup and
  releases it only after publishing the terminal cleanup state.
- Define an explicit wrapper-specific run deadline (for example,
  `MUSI_AGENT_RUN_TIMEOUT`). It must not silently inherit an ambient interactive
  timeout or impose a new default on unrelated commands. Validate a supplied
  value as a positive bounded duration, document whether omission means no
  supervisor deadline or a separately approved agent-run default, and record
  the effective disposition in testable launch metadata.
- On wrapper loss or deadline expiry, have the event loop TERM the exact
  supervisor-created backend process group, wait a short bounded grace, KILL
  any survivors, reap its backend child, remove its private temporary files,
  and publish `cleanup-complete` before closing fd 9 and exiting. If the
  supervisor itself crashes, inherited descriptors must close naturally and
  the waiter must report a distinct supervisor-crash/unknown-cleanup boundary;
  the design must not claim automatic containment beyond that boundary.
- On normal completion, send the exact child wait status to the wrapper and
  retire the deadline in the same event loop before publishing terminal state.
  Preserve existing answer, drift, and work-outcome normalization, plus the
  early `agent-run: backend-pid:` breadcrumb. In particular, preserve Codex's
  pre-`exec` PID identity and early anchored session-ID publication so a wrapper
  crash does not regress resumability or reopen the launch-to-PID-capture race.
- Add an explicit waiter state for **cleanup in progress**: a dead wrapper plus
  a live supervisor/backend, or a terminal signal without `cleanup-complete`,
  is neither a finalized run nor the old operator-owned orphan. It must remain
  non-takeover-safe until cleanup completes; timeout and supervisor-crash states
  remain fail-closed and give bounded manual recovery guidance.
- Define a narrow stale-lock policy. Do not blindly delete `.git/index.lock`
  after KILL: remove it only when this dispatch recorded that it created the
  exact lock file and can prove the entire owning backend group is dead;
  otherwise preserve it and report it for inspection.
- Replace the current SIGKILL fixture with deterministic lifecycle tests for
  wrapper death, deadline expiry, TERM-ignoring descendants, normal completion,
  and the Codex launch/PID-capture window. Exercise both lock-holding `work` and
  lock-free `consult` paths and at least one non-pipeline backend.
- Update both skill mirrors and the waiter/trailer documentation. A killed
  wrapper remains an unsuccessful, unfinalized run; after automatic cleanup,
  the waiter may classify it as a dead run with no live backend rather than an
  orphan requiring manual `kill`.

## Acceptance

- Killing the wrapper with `SIGKILL` after backend launch causes the whole
  backend process group, including a TERM-ignoring child, to become dead within
  the bounded cleanup window without an operator command.
- A backend that exceeds the internal deadline is terminated and reaped even
  while the wrapper itself remains healthy. The wrapper returns a failure and
  does not emit a false `worktree: clean` success.
- After either path reaches `cleanup-complete`, a new `work` dispatch can
  acquire the same worktree lock; no supervisor, backend descendant, tee
  process, fd 9 holder, supervisor-owned temporary file, or deadline remains.
  An unrelated or unproven `.git/index.lock` is reported, not deleted.
- A backend that finishes before the deadline preserves its exact exit/result
  behavior, and a later deadline cannot kill an unrelated process that reused
  an old PID.
- The waiter distinguishes running, cleanup-in-progress, cleanup-complete,
  finalized, and supervisor-crash/unknown-cleanup states without permitting
  takeover while cleanup may still be active.
- Tests cover wrapper death before and after verified group publication,
  Codex's pre-`exec` PID and early-session breadcrumbs, exact exit/signal status
  propagation, malformed IPC, supervisor crash, process-group KILL escalation,
  normal deadline retirement, temporary cleanup, fd inheritance, conservative
  `index.lock` handling, and the no-`setsid` portability disposition.
- `bash scripts/tests/test-skill-dispatch-wrappers.sh`, the skill mirror checks,
  and `bun run harness:check` pass.

## Boundaries

- Do not describe or implement this as trapping `SIGKILL`; survival belongs to
  an independent supervisor/liveness channel.
- Do not regress or replace the already-correct TERM/INT/HUP, dedicated process
  group, PID-capture, or normal orphan-child handling merely to share code.
- Do not treat timeout or wrapper death as successful completion, synthesize a
  clean worktree trailer, delete user work, or auto-resume the delegate.
- Do not let the wrapper and supervisor both own cleanup, waiting, or terminal
  status publication. One event loop owns the backend lifecycle; the wrapper
  owns result normalization only after receiving a valid terminal state.
- Do not kill an unverified bare PID or scan for processes by command name. A
  cleanup target must be the process group created for this exact dispatch.
- Do not remove an ambient `.git/index.lock` merely because forced cleanup ran.
- Do not silently promise whole-tree containment on platforms without
  `setsid`. Preserve a documented degraded leader-only path or explicitly make
  the prerequisite fail closed for lock-holding work after a portability
  review.
- Keep this inside the agent-cli wrapper contract; no system daemon, container
  runtime, cgroup service, or change to verification-slot timeouts is required.
- Scope the guarantee to wrapper-process death and the internal deadline. A
  host, container, or cgroup teardown that kills the supervisor too is outside
  the repo process's ability to recover.
