# Agent Pain-Point Audit — 2026-07-21

Status: Mostly drained — 7 of 9 repository candidates implemented; 10 and the 05 probe remain
Date: 2026-07-21
Updated: 2026-07-25

This pack reconciles `/home/node/persist/musi/pain_points.log` and its available
Claude-memory sources against the live repository, tests, history, and existing
backlog. Parallel subsystem triage produced candidate leaves; independent
runtime, command-safety, harness, data-model, evidence, and portfolio reviewers
then tried to refute or narrow every candidate.

The result is nine actionable repository candidates, one feasibility probe with
conditional implementation, and one non-schedulable correctness rider merged
into an existing ready task. This is a parked evidence pack, not a second ready
queue. Promote accepted work only through
[`ready-2026-07/00-index.md`](../ready-2026-07/00-index.md).

## Final disposition

| # | Item | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 02 | [Consolidate `land.sh` flow-test ownership](./02-consolidate-land-flow-test-ownership.md) | P2 | M | Implemented — 2026-07-22 |
| 03 | [C8 command-target correctness rider](./03-resolve-hook-command-targets.md) | — | — | Accepted decision record — non-schedulable; merged into ready C8/leaf 13 |
| 04 | [Bound agent backends to the wrapper lifetime](./04-bound-agent-backend-lifetime.md) | — | — | Cancelled — owner decision 2026-07-22; record retained |
| 05 | [Require an attributable teammate handoff](./05-require-attributable-teammate-handoff.md) | P2 | S probe / M conditional | Probe candidate — implementation requires an explicit GO result |
| 06 | [Restrict agent stash commands to an allowlist](./06-block-linked-worktree-stash-mutations.md) | P1 | S–M | Implemented — 2026-07-22 |
| 07 | [Replace stale `worktree:new` recovery output](./07-make-worktree-recovery-single-command.md) | P2 | S | Implemented — 2026-07-22 |
| 08 | [Generate skill mirrors and smoke subjects](./08-generate-skill-mirrors-and-subjects.md) | P2 | L | Implemented — 2026-07-22 |
| 09 | [Run a structural registration preflight in fast-commit mode](./09-fast-commit-registration-preflight.md) | P2 | L | Implemented — 2026-07-22 |
| 10 | [Preserve lint-ratchet identity across path renames](./10-lint-ratchet-path-renames.md) | P2 | L | Proposed — ready for design review |
| 11 | [Type successful shared-schema fixtures](./11-type-positive-schema-fixtures.md) | P2 | L | Implemented — 2026-07-22 |
| 12 | [Decouple Copilot retry artifacts](./12-decouple-copilot-retry-artifacts.md) | P2 | M | Implemented — 2026-07-25 |

Evidence, corrected claims, fixed items, external limitations, duplicate
ownership, and rejected designs are recorded in
[Sources and Verdicts](./01-sources-and-verdicts.md).

## Remaining work

Seven of the nine repository candidates landed between 2026-07-22 and
2026-07-25 (02, 06, 07, 08, 09, 11, 12). Two items are still open:

1. **10** — schedule proactively: simulate the rename trigger in fixtures
   rather than waiting for a real pending baselined-file move. Implementation
   and cost are approved, but merge is gated on a cross-model review panel
   (see the owner decision below). WIP branch: `feat/lint-ratchet-rename-identity`.
2. **05** — run the probe opportunistically, starting with the A1 capability
   check; implement Phase B only on an explicit `GO`. Agent team mode is still
   disabled locally and must be re-enabled to run it.

03 stays inside the existing C8 command-policy campaign; it is not a lane. 04
was cancelled by owner decision (see below).

## Owner decisions — 2026-07-22

- **04 cancelled.** The supervisor/lifecycle redesign will not be scheduled.
  The leaf is retained as an evidence record; manual orphan recovery stays the
  documented path.
- **05 probe approved.** A temporary workaround is live: agent team mode is
  disabled via the local, uncommitted `.claude/settings.local.json`
  (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`) and must be re-enabled to run the
  probe. The live reproduction matrix with long-running teammate commands is
  conditional: run it only after the capability probe confirms `TeammateIdle`
  is emitted and attributable, otherwise stop at `NO-GO/UNSUPPORTED`. Details in
  the leaf.
- **09 cost approved.** A seconds-scale registration admission cost per
  fast-mode commit is acceptable; the pain fast mode addresses is
  ten-plus-minute verify runs, not seconds.
- **10 unparked.** Do not wait for a real pending rename to justify the work.
  Implementation and cost approved, but merge is gated on a thorough cross-model
  review panel — a clean local gate is not sufficient to land. See the leaf.
- **11 approved as specced.** The full scope — typed schema helper, explicit
  result helper, repository-wide migration, and retirement of the ambiguous
  `expectParseSuccess` name — is approved; no slim/alias variant. Rationale:
  call sites become shorter and more declarative, and typed positive fixtures
  double as executable contract documentation for new contributors.

## Adversarial corrections that shaped the pack

- No generic shell evaluation, teardown receipt framework, transcript scanner,
  or second command-policy implementation was accepted.
- Stash mutations are blocked for repository agents everywhere; treating the
  primary checkout as the stash owner would preserve the same shared-ref risk.
- The fast-mode leaf owns structural registration only. Independent behavioral
  assertions remain intentional late tripwires until separately single-sourced.
- Backend supervision, ratchet rename replay, schema-fixture migration, and
  skill projection were resized to large after their real cross-surface work
  was traced.
