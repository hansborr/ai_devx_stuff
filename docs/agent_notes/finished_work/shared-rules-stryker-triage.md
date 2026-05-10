# Shared Rules Stryker Triage

Status: completed; focused survivor test landed on 2026-05-10
Date: 2026-05-10

## Slice

Focused on `packages/shared/src/rules/attack-roll.ts`, refreshed with:

```bash
bunx stryker run stryker.config.mjs --mutate packages/shared/src/rules/attack-roll.ts --testFiles packages/shared/src/rules/attack-roll.test.ts --reporters clear-text,json --force
```

The scoped report keeps the ignored JSON at `reports/mutation/mutation.json`.

## Useful Survivor

- Mutant `35`, `Regex`, line 118: `^(\d+)d` -> `^(\d)d`.
- Impact: `applyCritDice("10d6")` would not double the dice count. The current
  tests cover only one-digit dice counts (`1d8`, `2d6`, `1d12`, `1d4`).
- Next focused test: add an `applyCritDice("10d6") === "20d6"` assertion. This
  is a real behavior boundary because spell/combat damage already uses larger
  dice counts such as `8d6` and `12d6`.
- Landed: `packages/shared/src/rules/attack-roll.test.ts` now proves
  `applyCritDice("10d6") === "20d6"`.

## Reviewed Equivalent Or Noise

- Mutant `34`, `Regex`, line 118: `^(\d+)d` -> `(\d+)d`.
- Classification: equivalent under the current attack damage contract. Shared
  attack schemas accept pure leading dice notation (`^\d+d\d+$`), and current
  call sites apply critical dice before adding roll labels. Removing the anchor
  only changes out-of-contract strings such as already-labeled notation.
- If the contract is later broadened to support labels or prefixed expressions
  directly in `applyCritDice`, revisit this as a useful survivor instead of an
  equivalent/noisy mutant.
