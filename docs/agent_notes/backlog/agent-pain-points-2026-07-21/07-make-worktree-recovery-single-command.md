# Replace Stale `worktree:new` Recovery Output

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P2
Size: S
Source: `pain_points.log` — stale failed-provisioning cleanup instructions

## Problem

The teardown implementation and guide are already correct:
`worktree:drop <path> --remove` checks a target's cleanliness before changing
database or allocation state, refuses the primary and the worktree containing
the caller's shell, removes the linked worktree only after local teardown, and
retains its branch (`scripts/worktree-db.sh:1306-1379`). The guide documents
that one-command path (`docs/guides/per-worktree-dev.md:31-49`).

Failed `worktree:new` provisioning still prints obsolete recovery output,
however: enter the failed worktree and run `worktree:drop`, then run raw
`git worktree remove`, followed in `-b` mode by a static branch deletion command
(`scripts/worktree-new.sh:184-197`). Entering the target makes recovery depend
on a directory that the sequence itself removes and produced the confusing
"Unable to read current working directory" follow-up. The focused test pins
that stale output (`scripts/tests/test-worktree-db.sh:1034-1076`) even though the
same suite proves the safe `--remove` ordering and refusal behavior later
(`scripts/tests/test-worktree-db.sh:1159-1362`).

## Scope

- Capture the caller checkout's canonical repository root before provisioning
  changes directory. Pass that literal root and the canonical failed target to
  `init_failure_recovery_block` rather than making the printed command discover
  either value at execution time.
- Emit one location-independent, shell-quoted command with this argv shape:
  `bun --cwd=<quoted caller root> run worktree:drop -- <quoted target> --remove`.
  The `--` before the target is required so a target beginning with `-` cannot
  become a script option.
- Print no `cd`, command substitution such as `$()`, raw
  `git worktree remove`, or static `git branch -d` follow-up. The authoritative
  `worktree:drop --remove` implementation retains the branch and, after a real
  successful teardown, prints any branch-cleanup hint based on the branch it
  actually observed.
- Replace the focused function-output expectations and add an end-to-end shell
  regression that invokes `worktree:new` from a package subdirectory, forces
  `worktree:init` failure after worktree creation, and validates the emitted
  command for a target containing whitespace and shell metacharacters. Execute
  or parse that printed command through an argv-recording stub so the test proves
  the caller root and target survive copy/paste as single arguments.
- Pin the existing strict retry behavior: after a successful emitted recovery
  command removes the target, running it a second time fails explicitly with
  `not a git worktree`. This task adds no teardown history or idempotence state.

## Acceptance

- A simulated `worktree:init` failure emits exactly one recovery command in the
  form
  `bun --cwd=<quoted caller root> run worktree:drop -- <quoted target> --remove`.
  It contains no `cd`, `$()`/backticks, raw `git worktree remove`, or branch
  deletion command.
- The command is copy-pasteable from any current directory. Shell-quoting cases
  cover ordinary absolute paths, spaces, quotes, leading dashes, and shell
  metacharacters without evaluating target text.
- An end-to-end case launched from a package subdirectory proves the emitted
  root is that checkout's top level, not the package directory or a hard-coded
  `/workspace`, and proves the quoted target reaches `worktree:drop` as one
  argument after `--`.
- The first command performs the already-tested ordered clean-target teardown
  and removal while retaining the branch. The exact same command's second run
  fails with the current `not a git worktree` diagnostic; no repeat-success
  promise is introduced.
- Existing dirty-target, primary-checkout, current-shell, ordering, and branch
  retention tests stay green, and `bash scripts/tests/test-worktree-db.sh`
  passes.

## Boundaries

- Change only stale recovery emission and its tests. Do not redesign
  provisioning rollback, duplicate teardown logic in `worktree-new.sh`, or
  alter the already-correct guide and `worktree:drop --remove` implementation.
- Do not add `--force`, auto-delete a branch, remove dirty work, weaken the
  primary/current-shell guards, or treat an unknown/non-worktree path as a
  successful retry.
- Do not defer root resolution to the printed command with `pwd`,
  `git rev-parse`, `$()`, an environment variable, or a relative path. The
  output must remain valid if copied after the caller changes directories.
