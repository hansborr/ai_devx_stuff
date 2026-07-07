@AGENTS.md

## Claude Code only

### agent-cli inside Workflow scripts

The operational caveats for running agent-cli dispatches inside a dynamic workflow — thin `agent()` shims vs. direct dispatch, worktree isolation, how a schema-bound wrapper must wait, verifying lane state — are Claude-Code-specific and live in the agent-cli skill's "Harness-specific notes" section (loaded with the skill), not here, so they are not a permanent context tax on every session.

The one decision worth making before you reach for the skill: when the orchestrator's main loop can own the wait, dispatch `agent-run.sh` directly via background Bash — one backgrounded dispatch per worktree gives parallelism without shims — and reserve thin `agent()` shims for short dispatches (consults, single-leaf missions) the idle enforcer will not outlive.
