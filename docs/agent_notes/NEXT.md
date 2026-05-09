# Next Up

Active hot queue for agent loops. Keep only leaf tasks that are ready now or blocked on the leaf above. This file is the queue, not the design doc.

When an item lands, update only durable handoff history and remove or retier it
here. Parked and broad work lives in `backlog/README.md`; do not pull it into
the loop unless you are re-triaging.

## Ready now

Add `docs/guides/add-module-doc.md`, a narrow guide for adding or refreshing
`MODULE.md` orientation docs. Pair it with `docs/module-docs.md`, the
`Concepts:` breadcrumb pattern, `bun run module:index`, and the
`module:index:check` sensor.

Cache-budget slice 5 (typecheck optimization) stays conditional on
measurements showing typecheck regularly exceeds the 210s warm / 240s cold
budget; nothing currently justifies it.

## Blocked until earlier slices land

None.

## Scope

- The consolidated codebase-review cycle is closed and archived at
  `docs/agent_notes/finished_work/codebase-review-next-cycle.md`.
- Future harness leaves should come from
  `docs/agent_notes/backlog/ai-harness-followups.md` only after this ready-now
  item lands or is retiered.
