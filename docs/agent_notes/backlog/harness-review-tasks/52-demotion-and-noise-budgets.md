# 52 - Demotion rule and noise budgets

Status: Parked
Track: G (governance/refinement)
Size: small
Depends on: none
Blocks: all report-only sensors

## Goal

Document when a report-only sensor should stay parked, be promoted, or be
demoted because it is too noisy.

## Background

The review repeatedly warned that warnings agents can ignore become background
noise. Musi already says "report-only first"; this task adds the missing other
half: how to retire, narrow, or keep quiet a sensor that does not earn trust.

## Seams to touch

- `docs/ai-harness.md`
- `scripts/drift-ai/README.md`, if drift-specific examples help
- Any harness-control generated docs only if they are the canonical policy
  surface

## What to do

1. Add a short policy for report-only sensor lifecycle:
   - entry criteria;
   - observation period;
   - rough false-positive or noise budget;
   - promotion criteria;
   - demotion or deletion criteria.
2. Make the policy concrete enough for tasks 11, 40, and 41 to cite.
3. Preserve the current timing model: broad sensors stay outside the edit loop
   until proven cheap and useful.

## Testing

- Docs-only. Run markdown formatting if available.

## Out of scope

- Changing any sensor behavior.
- Turning any report-only check into a gate.
