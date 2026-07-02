---
name: codex-cli
description: >-
  Run OpenAI Codex from Claude Code for delegated implementation,
  investigation, and review work without hanging, detaching, duplicating runs,
  or sharing a dirty worktree. Use when Claude Code needs to dispatch Codex for
  a separate implementation task, second-opinion review, focused investigation,
  or unprompted diff review while preserving workspace ownership.
---

# codex CLI

Requires the `codex` CLI on PATH; behavior verified against codex-cli 0.142.5.

## Worktree Ownership

Codex gets temporary ownership of the worktree — treat a run as holding the worktree write lock.

- Start Codex only from a clean worktree unless the explicit task is to inspect the current uncommitted diff. A Stop hook nudges Codex when it finishes with a dirty worktree — an advisory only (stopping again proceeds, and the reminder is suppressed until the change set or branch changes), but in practice Codex reacts to it by committing stray WIP — even files it did not create — as its own work.
- While Codex runs, do not edit, stage, commit, rebase, run formatters, or run scripts that write files. Read-only inspection is fine: logs, `git status` / `git diff` / `git show`, `rg`, file reads.
- One Codex instance per worktree at a time; the wrapper serializes runs with a best-effort per-worktree lock (a busy worktree exits 3; the lock needs `flock` and a git checkout, otherwise the run proceeds unlocked). For parallel dispatch, give each run its own provisioned worktree (`docs/guides/per-worktree-dev.md`).

## Command Shape

Dispatch through the wrapper; it owns the devcontainer sandbox-bypass flags (`-c sandbox_mode=danger-full-access -a never`), owns the stdin policy (see below), rejects argument-less calls and `-C`/`--cd` (exit 2 — the lock must guard the worktree the run mutates; dispatch from the target worktree instead), and holds the per-worktree lock:

```bash
.claude/skills/codex-cli/scripts/codex-run.sh <subcommand> ... > /tmp/codex-<task>.log 2>&1
```

Every run follows the same lifecycle:

1. Verify the worktree is clean (`git status`).
2. Dispatch via the wrapper with `-o` and a log redirect, backgrounded with Claude Bash `run_in_background=true` — never a trailing shell `&`, never both. Never pipe Codex through `tail`.
3. Wait on the Bash job status; it is authoritative and runs take 10-30+ minutes. A quiet log is not a hang, a finished log is not a live run — do not dispatch duplicates.
4. Read the `-o` last-message file for the result (`review` has no `-o`: read the log tail).
5. Inspect the actual diff before reporting success.

Attach stdin material only as a regular-file redirect (`< prompt.txt`); the wrapper closes every other stdin kind (TTY, pipe) because codex 0.142.5 blocks reading an open non-TTY stdin to EOF — a backgrounded dispatch inheriting the harness's never-closing pipe would hang before the run starts, holding the worktree lock. Non-TTY runs print `Reading additional input from stdin...` at startup; harmless.

## `exec`

Use `exec` for implementation, investigation, and review.

```bash
.claude/skills/codex-cli/scripts/codex-run.sh exec \
  -o /tmp/codex-task.msg "<prompt>" > /tmp/codex-task.log 2>&1
```

- The `-o`/`--output-last-message` file is the authoritative result; the log is debugging and liveness material only.
- Pass short prompts as the argument. Feed long or quote-heavy prompts via a stdin file instead (`< prompt.txt`, no prompt argument). A stdin file alongside a prompt argument is appended as a `<stdin>` block — useful for attaching material to a short mission: `exec "Fix these review findings, one commit each." < findings.md`. This works for plain `exec` only — `exec resume` ignores stdin (see Follow-ups).
- Runs inherit the user-configured model and reasoning effort; `-m <model>` overrides the model for one run.

Prompt lean. Codex auto-loads AGENTS.md — never restate it. For docs it does not auto-load (`docs/guides/*`, plan files, backlog leaves), cite sections by path instead of pasting them. A lean prompt usually needs just: the exact task or symptom; the target branch (unstated, Codex follows the repo workflow and creates its own `fix/`/`feat/` branch); pointers to relevant docs, paths, errors, or commits; the few constraints that genuinely matter; done criteria. Do not dictate code structure, naming, or approach — over-specifying micromanages Codex into a worse solution. Grant latitude: committing and editing docs are allowed when they are part of the task. When the same correction keeps reappearing in dispatch prompts, promote it into AGENTS.md instead of growing prompts.

Scope runs by coherence — one mission per run, where a mission can be a batch (e.g. a list of review findings); ask Codex to commit per item so partial progress is recoverable and reviewable per commit. Split into separate runs only for genuinely unrelated missions.

Multi-commit missions pay the full pre-commit gate once per commit — the dominant wall-clock cost in practice. Consider enabling fast-commit mode before dispatching (`touch "$(git rev-parse --git-common-dir)/musi-fast-commit"`; see AGENTS.md): per-commit gates then skip only the slow test slots, and the tests run once in the full `verify` at land time (`bash scripts/land.sh`). Remove the marker when the mission is done; while it is active, "assume tests pass" holds only after that full verify.

### Review prompts

Prefer `exec` over the `review` subcommand for orchestrated reviews: state the scope in English, ask for priority-tagged (`[P0]`/`[P1]`/`[P2]`) findings with file:line citations, and collect the result from the `-o` file.

For review-only prompts, include this wording:

```text
Do not run the test suite/build; reading files and git diff is fine.
Do not modify files. Assume tests pass.
```

This block is load-bearing: the pre-commit hook runs the tests on every commit, so for committed work "assume tests pass" is true — and a reviewer re-running the suite is the biggest wall-clock sink in a multi-commit workflow. (Fast-commit branches skip the per-commit test slots; there, assert it only after a full `verify`.) Do not tighten it to "do not run any commands" — Codex over-interprets that as forbidding file reads and `git diff`.

### Follow-ups: `exec resume`

Codex sessions persist. When iterating on the same task — verification failed, a finding needs rework, a clarification — resume instead of paying a cold run's re-discovery:

```bash
.claude/skills/codex-cli/scripts/codex-run.sh exec resume --last \
  -o /tmp/codex-followup.msg "verify failed: <error>" > /tmp/codex-followup.log 2>&1
```

- Every run prints its session id in the log header; capture it whenever a later follow-up is plausible.
- `--last` picks this worktree's most recently *active* session (activity, not creation order). Any interleaved run — e.g. a review of the implementation — retargets it, so use `--last` only when nothing else has run since; otherwise resume by explicit id: `exec resume <session-id> "<prompt>"`.
- A resumed run takes the same flags and holds the write lock like any other run — except stdin: `exec resume` silently ignores piped material (verified on 0.139.0 and 0.142.5), so put follow-up material inline in the prompt argument or reference an absolute file path for Codex to read. The wrapper rejects a resume dispatched with a non-empty stdin file (exit 2) so the material cannot be silently dropped.
- For large or ambiguous missions, plan first: dispatch a run whose only deliverable is a plan written to `-o` (include the review-only wording above), vet the plan, then resume the same session to implement — the discovery context carries over.

## `review`

Use `review` when you specifically want Codex's native priority-tagged diff review harness.

```bash
.claude/skills/codex-cli/scripts/codex-run.sh review --commit <SHA> > /tmp/codex-review.log 2>&1
```

- Modes: `--commit <SHA>`, `--base <branch>`, `--uncommitted`. Prefer committed/base diffs.
- An optional positional prompt (`review --base main "focus on the auth changes"`) adds custom review instructions and composes with the mode flags.
- No `-o` support: read findings from the log — the reason `exec` is preferred for orchestrated reviews.
- Relay findings with their `[P0]`/`[P1]`/`[P2]` tag and file:line citation.
