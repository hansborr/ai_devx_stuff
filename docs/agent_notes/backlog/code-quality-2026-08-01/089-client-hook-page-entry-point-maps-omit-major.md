# 89. The client hooks and pages entry-point maps hide most of their production surface and advertise a file-private component as importable

Status: Not started
Theme: module-doc entry-point completeness · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Reading the nearest `MODULE.md` before editing is mandatory in this repo, and
the External Entry Points section is the part a contributor uses first: it is
the advertised index of what the directory offers to the outside. For two large, high-traffic client directories that index is quietly partial, and the charter gives only a broad public/external scope, with no completeness
or derivation rule.

`packages/client/src/hooks/` is a 42-file production tree. Its `MODULE.md`
lists 18 entry points — and omits at least eight exports that non-test
production code imports from outside the directory today, including both app
bootstrap providers (`AuthProvider`, `SocketProvider`), the reconnect
invalidation seam (`useRealtimeInvalidationSubscription`), the dashboard's
action hook, and the map-layer persistence helpers. A contributor who trusts
the list concludes those seams do not exist here.

`packages/client/src/pages/MODULE.md` is worse in the other direction: it
names only two of the 13 route-facing Page exports, so most routes cannot be
discovered through the advertised index — while it *does* list `CampaignTabs`,
which is a file-private function. The one symbol a reader would try to import
from the list's least obvious row does not compile. The underlying defect is
shared: the charter (`docs/module-docs.md`) and authoring guide
(`docs/guides/add-module-doc.md`) broadly scope the section to public or
externally used entries but state no completeness rule or derivation recipe, so
each list is whatever its author happened to remember, and there is no
mechanical way to tell "deliberately curated" from "stale".

## Evidence

- `packages/client/src/hooks/MODULE.md:36-55` — the External Entry Points
  section: 18 names, no inclusion rule stated.
- 42 non-test `.ts`/`.tsx` files under `packages/client/src/hooks/` (measured:
  `find` excluding `*.test.*`/`*.spec.*`/test-helpers).
- Eight production-consumed exports absent from that list, each re-verified at
  the pin with a non-test consumer outside `hooks/`:
  - `AuthProvider` (`hooks/auth-context.tsx:90`) — consumed at
    `packages/client/src/lib/providers.tsx:4,17`.
  - `SocketProvider` (`hooks/socket-context.tsx:34`) — consumed at
    `packages/client/src/lib/providers.tsx:5,18`.
  - `useRealtimeInvalidationSubscription` (`hooks/realtime-invalidation.ts:35`)
    — consumed at
    `packages/client/src/components/campaign/chat/chat-panel.tsx:22,134`.
  - `useBackgroundImage` (`hooks/use-background-image.ts:11`) — consumed at
    `packages/client/src/components/campaign/maps/map-background-image.tsx:4,17`.
  - `useCharacterActions` (`hooks/use-character-actions.ts:27`) — consumed at
    `packages/client/src/pages/dashboard-page.tsx:12,198`.
  - `useMapLayerMutations` and `getLayerOfType`
    (`hooks/use-map-layer-mutations.ts:27,76`) — both consumed at
    `packages/client/src/components/campaign/maps/map-fog-actions.ts:12`.
  - `SRD_LOOKUP_FALLBACK` (`hooks/use-srd-lookups.ts:11`) — consumed at
    `packages/client/src/components/sheet/sheet-header.tsx:5,26` and
    `components/sheet/level-up-helpers.tsx`.
- `packages/client/src/pages/MODULE.md:69-76` — five rows total; only
  `CharacterSheetPage` and `CampaignDetailPage` are route-page exports.
- 13 non-test top-level `*-page.tsx` files exist (measured), every one imported
  by a route module under `packages/client/src/routes/` (five static imports,
  eight `lazyRouteComponent` imports). The 11 absent: `CampaignsPage`,
  `CharacterCreatePage`, `CollectionDetailPage`, `DashboardPage`,
  `HomebrewPage`, `JoinPage`, `LegalPage`, `LoginPage`, `MagicItemsPage`,
  `RegisterPage`, `SettingsPage`.
- `packages/client/src/pages/campaign-detail-page.tsx:123` —
  `function CampaignTabs(` with no `export`; the "external entry point" at
  `pages/MODULE.md:75` is file-private. The same doc already documents its real
  role — composition root — at `pages/MODULE.md:26-28` and `:57-64`.
- `docs/module-docs.md:43-44` — the charter bullet defines the section only as
  "public hooks, facades, components, router calls, or imports used from
  outside the directory"; `docs/guides/add-module-doc.md:30-32` (step 9) adds
  only "avoid documenting private helper files". Both imply a public/non-private boundary, but neither states a completeness
  requirement or gives a derivation recipe.

## Proposed direction

Document a stable inclusion rule rather than build a new generator, then apply
it to the two directories. Three ordered parts; the rule lands first so the two
rewrites are its first applications and can cite it.

1. **Tighten the charter and guide to a checkable rule.** Amend the External
   Entry Points bullet in `docs/module-docs.md:43-44` and step 9 of
   `docs/guides/add-module-doc.md:30-32`: the section must list every export of
   the directory that non-test production code imports from outside it — or
   explicitly declare a narrower scope in the section itself; it must never
   name file-private symbols; internal composition landmarks belong in Data
   Flow. Record the mechanical derivation recipe in the guide so future audits
   and outside readers can reproduce an inventory: a fixed-string
   `git grep -Fln "<symbol>" -- 'packages/client/src' ':(exclude)*.test.*' ':(exclude)<dir>'`
   per candidate symbol, or `bun run code:intel -- exports <file>` plus
   `bun run code:intel -- dependents <file> --exclude-tests` (both verified
   runnable at the pin). Before landing wording changes, confirm nothing
   generated consumes the section wording — verified at the pin:
   `scripts/generate-module-index.sh` parses only H1/`Concepts:` lines and
   links to `docs/module-docs.md` (line 40) without reading its text.
2. **Rewrite the hooks inventory to completeness under that rule.** Re-derive
   the full externally-consumed export set of `packages/client/src/hooks/` at
   landing time (do not copy the list above verbatim — see sequencing), adding
   at minimum the eight verified omissions. Keep the section scannable:
   grouped, one line per entry, scoped to externally-consumed exports — not an
   export dump.
3. **Rewrite the pages inventory the same way.** Name all 13 route-facing Page
   exports (the current set: campaign-detail, campaigns, character-create,
   character-sheet, collection-detail, dashboard, homebrew, join, legal, login,
   magic-items, register, settings), stating the inclusion rule inline. Demote
   `CampaignTabs` to the Data Flow "composition root" role it already holds at
   `pages/MODULE.md:26-28` and `:57-64` — relocate the claim, do not delete it
   and do not export the function. Either drop the `../lib/campaign-tabs.ts`
   row or explicitly label it a cross-directory contract, since it is not an
   export of this directory. `CharacterSheetContent` keeps its row only under a
   declared scope: its sole non-test consumer is
   `packages/client/src/pages/character-sheet-page.tsx:8` — outside
   `pages/character-sheet/` but inside `pages/` — so under the strict
   directory-level rule it is an internal landmark; verify with `code:intel`
   at landing time like every other row and either declare the
   subdirectory-level scope in the section or move it to Data Flow.

Both rewrites are refreshes that likely leave the H1 and `Concepts:` lines
unchanged, so the expected index step is `bun run module:index:check` (not a
regenerate-and-commit), per `docs/guides/add-module-doc.md` step 13. Each
landed list should be provable by the recipe itself: the same fixed-string
`git grep` run shows every listed symbol has a non-test consumer outside the
directory and that no listed symbol is file-private.

## Scope / caveats

- **Out of scope:** exporting `CampaignTabs` or any other code change that
  makes the doc true by moving the code; sweeping other `MODULE.md` files
  repo-wide for the same defect (the rule makes them fixable opportunistically
  as they are touched); building a drift-checking generator for entry-point
  sections — note it in the charter change only as an optional follow-up,
  citing the `module:index` generator as precedent.
- **Bloat risk:** a completeness rule applied naively turns the section into a
  churn-prone export dump that contradicts the charter's "short enough to
  scan" rule (`docs/guides/add-module-doc.md` step 12). The rule is scoped to
  externally-consumed exports, not all exports, and rewrites must keep
  grouping and one-line descriptions.
- **Staleness risk:** hand-derived inventories go stale the moment exports
  change; the derivation recipe written into the guide (part 1) is what keeps
  the fix from silently reverting to today's partial-list state. Do not land
  parts 2-3 without part 1.
- **Over-correction risk:** doc-accuracy fixes tend to invert on later rounds.
  `CampaignTabs` is a real composition root worth documenting — relocate the
  mention, never delete it outright, and never "fix" the doc by exporting the
  symbol.
- **Sequencing (soft edges only):** the dead-code removals in
  [061-rollmodetoggle-complete-production-orphan.md](061-rollmodetoggle-complete-production-orphan.md)
  and
  [062-character-key-hook-constructs-three-filter.md](062-character-key-hook-constructs-three-filter.md)
  can shrink the client's production-consumer set, so parts 2-3 must re-derive
  their lists against the tree at landing time rather than trusting this
  leaf's enumeration; no hard dependency in either direction. Internally, part
  1 lands before parts 2-3.
- No prior-pack leaf covers this surface.
