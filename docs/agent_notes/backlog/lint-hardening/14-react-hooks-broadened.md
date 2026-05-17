# Leaf 14: Broadened react-hooks (React 19 / Compiler-Era Checks)

Status: Partially landed (2026-05-16); set-state-in-effect deferred
Depends on: Leaf 1 (zero-warning gate)
Related: Leaf 5 (jsx-a11y), Leaf 13 (eslint-plugin-react)

Dependency detail: this leaf needs Leaf 1 because each adopted hook rule should
be a deterministic gate once cleaned up. Inventory before Leaf 1 is allowed
only as throwaway/report-only output; do not commit a broad `warn` surface for
contributors to notice manually.

## Problem

`eslint-plugin-react-hooks` is installed at `^7`, but `eslint.config.js`
only enables `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`.
The plugin's React 19 / compiler-era rule set adds checks for hook purity,
set-state-in-render/effect, refs misuse, immutability of captured values,
unsupported syntax inside hooks, static-component patterns, manual memoization,
error-boundary usage, and compiler compatibility.

These checks have real correctness payoff but are *cleanup-heavy*: many were
not enforced when the code was written, so existing call sites will need
reshaping. Each rule needs an individually attributable inventory before
promotion.

## Rule Goals (Inventory Targets)

The plugin exposes more rules than the two currently enabled. Names and
recommended severities may shift between minor versions; verify against the
installed package before scripting by inspecting `reactHooks.configs.flat`.
At `eslint-plugin-react-hooks@7.0.1`, notable candidates include:

- `react-hooks/rules-of-hooks` — already enabled.
- `react-hooks/exhaustive-deps` — already enabled.
- `react-hooks/set-state-in-effect` / `set-state-in-render` — flags
  set-state during render or in an effect that runs unconditionally.
- `react-hooks/refs` — refs read or written during render.
- `react-hooks/purity` — hooks must be pure functions of their inputs.
- `react-hooks/static-components` — flags components/hooks defined inside
  other components.
- `react-hooks/immutability` — flags mutation of values that should be
  treated as immutable (e.g., dependency-array members).
- `react-hooks/unsupported-syntax` — flags syntax the React compiler cannot
  reason about.
- `react-hooks/component-hook-factories`, `error-boundaries`, `gating`,
  `globals`, `incompatible-library`, `preserve-manual-memoization`,
  `use-memo`, and `void-use-memo` — inventory only after the core purity,
  refs, set-state, and static-component rules are understood.

## Possible Outcomes

- **Adopt per-rule.** Most likely. Each rule has a different cleanup cost
  profile; adopt rule-by-rule after inventory.
- **Adopt subset.** Some rules (e.g., `set-state-in-effect`) may require
  larger reshaping than the cleanup-leverage justifies; park those with a
  reason rather than enabling at `error`.
- **Reject specific rules.** If a rule's findings cannot be triaged into
  "fix" or "intentional + scoped disable" — for example, if it fires
  across hundreds of legitimately stable patterns — record the verdict
  and move on.

## Rollout

1. Confirm the installed `eslint-plugin-react-hooks` version exposes the
   intended rules. Newer minor releases add or rename rules; pin
   expectations to what is actually present.
2. For each candidate rule, enable in isolation in a throwaway config and
   produce an inventory of findings.
3. Triage findings: real correctness bugs (fix), intentional-but-scoped
   (single-line disable with `-- <reason>`), structural mismatch (drop the
   rule).
4. Land cleanup PRs per rule, smallest first, before promoting the rule to
   `error`.
5. Promote to `error` only when the inventory is empty or every remaining
   site has a reasoned disable.
6. Update `docs/ai-harness.md` with each promoted rule.
7. Add rejected, deferred, subset-adopted, or full-adoption-with-caveats rules
   to `evaluation-verdicts.md` so they are not re-tried without new evidence.

## Stop Conditions

Stop inventory for a rule and record a reject/defer verdict when any of these
are true:

- Style/noise or intentional-pattern findings exceed real bug findings by more
  than 5:1.
- The rule produces a cleanup queue too broad to land within one focused
  client area.
- Fixes require broad render/effect rewrites whose runtime behavior cannot be
  verified in the leaf.

## Adaptation Policy

Hook purity and refs/setState misuse are strong-semantic rules — fix the
code. Static-component and immutability rules may surface intentional
patterns; scope or reject rather than disabling at every site. The goal is
"fix real findings; scope or reject rules that cannot explain a real
bug/smell."

## Verification

- `bun run lint -- --max-warnings=0` while iterating per rule.
- `bun run verify:changed`.
- Targeted client component tests for any reshaped render/effect path.
- Manual smoke of the most affected client routes — React state ordering
  bugs do not always show up in unit tests.
- If any rule is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## Implementation Result

Pass 2 adopted `react-hooks` `recommended-latest` for
`packages/client/**/*.{ts,tsx}`. The preset is active with
`react-hooks/set-state-in-effect` overridden off because the inventory found
23 findings in established props-to-local-state, dialog reset, and
external-system sync patterns that need a UI-wide refactor.

The promotable findings were cleaned to zero: five `react-hooks/refs`
findings by destructuring stable TanStack mutation members instead of writing
them into refs during render, and one `react-hooks/static-components` finding
by replacing notification dynamic icon selection with a dedicated
`NotificationIcon` component. Non-preset rules remained out of scope:
`hooks`, `todo`, `rule-suppression`, `automatic-effect-dependencies`, `fbt`,
`fire`, `invariant`, `memoized-effect-dependencies`,
`no-deriving-state-in-effects`, `syntax`, and `capitalized-calls`.

## References

- [React hooks ESLint plugin docs](https://react.dev/reference/eslint-plugin-react-hooks)
- [React Compiler ESLint plugin notes](https://react.dev/learn/react-compiler)
