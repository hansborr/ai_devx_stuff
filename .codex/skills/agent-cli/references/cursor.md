# cursor backend notes

Verified against Cursor Agent CLI 2026.07.09-c59fd9a. The binary is confusingly named `agent`. Requires a logged-in account (`agent login`) and, like the claude backend, `python3` on PATH to parse the JSON result envelope.

## Model catalog (`-m` defaults to `grok-4.5-xhigh`)

- `grok-4.5-xhigh` — "Cursor Grok 4.5", the wrapper default: not served by any other backend, so it is the fresh-perspective pick for consults and reviews. `grok-4.5-fast-xhigh` is the faster/cheaper variant.
- `composer-2.5` — Cursor's own fast agentic model; a reasonable `work cursor` delegate for mechanical tasks.
- `gpt-5.3-codex[-low|-high|-xhigh][-fast]`, `gpt-5.6-sol-*`, `gpt-5.5-high` — GPT family: a Claude Code caller wanting GPT should prefer `consult codex` (native harness); these are fallbacks.
- `claude-opus-4-8-thinking-high`, `claude-fable-5-thinking-high` (no ZDR) — Claude family: prefer the native claude CLI.
- There is no separate effort flag (the wrapper rejects `-e`): effort is encoded in the model id (`-xhigh`, `-low`) or a bracket override, e.g. `-m 'claude-opus-4-8[context=1m,effort=high]'`.
- The catalog is account-side and changes; re-discover it with `agent --list-models` (safe to run directly — it only prints and exits).

## Behavior notes

- The wrapper always passes `--trust` (headless runs otherwise stop at a workspace-trust prompt), `--output-format stream-json`, and a mode flag — consult gets `--mode ask`, work gets `--force`. The stream is a sequence of typed events ending in a result envelope (which carries `session_id`, `is_error`, and a `result` field). The wrapper writes only the **final assistant message** to `-o`: cursor's `result` field has been observed to concatenate every incremental status line ahead of the final summary, so it is not the clean answer other backends' envelopes give. Incremental commentary stays in the diagnostic log, never the `-o` answer file. (If a future cursor stream carries no assistant events, the wrapper falls back to the envelope `result` rather than writing an empty answer.)
- Ask mode is system-enforced read-only: file reads work, the write/edit tools are refused, and headless shell is denied outright. A cursor consult therefore **cannot run `git diff` or any other command** — attach diffs and command output as `-f` material instead of asking it to gather them.
- Without `--force`, headless denies every shell command while the write tool still works — neither read-only nor fully armed, which is why the wrapper never dispatches that default state.
- Subcommands dispatch from the first operand token even after `--` (a bare `models`, `update`, `login`, ... runs that subcommand instead of prompting). The wrapper rejects bare subcommand words in the passthrough and one-word work missions that match one.
- Resume (`-r`) reattaches by chat id from the same workspace directory; resuming from a different directory silently starts with empty context, so resume from the worktree that ran the original dispatch.
- Path quirk: workspace path components beginning with `-` (e.g. sandboxed scratch dirs) can make cursor write into a dash-flattened sibling directory instead of the real path. Dispatch from normally-named directories.
- No cost metadata in the envelope (only token usage), so cursor runs emit no `agent-run: cost-usd:` trailer; the raw envelope stays in the log.
- The session id lands only in the buffered result envelope, so the `agent-run: session-id:` trailer appears only at finalization (unlike codex, which logs it early). A run killed before then leaves no session-id trailer — reattach with the chat id from `agent --list-chats` (or start a fresh run), resumed from the same worktree that ran the original dispatch.
- Headless runs leave `worker-server` daemon processes behind after the dispatch finalizes; they keep the workspace registered and have been observed coinciding with transient `index.lock` contention on the dispatch repo (commits failing with "Unable to create index.lock"). If commits flake after cursor dispatches, `pkill -f 'cursor-agent.*worker-server'` and retry.
