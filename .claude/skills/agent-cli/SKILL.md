---
name: agent-cli
description: >-
  Dispatch implementation or a second opinion to another agent CLI (claude,
  codex, copilot) through one agent-run.sh wrapper. Use when handing work to an
  external agent, getting a cross-model review or design/idea consult, or
  running an off-family model — codex for GPT, copilot for Gemini/Kimi, claude
  for Opus/Fable. Not for ordinary local shell commands, direct
  claude/codex/copilot calls, or when a same-model subagent would do.
---

# agent CLI dispatch

One wrapper dispatches all three agent CLIs; callers state intent (mode, agent, model, prompt) and never touch per-CLI flags. The wrapper is self-contained bash with no build step, so a copied skill should need only the files under `.claude/skills/agent-cli/` plus the prerequisites below.

Never invoke `claude`, `codex`, or `copilot` directly from the interactive shell: zsh aliases silently append blanket permission flags (`--dangerously-skip-permissions` / `--yolo` / `--allow-all`). The wrapper is a bash script, so the aliases never apply.

## Prerequisites and portability

- Required for normal in-repo dispatch: `bash`, the target CLI on `PATH`, `git`, GNU-compatible `realpath -m`, and standard Unix commands used by the scripts (`cat`, `head`, `wc`, `grep`, `sed`, `sort`, `cksum`, `diff`, `tee`, `tr`, `paste`, `ps`, `kill`, `find`, `mktemp`, `rm`, `sleep`). Copilot also needs `copilot login`.
- Required for lock-required runs in a git worktree: `flock`. `work` runs and every codex run need the worktree lock; if `flock` is unavailable, the wrapper exits 3 before launching. Lock-free `consult claude` and `consult copilot` do not require it.
- Backend-specific: `python3` is required only for the claude backend, where the wrapper parses Claude's JSON result envelope for `-o` and trailers.
- Gracefully degraded helpers: `setsid` is used when present so TERM/INT/HUP can signal the backend process group; without it, signal cleanup falls back to the backend leader pid. `fuser` or `lsof` only improves the busy-lock holder message.
- Repo-local validation: in Musi, the existing lint lane ShellChecks `.claude/skills/**/*.sh` via `scripts/path-policy/path-policy.ts`; do not add a skill-specific verify slot. A copied consumer can run the standalone check directly: `shellcheck .claude/skills/agent-cli/scripts/agent-run.sh`.
- Version drift: backend references and examples name CLI versions and model ids that age quickly. Re-check the local CLI help/catalog after upgrades or when porting the skill; treat ids such as Copilot-hosted Gemini models and the "Verified against ..." notes as dated snapshots, not stable contracts.

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

For an off-family opinion, swap in `consult copilot -m gemini-3.5-flash` (cheap default) or `-m gemini-3.1-pro-preview` (heavyweight). Then read `-o`, check the `agent-run:` trailers, and after `work` verify the result (see Run lifecycle).

## Choosing agent and model

- Delegated implementation: `work codex` (no `-m`; runs the user-configured model) — the default delegate, best-tuned native harness. Use `work claude -m opus|fable` or `work copilot -m <model>` only when the implementation should come from that specific model.
- Second opinion for a Claude Code caller: `consult codex` for GPT's view; `consult copilot -m gemini-3.5-flash` (cheap default) or `-m gemini-3.1-pro-preview` (heavyweight) for off-family — the full catalog lives in [references/copilot.md](references/copilot.md). `consult claude` is pointless from Claude Code — spawn a subagent instead.
- Second opinion for a Codex caller: `consult claude -m fable|opus` — native harness, no Copilot credits. `consult copilot -m <model>` for Gemini/Kimi perspectives. Copilot-hosted `claude-*`/`gpt-*` models are fallbacks for when the native CLI cannot serve the model (see [references/copilot.md](references/copilot.md)).
- Codex's native priority-tagged diff-review harness: `review codex -- --base main` (log-only; prefer `consult codex` for orchestrated reviews so the result lands in `-o`).

Weigh the source when relaying: a fast-tier dissent is a prompt to re-examine, not an authority to defer to.

## Command shape

```bash
.claude/skills/agent-cli/scripts/agent-run.sh <consult|work|review> <claude|codex|copilot> \
  [-m <model>] [-e <effort>] [-p '<prompt>' | -P <mission-file>] [-f <material-file>]... \
  [--dirty-ok] [--require-feature-branch] [--branch <name>] [-o <answer-file>] [-r <session-id>] \
  [-- <native args>] > /tmp/agent-<task>.log 2>&1
```

The complete `agent-run:` trailer and exit-code contract lives in [references/trailer-contract.md](references/trailer-contract.md); the bullets below cover routine caller decisions.

- `-p` is the mission; `-P`/`--mission-file` reads the mission text from a file instead — same prompt assembly, no shell quoting. Exactly one of the two; a missing, unreadable, or empty mission file is a usage error (exit 2). The mission file is caller input, so unlike `-o` it may live inside the worktree. `-f` appends a file as an `<attached>` block (repeatable) — supporting material, not the mission. Pass material this way rather than piping — stdin is not an input channel.
- `-m` picks the model (required for copilot; claude/codex default to their user-configured model). `-e` sets reasoning effort where the model supports it.
- `-o` is the authoritative result — a plain answer file regardless of backend, with the log left for debugging. Omit it and the wrapper generates one under `$TMPDIR` (default `/tmp`); either way the path is echoed in the `agent-run: dispatched:` header at launch, and the `agent-run: answer:` trailer confirms a landed answer at finalize. `review codex` rejects it (read the findings from the log). An explicit path must be fresh — one already holding an answer is rejected (exit 2) rather than clobbered; `rm` it first to reuse deliberately — and must resolve outside the worktree, since the wrapper's own write would read as consult drift or a work run's leftover changes.
- `-r <session-id>` resumes a prior session; ids surface in the `agent-run: session-id:` trailer (omitted when the backend log carries none). Resume by explicit id only, never "most recent".
- Exit status is wrapper-normalized; [references/trailer-contract.md](references/trailer-contract.md) is authoritative for the 0/1/2/3/4 meanings, trailer ordering, and killed-wrapper shape. Backend codes never pass through raw.

Native flags after `--` pass through but are guard-scanned: sandbox, session, model, cwd-moving, and permission-mode flags are wrapper-owned and rejected, and a consult also rejects blanket permission grants — narrow grants (e.g. `'Bash(bun run test:*)'`) pass through as deliberate caller-owned escalations, trusted rather than verified, and the injected consult preamble carves them out so the delegate uses what you granted (the one cwd exception lives in [references/copilot.md](references/copilot.md)). Dispatch from the worktree the run should own.

## Run lifecycle

1. Start `work` from a clean worktree — the wrapper rejects a dirty start (exit 2) unless you pass `--dirty-ok` because the mission is to inspect the current uncommitted diff. Verify cleanliness yourself before codex consults; claude/copilot consults are safe anywhere.
2. Dispatch backgrounded so the wait never blocks a foreground call — never a trailing shell `&` (and never both a background mechanism and `&` at once); harnesses without a background mechanism use a foreground run with a generous timeout. Never pipe the wrapper through `tail`. Your harness's concrete dispatch-and-wait mechanism is in the harness-specific notes below.
3. Wait on the job status — it is authoritative, not the log. Do not infer liveness from log output: logs may stay quiet until completion, and a finished log is not a live run. How you wait is harness-specific (see the harness-specific notes below): idle if your harness can, poll a live session handle if you hold one, otherwise wait with the bundled helper. When you do wait with the helper, call it as one bounded foreground call per ~10 minutes: `.claude/skills/agent-cli/scripts/agent-wait.sh "$LOG" --timeout 570`. It sleeps internally and exits the moment the run is decided: 0 once the wrapper's completion anchors documented in [references/trailer-contract.md](references/trailer-contract.md) appear, or once a non-empty answer file appears; 10 when the timeout elapses with the run still live (re-invoke it to keep waiting); 20/21 on the dead-run signature (see below; 21 means a still-live backend holds the worktree lock). Its output is one `agent-wait:` status line plus the `agent-run:` summary trailers — a done/not-done signal, not streaming log-watching; never poll log contents for progress yourself. Pass `--finalized-only` when you will act on the worktree next (`work` runs): a landed answer means the backend finished, but the wrapper's drift check and lock release can lag it by a moment. Never spin no-op calls (`true`, `wait; echo`) to hold a turn open and never `tail -f` the log through a monitor: each no-op turn replays your whole context and a tail streams the delegate's log into it, costing more than the run itself. Consults usually finish in minutes, work runs in 10–30+ minutes; never dispatch a duplicate (a busy lock fails fast with exit 3). Killing a stalled run with TERM is safe once the backend has launched: propagation is guaranteed from the moment the backend pipeline is up — even inside the codex pid-capture window before the `backend-pid:` line prints, the wrapper recovers the pid the pipeline recorded and signals the backend's process group, then emits its completion trailers. If a codex launch cannot record a pid at all, it aborts before exec and reports `agent-run: backend-pid: none (launch aborted before exec; no backend started)`, so there is no backend to orphan. Only SIGKILL skips finalization entirely — the backend then survives as an orphan whose inherited lock fd keeps the worktree lock held (fail-safe against a recovery dispatch racing a still-writing delegate) until it exits or is killed.
4. Read the `-o` answer file and the `agent-run:` trailers (session-id, answer path, worktree state).
5. After `work`: verify the result before reporting success, but don't pull the full diff into your own context. The trailers scope it — `agent-run: head:` reports the commit range the run produced (`(unchanged)` flags a no-op run), `agent-run: worktree:` whether it finished clean or left uncommitted work behind. Confirm shape cheaply with `git log --oneline` and `git diff --stat` over that range. If a repo-local cross-worktree commit guard is in play, messages like `No commit landed` or `Another git commit in progress` can be normal queue states; verify by HEAD advancement and the final trailers, not by the delegate's first status line. When the change warrants substantive review, delegate it (a fresh subagent, or a cross-model consult on the diff) rather than reading hunks inline. This especially applies when orchestrating: the orchestrator confirms the work landed and routes review; it does not absorb the diff.

### Dead-run signature

The dead-run signature is defined in [references/trailer-contract.md](references/trailer-contract.md): launch header present, completion anchors absent, wrapper pid dead. `agent-wait.sh <log> --timeout 0` performs this diagnosis as a one-shot probe: exit 20 is the dead-run signature, exit 21 the variant whose backend still lives, exit 10 only proves the run was not decided *and* not diagnosably dead at that instant. Recovery:

- If the backend pid is still alive, it is an orphan that keeps holding the worktree lock (deliberately fail-safe: it may still be writing). Kill its process group (`kill -- -<backend-pid>`) before taking the worktree over.
- Check the worktree for the delegate's staged-but-uncommitted work: recover with a fresh `work --dirty-ok` run told the staged diff is its own, or resume the session — from the `agent-run: session-id:` trailer when the run finalized, otherwise the backend's native session store (`~/.codex/sessions/` for codex).
- An empty leftover explicit `-o` can be reused as-is; only a path already holding a non-empty answer is rejected as stale. An *auto-generated* `-o` that never received an answer is deleted whenever the wrapper finalizes (including the TERM path), so the header's `answer` path can intentionally point at nothing; only a SIGKILL leaves the empty file behind.

## consult — read-only second opinion

Reviews, design consults, "what am I missing here", idea generation. The wrapper injects the read-only preamble for you (do not restate it); the outcome lands in the `agent-run: worktree: clean|DIRTY|unchecked` trailer. DIRTY exits 4: inspect `git status` and revert the drift before trusting the worktree again — the `-o` answer itself may still be usable. The trailer now names the drifted component and the `git status --porcelain` captured at report time; a consult that spawned subagents may report a transient DIRTY that has already reverted, so if `git status` is clean the drift settled and the `-o` answer is trustworthy.

- claude/copilot consults are enforced read-only (mutating tools denied, narrow escalations only via passthrough grants) and lock-free — safe to run in parallel and alongside a running work dispatch. While another run holds the worktree lock, drift cannot be attributed, so the trailer reads `unchecked` instead of guessing.
- codex consults hold the worktree lock: codex has no working OS sandbox in this devcontainer, so its read-only-ness is prompt discipline verified by the drift check, not prevention.
- Ask for priority-tagged (`[P0]`/`[P1]`/`[P2]`) findings with file:line citations and relay them with tags intact.

## work — delegated implementation

Full permissions so a headless run never stalls on approval. The run owns the worktree lock:

- A dirty start is rejected (exit 2) because it invites the delegate to absorb unrelated WIP as its own work (see [references/codex.md](references/codex.md)); pass `--dirty-ok` only when the explicit task is to inspect the current uncommitted diff.
- While it runs: no edits, staging, commits, rebases, formatters, or file-writing scripts from anyone else. Read-only inspection is fine: logs, `git status`/`diff`/`show`, `rg`, file reads.
- Use `--require-feature-branch` when the repo convention forbids agent commits on `main`/`master`/`trunk`: the wrapper exits 2 before launching the backend if the current branch is protected or HEAD is detached. Opt-in, work-only (consult and review reject it as inapplicable) — repo-policy protection, not a universal requirement.
- Use `--branch <name>` (work-only) for fresh-branch missions: the wrapper creates `<name>` at the current HEAD and switches to it before the backend launches (`agent-run: branch: <name> (created)` in the log), so the mission drops its checkout step and the protection is structural instead of prompt discipline. Protected, invalid, and already-existing names are rejected (exit 2). Composes with `--require-feature-branch`: the guard is then satisfied by the created branch, making `--branch feat/<task> --require-feature-branch` from a worktree parked on `main` the safe default shape.
- One mutating agent per worktree: the wrapper serializes work runs (and all codex runs) with the worktree lock — busy exits 3. For parallel dispatch, use one worktree per delegate (see below).

### Parallel worktree dispatch

For parallel mutating work, create one git worktree per delegate — detached at the pinned base — and dispatch the wrapper from inside that worktree with `--branch`, so the lane branch is created structurally at dispatch (logged in the `agent-run: branch:` header) instead of at worktree creation. Use a fresh branch name and unique answer/log paths for each run.

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

Run each dispatch as its own backgrounded harness call (Claude Code: `run_in_background`; Codex: one `exec_command` session per dispatch) — the parallelism comes from the harness, never from a trailing shell `&`.

Answer and log paths must be fresh and unique per run and resolve outside the worktree they belong to (sibling paths under `/tmp`, as above, are fine). If the target repo has per-worktree provisioning, run it before dispatch or the delegate's gates fail on infrastructure, not code. Musi repo-local: see `docs/guides/per-worktree-dev.md`; when seed inputs changed on the base, run `bun run --filter @musi/shared build` before `bun run worktree:init` so provisioning sees current generated seed inputs.

After each run, read the answer file and trailers. Confirm the reported commit range with `git -C <worktree> log --oneline <base>..HEAD` or equivalent before integrating. Cherry-pick or merge from the delegate branches only after you have verified their shape.

Do not run multiple `work` delegates in the same worktree. A busy lock is a signal to wait or create a separate worktree, not to retry with a duplicate run.

## Prompting

Prompt lean. All three CLIs auto-load AGENTS.md — never restate it; cite docs they do not auto-load (`docs/guides/*`, plan files, backlog leaves) by path instead of pasting. A lean prompt is:

- the exact task or symptom;
- pointers to the docs, paths, errors, or commits that matter;
- the few constraints that genuinely matter;
- done criteria.

Do not dictate code structure, naming, or approach — over-specifying micromanages the agent into a worse solution. Grant latitude: committing and editing docs are allowed when they are part of the task. When the same correction keeps reappearing in dispatch prompts, promote it into AGENTS.md instead of growing prompts.

Scope runs by coherence — one mission per run, where a mission can be a batch (e.g. a list of review findings); ask for a commit per item so partial progress is recoverable and reviewable per commit. Multi-commit missions pay the full pre-commit gate once per commit — the dominant wall-clock cost; use the target repo's cheap-commit/landing policy deliberately. Musi repo-local: fast-commit mode is documented in AGENTS.md and lands through `bash scripts/land.sh`.

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

Sessions persist across all three backends; resume instead of paying a cold run's re-discovery:

```bash
.claude/skills/agent-cli/scripts/agent-run.sh work codex -r <session-id> \
  -p 'verify failed: <error>' -o /tmp/agent-followup.msg > /tmp/agent-followup.log 2>&1
```

Capture the session id from the trailer whenever a later follow-up is plausible. For large or ambiguous missions, plan first: dispatch a consult whose only deliverable is a plan written to `-o`, vet the plan, then resume the same session in work mode to implement — the discovery context carries over. The consult's injected read-only preamble also carries over in the session history, so open the work prompt by superseding it (e.g. "the earlier read-only constraint is lifted — implement the plan").

## Harness-specific notes

<!-- BEGIN HARNESS-SPECIFIC: claude
     This block is the ONLY content permitted to differ between the .claude and
     .codex copies of this SKILL.md. Everything OUTSIDE it is shared core and
     MUST stay byte-identical across both trees; each tree carries only its own
     harness's caveats. The invariant is enforced by
     scripts/tests/test-skill-dispatch-wrappers.sh (SKILL.md structural mirror).
     To change shared prose, edit both trees' copies identically; to change a
     caveat, edit only the block whose harness it belongs to. -->

These caveats apply when the caller is **Claude Code**; a caller on another
harness ignores them and reads its own tree's section instead.

**Waiting.** Claude Code can idle-wait, and idling is the cheapest wait: end
your turn and let the background-completion notification re-invoke you when the
run finishes. Dispatch backgrounded with Bash `run_in_background=true` (never a
trailing shell `&`, never both). You rarely need the `agent-wait.sh` helper —
reach for it only in the degraded cases the lifecycle names (a lost dispatch,
someone else's run, dead-run triage), or from a schema-bound workflow wrapper
that cannot idle (below).

**agent-cli inside Workflow scripts.** To run an off-family agent (e.g. codex)
inside a dynamic workflow, spawn a thin wrapper: an `agent()` with
`model: 'sonnet'`, `effort: 'low'`, and a prompt telling it to dispatch through
this skill and return the delegate's answer verbatim. Set `label` to the real
delegate (e.g. `codex:<task>`), not the sonnet shim.

- Shims cannot babysit gate-length runs: regardless of loop discipline, the
  idle enforcer kills a shim around the hour mark, orphaning its delegate
  mid-run. Reserve shims for short dispatches (consults, single-leaf missions).
  When the orchestrator's main loop can own the wait, prefer dispatching
  agent-run.sh directly via background Bash — one backgrounded dispatch per
  worktree gives parallelism without shims — and let completion notifications
  drive the turn.
- Shim report schemas: derive run status from the `agent-run:` trailers, never
  from guesses, and never include fields a backgrounded dispatch cannot know
  (e.g. the wrapper's exit code).
- Wrappers cannot idle-wait: the workflow's structured-output enforcer converts
  any tool-less turn into a forced report, and a second idle episode kills the
  wrapper (and its delegate child) outright. Tell wrappers to wait via the
  bundled helper (`agent-wait.sh "$LOG" --timeout 570`, one bounded call per
  ~10 minutes — exit 0 = run decided, 10 = still running (re-invoke it),
  20/21 = dead run; it anchors on the completion trailers, never the bare
  `^agent-run:` dispatch header) — never no-op spins or a `tail -f` monitor
  (context burn) — and, if forced to report before the job exits, to re-check
  the job in that same turn and report in-progress as in-progress, never as
  done or skipped.
- Workflow agents in `isolation: 'worktree'`: every Bash call starts back in
  the main checkout, not the worktree — a bare `git add`/`git commit` silently
  runs against the main repo and stages nothing. Pin each call with
  `cd <worktree> && …` or `git -C <worktree>`, tell the agent so in its prompt,
  and have it report its worktree path so the orchestrator can verify lanes
  with `git -C <worktree> log <base>..HEAD`.
- Parallel implementation wrappers need `isolation: 'worktree'`: edits collide
  in the shared checkout, and agent-run.sh serializes mutating runs per
  worktree anyway (busy lock exits 3). Codex consults also hold the lock, so
  isolate those too when parallel; claude/copilot consults are lock-free. Musi
  repo-local: fresh worktrees may need provisioning before DB-touching gates run
  (see `docs/guides/per-worktree-dev.md`); when seed inputs changed on the base,
  build `@musi/shared` before `worktree:init`.
- Trust wrapper reports only as claims: verify lane state from the orchestrator
  (`git log <base>..<branch>`) and plan a finish pass for lanes whose delegate
  outlived its wrapper; a killed run may leave complete work staged but
  uncommitted in its worktree (recover with a fresh `work codex --dirty-ok` run
  told the staged diff is its own). A silent lane is diagnosable from its log
  alone: the `agent-run: dispatched:`/`backend-pid:` header with no
  `worktree:`/`backend-exit:` trailer and a dead wrapper pid means the run died
  un-finalized (see "Dead-run signature" above); an alive backend pid means the
  delegate is still running and still holds the lane's lock.
<!-- END HARNESS-SPECIFIC -->

## References (edge cases only)

[references/trailer-contract.md](references/trailer-contract.md) is the wrapper trailer and exit-code contract. [references/claude.md](references/claude.md), [references/codex.md](references/codex.md), and [references/copilot.md](references/copilot.md) cover backend version notes, model catalogs (exact `-m` ids), native review details, permission-profile internals, and troubleshooting. Those CLI versions and model ids are dated snapshots; re-verify them when upgrading CLIs or porting the skill. Routine dispatch should not need the backend edge-case notes.
