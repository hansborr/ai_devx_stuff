# 02 — worktree:new failure recovery: clean up the created branch or print exact commands

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

## Evidence (verified 2026-07-15; re-verify before implementing)

- `scripts/worktree-new.sh:166-184` (`cmd_new`) — the failure paths after
  `git_worktree_add` leave state behind with no recovery guidance: an init
  failure dies with "leaving the worktree in place for inspection" (line 182)
  but never names the cleanup commands, and neither path mentions that a
  `-b <branch>` requested this invocation now exists and must be deleted
  before a retry.
- Field (2026-07-13 drift-fix drain): a failed `worktree:new` (unwritable lane
  parent) left its `-b` branch behind; the retry failed until a manual
  `git branch -d`. The knowledge lives only in agent memory.
- Guardrail interplay: agent sessions have `git branch -D` and `--force`
  blocked, so recovery hints must be spelled with allowed commands
  (`git worktree remove`, `git branch -d`) — a hint that suggests a blocked
  command strands the lane agent.

Failure: every failed `worktree:new` costs a debugging round-trip
(diagnose leftover branch/worktree, guess the cleanup commands), and an
autonomous lane agent may stall entirely because the obvious recovery
commands are the blocked ones.

## Do

1. When `git worktree add` itself fails after a `-b` branch was requested:
   if the branch now exists but the worktree directory does not, delete the
   branch this invocation created and say so. Hard precondition on the
   delete: `git rev-parse <branch>` must equal the resolved start ref's
   commit — only then is the branch provably the one this invocation created
   seconds ago. On any mismatch, leave it alone and name it in the error
   instead.
2. When `worktree:init` fails: keep the deliberate leave-in-place, but extend
   the die message with the exact, copy-pasteable recovery block for THIS
   invocation (real path and branch substituted): inspect, then
   `cd <path> && bun run worktree:drop`, `git worktree remove <path>`,
   `git branch -d <branch>`.
3. Fail fast with a writable-parent hint when the target's parent directory
   is missing or unwritable (the observed field failure), before any git
   state is created.

## Verify

```
bash scripts/tests/test-worktree-db.sh
bun run verify:changed
```

## Acceptance

A `worktree:new` that fails at the add step leaves no just-created branch
behind (or names it explicitly); branch cleanup fires only when the branch
points at the requested start ref, never on a mismatch; one that fails at
init prints a recovery block containing the actual path and branch, using
only agent-allowed commands; an unwritable parent fails before branch
creation; `test-worktree-db.sh` pins the branch-cleanup-on-add-failure
(including the ref-mismatch refusal) and recovery-message cases.

Sources: drain-lane recipe review 2026-07-15; 2026-07-13 drain field notes.
