# 22. Three near-identical capped multi-select checkbox groups across homebrew background/class form fields

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-med · Size: S-M
Source: drift:ai near-duplicates + clone-candidates (drift-baseline, merged — same shape) · Confidence: med

## Problem
Three sibling components implement the identical "pick up to N abilities/skills, disable unchecked options once at the limit" capped multi-select checkbox group, hand-copied:

- `AbilityScoreCheckboxes` (background, max 3)
- `SkillProficiencyCheckboxes` (background, max 2)
- `SavingThrowCheckboxes` (class, max 2)

Each has a byte-for-byte `toggle()` — filters the item out on uncheck, appends only while `selected.length < MAX` — plus identical `checked`/`disabled` computation (`const disabled = !checked && selected.length >= MAX`) and identical `<label><input type="checkbox" ... className="h-4 w-4 rounded border-input"/>{item}</label>` markup. They differ ONLY in: label text + `(pick N)`, the options array, the max constant, the item type (`AbilityAbbreviation[]` vs `string[]`), and one layout class (`flex flex-wrap gap-3` vs `grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3`).

This clears the bar as a maintainability/dedup win: the cap-and-disable logic is the kind of detail that silently drifts between copies (e.g. someone fixes an off-by-one or a11y attribute in one and not the others). The repo already has an established home and convention for exactly this — `homebrew/shared/` presentation primitives (`HomebrewTextField`, `HomebrewCoreFields`), whose `MODULE.md` states "Two+ modules? It belongs here." Three consumers across two entity modules already exceed that threshold.

## Evidence
- `packages/client/src/components/homebrew/background/background-form-fields.tsx:21-61` — `AbilityScoreCheckboxes`: `toggle` at 28-34, `disabled` at 42, `flex flex-wrap` layout.
- `packages/client/src/components/homebrew/background/background-form-fields.tsx:63-103` — `SkillProficiencyCheckboxes`: `toggle` at 70-76, `disabled` at 84, `grid` layout.
- `packages/client/src/components/homebrew/class/class-form-fields.tsx:32-72` — `SavingThrowCheckboxes`: third copy; `toggle` at 39-45, `disabled` at 53, `flex flex-wrap` layout.
- `packages/client/src/components/homebrew/shared/MODULE.md:18-22` — "Two+ modules? It belongs here" rule + "presentation primitives shared across entity form bodies" scope; this primitive fits.
- `packages/client/src/components/homebrew/shared/homebrew-text-field.tsx:1-41` — convention to mirror: explicit `…Props` interface, `readonly` props, `onChange(value)`-style callback.
- Scope check: `rg -l 'selected\.length <' homebrew/ -g '*.tsx'` returns only these two files; subclass has 0 capped-multiselect groups; no fourth consumer exists. Other `type="checkbox"` callers (spell/species/monster/item/feat) are boolean toggles, NOT this pattern — leave them.

## Proposed fix
1. Add `packages/client/src/components/homebrew/shared/capped-checkbox-group.tsx` exporting a generic
   `CappedCheckboxGroup<T extends string>({ label, options, selected, max, onChange, layout }): ReactElement`
   where `options: readonly T[]`, `selected: T[]`, `onChange: (next: T[]) => void`, and `layout: "flex" | "grid"` (default `"flex"`) picks the wrapper class. Render `<Label>{label} (pick {max})</Label>` and the shared `toggle`/`checked`/`disabled` logic lifted verbatim from the current copies.
2. Replace `AbilityScoreCheckboxes` and `SkillProficiencyCheckboxes` in `background-form-fields.tsx` with `CappedCheckboxGroup` call sites (`layout="grid"` for skills) — keep the surrounding `<div className="space-y-2">…{fieldErrors.x}` error wrappers in `BackgroundFormFields` unchanged.
3. Replace `SavingThrowCheckboxes` in `class-form-fields.tsx` with a `CappedCheckboxGroup` call site; delete the now-dead local component and `SAVING_THROW_LIMIT` (inline `max={2}` or keep a local const).
4. Add `packages/client/src/components/homebrew/shared/capped-checkbox-group.test.tsx` (TDD-first per repo norm): asserts checking up to `max` works, that unchecked options become `disabled` at the limit, that re-clicking a checked option removes it (and re-enables others), and that `layout="grid"` vs `"flex"` selects the right wrapper class.
5. Trim the existing `background-form-fields.test.tsx` / `class-form-fields.test.tsx` cap-behavior assertions to integration smoke (the group's own behavior now lives in step 4's test); keep at least one wiring assertion per form so onChange plumbing stays covered.
6. Update `homebrew/shared/MODULE.md` "Public exports" to list `capped-checkbox-group.tsx`.

## Verification / caveats
- False-positive risk is low: this is a confirmed verbatim clone, not an incidental similarity.
- Generic boundary: `AbilityAbbreviation` is a string-literal union, so `T extends string` covers both the ability (`AbilityAbbreviation`) and skill (`string`) call sites without an `as`-cast. Double-check the background ability call site still types `onChange` as `(scores: AbilityAbbreviation[]) => void` end-to-end — instantiate `CappedCheckboxGroup<AbilityAbbreviation>` explicitly there if inference widens `T` to `string`.
- The two layouts are a real difference, not noise — preserve both via the `layout` prop; do not silently unify the skill grid into a flex row (it would change the rendered form).
- Keep the field-error `<div className="space-y-2">` wrappers and `{fieldErrors.*}` rendering OUTSIDE the new component (they live in the parent form bodies today and vary in presence); the primitive should stay error-display-free to match its narrow "presentation primitive" mandate.
- Pure refactor — no schema, validation (`buildBackgroundData`/`buildClassData`), or wire-format change; `verify:changed` (lint:changed, typecheck, test:changed) should be the gate.
