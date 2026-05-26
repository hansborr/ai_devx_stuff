# Leaf 3: Vitest And Client Test-Quality Rules

Status: Parked; initial `@vitest/eslint-plugin` slice landed 2026-05-16.
Remaining work is tracked in `../lint-followups/10-test-quality-followups.md`.
Depends on: none (Leaf 1 and Leaf 2 are both resolved)

Dependency detail: Leaf 1 (zero-warning gate) landed 2026-05-16 — committed
warning-severity rules now fail deterministically. Leaf 2 (staged-content
correctness) is also resolved. No blockers remain.

## Problem

Musi has many Vitest tests. The initial Vitest ESLint plugin slice is already
installed and configured; this note preserves the original rollout and verdict.
Do not re-promote the install/inventory step. Remaining test-quality work is
client-scoped Testing Library/jest-dom inventory or explicitly named deferred
Vitest rule cleanup.

## Initial Rule Goals

- Catch focused or skipped tests outside explicit quarantine workflows.
- Require valid expectation usage and avoid false-positive tests.
- Discourage conditional expectations and duplicate titles where the plugin can
  do so reliably.
- Keep Playwright e2e under the existing Playwright rules, not the Vitest
  config.
- After the Vitest plugin is stable, evaluate `eslint-plugin-testing-library`
  and `eslint-plugin-jest-dom` only for client `.test.tsx` files that use
  Testing Library. Do not apply those rules to server/shared tests.

## Package Choice

Use `@vitest/eslint-plugin` (the official package). The older
`eslint-plugin-vitest` is the same project re-published; only
`@vitest/eslint-plugin` is actively maintained because the previous
maintainer lost access to the original npm account. Requires ESLint v9+,
which Musi already has.

## Rollout

Promotion note: this file intentionally tracks three related plugins, but the
`@vitest/eslint-plugin` slice below already landed. Promote Testing Library and
jest-dom as separate scoped follow-ups from
`lint-followups/10-test-quality-followups.md`, or split them into new leaf
files if that is clearer.

Historical `@vitest/eslint-plugin` rollout:

1. Add `@vitest/eslint-plugin` and a scoped config block for
   `**/*.test.{ts,tsx}` and `**/*.spec.ts`, explicitly excluding `e2e/**/*`.
2. Cross-check the glob against the local `test-file-location` rule. Widen or
   narrow whichever rule is wrong rather than letting them disagree.
3. First run the plugin as an inventory. A throwaway `warn` config is fine for
   the local inventory pass, but do not commit warning-only rules. Do not
   assume the recommended config is low-noise for this repo.
4. Promote only zero- or low-cleanup rules to `error`.
5. Keep noisy findings in a report-only note rather than long-lived ESLint
   warnings.
6. Land mechanical test fixes before turning any noisy rule into `error`.
7. Run full lint and all ESLint-rule tests.
8. Add the chosen stable Vitest rules to `docs/ai-harness.md`.
9. Add `eslint-plugin-testing-library` as a *separate* config block scoped
   only to `packages/client/**/*.test.tsx`. The plugin's React preset
   targets Testing Library's React adapter and would misfire on
   server/shared tests. Inventory, fix, promote rules with high signal
   (`testing-library/no-node-access`, `testing-library/no-container`,
   `testing-library/prefer-screen-queries`, etc.).
10. Add `eslint-plugin-jest-dom` in the same client-only block. Its rules
    require Testing Library + `@testing-library/jest-dom` matchers, both
    already installed. Inventory, fix, promote.
11. After both are wired, re-check Leaf 15 (Zod parse-assertion helpers) —
    Vitest/jest-dom may cover enough that Leaf 15 becomes narrower.

## Possible Outcomes

Each of the three plugins is a separate evaluation:

- `@vitest/eslint-plugin`: most likely **adopt subset** (focused/skipped
  test detection, expectation correctness). The recommended config is
  reasonably tight; reject only if inventory shows the plugin misfires on
  Musi's test helpers.
- `eslint-plugin-testing-library`: most likely **adopt subset** of the
  React preset, scoped to client `.test.tsx`. Reject if it overlaps too
  much with patterns already established in `packages/client/.../test/`.
- `eslint-plugin-jest-dom`: most likely **adopt recommended** (small,
  matcher-focused, low noise).

Record per-plugin verdicts in this leaf as each lands. If any plugin is
rejected, deferred after inventory, only partly adopted, or fully adopted with
caveats/scoped exceptions, also add the decision to `evaluation-verdicts.md`.

## Implementation Result

### 2026-05-16 - `@vitest/eslint-plugin` First Slice

Landed the official `@vitest/eslint-plugin` scoped only to non-e2e
`**/*.test.{ts,tsx}` and `**/*.spec.ts`. Testing Library and jest-dom were not
installed or evaluated.

Adopted rules:

- `vitest/expect-expect` with Musi assertion-helper names:
  `assertNonPermissiveOutput`, `expectClean`, `expectHit`, and
  `expectOneFulfilledOneConflict`.
- `vitest/valid-expect` with `maxArgs: 2` so Vitest assertion messages remain
  legal.
- `vitest/no-commented-out-tests`, `vitest/no-disabled-tests`,
  `vitest/no-focused-tests`, `vitest/no-identical-title`,
  `vitest/no-import-node-test`, `vitest/no-interpolation-in-snapshots`,
  `vitest/no-mocks-import`, `vitest/no-standalone-expect`,
  `vitest/no-unneeded-async-expect-function`,
  `vitest/prefer-called-exactly-once-with`,
  `vitest/prefer-comparison-matcher`, `vitest/prefer-equality-matcher`,
  `vitest/prefer-to-contain`,
  `vitest/require-local-test-context-for-concurrent-snapshots`,
  `vitest/valid-describe-callback`, `vitest/valid-expect-in-promise`, and
  `vitest/valid-title`.

Inventory and cleanup:

- Recommended-rule inventory found `expect-expect` (21 hits),
  `no-conditional-expect` (81 hits), `prefer-called-exactly-once-with` (2
  hits), and `valid-expect` (11 hits); every other recommended rule was zero.
- `expect-expect` was adopted after seven real no-assert tests were given
  explicit assertions and the remaining helper-assertion pattern was configured.
- `valid-expect` was adopted after rewriting the one lint-hostile,
  double-invoking `toThrow` pattern in
  `packages/server/src/trpc/rate-limit.test.ts`; the other ten findings were
  legitimate Vitest assertion-message calls covered by `maxArgs: 2`.
- `prefer-called-exactly-once-with` was adopted after two direct matcher
  cleanups.
- Extra matcher-rule inventory found zero hits for
  `prefer-comparison-matcher`, `prefer-equality-matcher`, and
  `prefer-to-contain`, so those were enabled. `prefer-to-be` had 2 style-only
  hits and `prefer-to-have-length` had 24 style-only hits, so both were
  deferred.

Deferred verdicts live in
`docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md` under
"2026-05-16 - Leaf 3 `@vitest/eslint-plugin` First Slice".

The local `test-file-location` rule was aligned with the new non-e2e test
scope: it now recognizes `.test.ts`, `.test.tsx`, and non-e2e `.spec.ts`
files, while Playwright e2e specs remain out of scope.

## Open Question

Determine whether Vitest rules make a local assertion-quality rule unnecessary,
or whether Zod/result assertions still need Musi-specific handling. Leaf 15 is
the likely follow-up for Musi-specific assertions.

## Verification

- `bun run lint`
- `bun run verify:changed`
- `bun run vitest run --project=eslint-rules` if lint config or local rule
  tests change.
- Targeted package tests for any test cleanup performed during rollout.
- If the promoted slice is rejected, deferred, subset-adopted, or fully adopted
  with caveats/scoped exceptions, append a row to
  `evaluation-verdicts.md` before closing the leaf.
