# 265. Document cross-worktree status modes

Status: Not started
Theme: Document the two cross-worktree status modes in the per-worktree guide · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The dedicated worktree guide documents only the current-worktree status
command. Contributors following it cannot discover the two read-only modes
that inspect provisioning across every worktree or summarize Git progress
across parallel lanes.

The omission is most costly in the guide's multi-lane workflow. That section
explains commit serialization and lane sizing at length but never points
operators to the existing overview of ahead/behind state, staged and unstaged
counts, and last-commit age.

## Evidence

- `docs/guides/per-worktree-dev.md:14-29` — the command table describes
  `worktree:status` only as current-worktree database, port, and template
  diagnostics.
- `docs/guides/per-worktree-dev.md:64-122` — the multi-lane orchestration and
  recovery sections do not mention either cross-worktree status mode.
- `package.json:28` — the root `worktree:status` script dispatches to
  `scripts/worktree-db.sh status`, so the documented command surface exists.
- `scripts/worktree-db.sh:14-20` — the authoritative command header defines
  `status --all` as one provisioning block per worktree and
  `status --lanes [--base <ref>]` as a read-only, no-Postgres Git-work summary
  with ahead/behind, staged/unstaged, and last-commit information.
- `scripts/worktree-db.sh:1536-1565` — the dispatcher implements both modes,
  rejects their combined use, rejects `--base` without `--lanes`, and routes
  each valid mode to its dedicated handler.

## Proposed direction

Expand the command table in `docs/guides/per-worktree-dev.md` with separate
entries for:

- `bun run worktree:status --all`, described as provisioning diagnostics for
  every worktree.
- `bun run worktree:status --lanes [--base <ref>]`, described as the
  Postgres-free Git-work overview for coordinating parallel lanes.

Keep the existing unqualified `bun run worktree:status` row for the current
worktree. State beside the new entries that `--all` and `--lanes` are mutually
exclusive and that `--base <ref>` is valid only with `--lanes`.

Add the lanes form to the multi-lane workflow as the inspection step for
comparing branch progress and working-tree state before deciding which lane
should commit, wait, or land. Explain that `--all` answers provisioning
questions, while `--lanes` answers Git-work coordination questions, so readers
do not treat the modes as interchangeable.

Review the completed prose against the header and dispatcher in
`scripts/worktree-db.sh`; the script remains the behavior authority and the
guide should not independently elaborate its fallback algorithm.

## Scope / caveats

- This is documentation-only. Do not change status output, argument parsing,
  base selection, database access, or worktree provisioning behavior.
- Preserve the explicit boundaries that `--base` belongs only to `--lanes`
  and that `--all` and `--lanes` cannot be combined.
- Keep `scripts/worktree-db.sh` authoritative. The guide should explain which
  mode to choose and link behavior back to the script rather than duplicating
  implementation details.
- [198-worktree-provisioning-hard-wired.md](./198-worktree-provisioning-hard-wired.md)
  adds credential prerequisites to the same guide. Those prerequisites remain
  independent of status-mode documentation, but coordinate the shared file if
  both changes land together.
- No 2026-07-25 record covers these missing status-mode instructions.
