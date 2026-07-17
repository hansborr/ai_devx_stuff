# Agent CLI Crash-Recovery and Answer UX

Status: Done
Date: 2026-07-12
Source: Dispatch friction observed during the 2026-07-12 multi-lane drain.

## Evidence

- Session IDs are not emitted while a backend is still running. The wrapper's
  dispatch header contains the mode, backend, wrapper PID, and answer path, but
  no session ID (`emit_dispatch_header` in
  `.claude/skills/agent-cli/scripts/agent-run.sh`). Claude and cursor session
  IDs are read from the result envelope only after the backend exits, while
  codex and copilot IDs are extracted during finalization. Even the fatal-signal
  handler can only attempt this extraction while finalizing. A container OOM
  killed six wrappers during the drain without finalization, leaving no logged
  session ID for `-r`; recovery used fresh `--dirty-ok` runs and paid cold
  discovery cost again.
- Cursor uses the same `launch_result_envelope_backend` parser as Claude. That
  parser writes the envelope's complete `result` value to `-o` without
  backend-specific normalization. In the drain, a cursor work run's `result`
  contained every incremental status line concatenated before the final
  summary, so its answer file was a transcript-like accumulation rather than
  the clean final answer produced by codex and Claude.
- `parse_args` stores one `MISSION_FILE` and explicitly rejects a second `-P`
  or `--mission-file`; `load_mission_file` then reads only that single file.
  Re-dispatching a crashed mission with a recovery preamble such as "the dirty
  diff in this worktree is yours" therefore required hand-concatenating prompt
  files instead of composing the original mission and resume context at the
  command line.
- A headless delegate that starts a long command in the background and ends
  its turn to await completion is finalized at end-of-turn, and finalization
  tears down its process tree — taking the still-running command with it.
  During the 2026-07-12 integration land, a Claude delegate backgrounded
  `scripts/land.sh` and ended its turn "to wait for the notification"; the
  wrapper finalized with `worktree: clean` and exit 0 while land.sh's full
  verify died 50 seconds in (recorded as `serial-verify exit 124` with zero
  completed steps). The mission looked successful from the trailers alone;
  only checking main showed nothing had landed. Nothing in the dispatch
  contract warns the backend that backgrounded work does not survive its final
  turn.

## Do

- Capture and log each backend's native session ID as soon as the backend emits
  it. Where streamed output cannot expose it promptly, discover it immediately
  after spawn from the backend's native session store. Preserve the existing
  anchored parsing safeguards so prompt content cannot spoof an ID. A run
  killed before wrapper finalization must still leave a resumable ID in its
  log.
- Normalize cursor `-o` output to the final assistant message only. Keep
  incremental commentary in the diagnostic log if it is useful, but do not
  include it in the answer-file contract.
- Make resume mission composition a one-command operation. Prefer repeatable
  `-P` / `--mission-file` values concatenated in caller order, or add a
  dedicated repeatable `--preamble-file` option that is prepended to the
  mission. Define separators and ordering explicitly.
- Close the backgrounded-work lifetime gap from both sides: state in the
  mission preamble the wrapper injects (or the skill's dispatch guidance) that
  backgrounded processes die at end-of-turn, so delegates must foreground
  long-running commands; and have the wrapper detect the orphan case where the
  backend exits successfully while children of its process group are still
  running, emitting a distinct trailer (or delaying finalization) instead of a
  clean `worktree: clean` success.
- Update the agent-cli skill usage and backend references alongside the wrapper
  so dispatch and recovery examples describe the new contracts.

## Verify

- Extend `scripts/tests/test-skill-dispatch-wrappers.sh` with the earliest-ID,
  cursor-final-only, and mission-composition cases where its fake backends can
  model the behavior.
- Run `bun run test:scripts:file -- scripts/tests/test-skill-dispatch-wrappers.sh`.
- Run `bun run test:scripts:subjects:check`.
- Run `bun run harness:check` if test registration or harness-controlled paths
  change.

## Acceptance

- A wrapper test proves a session ID is logged before normal finalization, and
  crash recovery can retrieve it, for every backend whose native interface
  makes early discovery testable.
- A cursor wrapper test feeds incremental commentary plus a final response and
  proves `-o` contains only the final response.
- A wrapper test proves two mission components can be supplied separately and
  reach the backend once, in documented order.
- Backends that cannot expose an early session ID have the limitation pinned by
  a test or fixture and documented with the best available recovery path.
- A wrapper test proves that a backend exiting while a child it spawned is
  still running does not finalize as an unqualified success (distinct trailer
  or delayed finalization), and the skill's dispatch guidance tells delegates
  that backgrounded work does not survive their final turn.
- The agent-cli skill docs and relevant backend references are updated in the
  same change as the wrapper behavior.
