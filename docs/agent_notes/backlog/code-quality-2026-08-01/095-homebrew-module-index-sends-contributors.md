# 95. The homebrew module index's add-entity recipe points contributors at a registry consumer and hides five of six shared helpers

Status: Landed on fix/cq-091
Theme: Parent index drift after module split · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/client/src/components/homebrew/MODULE.md` is the parent index for the
split homebrew module tree, and it duplicates details that the focused child
MODULE documents own — details that have since drifted. Its numbered "Adding a
new entity type" recipe tells contributors to add "one block + one registry
entry" to `entries/entry-dialog.tsx`, but the dialog is a *consumer* of the
registry: the one place that owns every homebrew entity editor binding is
`entries/entry-editor-registry.ts`, and the child `entries/MODULE.md` says so
explicitly. The index also inventories `shared/` as "currently:
`caster-form-utils.ts`" when the folder holds six helper files, all documented
in `shared/MODULE.md` — so the index both misdirects the registry edit on a
documented common task and hides five reusable helpers, inviting contributors
to reinvent them inside entity folders. A wrong step in an explicit numbered
recipe actively misleads the next person; volatile inventories copied into a
parent index will keep drifting every time a child changes.

## Evidence

- `packages/client/src/components/homebrew/MODULE.md:31` — recipe step 3: "Add
  one block + one registry entry to `entries/entry-dialog.tsx`." The registry
  lives elsewhere: `EDITOR_REGISTRY` is declared at
  `packages/client/src/components/homebrew/entries/entry-editor-registry.ts:162`,
  with its typed key map `EntryFormByType` at `:65`; `entry-dialog.tsx:24-29`
  only imports that registry's API (`EntryFormState`,
  `getDefaultEntryFormState`, `makeEntryFormState`, `withEntryHandler`).
- `packages/client/src/components/homebrew/entries/MODULE.md:11-17` — the
  focused child document routes the editor-registry work to the correct file:
  its add-an-entity steps send the import block, `EntryFormByType` key, and
  `EDITOR_REGISTRY` entry there. Its broader “one place” and “Nothing else
  changes” claims are false because presentation arrays remain elsewhere;
  [180-homebrew-entry-type-vocabulary-enumerated.md](./180-homebrew-entry-type-vocabulary-enumerated.md)
  owns that separate correction.
- `packages/client/src/components/homebrew/MODULE.md:21` — "`shared/` — helpers
  used by more than one entity (currently: `caster-form-utils.ts`)". The folder
  contains six non-test source files (`capped-checkbox-group.tsx`,
  `caster-form-utils.ts`, `form-field-error.tsx`, `form-value-utils.ts`,
  `homebrew-core-fields.tsx`, `homebrew-textarea-field.tsx`), each documented
  in `packages/client/src/components/homebrew/shared/MODULE.md:7-21`.
- `packages/client/src/components/homebrew/MODULE.md:25` — the flow line
  likewise credits `entry-dialog.tsx` with switching on entry type, with no
  mention of the registry that actually performs the dispatch.

## Proposed direction

Fix `packages/client/src/components/homebrew/MODULE.md`: point the add-entity
recipe's registry step at `entries/entry-editor-registry.ts` and replace the
stale `shared/` file inventory with a link to `shared/MODULE.md` instead of
duplicating child details. Concretely:

1. Rewrite recipe step 3 (`MODULE.md:31`) to send the registry edit to
   `entries/entry-editor-registry.ts` — or defer only the editor-registry
   portion to `entries/MODULE.md:13-17`, which lists the exact import, key, and
   registry edits and is compile-checked against each entity's `FormData`.
   Do not repeat the child recipe's “Nothing else changes” claim; leaf 180 owns
   the additional presentation-metadata step.
2. Drop the `(currently: `caster-form-utils.ts`)` parenthetical at
   `MODULE.md:21`; the line already links to `shared/MODULE.md`, which is the
   authoritative inventory.
3. While editing line 25, name `entry-editor-registry.ts` in the flow so the
   dispatch step matches the code.

The governing principle: the parent index owns layout and links; code and the
focused child MODULE documents stay authoritative for per-folder detail.

## Scope / caveats

- Doc-only; no source files change. Follow `docs/guides/add-module-doc.md` for
  MODULE.md conventions.
- `shared/MODULE.md` is correct and out of scope. The editor-registry portion
  of `entries/MODULE.md` is correct, but its broader entity-type checklist is
  owned by leaf 180; do not duplicate either child document's volatile details
  into the parent.
- The parallel entry-type registries themselves (selector list in
  `entry-dialog.tsx:31`, card labels, create/filter arrays vs the typed
  `EDITOR_REGISTRY`) are a separate code problem owned by
  [180-homebrew-entry-type-vocabulary-enumerated.md](./180-homebrew-entry-type-vocabulary-enumerated.md).
  If that leaf lands first and reshapes `entry-editor-registry.ts`, re-check
  that the recipe pointer written here still names the surviving registry file;
  no hard ordering otherwise.
- Prior pack: the landed 2026-07-25 client cluster (CQ25-117, do-not-reopen)
  refreshed the focused child modules and homebrew form helpers; this is
  residual parent-index drift it did not cover, not a reopen.
