# Agent Hook Git Safety

Status: Implemented on 2026-05-08
Source: `docs/agent_notes/backlog/agent-hook-git-safety.md`

## Scope Landed

- `scripts/ai-hooks/policy.sh` now blocks local history rewrites, dangerous
  reset modes, force pushes and remote branch deletion, pushes to `main` /
  `master`, forced branch/worktree cleanup, tag deletion, forced `git clean`,
  GitHub CLI mutations/auth changes, mutating `gh api` calls, and raw shell
  `grep`.
- The shared policy handles direct commands, compound shell commands,
  `bash -lc` / `sh -c` wrappers, and simple `env VAR=value ...` wrappers.
- `git rebase --continue` / `--abort` / `--skip` / `--quit`, path-scoped
  unstage flows, feature-branch pushes, read-only `gh` view/list/status/API
  calls, `git grep`, `rg`, and `ripgrep` remain allowed.

## Fixture Catalog

- Local Git rewrite: amend, rebase variants, reset modes, filter commands,
  `replace`, `update-ref`, and reflog expiry.
- Remote Git safety: force flags, force refspecs, delete refspecs, explicit
  `main` / `master` destinations, and current-branch protected push detection.
- Cleanup: branch force delete, tag delete, forced worktree remove, and forced
  clean.
- GitHub CLI: PR, issue, repo, deploy-key, release, workflow, run, cache,
  secret, variable, API mutation, codespace, gist, key, label, alias, config,
  extension, and auth mutation forms.
- Context hygiene: direct `grep`, `egrep`, `fgrep`, pipe, `find -exec`,
  `xargs`, compound command, and shell wrapper forms.

## Verification

- `bash scripts/test-ai-hooks.sh` passes.

## Watch

- The raw `grep` block is intentionally regex-based and may catch quoted
  command text inside other shell commands. If that becomes real friction,
  consider softening only the `grep` rule after reviewing concrete examples.
