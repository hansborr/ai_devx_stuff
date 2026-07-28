# Make Edit Hooks Target-Worktree Aware

Status: Approved 2026-07-21 — owner selected worktree-local marker scope; split P1 correctness from P2 advisory parity
Date: 2026-07-21
Priority: P1

## Problem

Six of seven edit hooks are partly or wholly bound to the checkout that
registered the hook. The highest-risk case is `prisma-generate.sh`: any absolute
`*/prisma/schema.prisma` payload triggers generation of the registering
checkout's canonical schema, so a sibling edit regenerates the wrong client
and an unrelated repository can trigger Musi work. Protected-file markers,
doc-length policy, backlog lint, lint coverage, and ratchet regression have
related sibling/unrelated path errors. `tidy-edited-file.sh` already handles
Git-common-dir identity correctly.

## First slice

- Move tidy's proven resolver into `edited-paths.sh`: absolute path, owning
  worktree root, and target-relative path, including new files via nearest
  existing ancestor.
- Return a classified resolution: same-repository target, unrelated/outside,
  or invalid. Non-tidy hooks ignore unrelated paths; tidy alone may retain its
  explicit outside-repository backpressure message.
- Resolve relative paths from payload `cwd`. Define and test the compatibility
  fallback for absent, nonexistent, outside-repository, and legacy `/` values
  independently for Claude, Codex, and Copilot.
- Preserve tidy's real-target safety model: define lexical ownership versus
  resolved symlink ownership and cover in-repository symlinks, escaping
  symlinks, malformed paths, and new files below nonexistent directories.
- Assign tools, target-local state, cwd, schema, and repair commands to the
  resolved target. Migrate Prisma and protected-files first because they mutate
  generated state or carry hard-deny behavior.
- Group multi-path payloads by target root before applying root-sensitive
  policy or running commands. A patch spanning two worktrees must use each
  target's policy and state, and Prisma must run at most once per edited schema
  root rather than stopping after the first matching path.
- `.allow-protected-edits` scope — owner decision (2026-07-21): the marker is
  target-worktree-local, so one lane cannot weaken sibling policy. This
  supersedes the previous repository-wide wording. Record the worktree-local
  contract in the manifest, policy guidance, session-state reporting, hook
  README, and tests before migration.
- Derive target-local state only after target classification. Each group gets
  its target worktree's cache, throttle, log, kill-switch, tool/config/baseline,
  and execution cwd while explicit environment overrides remain honored.
- Keep tidy on the shared helper without regressing its outside-repository
  backpressure.

## Later P2 slice

Migrate doc-length, backlog-note-lint, lint-coverage, and ratchet-regression
after the resolver contract is proven. Broader advisory-hook migration and
performance refinements belong here rather than blocking the P1
Prisma/protected-files repair.

## Acceptance

For Claude, Codex, and Copilot payload shapes, the first slice covers registering
worktree, linked sibling, unrelated repository, relative/absolute path, new
file, in-repository and escaping symlinks, and a mixed-root patch. Prisma runs
once in each edited target root only; unrelated schemas run nothing. The
protected-files hook uses each target's advisory/deny paths and the
owner-selected override scope. Preserve tidy's outside-repository message and
document the resolver and target-state ownership contract. Later slices own
advisory-hook parity, not correctness cases required by Prisma or hard-deny
policy.
