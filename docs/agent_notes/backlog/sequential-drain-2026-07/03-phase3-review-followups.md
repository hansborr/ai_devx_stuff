# Phase 3 review follow-ups

Status: Open leaves (small)
Created: 2026-07-16
Source: 4-model pre-land review of `feat/sd-p3-integration` (grok/codex/opus/fable)
and the confirm-then-fix pass. Context commits: 4a99db39..9e228ffc.

Low-priority residue that survived the fix pass deliberately — none of these
block anything today.

## 1. Shared-collector escalation for the remaining changed-scope gates

The suppression scanners now escalate to full scope when
`scripts/lib/changed-lintable-files.sh` or `scripts/lint-suppressions.sh`
changes (9e228ffc). The main eslint gates (`eslintChanged`,
`agentLintChanged`) and `configSensorsChanged` still omit the shared
collector as a full-scan trigger — the same class of self-referential gap.
Decide whether they should escalate too, or introduce a shared trigger
group in `scripts/path-policy/path-policy.ts` instead of per-gate
duplication.

## 2. Generator-import freshness-trigger consistency test

Nothing enforces that every module imported by
`scripts/harness/generate-verify-steps.ts` (or the other generators in the
freshness registry) appears in that generator's trigger list in
`scripts/harness/generated-surface-freshness.ts`; 964dc6a1 fixed one such
omission by hand. A small consistency test (imports ⊆ triggers, or an
explicit exempt list) would prevent recurrence.

## 3. Porting-knob parity scan roots

`scripts/harness/porting-knob-parity.ts` scans only
`PORTING_SCAN_ROOTS = ["scripts"]`. All current `porting-knob:` markers
live under `scripts/`, but the first marker under `eslint-config/`,
`.husky/`, or a top-level config would silently escape the parity gate.
Widening needs a scoped scan design (the collector recurses and reads every
file per root, so a repo-root scan is out).

## 4. SubagentStop delivery — resolved 2026-07-16: stays off pending attribution

Originally "verify a live SubagentStop renders `systemMessage`, else flip
the adapter (f58262ac) to `hookSpecificOutput.additionalContext`". Resolved
with the owner as a decision instead of an implementation:

The Stop-hook family is intentionally disabled in this environment. The
history behind that: agent-facing nudges about shared worktree state carry
no attribution — "there are uncommitted changes" reads as *my delegation
left this* — and agents acting on that inference committed other agents'
in-flight work and, in at least one consult-only case, reverted it. The
agent-cli worktree lock is the structural replacement for what these nudges
tried to do with prose.

Decision: do **not** re-enable the family here, and do not flip the adapter
to agent-facing `additionalContext` — that recreates the misattribution
hazard at the orchestrator level, with more authority behind the mistake.
The adapter stays in-tree as reference wiring (correct as written for
single-agent environments with stop hooks enabled; the copyability audience
is the point).

Re-open only with an attribution mechanism: snapshot worktree state when a
delegation starts and report only the delta attributable to it. If partially
revived, the failing-cached-verify check is the safe half (remediation is
investigation); the dirty-tree check is the hazardous half (remediation is
mutation — commit or revert).
