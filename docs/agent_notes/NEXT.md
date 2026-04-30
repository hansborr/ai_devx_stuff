# Next Up

Active hot queue for agent loops. Keep only leaf tasks that are ready now or
blocked on the leaf above. This file is the queue, not the design doc.

When an item lands, update only durable handoff history and remove or retier it
here. Parked and broad work lives in `backlog/`; do not pull it into the loop
unless you are re-triaging.

## Ready Now

- [ ] Replace this with exactly one small, ready-to-implement leaf task.

## Blocked Until Earlier Slices Land

None.

## Scope

Link the canonical design doc, roadmap section, issue, or active
`in_progress/` note here instead of duplicating the whole plan.
