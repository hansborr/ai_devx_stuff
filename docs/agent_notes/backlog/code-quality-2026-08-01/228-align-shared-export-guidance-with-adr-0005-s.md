# 228. Align shared export guidance with ADR-0005's scoped-only decision

Status: Landed on fix/cq-228
Theme: Resolve the promised shared aggregate-export review against ADR-0005's barrel prohibition · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The shared schemas guide tells contributors that a root or schema aggregate
export is deferred work, while accepted ADR-0005 records the absence of those
exports as a load-bearing architecture decision. The implemented package and
lint fence follow the ADR, while the live orientation guide still suggests
that a broad barrel is intended future work.

The guide predates CQ25-115. That cluster's landed S1 schema-layout work
updated its ownership and inventory guidance but did not resolve the promised
aggregate-export review. Contributors and later
audits therefore receive incompatible answers: one document advertises a
backlog opportunity while the governing decision treats the same change as a
regression.

## Evidence

- `packages/shared/src/schemas/MODULE.md:30-34` — the orientation section says
  there is no root or schemas barrel, then explicitly defers an aggregate
  export to a separate backlog leaf.
- `packages/shared/src/schemas/MODULE.md:192-199` — the Gotchas section repeats
  that adding an aggregate is a deferred leaf, even while its next bullet
  invokes ADR-0005's defining-file import rule.
- `docs/adr/0005-shared-subpath-exports.md:29-43` — ADR-0005 permits only
  scoped subpaths, requires the removed schemas barrel to stay removed, and
  treats the absent root export as a gated decision.
- `docs/adr/0005-shared-subpath-exports.md:48-56` — new shared code belongs
  under a specific subpath; when none fits, contributors add a scoped export
  entry rather than widening a generic bucket.
- `packages/shared/package.json:8-32` — the implemented export map contains
  schema, rules, dice, map, test, and constants subpaths, with neither a root
  `"."` entry nor a schemas aggregate.
- `packages/client/src/components/character-create/steps/spell-selection-step.tsx:1-3`
  — a representative consumer imports its three dependencies through separate
  constants, rules, and defining-schema subpaths, illustrating the scoped API
  ADR-0005 requires.

## Proposed direction

Revise both aggregate-export passages in
`packages/shared/src/schemas/MODULE.md`. Replace the promise of a future
backlog review with an affirmative statement that consumers use scoped,
defining-file imports by accepted ADR-0005. Link the guide to that ADR and
summarize its extension path: add a specific subpath export when a new shared
area does not fit an existing namespace; do not add a root or `./schemas`
aggregate.

Keep the orientation useful by acknowledging the navigation cost directly and
pointing contributors to the file inventory and defining-file convention
already present in the guide. Do not change imports, source layout,
`package.json`, ESLint configuration, or runtime code.

No runtime test is needed for this documentation correction. Review should
confirm that both deferred-leaf statements are gone, both replacement passages
point to ADR-0005, and the guide no longer suggests a root or schemas aggregate
as pending work.

## Scope / caveats

- Do not add a root or schemas aggregate export, compatibility re-export, or
  second public path for an existing symbol.
- Do not weaken ADR-0005's message or the restricted-import protection owned by
  [153-global-restricted-import-policy-survives.md](./153-global-restricted-import-policy-survives.md).
  This leaf corrects contributor guidance; that leaf strengthens enforcement.
- [021-shared-production-builds-expose-colocated.md](./021-shared-production-builds-expose-colocated.md)
  addresses emitted tests behind the existing wildcard subpaths and explicitly
  excludes export-map redesign. Keep this documentation-only scope separate.
- The prior-pack residual is `CQ25-115` in
  [code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md):
  its landed S1 schema-layout work corrected module ownership and inventory,
  but did not resolve the aggregate-export review the live guide deferred.
- Any future reconsideration of aggregate exports requires bundle and
  dependency-graph evidence, a superseding or amended ADR, and coordinated
  updates to the manifest and enforcement gate. It is not an incidental
  documentation or convenience change.
