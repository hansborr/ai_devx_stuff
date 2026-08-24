# 201. Let an imported homebrew collection receive a distinct visible name

Status: Not started
Theme: Import-time collection identity · Area: cross-cutting · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Re-importing an exported collection currently creates another card with the
same visible identity as the original. The copy retains the collection name
and description, is owned by the same importing user, and is forced private.
The cards therefore look alike closely enough that the E2E page object must
inspect their hidden route targets to find the copy.

The export envelope already makes `collection.name` an independently
validated field, and the server persists that value verbatim. The missing
piece is a client affordance for choosing the imported copy's name.

## Evidence

- `e2e/page-objects/homebrew.po.ts:50-78` — `openCollectionCopy` enumerates
  same-name links, reads each `href`, and excludes the original collection's
  path because the copy has no visible discriminator.
- `e2e/homebrew-sharing.spec.ts:21-27` — the round-trip scenario imports the
  file, expects two cards with the same name, then invokes that hidden-href
  workaround.
- `packages/client/src/components/homebrew/collections/import-collection-dialog.tsx:74-87`
  — submission parses the file envelope and passes `parsed.data` to the
  mutation unchanged.
- `packages/shared/src/schemas/homebrew-export.ts:57-68` — the envelope owns a
  separately validated `collection.name`, bounded by the existing homebrew
  name rules.
- `packages/server/src/services/homebrew-import-service.ts:38-47` — persistence
  creates a new collection with `name: input.collection.name` while clamping
  visibility to private.
- `packages/client/src/components/homebrew/collections/collection-card.tsx:68-120`
  — a card exposes the name, description, visibility, and author, but no
  import provenance or other copy identity.

## Proposed direction

In the import-collection dialog, show the parsed collection name in an
editable **Import as** field and submit a copied envelope carrying the edited
name. The server already persists the envelope name verbatim, so this is a
dialog-level change with no server or shared-schema work.

Parse and retain the validated envelope when a file is selected, prefill the
field from `collection.name`, and keep the Import button disabled until both
the file and editable name are valid. Before mutation, validate the copied
payload through the existing envelope schema:

`{ ...envelope, collection: { ...envelope.collection, name: importAs } }`.

Refresh the parsed envelope and editable name when the file changes, and reset
all four pieces of dialog state — file, local error, parsed envelope, and editable
name — when the dialog closes or an import succeeds.

Extend `import-collection-dialog.test.tsx` to prove that the parsed name is
shown, editing it changes only the submitted `collection.name`, and invalid
names do not invoke the mutation. Update the E2E page object so
`importCollection` fills **Import as**; have the round-trip scenario use a
distinct copy name and open it through the ordinary visible-name helper.
Delete `openCollectionCopy` if it still has no other caller.

## Scope / caveats

- Preserve the envelope version, description, entries, export timestamp, and
  server-side private-visibility clamp. Renaming must not rewrite exported
  entry names or cross-entry references.
- Do not add import-provenance columns, change the collection card, or create a
  general collection-renaming feature. This leaf only chooses the name of the
  newly imported collection.
- Keep the shared schema as the name-validation authority rather than adding a
  divergent client-only length or character policy.
