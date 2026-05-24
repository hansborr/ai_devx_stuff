# Hook JSON Output Validation — Investigation Notes

**Error:** `Hook JSON output validation failed — (root): Invalid input`

This appeared during a backgrounded commit (`run_in_background: true`) where the
pre-commit hook failed (ShellCheck and script smoke failures). The agent never saw
the error in tool results — only the user saw it in the Claude Code UI.

## Root cause

`git-commit-quiet.sh` had **no signal handlers** (TERM/INT). When the harness
600s timeout fires or the tool call gets backgrounded and the harness sends
SIGTERM, the hook dies silently with exit code 143 and empty stdout. The harness
sees no JSON → `(root): Invalid input`.

Additionally, `bash -c "$CMD"` ran in the **foreground** (blocking the parent
shell), so even if traps had existed, they wouldn't fire until the child exited —
defeating the purpose for timeout handling. In bash, signal traps are deferred
while a foreground child is running.

Contrast with `bun-run-quiet.sh`, which has three signal handlers:
- `on_early_signal()` — covers the flock-wait window
- `on_sigterm()` — covers the command execution window (watchdog/external kill)
- `on_sigint()` — covers user cancellation

All three emit valid deny JSON and exit 0, ensuring the harness always gets a
parseable response.

## Fix applied

1. Restructured `git-commit-quiet.sh` to run `bash -c "$CMD"` in the background
   (with `&` + `wait $CHILD`), matching `bun-run-quiet.sh`'s pattern.
2. Added a 540s internal watchdog (under the 600s harness backstop).
3. Added `on_sigterm()` and `on_sigint()` handlers that signal the child +
   watchdog, emit valid deny JSON, and exit 0.
4. Added jq fallback (`|| printf ...`) on the final deny line so even a jq failure
   still produces valid JSON.
5. Moved `rm -f "$OUTFILE"` into the EXIT trap (previously it was a standalone trap
   that got overwritten by the new signal traps).
6. Follow-up: timeout summaries now explicitly say the commit may still be
   running in the background and point the agent at
   `commit-timeout-status.sh`. That helper checks whether HEAD moved, waits up
   to 240s for the pre-commit lock, and tells the agent to rerun the status
   command if the lock is still held. Codex post-tool git commit summaries use
   the same guidance for timeout/signal or empty-output commit results.

## Original hypotheses evaluated

### H1: Silent jq failure on the failure path — partially confirmed
The jq fallback addresses this. However, the primary issue was signal handling,
not jq failure. The jq fallback is a defense-in-depth measure.

### H2: Stray stdout from sourced scripts — not confirmed
Audited all sourced files; no unconditional echo/printf at source-time.

### H3: Background mode / pipe interaction — confirmed (root cause)
When `run_in_background` is set and the harness manages the tool call lifecycle,
external signals (TERM from harness timeout or backgrounding) are the primary
trigger. The hook's lack of signal handlers meant these produced empty stdout.

### H4: Multiple hooks emitting conflicting responses — not confirmed
The hooks fire sequentially and only one matches `git commit` commands.
