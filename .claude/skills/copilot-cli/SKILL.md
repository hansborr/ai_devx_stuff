---
name: copilot-cli
description: >-
  Run GitHub Copilot CLI from Claude Code or Codex to consult models outside the
  Claude and Codex lineups (Gemini, Kimi, MAI, plus Copilot-hosted Claude
  and GPT) for second opinions, reviews, and design consults, or to
  delegate implementation to a specific model — non-interactively, without
  hanging, letting a consult mutate the worktree, or colliding with a
  concurrent Codex run. Use when a different model family's perspective is
  wanted or when Codex/Claude cannot serve the desired model.
---

# copilot CLI

Requires the `copilot` CLI on PATH and a logged-in Copilot account (`copilot login`; without one, non-interactive runs fail immediately). Behavior verified against GitHub Copilot CLI 1.0.68.

## Why Copilot: model choice

The point of this skill over codex-cli is routing to models neither Claude Code nor Codex can serve. Always pass `--model` explicitly (the wrapper enforces this in both modes; the silent default would be claude-sonnet-5):

- `gemini-3.5-flash` — default consult pick. Not available via Claude or Codex; less capable than the frontier models but fast, cheap, and useful for fresh-angle reviews and idea generation.
- `claude-fable-5` — frontier consult. Useful whenever Fable is not (or no longer) available in Claude Code itself.
- `gemini-3.1-pro-preview` — strongest non-Claude/non-GPT option for a heavyweight second opinion.
- `kimi-k2.7-code` — another off-family perspective; no `--effort` support.
- `mai-code-1-flash-picker` — cheap and not very capable; only for delegating very simple mechanical tasks, never for judgment calls.
- `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5-mini` — Codex's own family, so no second opinion for a Codex caller; a Claude Code caller wanting GPT should prefer the codex-cli skill's better-tuned native harness.
- `claude-sonnet-5`, `claude-sonnet-4.6`/`4.5`, `claude-haiku-4.5`, `claude-opus-4.8`(`-fast`), `claude-opus-4.7` — Claude Code's own family, so rarely a second opinion for a Claude caller (use only to reach a variant the session cannot run); for a Codex caller these are natural frontier consults.

`--effort low|medium|high` works on most models (Claude 5-era and GPT add `xhigh`/`max`; kimi, sonnet-4.5, haiku have none). The catalog is server-side and changes; to re-discover it, run any prompt with `--log-level debug --log-dir <scratch dir>` and grep the log for `Available models`.

## Command Shape

Dispatch through the wrapper; it rejects promptless calls and interactive flags (which would open the TUI and hang) plus missing or empty `--model`/`-p` values, closes stdin, holds the shared per-worktree lock for `work` runs, and owns the permission flags per mode:

```bash
.claude/skills/copilot-cli/scripts/copilot-run.sh consult \
  --model gemini-3.5-flash -p "<prompt>" > /tmp/copilot-<task>.log 2>&1
```

- Never invoke bare `copilot` from the interactive shell: a zsh alias silently appends `--allow-all`, which would give a consult full write permissions. The wrapper is a bash script, so the alias does not apply.
- The log is clean and self-contained: tool activity lines, the answer, then a stats block with AI credit cost and the `--resume=<session-id>` line for follow-ups. `-s` strips everything but the answer when you want a pure result file (you lose the stats; add `--share=/tmp/copilot-<task>.md` to still capture the session id and transcript). Never use bare `--share` — its default path dirties the worktree.
- copilot ignores stdin entirely (unlike codex). Prompt material goes in the `-p` argument, or into a scratch file the prompt tells the run to read (`--add-dir` if it lives outside the cwd).
- Quick consults return in seconds and can run foreground with a timeout. Anything asked to read a real diff or codebase area takes minutes: background it through the dispatching harness (Claude Code: Bash `run_in_background=true` — never a trailing shell `&`; harnesses without a background mechanism use a foreground run with a generous timeout), wait on the job status (authoritative — a quiet log is not a hang), and never dispatch duplicates.
- Exit codes: 0 on success even when individual tool calls were denied; 2 wrapper usage error; 3 worktree lock busy (`work` only).

## `consult`

Read-only second opinion: reviews, design consults, "what am I missing here", idea generation. Safe to run in parallel and safe alongside a running Codex — it cannot mutate the worktree.

Under the hood: no blanket permission grants plus `--deny-tool write`. File reads under the cwd and safe read-only shell commands (`git diff`/`log`/`show`, `rg`, `ls`) run without prompting; every mutating tool call is auto-denied and the run continues and reports. Widen reads with `--add-dir <dir>` (or `--allow-all-paths`); URLs are denied by default, `--allow-url=<domain>` opts one in. Targeted `--allow-tool` grants (e.g. `--allow-tool 'shell(bun test:*)'`) compose when a consult should verify something — a narrow shell grant is a deliberate, caller-owned crack in the read-only wall. Blanket permissions (`--allow-all`/`--yolo`/`--allow-all-tools`, bare `--allow-tool shell`/`write`) are rejected and an inherited `COPILOT_ALLOW_ALL` is stripped — full permissions are `work`'s job.

Copilot auto-loads AGENTS.md, so prompt lean exactly as with codex: never restate it, cite non-auto-loaded docs by path, state the mission, scope, and done criteria, and grant latitude. For review prompts include the codex skill's load-bearing wording — here it saves the model from burning turns on tool calls that will be denied anyway:

```text
Do not run the test suite/build; reading files and git diff is fine.
Do not modify files. Assume tests pass.
```

Ask for priority-tagged (`[P0]`/`[P1]`/`[P2]`) findings with file:line citations and relay them with tags intact. Weigh the source when relaying: a gemini-3.5-flash dissent is a prompt to re-examine, not an authority to defer to.

## `work`

Delegated implementation with full permissions (`--allow-all`, the `--yolo` equivalent) so a non-interactive run never stalls on approval:

```bash
.claude/skills/copilot-cli/scripts/copilot-run.sh work \
  --model gemini-3.1-pro-preview -p "<mission>" > /tmp/copilot-<task>.log 2>&1
```

- For routine delegation from Claude Code, prefer the codex-cli skill; use `work` when the implementation should come from a specific model the usual delegate cannot serve.
- A `work` run owns the worktree like a Codex run: start from a clean worktree, no concurrent edits/commits/formatters while it runs, inspect the actual diff before reporting success. The full Worktree Ownership section of the codex-cli skill (`.claude/skills/codex-cli/SKILL.md`) applies verbatim.
- The wrapper takes the same per-worktree lock as codex-run.sh (busy → exit 3; needs `flock` and a git checkout, otherwise unlocked), so Copilot and Codex cannot mutate the same working copy concurrently. The lock guards the dispatching directory, so `work` rejects copilot's `-C` — dispatch from the worktree the run should mutate. For parallel dispatch, provision separate worktrees (`docs/guides/per-worktree-dev.md`).

## Follow-ups

Sessions persist; iterate instead of paying cold-start re-discovery:

```bash
.claude/skills/copilot-cli/scripts/copilot-run.sh consult \
  --model gemini-3.5-flash --resume=<session-id> -p "<follow-up>" > /tmp/copilot-followup.log 2>&1
```

- The session id comes from the stats block (or the `--share` file). Resume inherits the session's model, but the wrapper still demands `--model` for consults — pass the same one.
- Avoid `--continue` (most recent session, whatever it was); resume by explicit id.
