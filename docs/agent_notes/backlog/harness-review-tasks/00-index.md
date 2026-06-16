# Harness Review Tasks

Status: Parked task index
Created: 2026-06-01
Source: `docs/agent_notes/harness-review-2026-05/` plus selected portable ideas
from `/workspace/tmp/ma-toki/docs/harness-research/`.

This folder is the execution queue for the promising harness-review items. Each
task file is intended to be one small commit. If a promoted task still feels too
large after re-auditing the current tree, split it before implementing.

Always read [`01-shared-context.md`](./01-shared-context.md) first. For code
tasks, also skim [`02-live-seams.md`](./02-live-seams.md), then read only the
single task file you are implementing.

> **Precedence (2026-06-02):** [`../drift-ai-next-items/`](../drift-ai-next-items/00-index.md)
> is now the active queue for the diagnostics spine, the module-doc path sensor,
> and the layer-direction sensor, re-derived against live `main` code. The rows
> below stay as rationale but are marked **Superseded**; implement that work from
> next-items instead (this pack -> next-items): 11 -> 20, 20 -> 10, 21 -> 11,
> 22 -> 12, 23 -> 13, 24 -> 14, 40 -> 22. Tasks 25, 53, and all docs/feedforward
> and governance rows remain owned here.

## Task List

Tracks: **D** docs/feedforward, **Dg** diagnostics, **L** loop/autonomy,
**A** architecture sensors, **G** governance/refinement.

| # | Task | Track | Size | Depends on | Blocks | Status |
|---|---|---|---|---|---|---|
| 10 | [Fix character-live-state module doc](./10-character-live-state-module-doc.md) | D | S | none | 11 | Parked |
| 11 | [Module-doc path accuracy sensor](./11-module-doc-path-accuracy-sensor.md) | Dg | S-M | 10 | 23, 24 | Superseded -> next-items 20 |
| 12 | [Doc-length phantom-file cleanup](../../finished_work/doc-length-hook-redesign.md) | D | S | none | none | Done -> doc-length redesign |
| 13 | [Refresh ai-harness current gaps](./13-ai-harness-gap-refresh.md) | D | S | none | 20, 22 | Parked |
| 14 | [Skill trigger grammar](./14-skill-use-when-trigger-grammar.md) | D | S | none | none | Parked |
| 15 | [Golden-path reference feature pointer](./15-golden-path-reference-feature.md) | D | S | none | none | Parked |
| 16 | [Guide breadcrumbs and hook advisories](./16-guide-breadcrumbs-and-advisories.md) | D | S-M | none | none | Parked |
| 20 | [Diagnostics schema tool extension](./20-diagnostics-schema-tool-extension.md) | Dg | S | 13 | 21, 22, 23 | Superseded -> next-items 10 |
| 21 | [drift:ai diagnostics projection](./21-drift-ai-diagnostics-projection.md) | Dg | M | 20 | 23 | Superseded -> next-items 11 |
| 22 | [logs:audit diagnostics projection](./22-logs-audit-diagnostics-projection.md) | Dg | M | 13, 20 | 23 | Superseded -> next-items 12 |
| 23 | [harness:audit fusion consumer](./23-harness-audit-fusion-consumer.md) | Dg | M | 11, 20, 21, 22, 53 | 24 | Superseded -> next-items 13 |
| 24 | [Basic scheduled slow-drift lane](./24-scheduled-slow-drift-basic-lane.md) | Dg | M | 11, 23, 53 | 25 | Superseded -> next-items 14 |
| 25 | [Slow-lane mutation and timing add-ons](./25-slow-lane-mutation-and-timing-addons.md) | Dg | M | 24 | none | Parked |
| 40 | [Layer-direction report-only sensor](./40-layer-direction-sensor.md) | A | M | none | none | Superseded -> next-items 22 |
| 50 | [Lint self-correction exemption audit](./50-lint-self-correction-exemption-audit.md) | G | M | none | none | Parked |
| 51 | [Thin spec/plan template](./51-thin-spec-plan-template.md) | G | S-M | none | none | Parked |
| 52 | [Demotion rule and noise budgets](./52-demotion-and-noise-budgets.md) | G | S | none | all report-only sensors | Parked |
| 53 | [logs:audit latest graceful degradation](./53-logs-audit-latest-graceful-degrade.md) | Dg | M | none | 23, 24 | Parked |
| 54 | [Green-output backpressure carve-out](./54-green-output-backpressure-carveout.md) | G | M | none | none | Parked |

## Recommended Order

The diagnostics-spine (20-24), module-doc (11), and layer-direction (40) steps
below are **superseded** by `../drift-ai-next-items/` (see Precedence above) and
remain only as ordering rationale; run that work from next-items.

1. **Quick feedforward/doc repairs:** 10, 13, 14, 15, 16 (12 landed — see
   `../../finished_work/doc-length-hook-redesign.md`).
2. **Doc freshness:** 11 after 10, so the sensor can prove it would catch the
   fixed class of drift.
3. **Diagnostics spine:** 13 -> 20 -> 21 and 22; 11 and 53 before 23; then
   23 -> 24. Add 25 only after the basic weekly lane is producing useful
   artifacts.
4. **Architecture sensors:** 40 remains parked and report-only.
5. **Governance/refinements:** 50, 51, 52, and 54 are independent. Do 52 before
   promoting any new report-only sensor from this folder.

## Folded Backlog Mapping

The following older backlog items remain as rationale, but this folder is the
preferred execution queue for the overlapping leaves:

- `ai-harness-prioritized-backlog.md`: stable JSON diagnostics output, graph
  drift sensors, scheduled slow harness report, `logs:audit:latest`/doctor
  integration, stale module-doc sensor, sensor-trigger statistics, coding-session
  sidecar, and rule/codemod metadata registry (named, not numbered — that list
  renumbers as leaves land).
- `ai-harness-followups.md` slow drift reports, stable JSON diagnostics,
  behavior confidence notes, and `logs:audit` activation notes.
- `autonomous-agent-iteration-candidates.md` logs-audit latest candidate.
- `lint-followups-2026-06/` is the canonical lint platform queue; task 50 only
  covers the narrow exemption-audit slice from the harness review.

## Promotion Rules

1. Promote exactly one task file into active work.
2. Reconfirm the seams with `rg` or `bun run code:intel` before editing. The
   review was written against the 2026-05 tree and paths may have moved.
3. Preserve the repo timing model: report-only first for broad sensors; gates
   only after low noise, clear repair text, and a concrete consumer.
4. When a task lands, mark its row Done here and move durable details into
   `LOG.md`, a decisions file, or `finished_work/` only if the commit cannot
   carry the context.
