# 31. spells-by-level grouping (and the EmptyState/ErrorState list cards) duplicated across client components/pages

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-low · Size: S-M
Source: drift:ai near-duplicates-2 (drift-baseline) · Confidence: med

## Problem
Two presentational patterns are copy-pasted across the client.

(1) **Spells-by-level grouping** — the same `Map<number, CharacterSpellWithDetails[]>` accumulation appears three times, byte-identical except for the param name and a `readonly` modifier:
- `spells-panel.tsx` `groupByLevel` (param `s`, mutable array)
- `actions-tab-spells.tsx` `groupSpellsByLevel` (param `spell`, `readonly` array)
- `spells-tab.tsx` `groupSpellsByLevel` (param `s`, `readonly` array)

The body is identical in all three:
```ts
const groups = new Map<number, CharacterSpellWithDetails[]>();
for (const x of spells) {
  const level = x.spell.level;
  const group = groups.get(level) ?? [];
  group.push(x);
  groups.set(level, group);
}
return groups;
```
This is a pure, side-effect-free helper with no per-call divergence — a clean, high-confidence dedup. All three files already import from `components/sheet/spellcasting-constants.ts` (for `SPELL_LEVEL_LABELS`), so a shared home already exists in their import graph.

(2) **EmptyState / ErrorState list cards** — the `<Card><CardContent className="py-8 text-center">…</CardContent></Card>` error/empty skeletons are re-declared per list page. The `ErrorState` cards are identical except for one noun ("collections" / "campaigns" / "entries"); the `EmptyState` cards differ only in icon presence, title/description copy, and button label. This is lower-confidence dedup — the per-page copy is intentional and some pages may want bespoke states (see caveats).

## Evidence
- `packages/client/src/components/sheet/spells-panel.tsx:31-42` — `groupByLevel` Map accumulation.
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx:54-65` — `groupSpellsByLevel`, identical logic (`readonly` param).
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx:64-75` — `groupSpellsByLevel`, identical logic (`readonly` param).
- `packages/client/src/components/sheet/spellcasting-constants.ts:1-14` — existing shared spell-presentational module (`.ts`), natural home for the util.
- `packages/client/src/pages/homebrew-page.tsx:26-37` (`ErrorState`), `39-55` (`EmptyState`) — state cards.
- `packages/client/src/pages/campaigns-page.tsx:25-36` (`ErrorState`), `38-52` (`EmptyState`) — error card differs only by noun "campaigns"; empty card has no icon.
- `packages/client/src/pages/collection-detail-page.tsx:63-79` (`EmptyState`), `92-105` (inline error card in `EntryQueryContent`) — error card differs only by noun "entries".

## Proposed fix
Part (1) — high confidence, do this:
1. Add `export function groupSpellsByLevel(spells: readonly CharacterSpellWithDetails[]): Map<number, CharacterSpellWithDetails[]>` to `packages/client/src/components/sheet/spellcasting-constants.ts` (keep the `readonly` param signature; it accepts both the mutable and readonly call sites). The file is `.ts` and JSX-free — the util is pure, so this is fine.
2. Replace the three local functions: import the util in `spells-panel.tsx` (drop local `groupByLevel`, update its one call site at the `useMemo`), `actions-tab-spells.tsx`, and `spells-tab.tsx` (drop both local `groupSpellsByLevel` defs).
3. TDD: add a focused unit test for `groupSpellsByLevel` (empty input → empty Map; preserves insertion order within a level; groups by `spell.level`). The three component tests (`spells-panel.test.tsx`, and the drawer-tab tests) already cover the rendered output and should stay green unchanged.

Part (2) — lower confidence, gate behind a divergence check:
4. If pursued, lift `<ErrorState message onRetry/>` and `<EmptyState icon title description actionLabel onAction/>` into a shared `components/ui/` module (e.g. `list-state-cards.tsx`), and pass only the differing props from each page. The collection-detail error path is inline inside `EntryQueryContent` (not a named component) — extract it too.
5. TDD: add render tests for the new shared components; update the three page tests if any assert on the exact card markup.

## Verification / caveats
- Part (1) false-positive risk is low: the three bodies are mechanically identical and the helper is pure. Double-check the `readonly` signature compiles at `spells-panel.tsx` where the source array (`filteredSpells`) is mutable — `readonly` params accept mutable args, so no cast needed.
- Part (2) is the medium-risk half flagged by the audit: the per-page state cards are *intentionally* divergent copy. Before merging, confirm no page wants a bespoke state (e.g. different layout, extra CTA). If divergence is genuine product copy rather than accidental duplication, leave the cards per-page and ship only Part (1). Do not force a shared component if it makes the call sites harder to read than the current 10-line inline cards.
- Scope is client-only, presentational. No schema, server, or socket impact. Run `bun run verify:changed` after staging.
- Parallel-review verdict (Codex): ship **Part (1) only**. Treat Part (2) (the
  EmptyState/ErrorState cards) as out of scope unless doing a deliberate, broader UI
  pass — similar state cards exist elsewhere, so a narrow 3-page extraction is not
  clearly a win.
