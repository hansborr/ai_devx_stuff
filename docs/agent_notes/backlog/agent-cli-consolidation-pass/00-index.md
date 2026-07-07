# agent-cli wrapper consolidation — task pack

Status: Implemented 2026-07-07
Created: 2026-07-06 as a single backlog note; converted to a task pack 2026-07-07
Source: 2026-07-06 drift:ai hotspot lens + drift-triage FIX-PLAN item 12
deferral; revised 2026-07-06 after a Claude + Codex review pass; reshaped into
this pack 2026-07-07 after a delegability review (Claude orchestrator + Codex
+ Gemini consults) that folded in the `arch-review-2026-07` amendments (A3
backend adapter table, A2 trailer-contract artifact, Tier-3 agent-cli
cleanups). The original single-file note is superseded by this pack.

## Why

The 2026-07-06 drift:ai hotspot lens flagged the agent-cli dispatch harness as
the window's dominant fix-heavy hotspot: `agent-run.sh` at 41 revisions with
80–93% `fix:` commits, `test-skill-dispatch-wrappers.sh` co-changing 11 times.
The recent commit trail (signal-escalation hardening, TERM-in-pid-capture-window
propagation, mid-run-kill trailer finalization) shows convergence, not thrash —
but the component is 1312 lines of monolithic bash guarding worktree integrity,
locks, and subprocess lifecycles for three backends, verified by one 1762-line
test script. The drift-triage fix lanes (now landed, `2817f435`) doubled as a
burn-in; their incidents are recorded below as spec inputs.

## Overriding constraint — portability

The skill must stay easily shareable: it is ported to other repos by copying
files, and the repo is meant as a public harness-engineering reference judged
on copyability. Every leaf inherits this: no sourcing outside
`.claude/skills/agent-cli/`, no repo-coupled gates, no build step for the
wrapper, prerequisites documented in the skill itself.

## Task list

Leaves are scoped for **one-at-a-time dispatch on a single lane**: every leaf
touches `agent-run.sh` and/or `test-skill-dispatch-wrappers.sh`, so the
dependency column is ordering, not parallelism — parallel worktree lanes here
would buy merge conflicts, not speed.

| # | Leaf | Size | Depends on | Status |
|---|---|---|---|---|
| 10 | [Trailer/exit-code contract artifact + invariant tests](./10-trailer-contract-artifact.md) | S-M | none — **do first**; its tests are the safety net for 11–13 | Implemented 2026-07-07 |
| 11 | [Close the residual pid-capture gap](./11-pid-capture-gap.md) | S-M | 10 (contract tests in place) | Implemented 2026-07-07 |
| 12 | [Source-guard `main()` split + per-phase test suites](./12-source-guard-phase-functions.md) | M | 10 | Implemented 2026-07-07 |
| 13 | [Backend adapter table (+ parser/dead-defense cleanups)](./13-backend-adapter-table.md) | M-L | 12; must preserve 11's semantics | Implemented 2026-07-07 |
| 21 | [Per-agent skill caveats — mirror redesign](./21-per-agent-skill-caveats.md) | M | after 13; spike DONE 2026-07-07 (both loaders inject SKILL.md verbatim, `@`-refs inert → inline per-agent sections) | Implemented 2026-07-07 |
| 20 | [Skill docs: prerequisite audit, lore re-audit](./20-skill-docs-portability-audit.md) | S-M | after 10–13 and 21 (prunes lore the wrapper then enforces; audits leaf 21's new shape) | Implemented 2026-07-07 |

## Incident inputs — drift-triage-2026-07-06 fix workflow burn-in (2026-07-07)

Six agent-run.sh dispatches (three fresh `work codex`, two `-r` session
resumes, one `consult codex`): all finalized with clean `agent-run:` trailers;
zero dead-run signatures; session resume worked as designed for iterative fix
rounds (three rounds on one session).

- **Cross-worktree commit-guard queuing read as failure** — with 6+ lanes
  committing in parallel, the shared-git-dir commit guard serialized
  `git commit` calls across worktrees; delegates saw "No commit landed" /
  "Another git commit in progress" while the commit in fact landed after
  queuing. → owned by **leaf 20** (SKILL.md lifecycle step 5 waiter guidance).
- **Fixture-portability tail cost three fix rounds** — a new leaf module broke
  sandboxing fixtures in three copy sets, each surfacing only at the
  next-deeper gate. Not a wrapper defect; **routed out of this pack** to
  [`../fixture-copy-set-import-graph-guard.md`](../fixture-copy-set-import-graph-guard.md).
- **Worktree provisioning order** — a base whose seed inputs changed must
  `bun run --filter @musi/shared build` BEFORE `worktree:init` (hit once on
  the lane-H worktree). → owned by **leaf 20** (repo-local marking sweep).

## Pack done criteria

- Wrapper behavior unchanged from the caller's perspective (same CLI, same
  trailer contract, same exit codes) — leaf 10's invariant tests prove it.
- Each lifecycle phase has focused tests; the kill-window edges are covered
  (leaf 12).
- `backend-pid: unknown` is either impossible by construction or has a tested
  recovery path (leaf 11).
- A `work` run editing the wrapper itself no longer self-corrupts, or the
  residual window is documented as negligible (leaf 12).
- Per-backend logic lives in one adapter set per backend; a new backend is one
  edit site, not five (leaf 13).
- **Portability preserved** (see constraint above) and ShellCheck coverage of
  the skill scripts confirmed intact in the existing lint lane (leaf 20).
- Per-agent caveats live in the skill, not CLAUDE.md; the mirror invariant is
  the leaf-21 redesign, not byte-identical (leaves 21 + 20).
