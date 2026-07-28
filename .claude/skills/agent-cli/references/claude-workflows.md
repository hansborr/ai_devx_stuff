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
