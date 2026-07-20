---
name: agent-cli
description: >-
  Dispatch implementation or a second opinion to another agent CLI (claude,
  codex, copilot, cursor) through one agent-run.sh wrapper. Use when handing
  work to an external agent, getting a cross-model review or design/idea
  consult, or running an off-family model — codex for GPT, copilot for
  Gemini/Kimi, cursor for Grok, claude for Opus/Fable. Not for ordinary local
  shell commands, direct claude/codex/copilot/agent calls, or when a
  same-model subagent would do.
---

# agent CLI dispatch

One wrapper dispatches all four agent CLIs — claude, codex, copilot, and cursor. Never invoke them directly — direct invocations carry the wrong permission profile. State intent — mode, agent, model, prompt — and the wrapper owns the per-CLI flags.

## Fast path

The common cases — each backgrounded, answer in `-o`, log for debugging only:

```bash
# delegate implementation
.claude/skills/agent-cli/scripts/agent-run.sh work codex \
  -p '<task>' -o /tmp/agent-fix-auth.msg > /tmp/agent-fix-auth.log 2>&1

# GPT second opinion / review
.claude/skills/agent-cli/scripts/agent-run.sh consult codex \
  -p '<question>' -o /tmp/agent-review-auth.msg > /tmp/agent-review-auth.log 2>&1
```

For an off-family opinion, swap in `consult copilot -m <model>` or `consult cursor` (see Choosing agent and model). Then: read `-o` and the trailers; after `work`, verify (Run lifecycle).

## Choosing agent and model

- Delegated implementation: `work codex` (no `-m`; user-configured model) is the default delegate. Use `work claude -m opus|fable`, `work copilot -m <model>`, or `work cursor` only when the implementation should come from that specific model.
- Second opinion from Claude Code: `consult codex` for GPT, `consult copilot -m gemini-3.5-flash` for Gemini, `consult cursor` for Grok (catalogs in [references/copilot.md](references/copilot.md) and [references/cursor.md](references/cursor.md)). `consult claude` is pointless from Claude Code — spawn a subagent instead.
- Second opinion from Codex: `consult claude -m fable|opus`; `consult copilot` for Gemini/Kimi, `consult cursor` for Grok. Copilot-hosted `claude-*`/`gpt-*` models are fallbacks for when the native CLI can't serve the model.
- `review codex -- --base main` runs codex's native priority-tagged diff review (log-only; prefer `consult codex` so the result lands in `-o`).

## Command shape

```bash
.claude/skills/agent-cli/scripts/agent-run.sh <consult|work> <claude|codex|copilot|cursor> \
  [-m <model>] [-e <effort>] [-p '<prompt>'] [-P <mission-file>]... [-f <material-file>]... \
  [--dirty-ok] [--require-feature-branch] [--branch <name>] [-o <answer-file>] [-r <session-id>] \
  [-- <native args>] > /tmp/agent-<task>.log 2>&1

.claude/skills/agent-cli/scripts/agent-run.sh review codex \
  [-p '<custom instruction>' | -P <mission-file>] [-- <native review args>]
```

The complete `agent-run:` trailer and exit-code contract lives in [references/trailer-contract.md](references/trailer-contract.md); the bullets below cover routine caller decisions.

- `consult` and `work` require a mission: `-p`, or `-P`/`--mission-file` to read it from a file. `-P` is repeatable and composes with a single `-p` — components concatenate in command-line order into one prompt, so a resume is one command (`-P mission.prompt -P resume-note.prompt`), never hand-concatenation. An empty or whitespace-only mission (or component) exits 2; native `review codex` may omit its instruction. Mission files may live inside the worktree (unlike `-o`). `-f` attaches a file as supporting material (repeatable) — never the mission; attachment-only dispatch exits 2, and stdin is not an input channel.
- `-m` picks the model (required for copilot; claude/codex default to the user-configured model; cursor to `grok-4.5-xhigh`). `-e` sets reasoning effort where supported (cursor rejects it — effort is encoded in the model id).
- `-o` is the authoritative result — a plain answer file regardless of backend. Omit it and one is generated under `$TMPDIR`; either way the path is echoed in the `agent-run: dispatched:` header and confirmed by the `agent-run: answer:` trailer. An explicit path must be fresh — one already holding an answer exits 2 rather than clobbering (`rm` it to reuse) — and must resolve outside the worktree. `review codex` rejects `-o` (read the log).
- `-r <session-id>` resumes a prior session; ids surface in the `agent-run: session-id:` trailer. Resume by explicit id only, never "most recent".
- Native flags after `--` pass through but are guard-scanned: sandbox, session, model, cwd-moving, and permission-mode flags are wrapper-owned and rejected; consults also reject blanket permission grants, while narrow grants (e.g. `'Bash(bun run test:*)'`) pass through as deliberate caller-owned escalations (the one cwd exception lives in [references/copilot.md](references/copilot.md)). Dispatch from the worktree the run should own.

## Run lifecycle

1. Start `work` from a clean worktree — a dirty start exits 2 unless you pass `--dirty-ok` because the mission is to inspect the current uncommitted diff. Verify cleanliness before codex consults; claude/copilot/cursor consults are safe anywhere.
2. Dispatch backgrounded via your harness's background mechanism — never a trailing shell `&` (and never both), never piped through `tail`. Concrete mechanics are in the harness-specific notes below.
3. Wait on the job status — it is authoritative, not the log (logs may stay quiet until completion, and a finished log is not a live run). Idle if your harness can, poll a live session handle if you hold one, otherwise call the bundled helper as one bounded foreground call per ~10 minutes: `.claude/skills/agent-cli/scripts/agent-wait.sh "$LOG" --timeout 570` — exit 0 once the run is decided, 10 on timeout with the run still live (re-invoke), 20/21 on the dead-run signature (below). Treat it as a done/not-done signal: never poll log contents yourself, spin no-op calls, or `tail -f` the log. Pass `--finalized-only` when you will act on the worktree next (`work` runs): a landed answer can precede the drift check and lock release. Consults usually finish in minutes, work runs in 10–30+; never dispatch a duplicate (a duplicate work run fails fast on the busy lock with exit 3). TERM on a stalled run is safe once the backend has launched; only SIGKILL skips finalization (signal semantics in the contract doc).
4. Read the `-o` answer file and the `agent-run:` trailers (session-id, answer path, worktree state).
5. After `work`: verify the result before reporting success, but don't pull the full diff into your own context. The trailers scope it — `agent-run: head:` reports the commit range (`(unchanged)` flags a no-op run), `agent-run: worktree:` whether it finished clean. Confirm shape cheaply with `git log --oneline` and `git diff --stat` over that range; delegate substantive review rather than reading hunks inline. Trust HEAD advancement and the final trailers over the delegate's own status messages (under a cross-worktree commit guard, `No commit landed` can be a normal queue state).

### Dead-run signature

Launch header present, completion anchors absent, wrapper pid dead. `agent-wait.sh <log> --timeout 0` is the one-shot probe: exit 20 is the dead-run signature, 21 the variant whose backend still lives — an orphan that may still write (and, for `work`, still holds the lock); kill its process group (`kill -- -<backend-pid>`) before taking the worktree over. Recovery — resuming from a logged session id, salvaging staged work, leftover `-o` reuse — is in [references/trailer-contract.md](references/trailer-contract.md).

## consult — read-only second opinion

Reviews, design consults, "what am I missing here", idea generation. The wrapper injects the read-only preamble for you (do not restate it); the outcome lands in the `agent-run: worktree: clean|DIRTY|unchecked` trailer. DIRTY exits 4: inspect `git status` and revert the drift before trusting the worktree again — the `-o` answer itself may still be usable, and a transient DIRTY from a consult's subagents that has already reverted is trustworthy.

- Consults are lock-free on every backend — safe in parallel and alongside a running work dispatch. While another run holds the worktree lock, drift cannot be attributed, so the trailer reads `unchecked`.
- codex consults are drift-checked, not sandboxed (see [references/codex.md](references/codex.md)) — verify cleanliness first.
- **Reviewing a branch: name the branch, don't attach the diff.** Tell the consult "review branch `<feature>` vs `main`" and let it run `git diff main...<feature>` itself — it then sees the live tree (real whitespace, surrounding context, adjacent files it can open to trace a hunk). A pre-computed `-f` diff is strictly worse: it anchors the reviewer on the frozen hunk and hides the surrounding system. Reserve `-f` for material the agent genuinely cannot gather itself.
- Ask for priority-tagged (`[P0]`/`[P1]`/`[P2]`) findings with file:line citations.

## work — delegated implementation

Full permissions; the run owns the worktree lock:

- A dirty start exits 2; pass `--dirty-ok` only when the explicit task is the current uncommitted diff (why: [references/codex.md](references/codex.md)).
- While it runs: no edits, staging, commits, rebases, or formatters from anyone else. Read-only inspection is fine.
- `--require-feature-branch` (work-only) exits 2 before launch if the current branch is protected (`main`/`master`/`trunk`) or HEAD is detached.
- `--branch <name>` (work-only) creates `<name>` at the current HEAD and switches to it before launch; protected, invalid, and existing names exit 2. `--branch feat/<task> --require-feature-branch` from a worktree parked on `main` is the safe default shape.
- One mutating agent per worktree: the lock serializes work runs — busy exits 3, which means wait or add a worktree, never retry. For parallel dispatch, use one worktree per delegate:

### Parallel worktree dispatch

Create one git worktree per delegate — detached at the pinned base — and dispatch from inside it with `--branch`. Fresh branch names and unique answer/log paths per run, resolving outside the worktree they belong to.

```bash
git worktree add --detach /tmp/agent-task-a "$BASE_SHA"
git worktree add --detach /tmp/agent-task-b "$BASE_SHA"

# The wrapper locks and mutates the worktree it runs *in* — each dispatch must
# have the target worktree as its working directory.
(cd /tmp/agent-task-a && <repo>/.claude/skills/agent-cli/scripts/agent-run.sh \
  work codex --branch agent/task-a --require-feature-branch \
  -p 'Task A...' -o /tmp/agent-task-a.msg) > /tmp/agent-task-a.log 2>&1

(cd /tmp/agent-task-b && <repo>/.claude/skills/agent-cli/scripts/agent-run.sh \
  work codex --branch agent/task-b --require-feature-branch \
  -p 'Task B...' -o /tmp/agent-task-b.msg) > /tmp/agent-task-b.log 2>&1
```

Run each dispatch as its own backgrounded harness call — the parallelism comes from the harness. If the target repo has per-worktree provisioning, run it before dispatch or the delegate's gates fail on infrastructure, not code (Musi repo-local: `docs/guides/per-worktree-dev.md`; build `@musi/shared` before `worktree:init` when seed inputs changed on the base). After each run, read the answer file and trailers, and confirm the reported commit range with `git -C <worktree> log --oneline <base>..HEAD` before integrating.

## Prompting

Prompt lean. All four CLIs auto-load AGENTS.md — never restate it; cite docs they do not auto-load (`docs/guides/*`, plan files, backlog leaves) by path instead of pasting. A lean prompt is: the exact task or symptom; pointers to the docs, paths, errors, or commits that matter; the few constraints that genuinely matter; done criteria. Do not dictate code structure, naming, or approach; grant latitude — committing and editing docs are allowed when part of the task.

Scope runs by coherence — one mission per run, where a mission can be a batch (e.g. a list of review findings); ask for a commit per item so partial progress is recoverable, and use the target repo's commit/landing policy deliberately.

Tell delegates to foreground long-running commands (builds, verify, `land.sh`): a process the delegate backgrounds with `&` dies when its final turn ends, taking the unfinished command with it. The wrapper flags this on `work` runs (`agent-run: backend-exit: orphaned-children`, exit 1).

Long missions travel better as a file — no shell quoting, reusable across retries:

```bash
.claude/skills/agent-cli/scripts/agent-run.sh work codex \
  --mission-file /tmp/agent-task.prompt -o /tmp/agent-task.msg > /tmp/agent-task.log 2>&1
```

## Follow-ups

Sessions persist across all four backends; prefer resume over a cold run (cursor: resume from the same worktree that ran the original dispatch — see [references/cursor.md](references/cursor.md)):

```bash
.claude/skills/agent-cli/scripts/agent-run.sh work codex -r <session-id> \
  -p 'verify failed: <error>' -o /tmp/agent-followup.msg > /tmp/agent-followup.log 2>&1
```

Capture the session id whenever a later follow-up is plausible. For large or ambiguous missions, plan first: dispatch a consult whose only deliverable is a plan written to `-o`, vet it, then resume the same session in work mode — the discovery context carries over. The consult's read-only preamble also carries over in the session history, so open the work prompt by superseding it ("the earlier read-only constraint is lifted — implement the plan").

## Harness-specific notes

<!-- BEGIN HARNESS-SPECIFIC: codex -->

**Waiting — Codex cannot idle-wait.** Codex gets no background completion
notification, so it must hold the session by polling until the run exits. It
does hold a live session handle on its own dispatch, so it polls that handle
directly (below) rather than reaching for the `agent-wait.sh` helper — the
helper is for the degraded cases the lifecycle names (a lost handle, someone
else's dispatch, dead-run triage).

### Codex polling pattern

When calling from Codex, do not append `&`. Start the wrapper through
`exec_command` with a short `yield_time_ms`; if the process is still running,
Codex returns a session id. Poll that exact session id with an empty
`write_stdin` until the process exits, then read the answer file and trailers.

```json
{
  "cmd": ".claude/skills/agent-cli/scripts/agent-run.sh work codex -p '...' -o /tmp/agent-task.msg > /tmp/agent-task.log 2>&1",
  "workdir": "/tmp/task-worktree",
  "yield_time_ms": 1000
}
```

Then poll:

```json
{
  "session_id": 12345,
  "chars": "",
  "yield_time_ms": 300000,
  "max_output_tokens": 200
}
```

The session status is authoritative. Do not infer completion from log silence or from a partial log tail.

Codex cannot idle-wait, so make each forced check as infrequent and minimal as the harness allows. The caps (verified on codex-cli 0.142.5, re-check after CLI upgrades): `exec_command` yields after at most 30000 ms, an empty `write_stdin` poll after at most 300000 ms, and there is no completion notification — one empty poll at the 300000 cap every 5 minutes *is* the cheapest legal wait, not a hang to escalate. Runs legitimately take minutes (consults) to hours (large work missions): treat each poll as a status-only done/not-done signal, do not narrate unchanged polls, and never read elapsed time alone as failure.

The `> log 2>&1` redirect is load-bearing: it keeps the session's stdout empty, so each poll returns status only instead of streaming the delegate's log into your context. If you lose the session handle (or the run was dispatched by someone else), start `agent-wait.sh <log> --timeout 3600` in a fresh `exec_command` session and poll that instead — same discipline, plus dead-run detection.

**Locks and sessions.** Only `work` runs hold the worktree lock; consults are
lock-free and parallelize in place. Parallel work dispatches need one worktree
each (set `workdir` per `exec_command`). To resume after a lost session, use
the `agent-run: session-id:` trailer when the run finalized, otherwise codex's
native session store at `~/.codex/sessions/`.
<!-- END HARNESS-SPECIFIC -->

## References (edge cases only)

[references/trailer-contract.md](references/trailer-contract.md) — trailer and exit-code contract. [references/claude.md](references/claude.md), [references/codex.md](references/codex.md), [references/copilot.md](references/copilot.md), [references/cursor.md](references/cursor.md) — model catalogs (exact `-m` ids), native review details, permission internals, troubleshooting. [references/portability.md](references/portability.md) — prerequisites and porting. Routine dispatch should not need any of them.
