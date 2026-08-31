# Document the Self-Edit Hazard for agent-run.sh and agent-wait.sh

Status: Implemented
Date: 2026-08-25
Priority: P3
Size: S
Source: `agent-cli-and-external-reviews.md` — “Backend lifetime and wrapper
self-edits” (the self-edit clause)

## Problem

The pain-point note records a hazard with no current home in the repository:

> Editing `agent-run.sh` in place from a run of that same script is unsafe:
> Bash can resume reading the rewritten inode at its old byte offset. Prefer a
> separate worktree. When a task explicitly requires staying in the same
> worktree, patch a same-directory copy and atomically replace the pathname so
> the running shell retains the old inode.

This is a real Bash hazard: the interpreter reads a running script as a byte
stream at increasing file offsets rather than loading it fully into memory up
front, so overwriting the same inode in place can make a still-executing
shell read *rewritten* bytes at its *old* offset partway through the script,
corrupting control flow mid-run. It specifically bites a `work` (or even a
`consult`) mission asked to edit `scripts/agent-cli/agent-run.sh` or
`scripts/agent-cli/agent-wait.sh` from inside the same worktree that is
running it — meta-work this repository does routinely, per the wrapper's own
long history of self-directed fixes (`git log --oneline -- scripts/agent-cli/`
shows dozens of prior commits changing these exact files).

Nothing in the live tree documents this today.
`.claude/skills/agent-cli/references/portability.md` covers copying/porting
the skill and its runtime prerequisites but has no section on safely
modifying the wrapper scripts themselves, and neither `docs/ai-harness.md` nor
any guide under `docs/guides/` mentions it — a grep for `"same-directory
copy"`, `"atomically replace"`, or the inode-reread mechanism across `docs/`,
`scripts/`, and `.claude/` returns nothing outside the pain-point archive.

## Scope

- Add a short new subsection to
  `.claude/skills/agent-cli/references/portability.md` (e.g. "Editing the
  wrapper scripts while they run") stating: prefer dispatching wrapper edits
  from a separate worktree (the normal parallel-worktree `work` pattern
  already documented in `SKILL.md`); when a task must edit
  `agent-run.sh`/`agent-wait.sh` from the same worktree that is currently
  executing one of them, do not edit the file in place — write the new
  content to a same-directory temporary file and atomically replace the
  original pathname (`mv -fT`, already a required prerequisite per this same
  file) so a process still executing the old file keeps reading the old
  inode's bytes rather than jumping into rewritten content mid-script.
- State the underlying mechanism in one sentence so the guidance is not
  cargo-culted: a shell reads its script as a byte stream at increasing file
  offsets, not fully into memory up front, so an in-place overwrite of the
  same inode can change what a still-running read returns for the remainder
  of the script.
- Run `bun run harness:skills:refresh` to project the addition into
  `.codex/skills/agent-cli/references/portability.md`.
- Out of scope: any change to `agent-run.sh`/`agent-wait.sh` behavior;
  building automated tooling that performs the atomic-replace dance on the
  caller's behalf; and the unrelated function-ordering self-edit hazard that
  the 2026-07-29 pack's ledger already closed as Fixed (commit `c24f502e5`,
  "`agent-run.sh` now defines phase functions before entering main") — this
  leaf covers only the separate, still-undocumented inode/byte-offset hazard.

## Verification

- This is prose guidance with no runtime assertion to add; verify by
  read-through that the new subsection accurately states the mechanism and
  the atomic-replace recipe.
- `bun run harness:skills:refresh` reprojects cleanly — the `.codex` mirror's
  `references/portability.md` matches the canonical `.claude` copy — and a
  second refresh is clean.
- `bun run harness:check` and `bun run docs:harness-controls:check` pass.
- `bash scripts/tests/test-skill-dispatch-wrappers.sh` continues to pass
  unchanged (no behavioral surface touched).
