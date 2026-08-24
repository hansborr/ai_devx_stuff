# copilot backend notes

Verified against GitHub Copilot CLI 1.0.70. Requires a logged-in account (`copilot login`); without one, non-interactive runs fail immediately.

## Model catalog (`-m` is wrapper-required)

- `gemini-3.6-flash` — the Gemini pick: not served by claude or codex; fast, cheap, useful for fresh-angle reviews and idea generation.
- `kimi-k2.7-code` — another off-family perspective; no effort support.
- `mai-code-1-flash-picker` — cheap and not very capable; only for delegating very simple mechanical tasks, never judgment calls.
- `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5-mini` — Codex's own family: no second opinion for a Codex caller, and a Claude Code caller wanting GPT should use `consult codex` (better-tuned native harness).
- `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`, older opus/sonnet/haiku — Claude's family: prefer the native claude CLI (`consult claude`); use these only when it cannot serve the model.
- `-e low|medium|high` works on most models (Claude 5-era and GPT add `xhigh`/`max`; kimi, sonnet-4.5, haiku have none).
- The catalog is server-side and changes; re-discover it with any prompt plus `-- --log-level debug --log-dir <scratch dir>`, then grep the log for `Available models`.

## Behavior notes

- Exit code 0 even when individual tool calls were denied — read the trailers and log, not just the code.
- Consults deny mutations without prompting (no blanket grants plus `--deny-tool write`); file reads under the cwd and safe read-only shell commands run freely. Widen reads with `-- --add-dir <dir>` (or `--allow-all-paths`); URLs are denied by default, `-- --allow-url=<domain>` opts one in.
- Copilot consults may pass a `-C <dir>` cwd override through `--` — the single cwd-moving flag the wrapper permits (every other backend rejects cwd-moving flags outright). The drift trailer then reads `unchecked`: the wrapper can only snapshot the dispatch worktree, not the `-C` target.
- The wrapper captures Copilot's JSONL stdout for parsing and captures stderr
  separately. After the backend exits (normally or through a handled fatal
  signal), filtered stderr diagnostics are replayed to stderr and therefore to
  the usual merged caller log; they are deferred rather than live. Raw JSONL
  events are not replayed. The wrapper writes only the root agent's final
  assistant response to an attempt-private candidate. `python3` is required.
  After successful parsing it publishes the complete candidate atomically to
  the public answer path.
- Each claimed attempt allocates a distinct wrapper-owned transcript at `<answer-file>.agent-run/attempt.<identity>/copilot-transcript.md`. The early `agent-run: attempt:` and `agent-run: transcript:` trailers name the record and exact transcript before the backend starts; the attempt's `transcript-path` file repeats it for recovery. Explicit-output attempts retain failed transcripts, so a finalized no-answer retry gets a new transcript without changing the first one. Bundle retention for auto-generated paths follows the shared rule in [trailer-contract.md](trailer-contract.md#attempt-bundle-and-retry-contract).
- A passthrough `--share=<path outside the worktree>` remains caller-owned and replaces the wrapper transcript for that attempt. The wrapper resolves it once, passes and records that canonical absolute path, and requires it to be absent before every run; any existing path, empty or nonempty, is rejected before launch. It exclusively locks and persistently pins the canonical share-path lock inode, so two different outputs cannot launch against the same transcript even if the public lock pathname is replaced. The attempt retains the path and finalization-time identity as recovery metadata, but later deletion or rotation of that caller-owned artifact does not invalidate the wrapper's attempt lineage or block an answer retry.
- A resume (`-r`) still requires `-m`: the session inherits its model, so pass the same one.
- The session id lives in the share transcript, which Copilot writes at end of run, so the `agent-run: session-id:` trailer appears only at finalization. The finalized attempt record carries the same id. A run killed before extraction still leaves the early per-attempt transcript path; inspect it first, then fall back to Copilot's own session history if the transcript has no id.
