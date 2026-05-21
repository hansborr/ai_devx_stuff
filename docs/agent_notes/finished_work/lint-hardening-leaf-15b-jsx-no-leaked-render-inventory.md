# Leaf 15b Inventory: react/jsx-no-leaked-render

Status: Resolved — verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-15b-jsx-no-leaked-render.
Throwaway config: /tmp/eslint-jsx-no-leaked-render.config.js
(not committed).

Scope: `packages/client/src/**/*.tsx`.

## Resolution

- Verdict: `react/jsx-no-leaked-render` **deferred** for this
  client source scope. The current probe still reports 87 findings
  across 38 files, with no count delta from the just-verified baseline.
- The sampled findings are React-safe guard idioms: JSX-attribute
  boolean expressions, nullable object/query guards, optional string
  guards, and child-position boolean/comparison guards. The sample did
  not surface an actual stray `0`/`NaN` render bug.
- No production code or eslint.config.js changes landed; the rule stays
  off. Enabling it now would require broad ternary/coercion churn or
  inline disables across accepted render guards without proving a real
  bug class in this client surface.
- No obvious 1-2 line bug-prevention rewrite fell out of the inventory.
  Potential follow-up should be a narrower local rule for bare numeric
  guards such as `{count && <X />}`, not promotion of this upstream rule
  as-is.

## Summary

- Total findings: 87 errors, 0 warnings.
- Files with findings: 38.
- Sample size: 35 findings across 13 files.
- attribute-boolean: 3
- string-array-length: 0
- nullable-object: 9
- truthy-string: 9
- actual-bug: 0
- other: 14

Sampled files:

- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-tracker.tsx`
- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx`
- `packages/client/src/components/campaign/npcs/monster-spellcasting-block.tsx`
- `packages/client/src/components/character-create/steps/proficiencies-step.tsx`
- `packages/client/src/components/compendium/magic-item-detail-dialog.tsx`
- `packages/client/src/components/sheet/cast-spell-dialog.tsx`
- `packages/client/src/components/sheet/inventory-item-row.tsx`
- `packages/client/src/components/sheet/level-up-dialog-body.tsx`
- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx`
- `packages/client/src/components/sheet/spell-detail-dialog.tsx`
- `packages/client/src/components/sheet/weapon-mastery-dialog.tsx`
- `packages/client/src/components/vtt/drawer/cast-rail.tsx`
- `packages/client/src/pages/campaigns-page.tsx`

Top offender files remain unchanged from the current baseline:

- `components/sheet/spell-detail-dialog.tsx`: 7
- `components/sheet/cast-spell-dialog.tsx`: 6
- `components/compendium/magic-item-detail-dialog.tsx`: 5
- `components/sheet/level-up-dialog-body.tsx`: 5
- `components/sheet/mobile-sheet-tabs.tsx`: 5
- `components/campaign/npcs/monster-detail-dialog.tsx`: 4
- `components/sheet/inventory-item-row.tsx`: 4
- `pages/campaigns-page.tsx`: 4

Config note: the final probe used the throwaway `/tmp` config requested
for this leaf:

```bash
bun run eslint --config /tmp/eslint-jsx-no-leaked-render.config.js \
  "packages/client/src/**/*.tsx"
```

The run reported 87 errors and 0 warnings, matching the expected
current total for this branch. The previous inventory also reported
87 findings, so this re-inventory records no total-count delta.

Plugin-option note: the installed `eslint-plugin-react` version is
7.37.5. `node_modules/eslint-plugin-react/lib/rules/jsx-no-leaked-render.js`
still defines exactly one schema property, `validStrategies`, whose
values are `["ternary", "coerce"]` with both enabled by default.
`additionalProperties: false` is set, and no `allowExpressions` option
exists for this rule.

Extrapolated distribution: the top files concentrate optional spell/item
strings, nullable detail/query objects, and safe UI state booleans.
Long-tail findings still include JSX-attribute boolean prop expressions.
The current sample suggests the full 87 are dominated by lint pressure
around React-safe guards, not by the rule's intended bare numeric render
leak. No sampled finding justified changing the prior defer verdict.

## Findings

### attribute-boolean

- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-tracker.tsx:83`
  — JSX prop expression; cannot render into children. Brief excerpt:

  ```tsx
  isCurrent={isActive && p.sortOrder === encounter.currentTurnIndex}
  ```

- `packages/client/src/components/sheet/weapon-mastery-dialog.tsx:74`
  — JSX prop expression; cannot render into children. Brief excerpt:

  ```tsx
  disabled={disabled && !selected}
  ```

- `packages/client/src/components/vtt/drawer/cast-rail.tsx:175` — JSX
  prop expression; cannot render into children. Brief excerpt:

  ```tsx
  canPlace={canCast && !flow.isDropping}
  ```

### string-array-length

No sampled finding used a bare `someArray.length && <X />` or
`someString.length && <X />` guard. Sampled length-adjacent sites used
explicit boolean comparisons such as `length > 0`, so they cannot render
`0`.

### nullable-object

- `packages/client/src/components/sheet/cast-spell-dialog.tsx:210` —
  optional metamagic data guards a selector. Brief excerpt:

  ```tsx
  {metamagics && metamagics.length > 0 && sorceryPoints !== undefined && (
  ```

- `packages/client/src/components/compendium/magic-item-detail-dialog.tsx:74`
  — `charges` is nullable object data. Brief excerpt:

  ```tsx
  {item.charges && <ChargesSection charges={item.charges} />}
  ```

- `packages/client/src/components/compendium/magic-item-detail-dialog.tsx:75`
  — `variants` is nullable/array data, not a number. Brief excerpt:

  ```tsx
  {item.variants && <VariantsSection variants={item.variants} />}
  ```

- `packages/client/src/components/compendium/magic-item-detail-dialog.tsx:126`
  — query result object guard. Brief excerpt:

  ```tsx
  {item && <MagicItemStatBlock item={item} />}
  ```

- `packages/client/src/components/sheet/level-up-dialog-body.tsx:73`
  — optional class-options data plus explicit count comparison. Brief
  excerpt:

  ```tsx
  {classOptions && enabledClassCount > 1 && (
  ```

- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:156` —
  optional spells tab data. Brief excerpt:

  ```tsx
  {props.spells && (
  ```

- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:230` —
  optional sorcery-points object plus explicit numeric comparisons. Brief
  excerpt:

  ```tsx
  {props.sorceryPoints &&
    props.sorcererLevel != null &&
    props.sorceryPoints.sorceryPointsMax > 0 && (
  ```

- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:190`
  — nullable legendary-action object. Brief excerpt:

  ```tsx
  {monster.legendaryActions && (
  ```

- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:260`
  — query result object guard. Brief excerpt:

  ```tsx
  {monster && <MonsterStatBlock monster={monster} onAdd={onAdd} />}
  ```

### truthy-string

- `packages/client/src/components/sheet/spell-detail-dialog.tsx:75` —
  optional spell text; `""` does not produce visible output. Brief
  excerpt:

  ```tsx
  {spell.higherLevel && (
  ```

- `packages/client/src/components/sheet/spell-detail-dialog.tsx:83` —
  optional damage-type text. Brief excerpt:

  ```tsx
  {spell.damageType && <span>Damage: {spell.damageType}</span>}
  ```

- `packages/client/src/components/sheet/spell-detail-dialog.tsx:85` —
  optional saving-throw text. Brief excerpt:

  ```tsx
  {spell.savingThrow && <span>{spell.savingThrow} save</span>}
  ```

- `packages/client/src/components/sheet/cast-spell-dialog.tsx:218` —
  optional spell text. Brief excerpt:

  ```tsx
  {spellData.higherLevel && (
  ```

- `packages/client/src/components/sheet/level-up-dialog-body.tsx:68` —
  optional validation/message text. Brief excerpt:

  ```tsx
  {cannotLeaveMessage && (
  ```

- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:164` —
  string ids used as presence guards; empty strings do not produce
  visible output. Brief excerpt:

  ```tsx
  {props.campaignId && props.currentUserId && (
  ```

- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:255` —
  same string-id presence guard for the tab panel. Brief excerpt:

  ```tsx
  {props.campaignId && props.currentUserId && (
  ```

- `packages/client/src/components/sheet/inventory-item-row.tsx:45` —
  optional item description. Brief excerpt:

  ```tsx
  {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
  ```

- `packages/client/src/components/campaign/npcs/monster-spellcasting-block.tsx:66`
  — optional spellcasting header text. Brief excerpt:

  ```tsx
  {monster.spellcastingHeaderText && (
  ```

### actual-bug

No sampled finding was an actual bug. The sample did not include a
child-position primitive numeric guard that could render `0` or `NaN`.

### other

These sampled findings are safe boolean flags, boolean comparisons, or
boolean-driven string suffixes. They are lint pressure only, not leaked
render bugs.

- `packages/client/src/components/sheet/spell-detail-dialog.tsx:66`
  — boolean union guard. Brief excerpt:

  ```tsx
  {(spell.concentration || spell.ritual) && (
  ```

- `packages/client/src/components/sheet/spell-detail-dialog.tsx:68`
  — boolean property guard. Brief excerpt:

  ```tsx
  {spell.concentration && <Badge variant="secondary">Concentration</Badge>}
  ```

- `packages/client/src/components/sheet/cast-spell-dialog.tsx:38` —
  boolean property guard. Brief excerpt:

  ```tsx
  {spell.concentration && <Badge variant="secondary">Concentration</Badge>}
  ```

- `packages/client/src/components/sheet/cast-spell-dialog.tsx:198` —
  local boolean display flag. Brief excerpt:

  ```tsx
  {showWarning && <ConcentrationWarning currentSpellName={currentConcentrationSpellName} />}
  ```

- `packages/client/src/components/compendium/magic-item-detail-dialog.tsx:114`
  — TanStack Query boolean state. Brief excerpt:

  ```tsx
  {itemQuery.isLoading && (
  ```

- `packages/client/src/components/sheet/level-up-dialog-body.tsx:80`
  — boolean flag plus explicit length comparison. Brief excerpt:

  ```tsx
  {needsSubclass && subclasses.length > 0 && (
  ```

- `packages/client/src/components/sheet/level-up-dialog-body.tsx:105`
  — boolean feature flag. Brief excerpt:

  ```tsx
  {needsMetamagic && (
  ```

- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:248`
  — TanStack Query boolean state. Brief excerpt:

  ```tsx
  {monsterQuery.isLoading && (
  ```

- `packages/client/src/components/sheet/inventory-item-row.tsx:177`
  — boolean item state. Brief excerpt:

  ```tsx
  {item.attuned && <Badge className="shrink-0 text-xs">Attuned</Badge>}
  ```

- `packages/client/src/components/sheet/inventory-item-row.tsx:190`
  — local boolean expansion state. Brief excerpt:

  ```tsx
  {expanded && (
  ```

- `packages/client/src/pages/campaigns-page.tsx:114` — TanStack Query
  boolean state. Brief excerpt:

  ```tsx
  {campaignsQuery.isLoading && <CampaignListSkeleton />}
  ```

- `packages/client/src/pages/campaigns-page.tsx:122` — derived boolean
  empty-state guard. Brief excerpt:

  ```tsx
  {isEmpty && (
  ```

- `packages/client/src/pages/campaigns-page.tsx:129` — derived boolean
  list guard. Brief excerpt:

  ```tsx
  {hasCampaigns && <CampaignList campaigns={campaigns} />}
  ```

- `packages/client/src/components/character-create/steps/proficiencies-step.tsx:126`
  — boolean-driven string suffix; false renders nothing. Brief excerpt:

  ```tsx
  {isBgSkill && " (background)"}
  ```

## Recommended next step

"Defer `react/jsx-no-leaked-render` for the client TSX scope — the fresh probe still reports 87 findings, the sampled sites are React-safe attribute, nullable-object, optional-string, and boolean/comparison guards with 0 actual leaked-render bugs, and eslint-plugin-react v7.37.5 still has no `allowExpressions` option to separate those patterns from bare numeric render leaks."

Revisit only if the upstream rule gains an option that can exempt safe
boolean/object/string expressions, or if a narrower local rule is proposed
for child-position bare numeric guards such as `{count && <X />}`.
