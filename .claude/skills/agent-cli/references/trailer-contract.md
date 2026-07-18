# agent-run trailer and exit-code contract

This is the caller-facing contract for
`.claude/skills/agent-cli/scripts/agent-run.sh`.

## Stream Model

The wrapper writes line-oriented records into the merged dispatch log:

```text
agent-run: <key>: <value>
```

Backend output may appear before, between, or after these records. Consumers
must parse anchored `^agent-run: <key>:` lines and tolerate unrelated log
content.

A wrapper dispatch attempt emits the launch header before any completion anchor.
A dispatch can still abort before `exec` (for example, if the codex launch path
cannot record the backend pid); that case is represented by
`agent-run: backend-pid: none (...)`, finalizes as exit 1, and there is no
backend to orphan. A pre-launch wrapper rejection, such as usage failure or lock
failure, emits no launch header.

Completion is anchored only by:

- `agent-run: worktree:`
- `agent-run: backend-exit:`

Do not treat the bare `agent-run: dispatched:` header, or any other
`agent-run:` line, as completion. Optional records can be omitted, and their
relative order is intentionally not a byte-exact golden contract.

## Launch Records

| Record | Requirement | Ordering | Meaning |
|---|---|---|---|
| `agent-run: branch:` | Optional | Before `dispatched:` when present | A `work --branch <name>` run created and switched to the named branch before backend launch. |
| `agent-run: dispatched:` | Required for every dispatch attempt that reaches the launch phase | Before `backend-pid:` and before completion anchors | Names the mode, agent, wrapper pid, and the answer path when the mode has one. `review codex` has no answer path. |
| `agent-run: backend-pid:` | Required for every dispatch attempt that emitted `dispatched:` | After `dispatched:` and before completion anchors | Names the backend pid. `none (...)` means no backend was exec'd — there is nothing to orphan, and the worktree lock releases with the wrapper. A `none` record never coexists with a live, lock-holding backend. |

## Finalize Records

| Record | Requirement | Ordering | Meaning |
|---|---|---|---|
| `agent-run: backend-exit:` | Optional completion anchor | After the launch header | Preserves a non-zero backend exit code, records fatal-signal finalization such as `killed (SIGTERM, ...)`, or records `orphaned-children (...)` when a non-consult backend exited 0 but left a live process in its group (backgrounded work that dies at end-of-turn). Omitted when the backend exits 0 cleanly with no orphaned children and no killed-backend finalization. The orphaned-children and fatal-signal cases exit 1. Parse failures and no-answer failures can exit 1 without this record. A consult that leaves an orphan does **not** emit this failure anchor — it is read-only, so a lingering child cannot be abandoned mutating work (a real mutation trips the drift check and exits 4 instead); see `orphaned-children-reaped`. |
| `agent-run: orphaned-children-reaped:` | Optional | After the launch header | Consult-only. Records that a read-only consult's backend exited 0 but left a live process in its group (commonly a backend's own lingering daemon, e.g. cursor's worker-server), which the wrapper reaped. It is informational, not a completion anchor and not a failure: the run stays exit 0 (the `worktree:` anchor finalizes it, and the no-answer check can still demote it to exit 1). |
| `agent-run: answer:` | Optional | After the launch header | Confirms that a non-empty answer file landed at the named path. Omitted for `review codex`, empty/missing answers, and many failed or killed runs. |
| `agent-run: session-id:` | Optional | After the launch header | Backend session id parsed from an anchored backend header or transcript header. codex logs it early — as soon as the `exec` header streams, before the wrapper waits — so a run killed before finalization (OOM/SIGKILL, which skip the fatal-signal trap) still records a resumable id. claude, cursor, and copilot expose it only at finalization (buffered result envelope or end-of-run transcript); a crash before then leaves no trailer, and recovery falls back to the backend's native session store. |
| `agent-run: cost-usd:` | Optional | After the launch header | Claude-only cost and turn metadata. Informational; never required for control flow. |
| `agent-run: head:` | Optional | Before the `worktree:` outcome for `work` runs when git head can be read | Commit range summary for `work` runs. `(unchanged)` marks a no-op run. |
| `agent-run: worktree:` | Required completion anchor for finalized launched runs | After the launch header | Worktree outcome: `clean`, `dirty (...)`, `DIRTY (...)`, or `unchecked (...)`. This is the normal completion anchor for successful runs. |
| `agent-run: drift-status:` | Optional | Immediately after a `worktree: DIRTY` line when status details are available | Count or state of uncommitted paths observed while reporting read-only drift. |
| `agent-run: drift:` | Optional | After `drift-status:` | One line per `git status --porcelain` detail for a read-only drift report. |

## Exit Codes

| Exit | Owner | Meaning |
|---|---|---|
| 0 | Wrapper | Finalized success. For read-only modes, no drift was detected or drift was explicitly unchecked; for `work`, the backend completed and the worktree outcome was reported. |
| 1 | Wrapper | Run failure. This includes a non-zero backend exit, a launch abort before `exec`, a backend that produced no answer where one was required, parse/envelope failure, or TERM/INT/HUP finalization. Backend codes never pass through raw; numeric backend status appears only in `agent-run: backend-exit:` when available. |
| 2 | Wrapper | Usage error before backend launch, including invalid arguments, stale answer paths, dirty `work` start without `--dirty-ok`, and invalid branch policy combinations. No launch header is emitted. |
| 3 | Wrapper | Worktree lock failure before backend launch: busy lock, missing `flock` for a `work` run, or an unavailable lock path. No launch header is emitted. |
| 4 | Wrapper | A read-only run (`consult` or `review codex`) mutated the worktree. The log includes a `worktree: DIRTY (...)` completion anchor. Drift outranks backend failure, but the backend status is still preserved in `backend-exit:` when available. |

Codes 2, 3, and 4 always mean the wrapper, not the backend.

## Dead-Run Signature

SIGKILL and external harness reaping cannot run the wrapper's fatal-signal
trap. In that case the log can contain the launch header but no completion
anchor. If `agent-run: dispatched:` is present, the wrapper pid named there is
dead, and neither `agent-run: worktree:` nor `agent-run: backend-exit:` exists,
the run died un-finalized.

The `agent-run: backend-pid:` record then decides recovery shape: a live backend
is an orphan that may still hold the worktree lock, while a dead backend means
the wrapper died without finalizing. `agent-wait.sh` reports those cases as
dead-run statuses; consumers must not infer completion from the launch header.

Recovery:

- A still-alive backend pid is an orphan that may still be writing (a `work`
  orphan also still holds the worktree lock): kill its process group
  (`kill -- -<backend-pid>`) before taking the worktree over.
- Recover the delegate's staged-but-uncommitted work with a fresh
  `work --dirty-ok` run told the staged diff is its own, or resume the session
  from its id: check the log for an `agent-run: session-id:` line (codex logs
  it early, so it usually survives a crash; the other backends log it only at
  finalization), and fall back to the backend's native session store
  (`~/.codex/sessions/`, `~/.claude/`, or per the backend reference).
- An empty leftover explicit `-o` can be reused as-is; only a non-empty one is
  rejected as stale. An auto-generated `-o` that never received an answer is
  deleted whenever the wrapper finalizes (including the TERM path); only
  SIGKILL leaves the empty file behind.
