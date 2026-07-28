# 08. Client form primitives are re-invented per feature folder, and the generic ones are parked where they were first needed

Status: Open under [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slices
**F1 and F2**; the plan supersedes and shrinks this leaf (L→M). **Steps 6 and 7
are dropped permanently**; do not schedule the ~49-site form sweep or loose-root
regrouping from the `## Proposed direction` below.
Theme: Client form primitives and component placement · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/client` has no settled home for cross-feature form building blocks, so
two things happen repeatedly: each feature folder grows its own copy of a helper
that already exists next door, and any helper that *is* generic stays filed under
whichever feature folder happened to need it first.

At the JSX layer this produces three parallel "labeled field" abstractions —
`FormField` (`components/common/`), `HomebrewTextField` (`components/homebrew/shared/`)
and a page-local `PasswordField` (`pages/settings-page.tsx`) — plus roughly 49
hand-rolled `space-y-2` → `<Label>` → `<Input>` triples across 22 files. Only one
of the three carries the full accessibility contract: `FormField` sets
`aria-invalid`, `aria-describedby` and `role="alert"` on its error text;
`PasswordField` sets `role="alert"` but wires up neither `aria-*` attribute; and
`FormFieldError`, used by the homebrew fields, renders a bare `<p>` with no
`role="alert"` at all. So the same validation error is announced to a screen
reader in one form and silently rendered in another, and which behaviour you get
depends on which of the three copies the author happened to reach for.

At the data layer the same pattern produces something worse than duplication:
same-named helpers with *different contracts*. `str` is defined in nine homebrew
`*-form-data` files (eight bodies byte-identical). `numStr` is defined four times
with three different coercion behaviours. `parseStringArray` exists twice —
returning `string[]` in one directory and a comma-joined `string` in another. A
maintainer who reads one of these and assumes it means the same thing two folders
over will introduce a silent form-default bug.

Placement is the third face of the same cause. `DeleteConfirmDialog` is a fully
generic 55-line dialog living in `components/campaign/settings/`, imported by four
sibling panels and by nothing in `settings/` except its own test.
`pages/sheet-helpers.ts` (213 lines) is consumed only from inside
`pages/character-sheet/`. And three ungrouped components sit loose at the
`components/` root.

## Evidence

Three parallel labeled-field abstractions:

- `packages/client/src/components/common/form-field.tsx:19` — `FormField`, the only one with `aria-invalid` (`:48`), `aria-describedby` (`:49`) and `role="alert"` (`:53`). Imported by exactly two files: `src/pages/login-page.tsx`, `src/pages/register-page.tsx`.
- `packages/client/src/components/homebrew/shared/homebrew-text-field.tsx:17` — `HomebrewTextField`, imported by exactly one non-test file (`homebrew-core-fields.tsx`).
- `packages/client/src/components/homebrew/shared/form-field-error.tsx:7` — `FormFieldError` renders `<p className="text-sm text-destructive">` with no `role="alert"`; the a11y gap is real.
- `packages/client/src/pages/settings-page.tsx:34` — local `PasswordField`, a fourth copy of the same `space-y-2` / `Label` / `Input` triple; its error `<p>` has `role="alert"` but the `Input` gets no `aria-invalid` / `aria-describedby`. Three call sites at `:170-176`, `:177-183`, `:184-190`.
- Counts via `rg --multiline --count-matches 'className="space-y-2">\s*<Label' packages/client/src -g '*.tsx'`: **83 matches across 24 files**; extending the pattern to `…</Label>\s*<Input` narrows it to **51 across 22 files**, two of which are the abstractions themselves — so ~49 hand-rolled copies. The remaining ~32 labeled blocks pair `Label` with `Select`/`Textarea`/`Checkbox`.

Duplicated `*-form-data` helpers with divergent contracts:

- `function str(value: unknown): string` defined in nine files: `homebrew/subclass/subclass-form-data.ts:32`, `homebrew/species/species-form-data.ts:53`, `homebrew/magic-item/magic-item-form-data.ts:50`, `homebrew/item/item-form-data.ts:111`, `homebrew/background/background-form-data.ts:28`, `homebrew/class/class-form-data.ts:73`, `homebrew/monster/monster-form-data.ts:183` (param named `v`), `homebrew/spell/spell-form-data.ts:79`, `homebrew/feat/feat-form-fields.tsx:37`. Eight bodies are byte-identical (`return typeof value === "string" ? value : ""`).
- `numStr` defined four times with **three** behaviours: `class/class-form-data.ts:77` and `subclass/subclass-form-data.ts:36` accept number-or-string; `item/item-form-data.ts:77` accepts number only and drops strings; `monster/monster-form-data.ts:187` takes a required fallback argument (`numStr(v, fb)`).
- `parseStringArray` name collision: `background/background-form-data.ts:38` returns `string[]`; `class/class-form-data.ts:89` returns a **comma-joined `string`** (and drops empty entries). Same name, different return type, different semantics, two directories apart.
- Other local noise in the same family: `monster/monster-form-data.ts:81` `const Z = "0"` (used 15 times across 11 lines, five of them on `:226` alone), `:191` `spd(v)`, `:228` `const s = d as Record<string, unknown>`, `:253` `const o = d as Record<string, unknown>`.
- The sanctioned destination already exists and already has precedent: `homebrew/shared/caster-form-utils.ts` is imported by `class/class-form-data.ts:4` and `subclass/subclass-form-data.ts:4`, and `packages/client/src/components/homebrew/shared/MODULE.md:3` documents exactly that arrangement ("Utilities imported by more than one entity module").
- That destination has an **explicit admission threshold**, and it constrains what this leaf may hoist: `homebrew/shared/MODULE.md:20-21` — "One module? It belongs in that entity's folder, not here. Two+ modules? It belongs here. Current threshold is soft — land a helper where it's needed, promote when a second consumer appears." Consumer counts today (every one of these is a file-local, non-exported `function`): `str` 9 modules; the number-or-string `numStr` 2 (`class`, `subclass`, byte-identical bodies); the number-only `numStr` 1 (`item`); the fallback `numStr(v, fb)` 1 (`monster`); each `parseStringArray` 1 (`background`, `class`). Only `str` and the number-or-string `numStr` clear the threshold.

Placement:

- `packages/client/src/components/campaign/settings/delete-confirm-dialog.tsx` — 55 lines, `itemName`/`itemType` props, zero campaign coupling. Imported by `campaign/encounters/encounters-panel.tsx`, `campaign/maps/maps-panel.tsx`, `campaign/notes/notes-panel.tsx`, `campaign/npcs/npc-panel.tsx`, and by nothing inside `settings/` except its own test.
- `packages/client/src/components/common/` already holds the neutral primitives (`filter-select`, `form-field`, `paginated-result-list`, `loading-spinner`), i.e. the destination exists.
- `packages/client/src/pages/sheet-helpers.ts` — 213 lines, imported only by `pages/character-sheet/sheet-layout.tsx:14` and `pages/character-sheet/sheet-state.ts:28` (plus its own sibling test).
- `packages/client/src/components/` root holds three ungrouped components: `app-header.tsx`, `character-card.tsx`, `delete-character-dialog.tsx` (each with a sibling test).

## Proposed direction

Steps 1-4 are behaviour-free and can land in any order; step 5 is the one with
user-visible (a11y) effect and should be tested first.

1. **Hoist `str` into `homebrew/shared/`.** Add a `form-value-utils.ts` (or
   extend `caster-form-utils.ts`'s neighbourhood) exporting the single
   `str(value: unknown): string`, and delete the nine local copies listed above,
   including the `v`-parameter variant in `monster-form-data.ts:183`. This is the
   safest of the set: eight of nine bodies are already identical.

2. **Disambiguate the three `numStr` contracts by name; hoist only the one that
   has two consumers.** Do *not* collapse them (see caveats). Give each a name
   that states its coercion — e.g. `numOrStr` (`class-form-data.ts:77`,
   `subclass-form-data.ts:36`), `numOnly` (`item-form-data.ts:77`),
   `numWithFallback` (`monster-form-data.ts:187`). `numOrStr` has two consumers,
   so it moves next to `str` in `homebrew/shared/`. `numOnly` and
   `numWithFallback` have exactly one consumer each and **stay in their entity
   folder** — renaming them in place is the whole fix, per
   `homebrew/shared/MODULE.md:20` ("One module? It belongs in that entity's
   folder, not here"). Promote either one only if a second consumer appears.

3. **Break the `parseStringArray` name collision — rename in place, do not
   hoist.** Rename by contract: `background-form-data.ts:38` → something that
   says it returns a list (`parseStringList`), `class-form-data.ts:89` →
   something that says it joins (`parseStringListToText` / `joinStringList`).
   Both have a single consumer, so both stay in their own entity folder; moving
   them to `homebrew/shared/` would violate the same documented threshold. The
   defect here is two different contracts wearing one name, and the rename fixes
   it entirely.

4. **Move the misplaced files.** (a) `components/campaign/settings/delete-confirm-dialog.tsx`
   → `components/common/`, with its test, updating the four panel imports and
   amending `campaign/settings/MODULE.md:3`, whose scope sentence currently
   claims delete-confirmation UI lives in that folder.
   (b) `pages/sheet-helpers.ts` (and `sheet-helpers.test.ts`) → `pages/character-sheet/`,
   updating the two importers. Both are pure moves plus import rewrites; no
   runtime change.

5. **Consolidate onto one labeled-field primitive.** `HomebrewTextFieldProps`
   (`homebrew-text-field.tsx:7-15`) is a strict subset of `FormFieldProps` once
   `type="text"` is supplied, so delete `homebrew/shared/homebrew-text-field.tsx`,
   repoint `homebrew-core-fields.tsx:35` directly, and drop the now-dead export
   entry at `homebrew/shared/MODULE.md:13-14`.

   `PasswordField` is not a subset. `FormFieldProps` makes `placeholder` required
   (`form-field.tsx:11`) and always emits `name={name ?? id}` (`:40`);
   `PasswordField` renders neither, and its three call sites
   (`settings-page.tsx:170-176`, `:177-183`, `:184-190`) pass only `id`, `label`,
   `value`, `error`, `onChange`. So: make `placeholder` optional on
   `FormFieldProps` (every current caller already passes one, so this is
   additive) and add the omitted-placeholder case to `form-field.test.tsx`, then
   repoint the three call sites, passing `autoComplete="current-password"` /
   `"new-password"` while you are there. The `name` attribute those three fields
   gain defaults to their existing `id` — accept it and update selectors per the
   DOM caveat rather than adding an opt-out prop.

   Fix `FormFieldError` (`form-field-error.tsx:7`) to carry `role="alert"`. It
   still has `homebrew-textarea-field.tsx:5` as a consumer after this step, so it
   stays. Test the a11y contract (`aria-invalid`, `aria-describedby`,
   `role="alert"`) before moving any call site.

6. **Then, and only then, decide about the ~49 hand-rolled sites.** With one
   primitive that has the a11y contract, converting the ~49 Label→Input triples
   across 22 files is a mechanical follow-up. Treat it as its own commit series
   (a few files at a time), not part of step 5.

7. **Optional, low value:** group the three loose components at the
   `components/` root (`app-header.tsx`, `character-card.tsx`,
   `delete-character-dialog.tsx`) into folders, and/or split
   `pages/settings-page.tsx` (354 lines) into `components/account-settings/`.
   Both are file-size hygiene only — see caveats before spending effort here.

## Scope / caveats

- **This is not a codemod-scale finding.** The Label→Input triples number ~49
  across 22 files (51 matches including the two abstractions themselves); the raw
  `className="space-y-2"` string occurs 115 times in 47 files across the whole
  package, most of them not field triples. Size and sequencing here assume ~49.
- **One `Input`-shaped `FormField` cannot absorb everything.** Of the 83 labeled
  blocks, ~32 pair `Label` with `Select`, `Textarea` or `Checkbox`. "Promote
  `FormField`, delete the others, codemod the rest" covers the Input triples only;
  the rest needs a sibling primitive (or should be left alone). Do not widen
  `FormField` into a polymorphic control-renderer to close that gap.
- **`homebrew/shared/` has a documented admission threshold; this leaf does not
  get to relax it.** `MODULE.md:20-21` requires two or more consuming entity
  modules. Only `str` (9) and the number-or-string `numStr` (2) qualify. Do not
  hoist `numOnly`, `numWithFallback`, or either `parseStringArray` — each has a
  single consumer, renaming them in place is the complete fix, and moving a
  single-consumer helper into `shared/` violates that folder's own rule.
- **Do not hoist `FormFieldError` out of `homebrew/shared/`.** It looks generic
  (9 lines), but its only two consumers are its own folder siblings
  `homebrew-text-field.tsx:5` and `homebrew-textarea-field.tsx:5`, and it is
  documented in that folder's `MODULE.md:9`. It is correctly co-located; moving
  it would be speculative generality. The only defect there is the missing
  `role="alert"` (step 5).
- **Do not "break up" `components/campaign/settings/`.** Its scope is deliberate
  and documented at `packages/client/src/components/campaign/settings/MODULE.md:3`
  ("Campaign cards, creation, overview, settings, and delete confirmation UI lives
  here.") and `:5` ("Owns campaign-level create/update/delete entry points and
  overview shell."). Only `DeleteConfirmDialog` moves out — step 4a amends the
  `:3` sentence to match — and its four importers are sibling campaign panels.
- **`settings-page.tsx` is not a catch-all.** At 354 lines it is the largest page
  in `pages/`, but only 22% larger than `campaign-detail-page.tsx` (289) and in
  the same band as `collection-detail-page.tsx` (262) and `dashboard-page.tsx`
  (241); its three sections are ~68/~79/~60 lines of ordinary form JSX. Splitting
  it is optional hygiene, not a finding — do not let step 7 grow.
- **`numStr` is a correctness hazard, not a naming one.** The three variants
  differ in whether a string input is passed through, dropped, or replaced by a
  caller-supplied fallback. Collapsing them into one helper will silently change
  form default values in at least one homebrew editor. Keep them distinct and
  verify each call site against its current behaviour.
- Step 5 changes rendered DOM: added `aria-invalid` / `aria-describedby`
  attributes, error element ids, and a `name` attribute the old markup never
  emitted (`form-field.tsx:40` defaults it to `id`). If any e2e page object or
  test selector depends on the current markup of the homebrew or settings forms,
  update it per `docs/guides/add-e2e-test.md`.
- Any file move that changes a module's public exports needs its `MODULE.md`
  refreshed — see `docs/guides/add-module-doc.md`. Client feature-module
  conventions: `docs/guides/add-client-feature-module-cache-socket.md`. Removing
  the two `as Record<string, unknown>` casts in `monster-form-data.ts:228/:253`
  is out of scope here, but if you touch them, keep or add the
  `// type-assertion-boundary:` markers per `docs/guides/local-eslint-rules.md`
  and check `docs/guides/lint-ratchet.md` before changing suppression counts.
- Follow TDD: steps 1-3 are covered by the existing `*-form-data` tests; add the
  missing coverage for the `numStr` variants *before* moving or renaming them.
- **Size is L for steps 1-5 alone** (a 9-file hoist, two rename sweeps, two file
  moves with `MODULE.md` edits, and an a11y-affecting primitive consolidation
  with new tests). Step 6 — the ~49 hand-rolled Label→Input triples across 22
  files — is deliberately *not* counted in that estimate; schedule it as its own
  follow-up series once step 5 has landed, or the leaf becomes XL.
- No sequencing dependency on leaves 07 or 09 (07 is server-side; 09 is the map
  canvas store), and no file overlap with leaf 16 (it cites `notes-panel.tsx:239-240`
  only as a read-only `infiniteQueryOptions` precedent). **Leaves 13 and 14 do
  overlap and must be sequenced.** Leaf 14 step 3 renames locals *inside*
  `pages/sheet-helpers.ts` — the file step 4b moves — with evidence pinned at
  `:83-84`, `:88`, `:95`, `:111` and `:150`; land leaf 14's rename first, or do
  the move first and re-point leaf 14's evidence paths to
  `pages/character-sheet/sheet-helpers.ts`. Leaf 13 step 7 rewrites
  `notes-panel.tsx` and `npc-panel.tsx` onto new panel primitives, while step 4a
  here only rewrites their `DeleteConfirmDialog` import at `:10` in each; land
  step 4a first so leaf 13's rewrite carries the settled import path.
- Leaves 13, 14 and 16 propose similar extractions. Count the consumers before
  promoting any helper into a shared module — the same threshold applies there.
