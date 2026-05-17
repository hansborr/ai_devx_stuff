# Leaf 13: Main eslint-plugin-react (Correctness Subset)

Status: Partially landed (2026-05-16); jsx-no-leaked-render deferred
Depends on: Leaf 1 (zero-warning gate), Leaf 5 recommended to ship first
Related: Leaf 5 (jsx-a11y), Leaf 14 (broadened react-hooks)

Dependency detail: Leaf 1 is needed so selected React rules land as a real
gate instead of warning noise. Leaf 5 should ship first because accessibility
rules are better scoped and can remove or explain some JSX findings before the
broader React plugin inventory.

## Problem

The main `eslint-plugin-react` is not configured. Its recommended preset
includes both correctness rules (`react/jsx-key`,
`react/no-unstable-nested-components`, `react/jsx-no-leaked-render`) and a
larger pool of style/preference rules that have meaningful noise in a modern
React 19 + TypeScript codebase (where many "missing prop type" or
"missing display name" checks duplicate what TypeScript already enforces).

Treat this leaf as an *evaluation*, not a presumed adoption. Inventory first;
adopt only the rules that explain a real bug or smell that nothing else
catches.

## Rule Goals (Inventory Targets)

Correctness candidates to inventory:

- `react/jsx-key` — missing key in iterators.
- `react/no-array-index-key` — index-as-key correctness smell.
- `react/no-unstable-nested-components` — function components defined inside
  render (causes unnecessary unmounts).
- `react/jsx-no-leaked-render` — `{count && <X/>}` rendering literal `0`.
- `react/no-unused-prop-types` — useful if any code still uses prop-types,
  otherwise drop.
- `react/self-closing-comp` — pure style; skip unless Prettier doesn't cover
  it.

Rules explicitly *not* in scope (handled elsewhere or duplicative):

- JSX runtime rules — Vite/React 19 handle this.
- prop-types rules — TypeScript replaces prop-types.
- `react/display-name` — useful only if anonymous components are observed in
  React DevTools output during debugging; not lint-time signal.

## Possible Outcomes

- **Adopt subset.** Most likely outcome. Cherry-pick `jsx-key`,
  `no-unstable-nested-components`, `jsx-no-leaked-render`, and possibly
  `no-array-index-key`. Skip the rest.
- **Adopt recommended.** Only if the inventory shows the broader recommended
  set produces high-signal findings on real Musi code. Unlikely.
- **Reject.** If the inventory is dominated by style noise that other tools
  (Prettier, TypeScript, jsx-a11y) already cover, park the plugin and record
  the verdict here.

## Rollout

1. Install `eslint-plugin-react`. Add a scoped config block under
   `packages/client/**/*.tsx` with the candidate rules at
   `warn` in a throwaway config to produce an inventory. The `warn` state is
   local scaffolding only; do not commit it as a long-lived migration mode.
2. Bucket findings: real correctness bugs, intentional-but-scoped, pure
   style/noise.
3. Decide per-rule. Drop any rule whose inventory cannot point to a real
   bug or smell.
4. Add the chosen subset at `error`. Add to `docs/ai-harness.md`.
5. If the final outcome is reject, defer, subset adoption, or full adoption
   with caveats/scoped exceptions, add a row to
   `evaluation-verdicts.md`.

## Stop Conditions

Stop inventory for a rule and record a reject/defer verdict when any of these
are true:

- Style/noise findings exceed real bug or correctness-smell findings by more
  than 5:1.
- The rule produces a broad cleanup queue with no clear recurring bug class.
- Fixes require render-flow rewrites across unrelated client areas rather than
  a focused package or component family.

## Adaptation Policy

Per the index principle 4: for correctness rules with strong semantics
(`jsx-key`, `no-unstable-nested-components`), fix the code. For broader
rules, false positives are signal about rule scoping — drop the rule rather
than papering over with disables. The goal is "fix real findings; scope or
reject rules that cannot explain a real bug/smell."

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
- Targeted client tests if any nested-component or leaked-render fix touches
  a render path.
- If any rule is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## Implementation Result

Pass 2 partially landed the leaf by adopting five client TSX rules at `error`:
`react/jsx-key`, `react/no-unstable-nested-components`,
`react/self-closing-comp`, `react/no-array-index-key`, and
`react/no-unused-prop-types`.

`react/no-array-index-key` was cleaned at four sites: individual dice roll
spans now use `` `${String(i)}-${String(roll)}` ``, dice result groups now use
`` `${String(i)}-${String(group.rolls.length)}` `` because
`DiceGroupResultParsed` has no stable notation/dice-spec field, and the
equipment/review badges now use `` `${String(i)}-${item.name}` ``.

`react/no-unused-prop-types` was cleaned at four prop sites:
`SubspeciesSectionProps.speciesId` was removed from the local species step
contract, `SorceryPointsPanelProps.onUsePoints` and `onRecoverPoints` were
removed from panel callers/tests, and `SpellsPanelProps.characterId` was
removed from the panel contract plus `buildSpellsProps`/tests. Upstream,
`useSorceryPoints` no longer returns the unused manual use/recover callbacks
or pending flags because no production consumer remained after the panel
cleanup.

`react/jsx-no-leaked-render` remains deferred: the Pass 1 inventory found 87
findings in `eslint-plugin-react@7.37.5`, the rule has no `allowExpressions`
option, and it flags JSX-attribute boolean expressions as false-positive
noise. Revisit only with a narrower scope or upstream rule improvement.

## References

- [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react)
- [Why React 19 deprecates prop-types](https://react.dev/blog/2024/04/25/react-19#removed-proptypes-and-defaultprops)
