# copilot backend notes

Verified against GitHub Copilot CLI 1.0.68. Requires a logged-in account (`copilot login`); without one, non-interactive runs fail immediately.

## Model catalog (`-m` is wrapper-required)

- `gemini-3.5-flash` — default consult pick: not served by claude or codex; fast, cheap, useful for fresh-angle reviews and idea generation.
- `gemini-3.1-pro-preview` — strongest non-Claude/non-GPT option for a heavyweight second opinion.
- `kimi-k2.7-code` — another off-family perspective; no effort support.
- `mai-code-1-flash-picker` — cheap and not very capable; only for delegating very simple mechanical tasks, never judgment calls.
- `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5-mini` — Codex's own family: no second opinion for a Codex caller, and a Claude Code caller wanting GPT should use `consult codex` (better-tuned native harness).
- `claude-fable-5`, `claude-sonnet-5`, `claude-opus-4.8`(`-fast`), older sonnet/haiku — Claude's family: prefer the native claude CLI (`consult claude`); use these only when it cannot serve the model.
- `-e low|medium|high` works on most models (Claude 5-era and GPT add `xhigh`/`max`; kimi, sonnet-4.5, haiku have none).
- The catalog is server-side and changes; re-discover it with any prompt plus `-- --log-level debug --log-dir <scratch dir>`, then grep the log for `Available models`.

## Behavior notes

- Exit code 0 even when individual tool calls were denied — read the trailers and log, not just the code.
- Consults deny mutations without prompting (no blanket grants plus `--deny-tool write`); file reads under the cwd and safe read-only shell commands run freely. Widen reads with `-- --add-dir <dir>` (or `--allow-all-paths`); URLs are denied by default, `-- --allow-url=<domain>` opts one in.
- Copilot consults are lock-free, so unlike the other backends they may pass a `-C <dir>` cwd override through `--` — the single cwd-moving flag the wrapper permits (every other backend rejects cwd-moving flags outright). The drift trailer then reads `unchecked`: the wrapper can only snapshot the dispatch worktree, not the `-C` target.
- The wrapper strips output to the bare answer (`-s`) and keeps the transcript plus session id in `<answer-file>.transcript.md`. A passthrough `--share=<path outside the worktree>` replaces that sidecar (one transcript per run), and like the sidecar it must be a fresh path.
- A resume (`-r`) still requires `-m`: the session inherits its model, so pass the same one.
- The session id lives in the share transcript, which Copilot writes at end of run, so the `agent-run: session-id:` trailer appears only at finalization (unlike codex, which logs it early). A run killed before then leaves no session-id trailer — recover the id from Copilot's own session history.
- Quick consults return in seconds; anything reading a real diff or codebase area takes minutes — background it like any other run.
