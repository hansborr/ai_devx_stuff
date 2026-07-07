# 19. Stop hooks must never notify or wake an agent (user-visible warnings only)

Status: Done — implemented 2026-07-07 on branch `fix/stop-hooks-user-only`,
merged to main 2026-07-07 (`39b6abc2`) — code `c73b5070` (codex) + docs
`3fdf1594`; reviewed (no P0/P1).
Verification step 1 ran first and PASSED on claude CLI 2.1.202: exit-0
`{"systemMessage": …}` renders to the user (`hook_system_message` attachment),
never enters model context, never resumes the agent — so the systemMessage
design shipped, not the fallback. Caveat recorded: in headless
`--output-format stream-json` runs the message is absent from the stdout
stream (transcript-only).
Size: M · Severity: owner ruling
Source: owner ruling 2026-07-07. **Scope expanded 2026-07-07 by a second owner
ruling** — this supersedes the earlier version of this leaf
(`19-remove-stop-uncommitted-reminder.md`), which only removed the
uncommitted-changes reminder.

## Ruling

No Stop-family hook may ever notify, nudge, block, or wake **any agent**, on
**any adapter** — Claude Code (`Stop`, `SubagentStop`), Codex (`Stop`), Copilot
(`agentStop`). Showing a warning to the *user* is fine. Where an adapter has no
verified user-only output channel, remove that adapter's stop wiring entirely
rather than keep an agent-facing variant. Fallback ruling: if user-only
delivery turns out to be impossible or leaky in practice (the message reaches
agent context in any form), fully remove the stop hooks.

Why: agent-facing stop nudges have repeatedly caused trouble in multi-agent /
orchestration sessions. The concrete 2026-07-07 incident: a read-only consult
subagent got the SubagentStop uncommitted-changes injection for the
*orchestrator's* in-flight edits in the shared checkout and appended a
confusing "these changes aren't mine" disclaimer to its report. More broadly,
exit-2 stop-blocking restarts agents mid-orchestration, and `additionalContext`
injection lands policy text in whichever agent happens to be stopping,
regardless of whether the condition is theirs to act on. Commit and
verification discipline is already an AGENTS.md instruction; the mechanical
nudge is redundant with it and misfires in exactly the sessions where stop
events are most frequent.

## Platform facts (verified 2026-07-07 against the Claude Code hooks doc, <https://code.claude.com/docs/en/hooks.md>)

- Agent-facing channels on Claude's Stop/SubagentStop — all of which must go:
  exit 2 + stderr (blocks the stop, feeds stderr to the agent, wakes it),
  JSON `decision: "block"` + `reason` (same effect), and
  `hookSpecificOutput.additionalContext` (non-blocking but injected into agent
  context at end of turn — the incident mechanism).
- Claude **does** have a user-only channel: exit 0 with
  `{"systemMessage": "..."}` — documented as "Warning message shown to the
  user", a universal hook-output field. Plain stdout on exit 0 goes to the
  debug log only (Stop/SubagentStop are not in the stdout-as-context exception
  list, which is only `UserPromptSubmit`/`UserPromptExpansion`/`SessionStart`).
  Caveat: this is guaranteed by the per-field docs but not shown as a worked
  Stop example — verify it empirically once before building on it (see
  Verification, step 1).
- Codex: the repo capability model (`scripts/harness/hook-wiring-schema.ts`)
  supports only `decisionBlock` for Codex `Stop`; no user-only channel is
  known. Codex has no SubagentStop event wired at all.
- Copilot: `agentStop` is currently served by `.copilot/hooks/stop-reminder.sh`
  translating the shared body's exit 2 into `{decision:"block", reason}` —
  agent-facing by construction. The schema nominally permits
  `additionalContext` on Copilot Stop, but that is also an agent channel, and
  its behavior on the real CLI is unverified.

## Design (decided — do not re-litigate)

Per adapter:

- **Claude `Stop`** — keep the hook wired; rework
  `scripts/ai-hooks/stop-reminder.sh` to always exit 0 and, when
  `ai_stop_policy_messages` returns text, emit `{"systemMessage": "..."}` on
  stdout (jq-encoded). It must never exit 2 and never emit `decision` or
  `hookSpecificOutput` under any condition. The `stop_hook_active`
  short-circuit becomes moot once nothing blocks; drop it.
- **Claude `SubagentStop`** — unwire entirely. Its only implemented output
  (`additionalContext`) is agent-context injection — the exact incident
  mechanism — and per-subagent user warnings would be noise in multi-agent
  sessions. Delete `scripts/ai-hooks/subagent-stop-reminder.sh`, its
  `.claude/hooks/` shim, and `ai_stop_policy_messages_subagent` +
  `ai_stop_subagent_scope_key` in `stop-policy.sh`.
- **Codex `Stop`** — unwire (no user-only channel exists). Remove the codex
  harness entry from the `hook/ai-stop-reminder` control and the
  `.codex/hooks/stop-reminder.sh` shim.
- **Copilot `agentStop`** — unwire and delete the block-translation shim
  `.copilot/hooks/stop-reminder.sh`. Optional: if a genuinely user-only
  channel on the current Copilot CLI can be verified, a warning may be kept —
  but do not block the leaf on that; removal is the default.

Consequences inside `stop-policy.sh`:

- **All five subchecks survive as user-visible warnings** (uncommitted
  changes, failing e2e, async verify, cached verify status, lint warnings) on
  the Claude Stop path. This intentionally supersedes the old leaf's "delete
  the commit reminder entirely": the removal rationale was agent
  misattribution, which dies with agent-facing delivery. If the dirty-tree
  warning proves noisy for the user later, its kill switch still silences it.
- **Hard-stop mode dies.** Its entire mechanism is blocking the agent, which
  the ruling forbids. Remove `AI_STOP_HARD_MARKER_NAME` (`musi-stop-hard`),
  `ai_stop_hard_marker_path`, `ai_stop_hard_enabled`,
  `ai_stop_hard_mode_trailer`, `ai_stop_append_hard_mode_trailer`,
  `ai_stop_commit_hard_reminder`, and the hard branches in
  `ai_stop_policy_messages` / `ai_stop_verify_status`. Nothing creates the
  marker automatically (verified 2026-07-07 — manual `touch` only), so stale
  markers are inert and need no migration. `harness-review-2026-07/55` (the
  hard-stop design record, Done) stays as-is; add a one-line superseded-by
  cross-reference there.
- **Reword message copy for a human reader.** Drop the agent-directed "stop
  again; this reminder will not repeat…" suffixes (`AI_STOP_REMINDER_SUFFIX`
  and the per-check variants). Keep the dedup markers and repeat counters —
  they now throttle user-warning spam instead of agent nudges. Keep every
  kill switch with unchanged name and semantics (now: silence that user
  warning): `.no-stop-uncommitted`, `.no-stop-e2e`, `.no-stop-async-verify`,
  `.no-stop-verify-changed`, `.no-stop-verify` (legacy alias),
  `.no-stop-lint-warnings`.

## Couplings and constraints (from a 2026-07-07 reference sweep)

- `scripts/ai-hooks/session-state.sh` (a SessionStart hook) **sources
  `stop-policy.sh`** and reuses `ai_stop_verify_meta_string`,
  `ai_stop_verify_meta_int`, `ai_stop_verify_failing_gates`, the
  `ai_stop_async_*` state readers, `ai_stop_current_branch`, and all six
  `AI_STOP_*_KILL_SWITCH` constants (for its active-kill-switch summary).
  Whatever is deleted, those symbols must keep working —
  `test-session-state.sh` asserts the kill-switch listing. SessionStart
  behavior is out of scope for this leaf.
- `ai_emit_additional_context` (`scripts/ai-hooks/common.sh`) is a shared
  primitive with ~12 other callers (protected-files, tidy, ratchet, …). Do
  not touch it; only remove the SubagentStop call site.
- **Hook wiring is generated.** Edit `harness.controls.json`
  (`hook/ai-stop-reminder`: drop the codex/copilot harness entries, update the
  `principle` text that still describes hard-stop mode;
  `hook/ai-subagent-stop-reminder`: remove the control), extend
  `scripts/harness/hook-wiring-schema.ts` to model a `systemMessage` output
  capability for Claude `Stop`, then regenerate — `.claude/settings.json`,
  `.codex/hooks.json`, and `.github/hooks/copilot.json` are outputs, not edit
  targets. `bun run harness:check` rolls up the wiring and generated-doc
  freshness checks.
- No script outside `stop-policy.sh` reads the `AI_STOP_STATE_DIR` markers
  and counters (`last.*`, `e2e.*`, `async.*`, `verify.*`) — internal reshaping
  is safe. `AI_STOP_STATE_DIR` itself is defined in `cache.sh` and covered by
  `test-cache.sh`; leave it.
- `AI_STOP_REMINDER_SUFFIX` and `ai_stop_has_uncommitted_changes` have no
  external readers (`ratchet-regression-check.sh` only mirrors the kill-switch
  *naming convention* in a comment) — free to remove or rewrite.

## Files to touch

- `scripts/ai-hooks/stop-reminder.sh` — systemMessage delivery, never exit 2.
- `scripts/ai-hooks/subagent-stop-reminder.sh` +
  `.claude/hooks/subagent-stop-reminder.sh` — delete.
- `.codex/hooks/stop-reminder.sh`, `.copilot/hooks/stop-reminder.sh` — delete.
- `scripts/ai-hooks/stop-policy.sh` — hard-stop removal, subagent-path
  removal, message rewording.
- `harness.controls.json` + `scripts/harness/hook-wiring-schema.ts` →
  regenerate `.claude/settings.json`, `.codex/hooks.json`,
  `.github/hooks/copilot.json`, `docs/generated/harness-controls.md`.
- Tests: `scripts/ai-hooks/test-stop-policy.sh` (drop subagent and hard-stop
  cases; add delivery-shape cases — entry script exits 0 and emits
  systemMessage-only JSON on a red condition), `test-copilot-wiring.sh` (its
  stop-shim cases go), `test-session-state.sh` (should stay green unchanged —
  treat a failure there as a coupling regression), `check-wiring.sh`
  expectations if it enumerates hook files.
- Docs: `docs/ai-harness.md` — the guides-table row pairing
  `docs/agent_notes/…` with the "Stop-hook dirty-work reminder" sensor, and
  the three later rows describing Stop-policy prompts for e2e / `verify:logs`
  / cached-verify replay (reword: advisory user warning, not agent nudge).
  `scripts/ai-hooks/README.md`'s hookWiring event list is stale (predates
  SubagentStop) — fix in passing.
- Backlog hygiene: `01-promotion-map.md` row for this leaf (updated with this
  rename); cross-reference, don't absorb,
  `17-verify-legacy-retirements.md` (retires the `.no-stop-verify` legacy
  alias — still valid on top of this leaf). `harness-review-2026-07b/32`
  (session-state kill-switch listing) and `harness-review-2026-07/51` (lists
  kill-switch names) remain valid; historical finished-work notes stay as-is.

## Done criteria

- No adapter's stop wiring can block a stop, exit 2, emit
  `decision: "block"`, or inject `additionalContext` — grep-clean across
  `scripts/ai-hooks/`, `.claude/`, `.codex/`, `.copilot/`, `.github/hooks/`.
- Claude Stop warnings arrive as `systemMessage` visible to the user; the
  agent's transcript contains no injected stop-hook text and the agent is not
  resumed.
- The SubagentStop surface is gone on all adapters.
- Hard-stop mode is gone; `musi-stop-hard` is dead (no code reads it).
- All five subchecks still fire (as user warnings) with their kill switches
  and repeat throttles intact; `session-state.sh`'s SessionStart summary is
  byte-identical for the same repo state.

## Verification

1. **Empirical gate first, before the refactor** (cheap): point a throwaway
   Stop hook at a script that exits 0 with `{"systemMessage":"stop-hook
   probe"}`, stop an agent, and confirm (a) the message renders for the user
   and (b) nothing appears in the agent's context and the agent stays
   stopped. If `systemMessage` leaks to the agent or does not render, invoke
   the fallback ruling: unwire the Claude Stop hook too (full removal, same
   as codex/copilot) and skip the systemMessage plumbing.
2. `bash scripts/ai-hooks/test-stop-policy.sh` green (rewritten per above).
3. `bash scripts/ai-hooks/test.sh` aggregate green (covers the session-state
   and copilot-wiring updates).
4. `bun run harness:check` green.
5. Manual: stop with a dirty worktree and a failing cached verify — user sees
   the warning, agent transcript clean, agent not resumed; stop a subagent —
   no output anywhere; `touch .git/musi-stop-hard` then stop — no effect.
