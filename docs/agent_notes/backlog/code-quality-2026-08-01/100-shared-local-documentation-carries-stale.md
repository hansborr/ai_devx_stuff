# 100. Shared-package docs carry three stale claims contradicted by a colocated test, the import graph, and the SRD 5.2.1 oracle

Status: Not started
Theme: stale doc claims vs code oracles · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three contributor-facing claims in `packages/shared` local documentation are
contradicted by things the repo itself treats as authoritative. The schemas
`MODULE.md` tells a reader `magic-item-inputs.ts` is untested, so anyone
touching that schema budgets for writing its first test — or trusts the label
and skips checking — when a substantive suite already sits beside it. The
area-template `MODULE.md` sends a reader tracing template consumers to
`map-canvas-overlays.tsx`, which no longer binds to the shared module at all,
while hiding the store that actually imports from it. And `xp.ts` labels its
CR-to-XP table "SRD 5.1 / 2024 revision" in a project whose ruleset — and whose
own exhaustive property-test fixture — is SRD 5.2.1, pointing a provenance
audit at the wrong source document. All three sit in first-read docs on common
shared-package paths; each is a hand-maintained exact inventory that routine
changes silently invalidated.

## Evidence

- `packages/shared/src/schemas/MODULE.md:168-171` — "Nine files have no
  colocated test today: … `magic-item-inputs.ts` …" (bullet spans `:166-174`).
- `packages/shared/src/schemas/magic-item-inputs.test.ts:1-59` — the colocated
  test exists and is substantive: imports `listMagicItemsInputSchema` at `:5`,
  8 cases (defaults, filters, search-length ceiling, limit bounds, `.strict()`
  rejection, pagination direction). Re-derived at the pin: of the nine listed
  files, exactly one has a colocated test; the other eight entries hold.
- `packages/shared/src/map/area-template-MODULE.md:10-14` — names
  `map-canvas-overlays.tsx` among the consumers binding to the exported
  constants/types, and omits `map-canvas-store.ts`.
- `packages/client/src/stores/map-canvas-store.ts:1` — `import type
  { TemplateShape } from "@musi/shared/map/area-template.js"`; the store owns
  `templateShapeForTool` (`:66`, exported `:625`).
- `packages/client/src/components/campaign/maps/map-canvas-overlays.tsx:10` —
  imports `type MapTool, templateShapeForTool` from the store; its only shared
  imports (`:1-2`) are `map/fog.js` and `schemas/map.js` — no `area-template`
  binding. Re-derived non-test importers of `area-template.ts` at the pin:
  `tool-handlers.ts:1-6`, `template-overlay.tsx:1`, `template-toolbar.tsx:1`,
  `map-canvas-store.ts:1`, `schemas/spell.ts:14` — five files, overlays absent.
- `packages/shared/src/rules/xp.ts:6` — "CR-to-XP lookup (SRD 5.1 / 2024
  revision)"; the only "SRD 5.1" in shared non-test source.
  `packages/shared/src/rules/xp.property.test.ts:121-128` pins every `CR_TO_XP`
  entry against an independent SRD 5.2.1 fixture ("matches the SRD 5.2.1
  XP-by-CR table exactly, entry for entry"); `AGENTS.md:3-4` states the project
  is built on the SRD 5.2.1 ruleset.

## Proposed direction

Fix three stale claims, treating the colocated test, the import graph, and the
SRD 5.2.1 oracle as authoritative. One commit, doc/comment edits only:

1. Drop `magic-item-inputs.ts` from `schemas/MODULE.md:168-171`'s
   no-colocated-test list — `magic-item-inputs.test.ts` exists. The remaining
   eight entries are correct; while editing the sentence, reword the volatile
   exact inventory to be less brittle (e.g. drop the hard-coded "Nine" so the
   next added test invalidates one list entry, not a count plus a list).
2. Correct `area-template-MODULE.md:10-14`'s consumer list: add
   `map-canvas-store.ts`'s `TemplateShape` import and stop naming
   `map-canvas-overlays.tsx` as a direct shared-module consumer — it reaches
   template state only through the store's `templateShapeForTool`. The
   re-derived five-file importer set above is the target state; prefer
   describing consumer roles over enumerating an exact file list where the
   wording allows.
3. Change `xp.ts:6` from "(SRD 5.1 / 2024 revision)" to SRD 5.2.1, matching
   the `xp.property.test.ts:121` oracle and `AGENTS.md`.

No `MODULE.md` is added, renamed, or deleted, so no `bun run module:index`
regeneration is needed (per `area-template-MODULE.md:78-79`).

## Scope / caveats

- Out of scope: writing tests for the eight genuinely untested schema files,
  mechanically enforcing the schema/test pairing (the `MODULE.md:171-172`
  "nothing enforces the pairing" warning stays true and stays in), and any
  runtime or client-structure change. `xp.ts` is touched at the line-6 comment
  only — no table values, no exports; `xp.property.test.ts` stays green
  untouched.
- Prior pack, binding: CQ25-117 (`CLIENT-CLUSTER-PLAN.md`, all 15 slices
  landed) is do-not-reopen; its Q3 follow-up added the shared magic-item input
  coverage that made the nine-file schema inventory stale. The template-tool
  mapping was instead centralized by
  [11-canvas-tool-typing.md](../code-quality-2026-07-25/11-canvas-tool-typing.md),
  whose status is Done — landed 2026-07-26. This leaf fixes only the resulting
  stale documentation; do not revisit either implementation.
- [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  and [034-campaign-homebrew-procedure-contracts-split.md](./034-campaign-homebrew-procedure-contracts-split.md)
  restructure shared schema modules and may update other parts of
  `schemas/MODULE.md`. No ordering edge, but avoid concurrent edits to that
  file; if either lands first, re-verify the untested-file list against the
  tree instead of applying step 1 blind.
