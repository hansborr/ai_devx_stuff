# Leaf 13 Pass 1 - eslint-plugin-react Correctness Inventory

Pass date: 2026-05-16

Probe config was temporary only: `eslint-plugin-react` was enabled at `warn`
for `packages/client/**/*.tsx` with the six requested correctness candidates.
The probe log is `/tmp/leaf13-pass1-lint.log`.

## Plugin Version

`eslint-plugin-react@7.37.5`, resolved from
`node_modules/eslint-plugin-react/package.json`.

## Total Warning Count

95 warnings.

## Per-Rule Table

| Rule | Count | Description | Triage hint |
| --- | ---: | --- | --- |
| `react/jsx-key` | 0 | Requires stable `key` props in arrays and iterators. | Direct adoption recommended; zero findings. |
| `react/no-array-index-key` | 4 | Flags `key={index}` and equivalent array-index keys. | (a) Clean inventory: <=5 findings and all look like real stability smells. |
| `react/no-unstable-nested-components` | 0 | Flags component definitions created during render. | Direct adoption recommended; zero findings. |
| `react/jsx-no-leaked-render` | 87 | Flags logical/conditional JSX expressions that may leak non-boolean values into render output. | (c) Per-site investigation needed; many findings with mixed signal and substantial boolean/attribute noise. |
| `react/no-unused-prop-types` | 4 | Flags declared component props that are never read. | (a) Clean inventory: <=5 findings and all sampled findings look real. |
| `react/self-closing-comp` | 0 | Requires self-closing tags for components/elements without children. | Direct adoption recommended; zero findings. |

## Firing Rules

### `react/no-array-index-key`

Total: 4 warnings.

Representatives:

- `packages/client/src/components/campaign/chat/dice-roll-result.tsx:41` -
  individual die roll spans use `key={i}` while rendering `group.rolls`.
- `packages/client/src/components/campaign/chat/dice-roll-result.tsx:91` -
  grouped dice result components use the group array index as the key.
- `packages/client/src/components/character-create/steps/equipment-step.tsx:75` -
  starting equipment badges use the item index as the key.
- `packages/client/src/components/character-create/steps/review-step.tsx:186` -
  review equipment badges use the item index as the key.

Triage hint: (a) clean inventory. These are small, real key-stability smells.
Pass 2 can either build deterministic composite keys from the rendered values or
decide whether any list is intentionally positional.

### `react/jsx-no-leaked-render`

Total: 87 warnings.

Representatives:

- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-tracker.tsx:83` -
  `isCurrent={isActive && p.sortOrder === encounter.currentTurnIndex}` is a
  boolean prop expression, not child rendering; this is safe-looking noise.
- `packages/client/src/components/campaign/members/members-panel.tsx:175` -
  `member.character && <MemberCharacterInfo ... />` gates JSX on an optional
  object.
- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:248` -
  `monsterQuery.isLoading && ...` gates the loading skeleton on a query boolean.
- `packages/client/src/components/sheet/cast-spell-dialog.tsx:38` -
  `spell.concentration && <Badge ... />` gates a badge on a boolean spell flag.
- `packages/client/src/pages/campaigns-page.tsx:114` -
  query/view booleans such as `isLoading`, `isError`, `isEmpty`, and
  `hasCampaigns` gate whole page sections.

Triage hint: (c) per-site investigation needed. The rule has possible
correctness value for `0`, string, or object leakage, but the default behavior
also reports JSX attributes and many semantically boolean conditions. Do not
promote as-is without a narrower policy decision.

Special note on options: in `eslint-plugin-react@7.37.5`, this rule exposes
`validStrategies` and defaults to allowing ternary and boolean-coercion
strategies. The default option set still flags boolean identifiers/member
expressions because the rule is not TypeScript-type-aware beyond a small literal
initializer check, and it also flags JSX attribute containers. There is no
`allowExpressions` option for this rule in the installed version. If this rule
is revisited, the useful path is likely targeted manual cleanup or a narrower
local rule/scope, not a simple option tweak.

### `react/no-unused-prop-types`

Total: 4 warnings.

Representatives:

- `packages/client/src/components/character-create/steps/species-step.tsx:111` -
  `SubspeciesSectionProps.speciesId` is passed to `SubspeciesSection` but the
  component never reads it.
- `packages/client/src/components/sheet/sorcery-points-panel.tsx:13` -
  `onUsePoints` is declared on `SorceryPointsPanelProps` but not used.
- `packages/client/src/components/sheet/sorcery-points-panel.tsx:14` -
  `onRecoverPoints` is declared on `SorceryPointsPanelProps` but not used.
- `packages/client/src/components/sheet/spells-panel.tsx:14` -
  `SpellsPanelProps.characterId` is declared but not read by `SpellsPanel`.

Triage hint: (a) clean inventory. All four findings look like real unused prop
surface that TypeScript's normal unused checks do not catch at the component
contract boundary. Pass 2 should remove or validate the dead props before
promotion.

## Zero-Finding Rules

- `react/jsx-key`: 0 warnings. Recommend direct adoption; jsx-a11y and
  TypeScript do not provide equivalent static missing-key coverage.
- `react/no-unstable-nested-components`: 0 warnings. Recommend direct adoption,
  subject to the Leaf 14 overlap note below.
- `react/self-closing-comp`: 0 warnings. Recommend direct adoption; it is
  mostly formatting/style pressure, but it has zero-churn inventory here.

## Cross-Rule Notes

- `react/jsx-key` found no current offenders. It did not duplicate any
  jsx-a11y or TypeScript finding in this pass; those tools do not statically
  enforce React list keys.
- `react/no-unstable-nested-components` has conceptual overlap with
  `react-hooks/static-components`. The current config already enables
  `react-hooks/static-components` through
  `reactHooks.configs.flat["recommended-latest"]` at `error`. This probe
  produced no `react/no-unstable-nested-components` warnings, and the lint log
  contains no `react-hooks/static-components` findings, so there is no concrete
  file/line overlap to report for this inventory.
- `react/no-unused-prop-types` uses legacy "PropType" wording even when it is
  reading TypeScript prop interfaces. The wording is odd, but the four findings
  sampled here appear real.

## Implementation Result

Pass 2 adopted five `eslint-plugin-react` rules at `error` for
`packages/client/**/*.tsx`:

- `react/jsx-key`
- `react/no-unstable-nested-components`
- `react/self-closing-comp`
- `react/no-array-index-key`
- `react/no-unused-prop-types`

`react/no-array-index-key` cleanup:

- `packages/client/src/components/campaign/chat/dice-roll-result.tsx`:
  individual roll spans now use `` `${String(i)}-${String(roll)}` `` composite
  keys.
- `packages/client/src/components/campaign/chat/dice-roll-result.tsx`:
  dice group displays had no notation/dice-spec field on `DiceGroupResultParsed`,
  so they now use `` `${String(i)}-${String(group.rolls.length)}` `` composite
  keys.
- `packages/client/src/components/character-create/steps/equipment-step.tsx`:
  equipment option badges now use `` `${String(i)}-${item.name}` `` composite
  keys.
- `packages/client/src/components/character-create/steps/review-step.tsx`:
  review equipment badges now use `` `${String(i)}-${item.name}` `` composite
  keys.

`react/no-unused-prop-types` cleanup:

- `SubspeciesSectionProps.speciesId` was deleted, and the local
  `speciesId={state.speciesId}` pass was removed; `state.speciesId` remains
  used by the species selection flow.
- `SorceryPointsPanelProps.onUsePoints` was deleted from the panel contract and
  removed from desktop/mobile layout callers and panel test defaults.
- `SorceryPointsPanelProps.onRecoverPoints` was deleted from the panel contract
  and removed from desktop/mobile layout callers and panel test defaults.
- `SpellsPanelProps.characterId` was deleted from the panel contract,
  `buildSpellsProps`, panel test defaults, and the sheet-helper test
  expectation; `character.id` remains used by the spell callbacks.

Upstream cleanup: after the sorcery panel stopped accepting manual use/recover
callbacks, `useSorceryPoints` had no production consumers for `usePoints`,
`recoverPoints`, `isUsePending`, or `isRecoverPending`, so those return fields,
their two client mutations, and their hook tests were removed.

Deferred rule: `react/jsx-no-leaked-render`. Rationale: 87 findings in
`eslint-plugin-react@7.37.5`; the rule has no `allowExpressions` option and
flags JSX-attribute boolean expressions such as
`isCurrent={isActive && p.sortOrder === encounter.currentTurnIndex}` as
false-positive noise. Revisit only with a narrower scope or upstream rule
improvement.
