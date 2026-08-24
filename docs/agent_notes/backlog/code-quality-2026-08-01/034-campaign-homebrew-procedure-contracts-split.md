# 34. The campaign-homebrew router's four output schemas live alone in a 19-line module, split from their matching inputs

Status: Not started
Theme: contract co-location · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/schemas/homebrew-campaign.ts` is a 19-line module whose
entire content is four tRPC output schemas and their inferred type aliases. It
owns no entity and no vocabulary of its own — the two entity schemas it wraps
both come from `homebrew.ts`. The four matching inputs (link, unlink,
collection-list, entry-list) live in `homebrew-inputs.ts`, so following any one
`homebrewCampaign` procedure means discovering its request half and response
half in two different files, and the router pays for the split with two import
blocks from two shared modules. The schemas directory's own convention says
request-side output schemas belong in the `-inputs.ts` file beside their
inputs; this module is the straggler against that rule, and the directory's
MODULE.md lists it as an unpaired file without ever justifying the boundary.
In a barrel-less contract layer where "knowing which file holds a symbol is
the whole game", an unjustified extra file is pure navigation cost.

## Evidence

- `packages/shared/src/schemas/homebrew-campaign.ts:1-19` — the whole module:
  four `*OutputSchema` exports with four inferred `*Output` types, plus one
  import of `homebrewCollectionWithAuthorSchema`/`homebrewEntrySchema` from
  `./homebrew.js` (`:3`). Nothing else.
- `packages/shared/src/schemas/homebrew-inputs.ts:129-167` — the "Campaign
  linking inputs" section: `linkCollectionInputSchema` (`:133`),
  `unlinkCollectionInputSchema` (`:142`), `listCampaignCollectionsInputSchema`
  (`:151`), `listCampaignEntriesInputSchema` (`:159`) — the exact four
  procedures whose outputs live in the other file.
- `packages/server/src/routers/homebrew-campaign.ts:1-12` — the router's first
  two import blocks: outputs from `@musi/shared/schemas/homebrew-campaign.js`,
  inputs from `@musi/shared/schemas/homebrew-inputs.js`.
- `bun run code:intel -- dependents packages/shared/src/schemas/homebrew-campaign.ts`
  returns exactly 1 result: that server router. A repo-wide grep (excluding
  `dist/`) confirms the four inferred `*Output` type aliases have zero
  importers anywhere.
- `packages/shared/src/schemas/MODULE.md:40-44` — the landed convention:
  `<name>-inputs.ts` holds tRPC inputs "and the matching request-side
  output/result schemas".
- `packages/shared/src/schemas/MODULE.md:92-97` — `homebrew-campaign.ts` sits
  in the "non-`-inputs.ts` files without a same-named inputs partner" trap
  list with no rationale for its existence; `:169-170` also lists it among the
  nine schema files with no colocated test.
- The fold adds no import edge: `homebrew-inputs.ts:4-8` already imports from
  `./homebrew.js`, and `homebrew.ts:1-23` imports no homebrew-inputs or
  homebrew-campaign symbol back, so no cycle risk.

## Proposed direction

Fold the four output schemas and inferred types from
`packages/shared/src/schemas/homebrew-campaign.ts` into `homebrew-inputs.ts`
beside their matching campaign-linking inputs, delete the module, and update
the imports in `packages/server/src/routers/homebrew-campaign.ts` (plus any
other importers found by `code:intel dependents` — as of this audit there are
none). Mechanics:

1. Append the four schema + type pairs to the "Campaign linking inputs"
   section of `homebrew-inputs.ts` (after `:167`), each output directly after
   its input; extend the existing `./homebrew.js` import at `:4-8` with
   `homebrewCollectionWithAuthorSchema` and `homebrewEntrySchema`.
2. Delete `homebrew-campaign.ts` and collapse the router's two shared-schema
   import blocks (`routers/homebrew-campaign.ts:1-12`) into one from
   `@musi/shared/schemas/homebrew-inputs.js`.
3. Update `packages/shared/src/schemas/MODULE.md`: drop `homebrew-campaign.ts`
   from the unpaired-files list (`:92-97`) and from the no-colocated-test list
   (`:169-170`). The doc edit is in scope — the unpaired list exists to
   enumerate traps, and this change removes one.

## Scope / caveats

- The alternative direction (keep the file, rename and document a genuinely
  independent campaign-link boundary) is rejected: there is no independent
  vocabulary to document, so the fold is the agreed fix.
- Move the schemas verbatim — no shape changes.
  [194-generic-mutation-acknowledgment-hidden-under.md](./194-generic-mutation-acknowledgment-hidden-under.md)
  separately converges `linkCollectionOutputSchema`/`unlinkCollectionOutputSchema`
  (`homebrew-campaign.ts:5-9`) onto the canonical `successResponseSchema` from
  `auth.ts`. Either order works, but do not run the two concurrently: if 194
  lands first, this fold moves the converged imports instead of the local
  `z.object({ success: z.boolean() })` declarations; if this leaf lands first,
  194's homebrew edits target `homebrew-inputs.ts`.
- Prior pack: the 2026-07-25 pack's leaf 23 (via SHARED-CLUSTER-PLAN S1-S3)
  landed the MODULE.md conventions this leaf leans on — including the
  request-side output-placement rule — but left this output-only module intact
  and merely catalogued it as unpaired. Nothing there adjudicates this
  boundary, so folding it reopens no prior ruling.
- `packages/server/dist/` and `packages/shared/dist/` contain stale `.d.ts`
  references to the module; they are build artifacts, not importers to update.
