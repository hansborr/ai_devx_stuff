# Codex Test Output Summarization Handoff

Status: Implemented on 2026-05-08; targeted smoke tests and
real Codex single-file pass/fail checks have been run. Cross-verified from
Claude on the same date.
Source: human noticed that passing tests still leave large output blocks in the
Codex context window, and that successful commands are shown as
`PostToolUse hook (blocked)` even though the tool ran and was allowed.

## User Goal

- For AI-agent test runs, passing checks should surface only a generic summary
  such as `X tests passed` or `<script> OK`.
- Extra output should remain visible when a command fails.
- Codex should not falsely label a successful post-tool summary as blocked if
  there is a non-blocking hook API path that can provide the message.

## What Is Already Quiet

- `scripts/verify.sh` and `.husky/pre-commit` already write detailed step logs
  and print high-level status on success. Failures use bounded excerpts through
  shared hook/cache helpers.
- `.claude/hooks/bun-run-quiet.sh` already handles the Claude path for
  `bun run <script>` by rewriting the command on success and showing bounded
  failure output. That is why Claude can avoid the misleading blocked label for
  successful runs.
- `scripts/vitest.sh` filters known warning noise through
  `ai_filter_known_output_noise`, but it does not collapse normal passing
  Vitest output by itself. The agent-facing quiet behavior is therefore mostly
  owned by tool hooks, not by the Vitest wrapper.

## Codex Hook Path Today

- `.codex/hooks/pre-tool-use.sh` recognizes wrapped `bun run <script>` commands,
  records state under `$AI_BUN_STATE_DIR/$TOOL_USE_ID`, and handles cached
  reruns. For a cache miss it currently allows the original command to run.
- `.codex/hooks/post-tool-use.sh` reads that state, captures the tool response
  into `/tmp/musi-bun-logs/<script>.log`, writes a cache marker, and emits a
  summary.
- The success branch currently uses `ai_emit_block`, which serializes
  `{"decision":"block","reason":...}`. That explains the Codex UI text
  `PostToolUse hook (blocked)`: the hook is intentionally using a block
  decision as the transport for hiding noisy output and replacing it with a
  short reason.
- Shared helper `ai_emit_additional_context` in
  `scripts/ai-hooks/common.sh` can emit
  `hookSpecificOutput.additionalContext` without `decision:"block"`. It has
  not been tested yet as a replacement for successful Codex summaries.

## Empirical Behavior Seen In Codex

Ran:

```bash
bun run test:shared -- packages/shared/src/test-tier-sentinel.test.ts
```

Expected agent-visible output: a short success summary.

Observed agent-visible output: the Codex post hook printed a generic
`test:shared finished (...)` message plus a 40-line tail. The tail included the
Vitest summary and was wrapped as JSON-ish text like `{"raw":"..."}` instead of
plain command output.

Also checked a failure-shaped case:

```bash
bun run test:shared -- --definitely-not-a-vitest-flag
```

Observed: the post hook again printed the generic `finished` path and a bounded
tail, rather than a proper failed-command summary with an exit label. No
`/tmp/musi-bun-logs/last.test_shared` marker was written in that failing run.

These observations point to two separate bugs:

1. The Codex post-tool hook cannot currently read the tool exit code from the
   payload shape it receives, so success is not recognized as success.
2. The shared response parser mishandles Codex responses shaped as
   `{raw: "..."}` and turns the object back into a JSON string before summary
   generation.

## Parser Bug To Fix

Likely file: `scripts/ai-hooks/common.sh`.

`ai_response_json_from_payload` tries to normalize `tool_response` into
`exit_code`, `stdout`, `stderr`, and `raw`. The object-detection branch checks
for keys such as `stdout`, `stderr`, `output`, `exit_code`, and similar names,
but it does not appear to treat an object with only `raw` as already-normalized
text.

Result: a Codex response like:

```json
{"tool_response":{"raw":"plain command output"}}
```

can become a stringified object in logs and summaries:

```text
{"raw":"plain command output"}
```

Next agent should add coverage for this normalization before changing behavior:

- `{tool_response:{raw:"plain", exit_code:0}}` should produce raw text
  `plain` and exit code `0`.
- `{tool_response:{raw:"plain"}}` should produce raw text `plain`, not a JSON
  object string.
- Existing stdout/stderr and scalar-string payload shapes should keep working.

## Exit Code Bug To Investigate

Likely files:

- `.codex/hooks/post-tool-use.sh`
- `scripts/ai-hooks/common.sh`
- possibly Codex hook payload documentation or local Codex hook fixtures if
  available

The post hook currently computes `EXIT_CODE` from normalized response JSON. In
the real Codex run above, a successful test did not enter the `EXIT_CODE == 0`
branch. A failing test also did not get a usable nonzero exit code.

Do not assume the current key list is complete. Inspect or capture the real
Codex `PostToolUse` payload shape before hard-coding fallback heuristics. If
temporary instrumentation is needed, make it opt-in and remove it before
landing.

Potential payload shapes to support defensively, if confirmed:

- `exit_code`, `exitCode`, `status`, or `code`
- `return_code`, `returncode`, `exit_status`, or `statusCode`
- nested metadata/status objects
- scalar text that includes a process-exit marker

Avoid treating an unknown exit code as success unless the hook path has another
reliable success signal. Misclassifying failures as passing would be worse than
showing too much output.

## Blocked Label Thread

The misleading `PostToolUse hook (blocked)` label is not caused by the command
being blocked. It is caused by `.codex/hooks/post-tool-use.sh` returning
`decision:"block"` after the command completes.

Recommended first experiment:

1. Keep failure handling on the existing blocking path so detailed failure
   output still replaces raw noisy output.
2. Change only the successful summary path to use
   `ai_emit_additional_context "PostToolUse" "<script> OK (...)"`.
3. Run a real passing `bun run test:shared -- <single-file>` command in Codex
   and inspect what the agent sees.

What to verify:

- If Codex shows only the additional-context success summary and does not show
  raw Vitest output, keep the non-blocking success path.
- If Codex shows the additional summary but also leaves raw command output in
  context, then `additionalContext` is not enough to solve context pollution.
  In that case, note the limitation and consider the wrapper approach below.

## Wrapper Approach If Additional Context Is Not Enough

Claude avoids the false blocked label by rewriting the command before it runs.
Codex may be able to do the same if `PreToolUse` supports
`hookSpecificOutput.updatedInput`.

Potential Codex design:

- Teach `.codex/hooks/pre-tool-use.sh` to rewrite cache-miss `bun run <script>`
  invocations to a repo-owned wrapper script.
- The wrapper would run the original command, write the full log to
  `/tmp/musi-bun-logs`, write the success/failure marker, print one success
  line on exit 0, print a bounded failure summary on nonzero exit, and exit with
  the original status.
- Then `.codex/hooks/post-tool-use.sh` can do little or nothing for that wrapped
  run, avoiding `decision:"block"` after a successful command.

This is more invasive than fixing the parser and success branch, so try the
small success-path experiment first.

## Suggested Verification

- Add hook-unit coverage in `bash scripts/test-ai-hooks.sh` for the `{raw:"..."}`
  parser shape and for Codex post-hook success/failure summaries.
- Run `bash scripts/test-ai-hooks.sh`.
- Run one real passing single-file test through Codex, for example:

```bash
bun run test:shared -- packages/shared/src/test-tier-sentinel.test.ts
```

- Run one real failure-shaped command and confirm the agent sees bounded useful
  failure output rather than raw full logs:

```bash
bun run test:shared -- --definitely-not-a-vitest-flag
```

## Do Not Lose

- The initial problem is context pollution, not just cosmetic UI text. A fix
  that removes the blocked label but reintroduces raw passing Vitest output is
  incomplete.
- The parser bug and exit-code bug are independent. Fixing `{raw:"..."}`
  normalization will make summaries readable, but it may not make success
  detection work.
- Failures should stay noisy enough to debug, but bounded. Success should be
  aggressively quiet.

## Implemented Outcome

- `scripts/vitest.sh` now compacts successful `vitest run` output to one line
  like `Vitest OK: 1 test passed in 1 file.` Failures still print filtered
  Vitest output.
- `scripts/ai-hooks/common.sh` now preserves `{raw:"..."}` response text,
  accepts more numeric exit-code shapes, and can infer Bun script failure exits
  from Bun's `error: script "... exited with code N"` footer.
- `.codex/hooks/post-tool-use.sh` now uses non-blocking
  `additionalContext` for successful wrapped Bun commands. Failure summaries
  still use the bounded blocking path so raw failure output is replaced with a
  useful tail.
- Local Codex 0.129 reports `updatedInput` unsupported for `PreToolUse` and
  `suppressOutput` unsupported for `PostToolUse`, so the Claude-style command
  rewrite path is not available in this Codex version.
