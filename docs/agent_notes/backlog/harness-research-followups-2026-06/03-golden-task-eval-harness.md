# EV-1 - Codebase-grounded golden-task eval harness

Status: In progress — implemented on `feat/golden-task-eval`; acceptance needs
the remaining fixture admissions and a first live-agent run

> **Superseded — in flight on `feat/golden-task-eval` (`ad60abec`).** This file
> is the original proposal. The branch carries a 292-line implementation ledger
> at this same path recording five cross-model review rounds (findings #1–#27:
> 19 fixed, 8 owner-classified deferrals, no known blockers). **Read the branch
> copy, not this one**, before touching the work.
>
> Built there: runner, workspace isolation, agent adapter, grader, scoring,
> reporter, `bun run eval:golden`, `docs/guides/golden-task-evals.md`, full
> harness registration, 85 green unit tests, and one admitted calibrated
> fixture. Remaining: rebase (65 behind, `package.json`-only conflict), the
> first real live-agent run (every run so far is controller-mode), four more
> admitted fixtures, and a pilot recalibration. Tracked as row C4 in
> `../ready-2026-07/00-index.md` §2.

## Problem

The harness research (`15-evals-and-observability.md`) argues you cannot tell
whether a harness change helped without a golden-task suite graded by your own
deterministic checks — and that leaderboard scores collapse on real code, so
the eval must run on *your* repo.

Musi has an unusually large amount of harness machinery — custom lint rules,
ratchets (`lint:ratchet`, `lint:ratchet:zero-baseline`), `drift:ai`, the
`harness:audit` fusion consumer, the weekly `slow-drift.yml` lane, `code:intel`,
guides under `docs/guides/`. What it does **not** have is any way to measure
whether all of that actually makes an agent more likely to complete a real Musi
task correctly. Every harness change today is justified by reasoning, not by a
before/after signal. There is no `/evals` suite.

## What this is (and is not)

- **Is:** a small set of fixtures derived from *real* Musi failures/tasks (a
  tRPC procedure to add, a rules edge case to fix, a socket broadcast to wire),
  each with a deterministic grader built from the gates the repo already runs.
- **Is not:** an LLM-judge benchmark, an observability/OTel stack, or a CI gate
  in the first cut. Those are explicitly deferred (see Non-Goals). Start with
  the cheapest thing that produces a number.

## Proposed Implementation

1. Pick 5-10 fixtures from real history (closed bugs, representative feature
   slices). Each fixture is a starting repo state + a task prompt + a
   deterministic grader.
2. Grade with what already exists — no new judging infra:
   `bun run typecheck`, `bun run lint`, the relevant `bun run test -- <file>`,
   and any task-specific assertion script. A fixture passes only when its
   graders are green. This reuses the deterministic floor as the rubric.
3. Run each fixture from a clean worktree/branch so fixtures cannot contaminate
   each other (the repo already has worktree DB tooling for isolation).
4. Record per-fixture pass/fail + a short trace (which gate failed) to a results
   file. That is the v1 "score." Run it manually, off the per-commit path.
5. Only after v1 produces stable numbers, consider: gating in CI with a
   regression threshold; an LLM judge *after* human calibration; cost/token
   capture. Each is a separate promotion, not part of this leaf.

## TDD / Verification

- Build one fixture end-to-end first and confirm its grader is deterministic
  (same input → same verdict across runs).
- A fixture whose grader flakes is not ready — fix the grader or drop the
  fixture; a noisy eval is worse than none.
- Keep the whole harness off `verify:changed`; it is a manual/scheduled tool.

## Acceptance Criteria

- A `evals/` (or similar) directory with ≥5 real-failure fixtures, each with a
  deterministic grader reusing existing gates.
- A documented command that runs the suite and emits a per-fixture results
  file.
- No new per-commit latency; no LLM-judge dependency in v1.

## Risks

- Fixture maintenance cost is real and paths drift; keep the set small and tied
  to durable rules/contract logic rather than fast-moving UI.
- A grader that is too loose passes broken solutions; too tight rejects valid
  ones. Calibrate against a known-good and known-bad solution per fixture.
- Scope creep into a full observability platform — resist; this leaf is the
  deterministic v1 only.

## Non-Goals (deferred to separate promotions)

- OpenTelemetry GenAI traces, Langfuse/Braintrust/LangSmith, cost dashboards.
- LLM-as-judge grading and its kappa calibration.
- A blocking CI eval gate with a regression threshold.
