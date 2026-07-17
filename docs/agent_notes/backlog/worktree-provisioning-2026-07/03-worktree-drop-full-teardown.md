# 03 — worktree:drop: full teardown, runnable from anywhere

Status: Done
Track: T (tooling) · Priority: P3 · Size: M

## Evidence (verified 2026-07-15; re-verify before implementing)

- `scripts/worktree-db.sh:1195-1213` (`cmd_drop`) — the command takes no path
  argument (slug is computed from the cwd), refuses to run from the primary
  worktree, and tears down only the database side: drop DBs, forget
  fingerprint/tombstone/allocation. The git worktree and its branch are left
  for the caller.
- Consequence: correct teardown is a cwd-sensitive two-step — run
  `worktree:drop` from INSIDE the doomed worktree, then from somewhere else
  run `git worktree remove <path>` (+ optionally `git branch -d`). Getting the
  order wrong either leaves orphan DBs (worktree removed first; `cmd_gc`
  eventually collects, but allocations/ports stay held until then) or leaves
  the shell's cwd inside a removed directory.
- Field: the drain-lane recipe (2026-07-13 notes) carries this as a standing
  gotcha; every drain re-teaches it to lane agents.

Failure: lane teardown is the most error-prone step of the drain lifecycle —
two commands, in a required order, from two different directories, none of
which the tool communicates.

## Do

1. Accept an optional target: `worktree:drop [<path>]`. With a path, resolve
   the slug from that worktree (same primary-refusal check); without one, keep
   today's cwd behavior.
2. Add `--remove`: after the DB/state teardown, run `git worktree remove
   <path>` (allowed for agents). Check target cleanliness FIRST, before any
   DB/state teardown: `git worktree remove` refuses a dirty worktree without
   `--force`, and `--force` is blocked for agents, so a late refusal would
   strand a half-torn-down lane (DBs gone, worktree left). On a dirty
   target, stop before touching anything and print an "uncommitted work at
   <path>; commit or inspect before dropping" message. Do NOT auto-delete
   the branch — it may hold unlanded work; print the `git branch -d
   <branch>` follow-up instead. When invoked from inside the target without
   a path, `--remove` should refuse with a "run it from the primary with an
   explicit path" hint rather than sawing off the branch the shell sits on.
3. Update the teardown section of `docs/guides/per-worktree-dev.md` to the
   one-command form.

## Verify

```
bash scripts/tests/test-worktree-db.sh
bun run verify:changed
```

## Acceptance

From the primary checkout, `bun run worktree:drop <path> --remove` drops the
lane's DBs, releases its allocation, removes the git worktree, and prints a
branch cleanup hint; a dirty target stops the whole operation before any DB
teardown; the no-argument form behaves exactly as today; primary refusal is
preserved for both forms; `test-worktree-db.sh` covers the path-argument,
`--remove`, dirty-target-refusal, and inside-target-refusal cases.

Sources: drain-lane recipe review 2026-07-15; 2026-07-13 drain field notes.
