# 195. Validate per-type homebrew payloads in the editor before sending mutations

Status: Not started
Theme: Pre-submit homebrew validation · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The homebrew editor builds type-specific data but validates only the opaque create/update envelope before sending it. Invalid spell, monster, class, item, or other concrete data therefore reaches the server before the shared per-type schema runs.

The server returns a detailed `Invalid <type> data` error, but the dialog discards that detail and renders a generic retry message. Authors incur a round trip and receive no field-level guidance even though the shared validator, field-error formatter, and form plumbing already exist.

## Evidence

- `packages/shared/src/schemas/homebrew.ts:223-255` exports an exhaustive nine-entry `HOMEBREW_DATA_SCHEMAS` registry and `validateHomebrewData(type, data)`.
- `packages/shared/src/schemas/homebrew-inputs.ts:64-99` deliberately keeps create/update `data` as an opaque string-keyed record, so parsing those outer schemas cannot validate the selected entry type's fields.
- `packages/client/src/components/homebrew/entries/entry-editor-registry.ts:65-85` correlates every `HomebrewEntryType` with its form data, builder, and component, including the existing `fieldErrors` prop.
- `packages/client/src/components/homebrew/entries/entry-dialog.tsx:176-200` builds concrete data but runs only `createEntryInputSchema.safeParse` or `updateEntryInputSchema.safeParse` before calling the mutation.
- `packages/client/src/components/homebrew/entries/entry-dialog.tsx:166`, `:188-197`, and `:212-216` already maintain a `fieldErrors` map, populate it through `formatFieldErrors`, and pass it into the active editor.
- `packages/client/src/lib/format-field-errors.ts:6-14` converts validation issues into the existing first-error-per-top-level-field map.
- The server performs authoritative per-type validation and includes the Zod detail in its error at `packages/server/src/routers/homebrew.ts:237-250` for creation and `:318-328` for updates.
- The dialog reduces any mutation rejection to “Failed to save entry. Please try again” at `packages/client/src/components/homebrew/entries/entry-dialog.tsx:217-220`.

## Proposed direction

In `entry-dialog.tsx`'s `handleSubmit`, run `validateHomebrewData(entryType, data)` immediately after the active editor builds `data` and before either outer input parse. If concrete validation fails, feed `validation.error.issues` through `formatFieldErrors`, call `setFieldErrors`, and return without invoking a mutation.

On success, pass `validation.data`—not the unparsed builder output—into `createEntryInputSchema` or `updateEntryInputSchema`. This follows the shared validator's security contract at `packages/shared/src/schemas/homebrew.ts:240-255`, which strips unknown keys and tells callers to use the parsed value.

Keep the server calls to `validateHomebrewData` unchanged as the authoritative trust boundary.

Add dialog tests covering create and edit submission, with at least one failing field for representative simple and complex entry types such as feat, spell, and monster or magic item. Each test should prove that the field message renders and the mutation is not called; retain a valid submission case proving the parsed payload still reaches the mutation.

## Scope / caveats

- Do not replace the opaque wire envelope with a large discriminated union. The decision is documented at `packages/shared/src/schemas/homebrew-inputs.ts:69-75` and `packages/shared/src/schemas/homebrew.ts:289-295`; the previous [24-homebrew-registry-typing.md](../code-quality-2026-07-25/24-homebrew-registry-typing.md) explicitly preserved it.
- Client validation supplements rather than replaces server validation. Requests outside this dialog must still be rejected authoritatively by the router.
- `formatFieldErrors` currently collapses nested issue paths to their first segment (`packages/client/src/lib/format-field-errors.ts:6-14`). Keep this leaf on the existing convention and choose representative failures whose top-level keys are already rendered by their forms; redesigning nested error-key syntax is separate work.
- Do not expose raw server/Zod messages through the generic mutation-error paragraph as a substitute for pre-submit field feedback.
- No database, router contract, editor-registry, or homebrew-entry-type vocabulary change is required.
