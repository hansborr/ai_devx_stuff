# 21. SIGKILLed bun-run-quiet wrapper frees the lock while its child keeps running

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: quiet-wrappers · Area: hooks-exec · Severity: med · Size: M · Confidence: med
Theme: orphan-process-safety · Source: harness review 2026-07-06 (Sonnet breadth + Codex PARTLY-confirmed)

## Problem
Both quiet wrappers spawn the real command with fd 9 closed (`9>&-`) so
forked test workers can never hold the worktree lock past the wrapper's
exit — correct for the normal path. But if the wrapper dies without its
traps running (SIGKILL, or harness escalation past SIGTERM — see leaf
20), the flock releases instantly while the orphaned child (a real `bun
run test`/`verify`) keeps running and writing. A second invocation then
starts immediately, racing the orphan in the same worktree — the exact
scenario the lock exists to prevent. Codex narrowed the original claim:
`git-commit-quiet.sh`'s child inherits the shared commit-queue fd 8,
which still serializes *commits*; the unguarded case is
`bun-run-quiet.sh` (and the non-queue half of git-commit-quiet).

## Evidence
- `scripts/ai-hooks/bun-run-quiet.sh:210`, `scripts/ai-hooks/git-commit-quiet.sh:121`
  — `bash -c "$CMD" > "$OUTFILE" 2>&1 9>&- &`.
- Codex verification: PARTLY — confirmed for bun-run-quiet; fd 8 caveat
  for git-commit-quiet.
- Precedent: agent-run.sh treats its orphan the opposite way — the
  backend deliberately inherits the lock fd as a fail-safe (see
  CLAUDE.md "Dead-run signature") and commits c4483383/e4667d23 hardened
  that path. The two wrappers chose opposite trade-offs; only one is
  documented.

## Proposed direction
Options, smallest first: (a) run the child under `setsid` and record its
pgid in a state file; on the next invocation, before taking the lock,
reap or refuse if the recorded pgid is still alive (mirrors agent-run.sh's
dead-run recovery, keeps fd 9 closed); (b) have the *child* hold a second
"work in progress" flock on a separate fd that it does NOT close, making
successor runs wait on the child rather than the wrapper. Either way, add
a comment on the `9>&-` line explaining the accepted window.

## Scope / caveats
Rare in practice (requires SIGKILL-class death mid-run) but silent and
state-corrupting when hit. Pair with leaf 20, which removes the most
likely trigger. Consider reusing `scripts/process-tree.sh` helpers; see
also leaf 22 before adding any new process machinery. One commit.
