# 223. Remove the fulfilled shared-rules mutation gap from harness documentation

Status: Not started
Theme: Harness current-gaps list still calls scheduled rules mutation missing · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The harness guide describes the weekly scoped shared-rules mutation run as both
implemented and missing. A reader following the Current Gaps list can therefore
re-propose an already-shipped capability or spend time investigating why a
documented gap has an active workflow.

This is not merely a stale isolated noun. The same Current Gaps bullet groups
several slow-lane signals together, so deleting one phrase without checking the
remaining claims could leave another misleading description of what the weekly
lane does.

## Evidence

- `docs/ai-harness.md:564-571` — the Slow Drift Schedule says the weekly
  workflow sets `MUSI_SLOW_DRIFT_MUTATION=1`, runs scoped Stryker mutation over
  `packages/shared/src/rules/**`, summarizes survivors, and continues with a
  note after failure or timeout.
- `docs/ai-harness.md:656-659` — the Mutation Testing section independently
  states that the weekly lane runs the scoped shared-rules mutation pass and
  trends its survivor counts.
- `docs/ai-harness.md:706-709` — Current Gaps nevertheless lists scoped
  mutation testing for `packages/shared/src/rules/` among the remaining
  slow-lane gaps.
- `.github/workflows/slow-drift.yml:43-49` — the scheduled workflow invokes
  `scripts/slow-drift-audit.sh` with `MUSI_SLOW_DRIFT_MUTATION: "1"`.
- `docs/ai-harness.md:561-563` — the schedule also says it records per-step
  timings as trend evidence, so the adjacent generic `flake/timing trends`
  wording at `:709` needs the same factual review before it is retained.

## Proposed direction

Remove scoped mutation testing for `packages/shared/src/rules/` from the
Current Gaps bullet at `docs/ai-harness.md:706-709`. Keep the implemented
weekly mutation behavior documented in the Slow Drift Schedule and Mutation
Testing sections; do not relocate or duplicate those explanations.

Before finalizing the remaining bullet, check every surviving slow-lane claim
against `.github/workflows/slow-drift.yml`, `scripts/slow-drift-audit.sh`, and
the surrounding guide. In particular, reconcile the generic `flake/timing
trends` phrase with the already-documented per-step timing output: retain only
a narrower, concrete missing signal that the executable lane does not provide,
or remove that fulfilled portion too.

Read the materially edited Current Gaps section as a whole after the change and
then compare it with the mutation description at `docs/ai-harness.md:656-659`.
The acceptance condition is one internally consistent account: shipped
shared-rules mutation and timing signals appear as current capabilities, while
the gaps list contains only capabilities that remain absent.

## Scope / caveats

- Treat every factual claim in the materially edited section as owned by this
  change. Verification must cover the full claim after editing, not only the
  deleted mutation phrase.
- This is documentation cleanup only. Do not change the workflow, mutation
  scope, timeout/recovery behavior, thresholds, or report-only semantics.
- Coordinate with
  [101-mutation-docs-promise-sandbox-isolation.md](./101-mutation-docs-promise-sandbox-isolation.md),
  which updates other mutation documentation but does not cover this Current
  Gaps contradiction. Preserve its eventual per-lane sandbox and recovery
  wording if it lands first.
- There is no prior-pack residual for this finding.
