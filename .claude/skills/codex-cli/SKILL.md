---
name: codex-cli
description: Correctly run OpenAI Codex from Claude Code for implementation, investigation, or review without hanging, detaching, duplicating runs, or sharing a dirty worktree.
---

# codex CLI

Use Codex when the user asks to delegate work, get a second-opinion review, or have a separate model investigate/fix something.

## Worktree Ownership

Codex gets temporary ownership of the workspace.

- Start Codex only from a clean worktree unless the explicit task is to inspect the current uncommitted diff.
- Prefer committing or stashing Claude's WIP before dispatching Codex.
- While Codex is running, do not edit, stage, commit, rebase, run formatters, or run scripts that write files.
- Read-only inspection is fine: logs, `git status`, `git diff`, `git show`, `rg`, and file reads.
- Do not start another Codex instance for the same workspace unless the first has exited or was explicitly stopped.

Think of a Codex run as holding the workspace write lock.

## Command Shape

Always bypass the broken devcontainer sandbox:

```bash
\codex -c sandbox_mode=danger-full-access -a never <subcommand> ...
```

Rules:

- Use `\codex`, not `codex`, to skip aliases.
- Always redirect output to a log file.
- Always close stdin:
  - `exec`: feed a prompt file via stdin.
  - `review`: use `< /dev/null`.
- Do not pipe Codex through `tail`; read or tail the log separately.
- Do not combine Claude Bash `run_in_background=true` with a trailing shell `&`. Pick one. Prefer Claude backgrounding.

## `exec`

Use `exec` for implementation, investigation, and prompted review.

```bash
\codex -c sandbox_mode=danger-full-access -a never exec \
  < /tmp/codex-task-prompt.txt > /tmp/codex-task.log 2>&1
```

Prompt briefly. Include only:

- Exact task or symptom.
- Relevant paths, errors, or commits.
- Constraints.
- Done criteria.

For review-only prompts, use this wording:

```text
Do not run the test suite/build; reading files and git diff is fine.
Do not modify files. Assume tests pass.
```

Do not say "do not run any commands"; Codex may interpret that as forbidding file reads and `git diff`.

Keep prompts small. If there are more than about three independent fixes, split into sequential runs. For review findings, use one `exec` per independent fix unless the fixes are tightly coupled.

## `review`

Use `review` only when you specifically want Codex's unprompted priority-tagged diff review.

```bash
\codex -c sandbox_mode=danger-full-access -a never review --commit <SHA> \
  < /dev/null > /tmp/codex-review.log 2>&1
```

Accepted modes include `--commit <SHA>`, `--base <branch>`, and `--uncommitted`.

Notes:

- Prefer committed/base diffs over uncommitted diffs.
- `review` takes no prompt with those mode flags. Use `exec` if you need focus instructions.
- Relay findings with their `[P0]`, `[P1]`, or `[P2]` tag and file:line citation.

## Background Runs

Codex can take 10-30+ minutes.

- Use either Claude Bash `run_in_background=true` or shell `&`, never both.
- Prefer Claude backgrounding and keep the shell command foreground.
- The Bash job status is authoritative.
- A quiet log does not mean Codex is hung.
- A completed log does not mean Codex is still running.
- Do not launch duplicate Codex jobs because the log is quiet.
- After completion, read the last few hundred log lines and inspect the actual diff before reporting success.
