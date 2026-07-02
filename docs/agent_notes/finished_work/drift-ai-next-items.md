# drift:ai Next Items — Pack Summary

Status: Archive summary written at pack close-out (2026-06-20). The pack
folder `docs/agent_notes/backlog/drift-ai-next-items/` was deleted after all
43 leaves landed on `main`. The individual leaves, shared-context, and
live-seams notes are available in git history before the folder was removed.

## What the pack changed

Post-ship task pack created after rechecking the original drift:ai backlog
against the live implementation. All 43 leaves (the diagnostics-spine,
check/adapter, prototype-advisory, and governance tracks) are implemented and
landed:

- Diagnostics fusion and projection: the shared
  `harness-diagnostics` schema/tool ids (`drift:ai`, `logs:audit`,
  `harness:audit`), per-tool diagnostics projections, and the `harness:audit`
  fusion consumer (`scripts/harness-audit.ts`).
- Prototype advisory lenses: MinHash/LSH near-duplicate clone candidates
  (`scripts/drift-ai/clone-candidates-*`), commented-out-code detection, the
  module-doc-path freshness check, and the server layer-direction advisory.
- Governance/hardening: effective-config inspection
  (`scripts/drift-ai/config-inspect.ts`), harness-controls inventory parity,
  per-check timing disclosure, and the scheduled weekly slow-drift lane.

Landing commits are on `main` — notably `543e7462`
(`feat(drift-ai): land 21 remaining findings`), the semgrep advisory series
(`4267f50b`..`1ede002d`), and the clone/coldspots/hotspots refactors. This
pack is the supersession target for the diagnostics-spine rows
(11, 20, 21, 22, 23, 24, 40) in `../backlog/harness-review-tasks/`.

## Where the details live

- Leaves (10–55), `01-shared-context.md`, and `02-live-seams.md`: git history
  before the folder removal (this summary's landing commit is the deletion
  point).
- Implementations: `scripts/drift-ai/`, `scripts/harness-audit.ts`, and
  `packages/shared/src/schemas/harness-diagnostics.ts`.
