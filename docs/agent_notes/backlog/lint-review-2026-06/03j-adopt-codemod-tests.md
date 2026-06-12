# 03j: Adopt Codemod Tests

Status: Done (2026-06-12, landed in "refactor(lint): adopt codemod tests
into normal lint")
Order: 03j (after 03i)
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

Four test files, currently outside normal lint, each pinned by four
`intentional-ratchet-only` floors:

- `scripts/codemods/concurrency-guard.test.ts`
- `scripts/codemods/expand-barrel.test.ts`
- `scripts/codemods/structured-logging-fix.test.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`

Ratchets (all zero):

- `ratchet/typescript-eslint-no-misused-promises-codemod-tests`
- `ratchet/typescript-eslint-only-throw-error-codemod-tests`
- `ratchet/vitest-expect-expect-codemod-tests` — pins the shared
  `assertFunctionNames` allowlist PLUS `runFixture`; normal lint's
  `unitTestConfigs` allowlist does not include `runFixture`, so adoption
  needs either a codemod-test-scoped option or `runFixture` added to the
  shared constant (Leaf 08 item 2 single-sources it — coordinate).
- `ratchet/vitest-valid-expect-codemod-tests` (`maxArgs: 2`)

The parent leaf's keep-list notes these floors stop being
"intentional-ratchet-only" exactly when this batch lands.

## Scope

1. Add the four test files to `lintedScriptFiles`; probe the full rule
   surface (legacy probes flagged test-harness findings: `void` callbacks,
   non-`Error` throws, assertion lint).
2. Carry the `assertFunctionNames` + `runFixture` option into the normal
   test config for these files (scoped block or shared-constant extension).
3. Fix findings; for any genuinely test-harness-shaped pattern, prefer a
   helper rewrite over a suppression.
4. Delete the four codemod-test ratchets once normal lint enforces the same
   rules at the same or stricter options.
5. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

The four codemod test files are under normal lint with the same effective
rule strength the ratchets pinned; the four codemod-test ratchets are
deleted; tests still pass.

## Notes

- Added the four codemod test files through a shared `codemodTestFiles`
  re-include list. `scripts/codemods/fixtures/**` remains excluded by using
  explicit test-file paths instead of a broad codemod glob.
- Normal lint now carries the codemod-specific `vitest/expect-expect`
  `assertFunctionNames` option with `runFixture`; `vitest/valid-expect`
  already matched the ratchet's `maxArgs: 2` option. The deliberate
  assertion-free `it(...)` probe failed under normal ESLint with
  `vitest/expect-expect`, then was reverted.
- The adoption surfaced normal-lint findings outside the four retired
  ratchet rules (`no-unnecessary-condition`, `no-confusing-void-expression`,
  and import ordering); fixed those directly in the fixture harness helpers.
- Deleted the four zero codemod-test ratchets from the registry, baseline,
  harness manifest, and generated harness-controls doc. `lint:ratchet:update`
  required the orphan-removal `--allow-worse` path even though all deleted
  baselines were empty, so the debt log records this as a normal-lint
  promotion rather than accepted debt.

## Verification

Umbrella gate set, plus `bash scripts/vitest.sh run scripts/codemods/` and a
deliberate assertion-free `it(...)` probe in one file failing
`vitest/expect-expect` under normal lint (then revert).
