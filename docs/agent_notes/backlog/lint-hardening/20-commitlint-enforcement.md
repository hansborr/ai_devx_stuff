# Leaf 20: Commitlint Enforcement

Status: Landed (2026-05-16)
Depends on: none

## Problem

AGENTS.md says "if you commit, use `feature/...` or `fix/...` branches and
conventional commits", but no automated check enforces conventional commit
shape. Husky is configured but only runs the changed-file lint/typecheck
gates; there is no `commit-msg` hook.

AI-generated commit messages drift from the convention enough that the
git history has noticeable inconsistency, which makes
`scripts/release-notes`-style automation (if added later) brittle.

## Decision

Add `@commitlint/cli` + `@commitlint/config-conventional` plus a Husky
`commit-msg` hook.

## Rollout

1. Install `@commitlint/cli` and `@commitlint/config-conventional`.
2. Add `commitlint.config.js` extending `@commitlint/config-conventional`.
   Keep scopes free-form and enforce subject/body shape rules.
3. Add `.husky/commit-msg` invoking `bunx commitlint --edit "$1"`.
4. Document the convention in `AGENTS.md`.

## Adaptation Policy

Reject only the *shape* of the commit message, not the content. Keep the
rule set minimal: type, optional scope, subject. Do not enforce subject
length, body wrap, or breaking-change footer initially; those add friction
without correctness wins.

Update 2026-05-16: orchestrator/user decided to broaden beyond "shape only"
to require non-empty body (>= 40 chars). Body length is still shape
(existence + minimum substance), not content (what the words say). Rationale:
AI-generated commits were drifting to single-line vague subjects.

## Implementation Result

Leaf 20 landed commitlint through a Husky `commit-msg` hook. The config
extends `@commitlint/config-conventional`, keeps scopes free-form, enforces
subject length 20-100 chars, requires a blank line before the body, and
requires a non-empty body of at least 40 chars.

`body-empty` and `body-min-length` are locally overridden with the same rule
names so trailing Git-style trailers such as `Co-Authored-By:` are stripped
before body length is measured. This prevents trailer-only commits from
passing. Inherited body/footer line-length and footer-blank rules are disabled
so the landed policy has no warnings and no unrequested body/footer formatting
checks.

Manual probe commits verified rejection for vague/no-body/short-body and
trailer-only messages, acceptance for a valid subject/body message, and
default-ignore acceptance for Git-generated merge and revert messages.

## Verification

- Manual: try a non-conforming commit message and verify it is rejected.
- `bun run verify:changed`
- `bash scripts/test-scripts.sh --changed` if the hook gets a smoke test.

## References

- [commitlint](https://commitlint.js.org/)
