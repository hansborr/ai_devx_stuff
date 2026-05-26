# Document Commit Shape Policy

Status: Done (2026-05-26)
Order: 33

## Context

Conventional commits are required, and the repository intentionally does not use
squash merges. Commit message shape is enforced by the local Husky `commit-msg`
hook. Human policy input on 2026-05-25 explicitly said CI enforcement is not
necessary right now.

## Scope

- Record the policy in contributor-facing docs: conventional commits are
  required, non-squash merge is intentional, and local hook enforcement is the
  current mechanism.
- Ensure existing backlog language no longer frames squash merges or CI
  commit-shape checks as the default concern.
- Do not add CI commitlint unless the human policy changes.

## Definition Of Done

Contributors and agents can find the commit-shape policy, and the backlog no
longer asks agents to add CI enforcement against current human direction.

## Verification

- Documentation formatting checks for edited docs
- `bun run verify:changed` if local scripts change
