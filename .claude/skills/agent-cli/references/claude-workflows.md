# agent-cli inside Claude Code Workflow scripts

Operational caveats for dispatching agent-cli runs from a dynamic Workflow
script. Claude-Code-only; routine dispatch does not need this file.

To run an off-family agent (e.g. codex) inside a workflow, spawn a thin
wrapper: an `agent()` with `model: 'sonnet'`, `effort: 'low'`, and a prompt
telling it to dispatch through this skill and return the delegate's answer
verbatim. Set `label` to the real delegate (e.g. `codex:<task>`), not the
sonnet shim.

- Shims cannot babysit gate-length runs: the idle enforcer kills a shim around
  the hour mark, orphaning its delegate mid-run. Reserve shims for short
  dispatches (consults, single-leaf missions). When the orchestrator's main
  loop can own the wait, dispatch agent-run.sh directly via background Bash —
  one backgrounded dispatch per worktree gives parallelism without shims — and
  let completion notifications drive the turn.
- Shim report schemas: derive run status from the `agent-run:` trailers, never
  from guesses, and never include fields a backgrounded dispatch cannot know
  (e.g. the wrapper's exit code).
- Wrappers cannot idle-wait: any tool-less turn becomes a forced report, and a
  second idle episode kills the wrapper (and its delegate child). Tell wrappers
  to wait via `agent-wait.sh "$LOG" --timeout 570` (one bounded call per ~10
  minutes; 0 = decided, 10 = re-invoke, 20/21 = dead run, 22 = the run died
  before launch, so redispatch the same mission as-is — see
  [trailer-contract.md](trailer-contract.md) for how each is classified; it
  anchors on the completion trailers, never the bare `^agent-run:` dispatch
  header) — never
  no-op spins or a `tail -f` monitor (context burn) — and, if forced to report
  before the job exits, to re-check the job that same turn and report
  in-progress as in-progress, never as done or skipped.
- Workflow agents in `isolation: 'worktree'`: every Bash call starts back in
  the main checkout — a bare `git add`/`git commit` silently runs against the
  main repo. Pin each call with `cd <worktree> && …` or `git -C <worktree>`,
  say so in the agent's prompt, and have it report its worktree path so the
  orchestrator can verify lanes with `git -C <worktree> log <base>..HEAD`.
- Parallel implementation wrappers need `isolation: 'worktree'`: edits collide
  in the shared checkout, and agent-run.sh serializes mutating runs per
  worktree anyway. Consults never take the worktree lock, so parallel consult
  shims need no worktree isolation; answer-producing consults still lock their
  unique `-o` path and any caller-owned Copilot `--share` path. Musi repo-local:
  fresh worktrees may need provisioning (`docs/guides/per-worktree-dev.md`);
  build `@musi/shared` before `worktree:init` when seed inputs changed on the
  base.
- Trust wrapper reports only as claims: verify lane state from the orchestrator
  (`git log <base>..<branch>`) and plan a finish pass for lanes whose delegate
  outlived its wrapper — a killed run may leave complete work staged but
  uncommitted (recover with a fresh `work codex --dirty-ok` run told the staged
  diff is its own). A silent lane is diagnosable from its log alone: dispatch
  header with no `worktree:`/`backend-exit:` trailer and a dead wrapper pid
  means the run died un-finalized (see the SKILL.md "Dead-run signature"); an
  alive backend pid means the delegate still runs and still holds the lane's
  lock. A log that never got past `starting:`/`attempt:` — no `dispatched:`,
  no `backend-pid:` — died before the delegate was launched: waiter exit 22
  (the attempt record is finalized `no-answer`) means nothing ran and the lane
  can simply be re-dispatched, while exit 20 on such a log means the attempt is
  un-finalized and needs explicit recovery before that output path is reused.

## Conductors and implementers: let agent-cli own the wait

A built-in subagent (Agent tool) that backgrounds a detached process —
`agent-run.sh`, `land.sh` — and then ends its turn never wakes: detached
processes are not harness-tracked children, so no notification fires, and the
conductor's task result reads like in-progress work ("waiting on their
answers"). Implementer subagents have the mirror-image failure: they finish and
commit, then idle without ever sending their final report. Warnings in the
brief did not prevent either; six conductors stalled this way in one drain.

The structural fix is to spawn conductors and implementers **through
agent-cli** (`agent-run.sh work claude …`) instead of the Agent tool: the
orchestrator's own background Bash (or `agent-wait.sh`) owns the waiting, and
the `-o` answer file owns delivery, so a delegate that goes quiet after its
last commit still leaves its report on disk and the run's `agent-run:` trailers
still say what HEAD did.

When a built-in subagent must be used anyway, its brief carries the in-turn
poll rule as an *operating rule that names the artifacts*, not as a warning:

> Whenever you wait on a detached process — an implementer, each review seat,
> `land.sh` — wait inside ONE long-lived in-turn shell loop that sleeps and
> polls for the `-o` answer file / the `.msg` / the log's `land: exit:` line.
> Cap it generously and re-enter another loop rather than stopping. Report only
> when the unit is closed, abandoned, or parked; nothing will wake you.

A conductor briefed that way ran a four-round panel plus `land.sh` to a clean
close with zero stalls; the one briefed without it stalled immediately. When a
stalled conductor's notification arrives anyway, check `ps aux | grep
agent-run`, the `-o` files, and the land log, then `SendMessage`-resume the same
agent with the rule above — one message, and it picks up cleanly. An idle
implementer is "work probably done, report lost": read `git -C <lane> log` and
`status` before nudging, and nudge at most once.

The cause is written up in the pain-point topic
`pain_points/agent-cli-and-external-reviews.md` ("A backgrounded consult never
wakes its dispatcher").
