# drift:ai Current Findings

Source report: `reports/drift-ai/current.json`

Invocation reviewed:

```bash
bun run drift:ai --scope current --format json --output reports/drift-ai/current.json --chunk-dir reports/drift-ai/current-chunks --chunk-size 75
```

## Summary

The current-scope run scanned 1476 files and reported 18 findings:

- 12 duplicate ranges.
- 6 ghost-file pairs.
- 0 comment findings.

The duplicate findings include real follow-up work. The ghost-file findings do
not point to code problems in the reported pairs, but they are actionable as a
detector-tuning issue if current-scope reports are expected to stay clean.

## Follow-ups

### 1. Tune current-scope ghost-file reporting

Files:

- `scripts/drift-ai/ghost-files.ts`
- `drift-ai.config.json`
- Reported pairs:
  - `packages/client/src/components/campaign/maps/map-canvas-helpers.ts`
  - `packages/client/src/pages/join-page.tsx`
  - `packages/client/src/routes/join-route.ts`
  - `packages/client/src/test/mock-trpc-helpers.ts`
  - `packages/server/src/services/character-create-helpers.ts`
  - `packages/server/src/utils/map-helpers.ts`

Problem:

The reported ghost-file pairs are intentional modules. The helper/type files are
imported by their owning modules or callers, and the join/login route/page pairs
represent different auth flows. The detector interface is useful for changed
scope, where a new sibling file may be accidental, but current scope is applying
the same weak-suffix and near-edit-distance heuristics across established
intentional siblings.

Solution:

Keep changed-scope behavior strict, but make current-scope ghost-file findings
harder to trigger or explicitly allowlisted. Options include a current-only
known-pair allowlist, a rule that suppresses `*-helpers` and `*-types` when one
module imports the other, or a separate current-inventory mode that reports
these as low-priority review candidates instead of warnings.

Benefits:

Current reports become higher-signal, and agents can trust a clean scan without
having to manually re-triage stable helper splits every time.

### 2. Share map token mutation side effects

Files:

- `packages/client/src/components/campaign/combat/combat-map-mutations.ts:9`
- `packages/client/src/components/campaign/maps/map-detail-mutations.ts:9`

Problem:

Both files define a `useTokenMutations(mapId)` module with the same update,
move, and remove mutations, the same map invalidation behavior, the same toast
messages, and the same selected-token clearing behavior. The map-detail version
also adds create. This is shared behavior behind two interfaces, so a toast,
invalidation, or selection fix can drift.

Solution:

Move the token mutation implementation to one map-token mutation module that
returns create/update/move/remove. The combat path can consume the shared module
and expose only the subset it needs if the narrower interface is useful.

Benefits:

The token mutation implementation has one locality point. Tests for map detail
and combat map flows would exercise the same mutation side effects instead of
pinning two copies.

### 3. Extract the debounced cursor-list module used by monster and magic item search

Files:

- `packages/client/src/components/campaign/npcs/monster-tab.tsx:91`
- `packages/client/src/components/campaign/npcs/monster-tab.tsx:325`
- `packages/client/src/components/compendium/magic-item-list.tsx:60`
- `packages/client/src/components/compendium/magic-item-list.tsx:249`
- Existing related module: `packages/client/src/components/sheet/filter-select.tsx`

Problem:

Monster and magic-item lists duplicate the same filter select shape, debounced
search state, cursor reset, accumulated pages, result concatenation, and load
more behavior. The row rendering and list input schemas are domain-specific,
but the pagination/control implementation is the same. Both modules also reset
cursor and accumulated state during render when the filter key changes.

Solution:

Keep row/detail modules local, but extract a small hook for debounced search
plus cursor accumulation and a shared filter-select module with "all" value
semantics. The hook interface should accept the current filter input and expose
`cursor`, `results`, `nextCursor`, and `loadMore`, while callers continue to own
their tRPC query options and item rendering.

Benefits:

Filtering and paging behavior becomes testable through one interface. Future
compendium-style lists get leverage without copying the render-time reset
pattern.

### 4. Consolidate campaign test context setup

Files:

- `packages/server/src/test/map-test-helper.ts:20`
- `packages/server/src/test/npc-test-helper.ts:34`
- `packages/server/src/test/note-test-helper.ts:32`
- Related repeated shapes: `packages/server/src/test/chat-test-helper.ts:23`,
  `packages/server/src/test/encounter-test-helper.ts:22`

Problem:

Map, NPC, and note helpers repeat the same clean database, DM user, player user,
login, campaign creation, campaign member creation, and returned context fields.
Chat and encounter helpers repeat nearby variants. A change to auth setup,
campaign defaults, member creation, or returned IDs has to be updated across
several test modules.

Solution:

Introduce a server test helper that creates a campaign test context with a DM
and configurable player members. Domain helpers should compose that module and
then add map/NPC/note/encounter-specific factories.

Benefits:

Auth and membership setup has one implementation and one test surface. Feature
tests keep their domain-specific helpers, but campaign boilerplate stops
spreading.

### 5. Share token dialog field and validation primitives

Files:

- `packages/client/src/components/campaign/tokens/add-token-dialog.tsx:48`
- `packages/client/src/components/campaign/tokens/add-token-dialog.tsx:82`
- `packages/client/src/components/campaign/tokens/add-token-dialog.tsx:207`
- `packages/client/src/components/campaign/tokens/edit-token-dialog.tsx:35`
- `packages/client/src/components/campaign/tokens/edit-token-dialog.tsx:54`
- `packages/client/src/components/campaign/tokens/edit-token-dialog.tsx:74`

Problem:

Add and edit token dialogs duplicate the palette, label/color/size fields, size
parsing, and max-size validation. They intentionally differ on position/type
fields versus visibility/bounds checks, but the shared appearance and size
implementation can drift.

Solution:

Create a token form module for palette constants, appearance fields, size
fields, and size parsing. Keep add-only position/type handling and edit-only
visibility/bounds handling in the dialog modules.

Benefits:

Token form behavior gains locality while each dialog keeps a narrow interface
for its own workflow.

### 6. Add a character-creation selectable-card module

Files:

- `packages/client/src/components/character-create/steps/species-step.tsx:51`
- `packages/client/src/components/character-create/steps/species-step.tsx:97`
- `packages/client/src/components/character-create/steps/class-step.tsx:23`
- `packages/client/src/components/character-create/steps/background-card.tsx:18`
- `packages/client/src/components/character-create/steps/equipment-step.tsx:43`

Problem:

The species finding is one instance of a broader repeated selectable-card
pattern: selected styling, keyboard activation, `aria-pressed` or
`aria-checked`, and click handling. Accessibility fixes or design changes need
to be copied across wizard steps.

Solution:

Add a character-create selectable-card module that owns the keyboard and
selected-state interface. Let callers provide header/body content and choose the
semantic role where needed.

Benefits:

The wizard gains a deeper selection-card module with one accessibility test
surface and consistent selected-state behavior.

### 7. Share the rollable sheet row shell

Files:

- `packages/client/src/components/sheet/saving-throws.tsx:20`
- `packages/client/src/components/sheet/skills-list.tsx:31`

Problem:

Saving throw and skill rows duplicate the same optional `RollContextMenu`
wrapper, non-roll fallback, row classes, formatted modifier placement, and test
ID structure. Their math and proficiency labels differ, but the row shell is
shared implementation.

Solution:

Create a `RollableModifierRow`-style module that accepts leading content,
modifier, test id, notation, label, and roll aria label. Keep save/skill math
and proficiency mapping in the current modules.

Benefits:

Roll affordance and keyboard/touch behavior have one implementation while the
rules-specific interfaces stay local.

### 8. Consolidate shared-schema codemod engine pieces

> **DONE** (`8454fab4`, drain leaf 4.9) — the trpc-shared input/output codemods
> now share a common engine (CLI parsing, candidate validation, shared-import
> insertion, export append, router rewrite), keeping input/output-specific
> discovery and tests.

Files:

- `scripts/codemods/trpc-shared-input.ts:12`
- `scripts/codemods/trpc-shared-input.ts:400`
- `scripts/codemods/trpc-shared-output.ts:11`
- `scripts/codemods/trpc-shared-output.ts:380`
- Existing shared module: `scripts/codemods/lib/trpc-shared-schema.ts`

Problem:

The input and output codemods already share lower-level helpers, but still
duplicate CLI parsing shape, candidate validation, shared import insertion,
export append, and router rewrite structure. Some differences are intentional,
such as `--all` for output and output dependency removal, but the surrounding
implementation is parallel enough that fixes can drift.

Solution:

Extract a small codemod engine that accepts the procedure method, schema suffix,
supported modes, candidate reference validator, and router dependency-removal
policy. Keep input/output-specific discovery and tests.

Benefits:

The codemods keep their separate interfaces while the shared migration
implementation has better locality.

### 9. Consider focused homebrew form field primitives

Files:

- `packages/client/src/components/homebrew/background/background-form-fields.tsx:147`
- `packages/client/src/components/homebrew/feat/feat-form-fields.tsx:127`
- Related existing module: `packages/client/src/components/common/form-field.tsx`

Problem:

The background/feat duplicate is part of a wider homebrew form pattern: label,
input or textarea, `fieldErrors`, and update-patch glue repeat across entry
editors. The existing `FormField` module covers a narrower auth-form interface
and does not cover textarea/select/checkbox homebrew fields.

Solution:

Do not extract a generic form framework. Add focused field primitives for
homebrew text, textarea, and checkbox/select rows only where they remove real
duplication and preserve clear caller-owned form state.

Benefits:

Homebrew form error rendering and accessibility can improve through one module
without forcing every editor through a shallow, over-general interface.

## Non-Issues From This Run

- `map-canvas-helpers.ts` is an intentional helper module used by
  `map-canvas.tsx`; `map-canvas.tsx` is the public map canvas module used by
  combat and map detail content.
- `join-page.tsx` / `login-page.tsx` and `join-route.ts` / `login-route.ts` are
  distinct auth flows, not accidental siblings.
- `mock-trpc-helpers.ts` is an intentional helper module used by the main mock
  factory and specialized mock builders.
- `character-create-helpers.ts` is an intentional implementation split for
  nested character create data; it is imported by `character-create.ts` and has
  direct tests.
- `map-helpers.ts` / `map-types.ts` is an intentional implementation/type split.

## Suggested Order

1. Tune current-scope ghost-file reporting if the goal is a clean current drift
   report.
2. Consolidate token mutations or campaign test context setup next; both are
   small, high-locality changes.
3. Handle the UI modules opportunistically when touching the relevant user
   flows.
