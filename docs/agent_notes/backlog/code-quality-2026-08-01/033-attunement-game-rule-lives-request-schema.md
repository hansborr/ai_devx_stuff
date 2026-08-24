# 33. The attunement limit — a game rule enforced by the server and displayed by two UIs — is declared in a request-schema module none of whose schemas use it

Status: Not started
Theme: rules constant placement · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MAX_ATTUNED_ITEMS = 3` is the 5E attunement rule: the server's inventory
service enforces it inside the create/update transactions, and both client
inventory surfaces render it as the "N/3 attuned" limit. But the constant is
declared in `packages/shared/src/schemas/inventory-inputs.ts`, sitting in a
run of request bounds (`MAX_QUANTITY`, `MAX_WEIGHT`, `MAX_SORT_ORDER`,
`DEFAULT_PAGE_SIZE`) — and unlike those, no schema in the file uses it.

The placement misleads twice. A reader of `inventory-inputs.ts` sees what
looks like an input-validation detail and has no signal it is the
authoritative game rule three production files depend on. Every production consumer — a server
service and two React components — must reach into a transport-contract module
for a rules value. All three already import request input types from that
module, so the defect is ownership and navigation rather than an
otherwise-absent module dependency. The shared schemas module's own
orientation doc says this exact value does not belong there: the directory
owns bounds "its own schemas are built from", while cross-domain rules
vocabulary goes in `../rules/` and is imported back.

The service header also promises more than its transaction provides. It says
the count and write share a transaction "so a concurrent attune can't slip
past the limit", although the implementation uses an ordinary
count-then-write transaction with no serialization mechanism. The repository's
concurrency policy deliberately accepts that theoretical race for this
single-writer, human-recoverable path; the defect is the contradictory
guarantee in the comment. Leaving it in place can teach future maintainers that
transactional grouping alone excludes concurrent writers and make the comment
an unsafe precedent for later invariant work.

## Evidence

Reproducible censuses used below:

- Importers: `git grep -n -E 'import .*MAX_ATTUNED_ITEMS|MAX_ATTUNED_ITEMS,' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages`.
- Request-bound declarations and uses: `git grep -n -E 'MAX_QUANTITY|MAX_WEIGHT|MAX_SORT_ORDER|DEFAULT_PAGE_SIZE|MAX_ATTUNED_ITEMS' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/shared/src/schemas/inventory-inputs.ts`.
- Rules-module inventory: `find packages/shared/src/rules -maxdepth 1 -type f -print | sort`.
- Service-doc zero-census: `test -z "$(git grep -n -E 'MAX_ATTUNED_ITEMS|schemas/inventory-inputs' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src/services/README.md 'packages/server/src/services/*MODULE.md' || true)"`.
- Service-test mentions: `git grep -n 'MAX_ATTUNED_ITEMS' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src/services/inventory-service.test.ts`.
- Current-pack coordination: `rg -l 'inventory-panel\.tsx' docs/agent_notes/backlog/code-quality-2026-08-01/[0-9][0-9][0-9]-*.md`.

- `packages/shared/src/schemas/inventory-inputs.ts:5-9` — `MAX_ATTUNED_ITEMS = 3`
  is the only export in a run of request bounds; the four names above it each
  feed schemas in the file, `MAX_ATTUNED_ITEMS` feeds none (its only occurrence
  in the file is the declaration at `:9`).
- `packages/server/src/services/inventory-service.ts:7` — the service imports it
  from `@musi/shared/schemas/inventory-inputs.js`; `:31-46` documents the
  "MAX_ATTUNED_ITEMS invariant" as the module's core contract; `:153-158` —
  `assertAttunementLimit` enforces it with a count-then-write and a
  `BAD_REQUEST`.
- `packages/client/src/components/sheet/inventory-panel.tsx:6` — the character
  sheet value-imports the constant from the request-schema module while also
  type-importing `CreateInventoryItemInput` and `UpdateInventoryItemInput` at
  `:2-5`; `:49` renders `{attunedCount}/{MAX_ATTUNED_ITEMS} attuned`.
- `packages/client/src/components/vtt/drawer/tabs/inventory-tab.tsx:3` — the
  second presentation surface value-imports the constant while also
  type-importing `UpdateInventoryItemInput` at `:2`; `:105` derives the
  overflow state and `:115` renders the limit.
- `packages/shared/src/schemas/inventory-inputs.test.ts:8,413-415` — the value
  pin ("is 3 per D&D 5E rules") lives in the schema suite, again tying a rules
  assertion to the transport module.
- `packages/shared/src/schemas/MODULE.md:17-28` — the module's ownership
  contract: it owns the bounds "its own schemas are built from"; a value "that
  several schema files or a rules helper must agree on" belongs in
  `../constants.ts`/`../rules/` instead. `MAX_ATTUNED_ITEMS` is built into no
  schema here, so the placement contradicts the module's own doc.
- `packages/server/src/services/inventory-service.ts:25-45` — the header says
  the transaction prevents a concurrent attune from slipping between the
  count and write, then describes the path as deliberately single-writer and
  outside the Pattern A/B/C gate.
- `packages/server/src/services/inventory-service.ts:143-159` —
  `assertAttunementLimit` performs a separate count and rejects only when that
  observed count has already reached the limit.
- `packages/server/src/services/inventory-service.ts:221-244` — create calls
  the count helper and then inserts inside a default callback transaction,
  without a lock, conditional write, or isolation-level option that would
  serialize competing transactions.
- `packages/server/src/services/inventory-service.ts:270-279` — update repeats
  the default count-then-write transaction shape when an unattuned item becomes
  attuned.
- `docs/CONCURRENCY.md:19-29` — the gate policy excludes single-writer paths and
  trivially recoverable mismatches; that is an accepted-risk judgment, not a
  claim that an ordinary transaction serializes the writers.

## Proposed direction

Agreed disposition, verbatim: "Move `MAX_ATTUNED_ITEMS` from
`packages/shared/src/schemas/inventory-inputs.ts` into an inventory
rules/vocabulary module under `packages/shared/src/rules/` and repoint
`inventory-service.ts`, `inventory-panel.tsx`, and `inventory-tab.tsx` in the
same commit (also refresh the MODULE-doc invariant note in inventory-service
if it cites the old location)."

Mechanics:

- No existing rules module owns inventory/attunement
  (`packages/shared/src/rules/` today: armor-class … xp), so add a small new
  file, e.g. `packages/shared/src/rules/attunement.ts`. The `./rules/*.js`
  wildcard export in `packages/shared/package.json` makes it importable as
  `@musi/shared/rules/attunement.js` with no package.json change; per
  `packages/shared/src/rules/MODULE.md:24-26`, a concept-owning file is
  preferred over widening an existing one.
- Delete the declaration at `inventory-inputs.ts:9` and repoint the four
  importers in the same commit — `inventory-service.ts:7`,
  `inventory-panel.tsx:6`, `inventory-tab.tsx:3`, and
  `inventory-inputs.test.ts:8`. Move the value-pin block
  (`inventory-inputs.test.ts:413-415`) into a colocated
  `rules/attunement.test.ts` rather than leaving a rules assertion in the
  schema suite.
- Correct the invariant header at `inventory-service.ts:31-45` in the same
  change. Replace the claim that the transaction prevents a concurrent attune
  from slipping past the limit with an explicit distinction: the transaction
  atomically groups each request's count and write, but does not exclude two
  transactions from observing the same available capacity. State that policy
  deliberately accepts this theoretical race because attunement is a
  single-writer, human-recoverable path. Retain the warning against promoting
  it to a CAS helper, but do not describe the current transaction as a
  concurrency guarantee. No separate `MODULE.md` or `README.md` cites the old
  constant location (verified by grep at the pin).
- Read `docs/guides/change-rules-logic.md` first (referenced by
  `rules/MODULE.md:5`); the move is value-preserving, so the guide's
  downstream-contract concerns reduce to keeping the relocated value pin and
  the existing service and UI behavior green.

## Scope / caveats

- The constant relocation is value-preserving: the value stays `3`, and no
  enforcement, transaction boundary, or UI behavior changes. The service
  header correction is documentation-only; do not alter
  `assertAttunementLimit`, add a compare-and-swap precondition, take a lock, or
  raise the transaction isolation level.
- Preserve the admission bar in `docs/CONCURRENCY.md`. In particular,
  [092-concurrency-rulebook-claims-three-exhaustive.md](./092-concurrency-rulebook-claims-three-exhaustive.md)
  corrects the guide's taxonomy around its existing narrow Serializable
  exception; it does not make this recoverable single-writer path eligible for
  Serializable isolation.
- Do not leave a re-export shim in `inventory-inputs.ts`; the point is that
  transport consumers stop being the constant's address. Repoint all four
  importers atomically instead.
- `packages/server/src/services/inventory-service.test.ts:15,113` mention the
  constant only in prose/describe names (no import) — no edit needed.
- Out of scope: any wider sweep of shared constant placement. The live
  2026-07-25 pack's leaf 21 (shared constants single-source) already landed
  the `constants.ts`-vs-`rules/` conventions this leaf follows; this is one
  straggler, not a re-open of that work. No prior-pack record separately covers
  the misleading concurrency claim.
- **Same-file coordination:**
  [027-condition-damage-modules-mix-contracts.md](./027-condition-damage-modules-mix-contracts.md)
  repoints an import in `inventory-service.ts`,
  [044-optimistic-writers-spread-transport.md](./044-optimistic-writers-spread-transport.md)
  edits `inventory-inputs.ts`. None changes the attunement rule, so there is no
  semantic ordering dependency, but avoid concurrent edits. No other leaf
  edits `inventory-panel.tsx`.
