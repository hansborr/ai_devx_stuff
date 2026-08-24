# Require an Attributable Teammate Handoff Before Idle

Status: Proposed — probe candidate after adversarial review; implementation conditional
Date: 2026-07-21
Priority: P2
Size: S (probe); M (implementation, conditional)
Risk: medium
Source:
`/home/node/persist/musi/pain_points/subagents-and-review-convergence.md` —
implementer subagents drop their final report

## Problem

Implementer teammates can finish and commit their assigned work, then become
idle without sending the requested report to the lead. The idle notification
carries no useful report, so the lead must reconstruct completion from the
lane's log, status, scope greps, and gates. Explicit prompt wording and later
nudge messages have not made delivery reliable.

The tempting fix—another generic Stop reminder—is unsafe. This repo previously
disabled unattributed Stop-time dirty-tree nudges after agents committed or
reverted other agents' work in a shared checkout. Any enforcement here must be
specific to the teammate that is becoming idle and to that teammate's own
successful report action. Repository state is not proof of report ownership.

## Current workaround and repro hypothesis (owner note, 2026-07-22)

- Agent team mode is currently **disabled** as a temporary workaround, via the
  local, uncommitted `.claude/settings.local.json`
  (`"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0" }`). Running the
  Phase A probe requires re-enabling it; whatever this leaf concludes, that
  workaround should not silently become permanent.
- The owner suspects the dropped report correlates with a teammate running a
  long command — for example `bun run verify`, which regularly exceeds ten
  minutes — and idling afterward without the report.
- Proposed live reproduction, **conditional**: this matrix is slow (several
  multi-minute sessions, one over ten minutes) and only matters if a hook can
  act on the result, so it runs only after the capability checks below confirm
  that `TeammateIdle` is emitted with attributable identity. If that capability
  is absent or ambiguous, record `NO-GO/UNSUPPORTED` and do not spend the matrix
  sessions. When it does run: agents run a command such as `sleep <n>; echo done`
  and then report, across a matrix of execution contexts, durations, and modes.
  - Contexts (three, not one): a **teammate** asked directly, outside a
    dynamic workflow (requires agent team mode enabled); a **normal subagent**
    asked the same way (with team mode disabled via `settings.local.json`);
    and the same work run **inside a dynamic workflow**.
  - Durations: under 5 minutes (for example `sleep 240`), over 5 minutes
    (`sleep 330`), and over 10 minutes (`sleep 601`).
  - Modes: the command run in the foreground versus backgrounded.

  The owner suspects some combination triggers the idle-without-report
  behavior; the matrix isolates which context, threshold, and mode matter
  rather than proving only that "long" fails.
- Because the contexts need fresh Claude Code sessions with different settings
  (team mode on versus off), the driving agent cannot run them in its own
  session: dispatch each run as a new session through the **agent-cli skill**
  (`claude` backend). Owner requirement: use **Sonnet 5** specifically for
  these probe runs.

## Evidence

- The source memory records three implementers in one drain finishing their
  commits but idling without the required `SendMessage` report, including one
  that idled again after a direct nudge:
  `/home/node/.claude/projects/-workspace/memory/subagent-implementers-stall-at-report.md:11-15`.
- `scripts/harness/hook-wiring-schema.ts:3-34` already models
  `TeammateIdle`, and lines 42-73 classify it as a no-matcher event. No
  `TeammateIdle` control is wired in `harness.controls.json` or generated
  Claude settings today.
- `scripts/ai-hooks/subagent-stop-reminder.sh:22-30` explicitly says its
  `SubagentStop` system message is non-blocking, user-facing, and does not wake
  the agent. It therefore cannot enforce a teammate-to-lead report.
- The prior Stop-hook ruling is recorded in
  `/home/node/.claude/projects/-workspace/memory/stop-hook-misattribution-history.md:10-26`:
  shared dirty/staged state is ambient, not attributable work, and must not be
  presented as the stopping agent's to-do.

## Phase A — Required Probe (Size S)

Before designing or wiring behavior, run a disposable, explicitly opt-in
Claude agent team with temporary observation-only probes and record a redacted
fixture/contract in the repo. Start with a status/capability probe; do not assume
that scanning a teammate transcript is the available or correct design.

Run the capability checks (A1) first; the reproduction matrix (A2) is gated on
them and must be skipped when A1 does not confirm an emitted, attributable
`TeammateIdle`.

### A1 — capability probe (run first)

Establish all of the following from the live installed runtime, not from the
event name or inferred docs:

- whether `TeammateIdle` is actually emitted for an opt-in team and which
  payload fields stably and uniquely identify the team, idle teammate, lead,
  task/session, and current idle cycle;
- the live meaning of exit 2 (and any structured response): whether it blocks
  that exact teammate's transition, wakes it with actionable feedback, merely
  logs, retries the hook, or affects another actor;
- whether a `PostToolUse` receipt for `SendMessage` can be observed and
  correlated to the sending teammate, exact lead recipient, successful tool
  result, task/session, and the **current** report-required idle cycle;
- if no attributable receipt exists, whether an event-supplied transcript or
  another runtime-owned record is uniquely scoped and sufficient; and
- how repeated/racing idle events and two parallel teammates are represented.

### A2 — reproduction matrix (only if A1 confirms an emitted, attributable event)

Run this only after A1 shows that `TeammateIdle` is emitted and carries stable,
attributable identity. If A1 does not, stop at A1 with a `NO-GO/UNSUPPORTED`
result and do not spend the matrix sessions: a characterized trigger is not
actionable without a hook that can observe it.

- whether the failure reproduces with long-running commands: run the
  reproduction matrix from the owner note above — three execution contexts
  (direct teammate with team mode enabled, normal subagent with team mode
  disabled, and inside a dynamic workflow) crossed with durations under 5
  minutes, over 5 minutes, and over 10 minutes (for example `sleep 240` /
  `sleep 330` / `sleep 601`), each in both foreground and backgrounded form,
  alongside a short-command control. Record per-cell whether the report is
  delivered, so the triggering context/duration/mode combination is identified
  rather than inferred. Because the contexts require fresh sessions with
  different `settings.local.json` states, dispatch each run as a new Claude
  Code session via the agent-cli skill (`claude` backend), using Sonnet 5
  specifically for the runs.

Record only the minimum redacted schema and synthetic fixtures needed for
tests; do not commit a real conversation transcript. End the probe note with an
explicit `GO` or `NO-GO/UNSUPPORTED` result against each capability above. A
`GO` must identify the attributable receipt/state source, current-cycle rule,
and verified delivery mechanism. If any is absent, ambiguous, or unwired, the
valid deliverable is `NO-GO/UNSUPPORTED`: document it and leave production hook
wiring unchanged. Unavailable evidence must fail open, not trigger a heuristic
reminder.

## Phase B — Conditional Implementation (Size M)

This phase is in scope only after Phase A records an explicit `GO`. The
implementation must use the proved event and receipt/state contract; a
transcript scanner is not an assumed fallback.

- Define one stable, prompt-visible report protocol for explicitly
  report-required team tasks: the teammate must call `SendMessage` to the
  event's lead, and the message must begin with `HANDOFF` and identify the
  assigned task and current report cycle. Document a small body contract for
  outcome, commit/change summary, checks run, and any blocker or residue.
- Add a Claude-only `TeammateIdle` body using the live-proved identity and
  current-cycle contract. Recognize only the probe-verified evidence of a
  successful `SendMessage` from that exact teammate to that team's exact lead
  for that task/session and current cycle. Prefer an attributable
  `PostToolUse(SendMessage)` receipt if the probe proves it; use a referenced
  transcript only if the probe independently proves unique ownership and
  successful-result attribution.
- When an opted-in, report-required teammate has no such action, use only the
  probe-verified exit/response mechanism to give that same teammate one narrow
  instruction: send the `HANDOFF` message to the lead before idling. A prose
  claim such as “I reported,” a prior-cycle handoff, an attempted/failed tool
  call, a message to another recipient, or another teammate's handoff must not
  satisfy the check.
- If the live runtime does not expose an unambiguous current-cycle key, create
  only the minimum hook-owned state proved safe by the probe, keyed by stable
  team + teammate + task/session identity and updated from attributable
  receipts. Do not equate “latest message in a transcript” with current-cycle
  completion.
- Keep the entire behavior explicitly opt-in for report-required team tasks.
  A normal team task, non-team session, or payload with missing opt-in evidence
  must continue unchanged.
- If any required identity field or receipt is absent or ambiguous, the trusted
  record is missing/unreadable, the live format is unknown, or parsing fails,
  exit 0 without blocking. Diagnostics may go to a bounded local debug log but
  must not turn unavailable attribution into agent-facing work.
- Keep parallel state isolated by stable team + teammate + task/session + cycle
  identity. One teammate's report or retry state must never release, suppress,
  or redirect another teammate's handoff.
- Wire the new body through `harness.controls.json`, generated Claude settings,
  harness documentation, schema capabilities, and the AI-hook/path-policy
  fixture surfaces. Mark Codex and Copilot unsupported with explicit notes
  rather than generating speculative adapters.
- Add focused fixtures for no handoff, valid handoff, prior-cycle handoff,
  wrong teammate, wrong recipient, failed tool result, quoted/fabricated
  handoff text, malformed payload, missing receipt/state, repeated idle, and
  two parallel teammates.

## Acceptance — Phase A

- The checked-in probe note records whether live `TeammateIdle` identity,
  opt-in scope, current-cycle correlation, exit-2/response behavior, and an
  attributable successful `PostToolUse(SendMessage)` receipt (or a proved
  equivalent) are available.
- The note ends in an evidence-backed `GO` or `NO-GO/UNSUPPORTED`. A no-go
  result leaves production wiring and ordinary sessions unchanged and
  completes the probe deliverable without pretending enforcement exists.
- The A2 reproduction matrix is recorded only when A1 confirmed an emitted,
  attributable event. If A1 reached `NO-GO/UNSUPPORTED`, the note states the
  matrix was intentionally skipped as unactionable; skipping it is not a gap.
- Synthetic/redacted fixtures cover the observed payloads and results; no real
  conversation transcript or broad transcript scanner is checked in.

## Acceptance — Phase B (only after `GO`)

- An opted-in, report-required teammate that tries to idle without a successful
  current-cycle handoff is returned a concise instruction through the
  probe-verified mechanism.
- After that exact teammate successfully sends a conforming handoff to that
  exact lead for the current cycle, the next idle event exits cleanly without
  another reminder.
- Hand-off prose, prior-cycle receipts, failed/partial tool calls, messages to
  peers, and another teammate's report do not count. Two simultaneous teammates
  remain isolated.
- Missing, malformed, ambiguous, or unreadable identity/receipt evidence always
  exits 0 and performs no repository or task mutation.
- Non-opted-in and non-team sessions are unchanged. Existing `Stop` and
  `SubagentStop` behavior and settings are unchanged except for documentation
  needed to distinguish them from `TeammateIdle`.
- Focused AI-hook tests, hook-generation tests, `bash scripts/ai-hooks/test.sh`,
  `bun run docs:harness-controls:check`, and `bun run harness:check` pass.

## Boundaries

- Do not re-enable, broaden, or repurpose the prior Stop dirty-tree reminder.
  This leaf owns only the opt-in agent-team `TeammateIdle` report transition.
- Do not inspect `git status`, commits, changed paths, task files, or other
  ambient shared state to decide whether the teammate has finished or reported.
- Do not infer ownership or current-cycle completion from cwd, branch, timing,
  prose, transcript recency, or an assumed transcript shape. Use only the
  live-proved teammate/team/task/cycle identity and attributable receipt/state.
- Do not scrape project transcripts, adopt a transcript scanner without a
  positive probe result, or send a report on the teammate's behalf. The
  required action remains the teammate's attributable `SendMessage` to its
  lead.
- Do not block when attribution is unavailable, and do not let a parser or
  transcript-read failure prevent an agent from idling.
- Keep both the probe and any behavior opt-in; do not introduce a default team,
  automatically spawn teammates, or change ordinary subagent/agent-cli dispatch
  behavior.
