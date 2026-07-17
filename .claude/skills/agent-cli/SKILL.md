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

One wrapper dispatches all four agent CLIs — claude, codex, copilot, and cursor (whose CLI binary is named `agent`). State intent — mode, agent, model, prompt — and let the wrapper own the per-CLI flags.

Never invoke `claude`, `codex`, `copilot`, or cursor's `agent` directly from the interactive shell: zsh aliases silently append blanket permission flags to the first three, and a bare headless `agent` is neither read-only nor fully armed. The wrapper is a bash script, so the aliases never apply.

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

For an off-family opinion, swap in `consult copilot -m <model>` or `consult cursor` (see Choosing agent and model). Then read `-o`, check the `agent-run:` trailers, and after `work` verify the result (see Run lifecycle).

## Choosing agent and model

- Delegated implementation: `work codex` (no `-m`; user-configured model) is the default delegate — best-tuned native harness. Use `work claude -m opus|fable`, `work copilot -m <model>`, or `work cursor` only when the implementation should come from that specific model.
- Second opinion from Claude Code: `consult codex` for GPT, `consult copilot -m gemini-3.5-flash|gemini-3.1-pro-preview` for Gemini, `consult cursor` for Grok (catalogs in [references/copilot.md](references/copilot.md) and [references/cursor.md](references/cursor.md)). `consult claude` is pointless from Claude Code — spawn a subagent instead.
- Second opinion from Codex: `consult claude -m fable|opus` — native harness, no Copilot credits. `consult copilot` for Gemini/Kimi, `consult cursor` for Grok. Copilot-hosted `claude-*`/`gpt-*` models are fallbacks for when the native CLI can't serve the model.
- `review codex -- --base main` runs codex's native priority-tagged diff review (log-only; prefer `consult codex` so the result lands in `-o`).

Weigh the source when relaying: a fast-tier dissent is a prompt to re-examine, not an authority to defer to.

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

- `consult` and `work` require a mission containing at least one non-whitespace character: `-p`, or `-P`/`--mission-file` to read it from a file with the same prompt assembly and no shell quoting. `-P` is repeatable; a single `-p` composes with the `-P` files: every component is concatenated in the exact command-line order, separated by one blank line, and reaches the backend as a single prompt — so resume composition is one command (`-P mission.prompt -P resume-note.prompt`, or the original file plus a `-p` recovery note), never hand-concatenation. Native `review codex` may omit its custom instruction. A missing, empty, or whitespace-only mission (or any composed component) exits 2. Mission files may live inside the worktree (unlike `-o`). `-f` appends a file as an `<attached>` block (repeatable) — supporting material, never the mission; attachment-only dispatch exits 2. Pass material this way; stdin is not an input channel.
- `-m` picks the model (required for copilot; claude/codex default to the user-configured model; cursor to `grok-4.5-xhigh`). `-e` sets reasoning effort where supported (cursor rejects it — effort is encoded in the model id).
- `-o` is the authoritative result — a plain answer file regardless of backend. Omit it and one is generated under `$TMPDIR`; either way the path is echoed in the `agent-run: dispatched:` header and confirmed by the `agent-run: answer:` trailer. An explicit path must be fresh — one already holding an answer exits 2 rather than clobbering (`rm` it to reuse) — and must resolve outside the worktree, so the wrapper's own write can't read as drift or leftover work. `review codex` rejects `-o` (read the log).
- `-r <session-id>` resumes a prior session; ids surface in the `agent-run: session-id:` trailer. Resume by explicit id only, never "most recent".
- Exit status is wrapper-normalized; the contract doc is authoritative for the 0/1/2/3/4 meanings. Backend codes never pass through raw.
- Native flags after `--` pass through but are guard-scanned: sandbox, session, model, cwd-moving, and permission-mode flags are wrapper-owned and rejected; consults also reject blanket permission grants. Narrow grants (e.g. `'Bash(bun run test:*)'`) pass through as deliberate caller-owned escalations, and the injected consult preamble carves them out (the one cwd exception lives in [references/copilot.md](references/copilot.md)). Dispatch from the worktree the run should own.

## Run lifecycle

1. Start `work` from a clean worktree — a dirty start exits 2 unless you pass `--dirty-ok` because the mission is to inspect the current uncommitted diff. Verify cleanliness before codex consults; claude/copilot/cursor consults are safe anywhere.
2. Dispatch backgrounded so the wait never blocks a foreground call — via your harness's background mechanism, never a trailing shell `&` (and never both), never piped through `tail`. Concrete mechanics are in the harness-specific notes below.
3. Wait on the job status — it is authoritative, not the log: logs may stay quiet until completion, and a finished log is not a live run. How to wait is harness-specific (below): idle if your harness can, poll a live session handle if you hold one, otherwise call the bundled helper as one bounded foreground call per ~10 minutes: `.claude/skills/agent-cli/scripts/agent-wait.sh "$LOG" --timeout 570`. It sleeps internally and exits the moment the run is decided: 0 once the completion anchors or a non-empty answer file appear, 10 when the timeout elapses with the run still live (re-invoke to keep waiting), 20/21 on the dead-run signature (below). Its output is a done/not-done signal — never poll log contents for progress yourself. Pass `--finalized-only` when you will act on the worktree next (`work` runs): a landed answer means the backend finished, but the drift check and lock release can lag it. Never spin no-op calls to hold a turn open and never `tail -f` the log through a monitor — both cost more context than the run itself. Consults usually finish in minutes, work runs in 10–30+; never dispatch a duplicate (a busy lock fails fast with exit 3). TERM on a stalled run is safe once the backend has launched: the wrapper signals the backend's process group and still emits its completion trailers (full signal semantics in the contract doc). Only SIGKILL skips finalization — the backend then survives as an orphan whose inherited lock fd keeps the worktree lock held (fail-safe: it may still be writing) until it exits or is killed.
4. Read the `-o` answer file and the `agent-run:` trailers (session-id, answer path, worktree state).
5. After `work`: verify the result before reporting success, but don't pull the full diff into your own context. The trailers scope it — `agent-run: head:` reports the commit range (`(unchanged)` flags a no-op run), `agent-run: worktree:` whether it finished clean. Confirm shape cheaply with `git log --oneline` and `git diff --stat` over that range; delegate substantive review (a fresh subagent, or a cross-model consult on the diff) rather than reading hunks inline — especially when orchestrating. If a cross-worktree commit guard is in play, delegate messages like `No commit landed` or `Another git commit in progress` can be normal queue states; verify by HEAD advancement and the final trailers, not the delegate's first status line.

### Dead-run signature

Defined in [references/trailer-contract.md](references/trailer-contract.md): launch header present, completion anchors absent, wrapper pid dead. `agent-wait.sh <log> --timeout 0` is the one-shot probe: exit 20 is the dead-run signature, 21 the variant whose backend still lives (and still holds the worktree lock), 10 only proves the run was undecided at that instant. Recovery:

- A still-alive backend pid is a lock-holding orphan: kill its process group (`kill -- -<backend-pid>`) before taking the worktree over.
- Recover the delegate's staged-but-uncommitted work with a fresh `work --dirty-ok` run told the staged diff is its own, or resume the session from its id. codex logs that id early — as soon as its exec header streams, before the wait — so even a run killed before finalization (OOM/SIGKILL) usually still carries a `agent-run: session-id:` line in the log; if it doesn't, its native session store is `~/.codex/sessions/`. claude, cursor, and copilot expose the id only at finalization, so a crash before then leaves no trailer: fall back to the backend's native session store (under `~/.claude/` for claude).
- An empty leftover explicit `-o` can be reused as-is; only a non-empty one is rejected as stale. An auto-generated `-o` that never received an answer is deleted whenever the wrapper finalizes (including the TERM path); only SIGKILL leaves the empty file behind.

## consult — read-only second opinion

Reviews, design consults, "what am I missing here", idea generation. The wrapper injects the read-only preamble for you (do not restate it); the outcome lands in the `agent-run: worktree: clean|DIRTY|unchecked` trailer. DIRTY exits 4: inspect `git status` and revert the drift before trusting the worktree again — the `-o` answer itself may still be usable. The trailer names the drifted component and the captured `git status --porcelain`; a consult that spawned subagents may report a transient DIRTY that has already reverted — if `git status` is clean now, the answer is trustworthy.

- claude/copilot/cursor consults are enforced read-only and lock-free — safe in parallel and alongside a running work dispatch. cursor's read-only ask mode also denies all shell — it cannot run `git diff`, so attach diffs and command output as `-f` material. While another run holds the worktree lock, drift cannot be attributed, so the trailer reads `unchecked`.
- codex consults hold the worktree lock: codex has no working OS sandbox in this devcontainer, so its read-only-ness is prompt discipline verified by the drift check, not prevention.
- Ask for priority-tagged (`[P0]`/`[P1]`/`[P2]`) findings with file:line citations and relay them with tags intact.

## work — delegated implementation

Full permissions so a headless run never stalls on approval. The run owns the worktree lock:

- A dirty start exits 2 — it invites the delegate to absorb unrelated WIP as its own work (see [references/codex.md](references/codex.md)); pass `--dirty-ok` only when the explicit task is the current uncommitted diff.
- While it runs: no edits, staging, commits, rebases, or formatters from anyone else. Read-only inspection is fine.
- `--require-feature-branch` (opt-in, work-only) exits 2 before launch if the current branch is protected (`main`/`master`/`trunk`) or HEAD is detached — for repos whose convention forbids agent commits on main.
- `--branch <name>` (work-only) creates `<name>` at the current HEAD and switches to it before launch (`agent-run: branch: <name> (created)` in the log), so fresh-branch missions drop their checkout step and the protection is structural. Protected, invalid, and existing names exit 2. Composes with `--require-feature-branch`: `--branch feat/<task> --require-feature-branch` from a worktree parked on `main` is the safe default shape.
- One mutating agent per worktree: the lock serializes work runs (and all codex runs) — busy exits 3. For parallel dispatch, use one worktree per delegate:

### Parallel worktree dispatch

Create one git worktree per delegate — detached at the pinned base — and dispatch from inside it with `--branch`, so the lane branch is created structurally at dispatch. Fresh branch names and unique answer/log paths per run.

```bash
git worktree add --detach /tmp/agent-task-a "$BASE_SHA"
git worktree add --detach /tmp/agent-task-b "$BASE_SHA"

# The wrapper locks and mutates the worktree it runs *in* — each dispatch must
# have the target worktree as its working directory (cd / subshell here; in
# Codex, set `workdir` on the exec_command instead). --branch composed with
# --require-feature-branch keeps a mis-parked worktree from ever committing to
# a protected branch.
(cd /tmp/agent-task-a && <repo>/.claude/skills/agent-cli/scripts/agent-run.sh \
  work codex --branch agent/task-a --require-feature-branch \
  -p 'Task A...' -o /tmp/agent-task-a.msg) > /tmp/agent-task-a.log 2>&1

(cd /tmp/agent-task-b && <repo>/.claude/skills/agent-cli/scripts/agent-run.sh \
  work codex --branch agent/task-b --require-feature-branch \
  -p 'Task B...' -o /tmp/agent-task-b.msg) > /tmp/agent-task-b.log 2>&1
```

Run each dispatch as its own backgrounded harness call (Claude Code: `run_in_background`; Codex: one `exec_command` session per dispatch) — the parallelism comes from the harness, never a trailing shell `&`.

Answer and log paths must be fresh, unique per run, and resolve outside the worktree they belong to (sibling paths under `/tmp` are fine). If the target repo has per-worktree provisioning, run it before dispatch or the delegate's gates fail on infrastructure, not code. Musi repo-local: see `docs/guides/per-worktree-dev.md`; when seed inputs changed on the base, run `bun run --filter @musi/shared build` before `bun run worktree:init`.

After each run, read the answer file and trailers, and confirm the reported commit range with `git -C <worktree> log --oneline <base>..HEAD` before integrating. Never run multiple `work` delegates in the same worktree — a busy lock means wait or add a worktree, not retry.

## Prompting

Prompt lean. All four CLIs auto-load AGENTS.md — never restate it; cite docs they do not auto-load (`docs/guides/*`, plan files, backlog leaves) by path instead of pasting. A lean prompt is: the exact task or symptom; pointers to the docs, paths, errors, or commits that matter; the few constraints that genuinely matter; done criteria.

Do not dictate code structure, naming, or approach — over-specifying micromanages the agent into a worse solution. Grant latitude: committing and editing docs are allowed when part of the task. When the same correction keeps reappearing in dispatch prompts, promote it into AGENTS.md.

Scope runs by coherence — one mission per run, where a mission can be a batch (e.g. a list of review findings); ask for a commit per item so partial progress is recoverable. Each commit pays the full pre-commit gate — the dominant wall-clock cost; use the target repo's cheap-commit/landing policy deliberately (Musi repo-local: fast-commit mode is documented in AGENTS.md and lands through `bash scripts/land.sh`).

Tell delegates to foreground long-running commands (builds, verify, `land.sh`): a process the delegate backgrounds with `&` and then ends its turn to await does not survive that final turn — it dies when the turn ends, taking the unfinished command with it. On a `work` run the wrapper detects a backend that exits while a child in its process group is still running and flags it as `agent-run: backend-exit: orphaned-children` with exit 1, so that shape reads as failed rather than a false clean success — but the fix is to run the command in the foreground, not to background it and hope. A read-only `consult` cannot abandon mutating work, so the same orphan there is reaped and reported as `agent-run: orphaned-children-reaped:` without failing (some backends, e.g. cursor's worker-server daemons, linger in the group on a clean consult); a consult that genuinely mutated the tree is still caught by the drift check and exits 4.

Long missions travel better as a file — no shell quoting, reusable across retries, quiet command history:

```bash
cat > /tmp/agent-task.prompt <<'EOF'
Implement the narrow fix described here.
Done criteria:
- tests pass
- commit the result
EOF

.claude/skills/agent-cli/scripts/agent-run.sh work codex \
  --mission-file /tmp/agent-task.prompt -o /tmp/agent-task.msg > /tmp/agent-task.log 2>&1
```

## Follow-ups

Sessions persist across all four backends; resume instead of paying a cold run's re-discovery (cursor: resume from the same worktree that ran the original dispatch — see [references/cursor.md](references/cursor.md)):

```bash
.claude/skills/agent-cli/scripts/agent-run.sh work codex -r <session-id> \
  -p 'verify failed: <error>' -o /tmp/agent-followup.msg > /tmp/agent-followup.log 2>&1
```

Capture the session id whenever a later follow-up is plausible. For large or ambiguous missions, plan first: dispatch a consult whose only deliverable is a plan written to `-o`, vet it, then resume the same session in work mode — the discovery context carries over. The consult's read-only preamble also carries over in the session history, so open the work prompt by superseding it ("the earlier read-only constraint is lifted — implement the plan").

## Harness-specific notes

<!-- BEGIN HARNESS-SPECIFIC: claude -->

**Waiting.** Idling is the cheapest wait: dispatch backgrounded with Bash
`run_in_background=true` (never a trailing shell `&`, never both), end your
turn, and let the background-completion notification re-invoke you. Reach for
`agent-wait.sh` only in the degraded cases the lifecycle names (a lost
dispatch, someone else's run, dead-run triage) or from a schema-bound workflow
wrapper that cannot idle (below).

**agent-cli inside Workflow scripts.** To run an off-family agent (e.g. codex)
inside a dynamic workflow, spawn a thin wrapper: an `agent()` with
`model: 'sonnet'`, `effort: 'low'`, and a prompt telling it to dispatch through
this skill and return the delegate's answer verbatim. Set `label` to the real
delegate (e.g. `codex:<task>`), not the sonnet shim.

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
  minutes; 0 = decided, 10 = re-invoke, 20/21 = dead run; it anchors on the
  completion trailers, never the bare `^agent-run:` dispatch header) — never
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
  worktree anyway. Codex consults also hold the lock — isolate those too when
  parallel; claude/copilot consults are lock-free. Musi repo-local: fresh
  worktrees may need provisioning (`docs/guides/per-worktree-dev.md`); build
  `@musi/shared` before `worktree:init` when seed inputs changed on the base.
- Trust wrapper reports only as claims: verify lane state from the orchestrator
  (`git log <base>..<branch>`) and plan a finish pass for lanes whose delegate
  outlived its wrapper — a killed run may leave complete work staged but
  uncommitted (recover with a fresh `work codex --dirty-ok` run told the staged
  diff is its own). A silent lane is diagnosable from its log alone: dispatch
  header with no `worktree:`/`backend-exit:` trailer and a dead wrapper pid
  means the run died un-finalized (see "Dead-run signature"); an alive backend
  pid means the delegate still runs and still holds the lane's lock.
<!-- END HARNESS-SPECIFIC -->

## References (edge cases only)

[references/trailer-contract.md](references/trailer-contract.md) is the wrapper trailer and exit-code contract. [references/claude.md](references/claude.md), [references/codex.md](references/codex.md), [references/copilot.md](references/copilot.md), and [references/cursor.md](references/cursor.md) cover backend version notes, model catalogs (exact `-m` ids), native review details, permission internals, and troubleshooting. [references/portability.md](references/portability.md) covers prerequisites and porting. Routine dispatch should not need any of them.
