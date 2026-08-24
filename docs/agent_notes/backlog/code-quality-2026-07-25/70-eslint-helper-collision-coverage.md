# 70. The local-rule collision guard protects one helper home and only top-level copies

Status: **Done 2026-07-31** on branch `fix/cq-64-70-guard-corpora`.
Theme: Shared lint helpers should resist renewed copy drift · Area: harness (lint guards) · Severity: low · Size: S

Source: leaf 38 cross-model pre-merge panel, 2026-07-31; Fable and Grok
independently identified the residual, and all three reviewers still returned
`merge` · Confidence: high

Evidence is pinned to `dec0fa6d1`. Re-resolve symbols before implementation.

## Outcome

- The leaf's residual scope was worth closing. The guard now dynamically
  imports every non-test JavaScript module, uses the registry guard's rule-shape
  classifier to identify rule targets, and compares declarations anywhere in
  each target AST against the named exports of every other module. The set is
  target-relative so a rule's own exported helpers do not collide with their
  declarations.
- Review found that the first implementation still omitted named exports from
  rule-shaped modules; `socket-registry-broadcasts.js` already exports the live
  `isEmitMember` counterexample. A focused case failed with that export absent,
  then passed when the protected set became target-relative. The widened live
  scan exposed no additional declaration collisions or need for an allowlist.
- TDD exposed both filed modes before the implementation changed: the widened
  live corpus found `no-arbitrary-tailwind-value.js:resolveDeclaredVariable`,
  and a focused probe showed that the program-body-only walk saw the top-level
  collision but missed same-named declarations inside `create()`.
- The live collision was a byte-identical copy of
  `binding-resolution.js`'s exported helper. The rule now imports that helper;
  no exception or allowlist was added. The rule's finding count stayed at its
  committed floor; only the generated `ruleSourceHash` in
  `lint-ratchet.baseline.json` changed.
- The small default-export classifier moved from
  `local-plugin-registry.test.js` into the existing `all-local-rules.js` support
  module, so both filesystem guards share it without a new classification
  framework or configuration surface. The focused recursive-walk regression
  stays beside the live comparison in `ast-helpers.test.js`.
- No cross-leaf corpus helper was introduced. Leaf 64 compares JSON behavior
  cases across ESTree and ts-morph detectors; this leaf classifies filesystem
  modules and walks declarations. Their common policy does not yield a useful
  shared data shape or executable helper.

## Problem

Leaf 38 centralized the helpers that had already drifted and added a collision
guard, but that guard seeds its protected names only from `ast-helpers.js`.
Other non-rule modules in `eslint-rules/` remain hand-copyable into a rule
without detection, including:

- `binding-resolution.js` (`resolveDeclaredVariable`,
  `resolveIdentifierBinding`);
- `no-swallowed-errors-paths.js` (`belongsToCatch`, `nodesMaySharePath`);
- `rule-tester.js` (`makeRuleTester`, `makeParserlessRuleTester`);
- the effect-misuse provenance/execution helpers; and
- `trpc-shared-schema-import-collector.js`.

The guard also inspects only declarations directly in the program body. A
same-named function or variable nested inside a rule's `create()` escapes even
when its name is exported by `ast-helpers.js`.

This does not invalidate leaf 38: its guard covers the helper names that had
demonstrably drifted, and all observed copies were top-level. This leaf records
follow-up hardening rather than a merge blocker.

## Evidence

- `eslint-rules/ast-helpers.test.js` builds `exportedHelperNames` from
  `Object.keys(astHelpers)` and scans only `ast.body`.
- `eslint-rules/local-plugin-registry.test.js` already classifies a module as a
  rule by the shape of its default export (`meta` plus `create`); everything
  else is a non-rule helper candidate.
- The modules listed above export shared functions that rule modules import,
  but none of their names enter the current collision set.

## Proposed direction

Keep this as one extension of the existing test, not a helper framework:

1. Reuse the registry test's rule-shaped default-export classification while
   walking the non-test JavaScript modules.
2. Seed the protected-name set from every non-rule module's named exports,
   rather than from `ast-helpers.js` alone.
3. Scan rule modules below the program body as well as at top level so a
   same-named declaration inside `create()` fails with its file and helper name.
4. Prove both residual modes by temporarily copying one helper at top level and
   one inside `create()`, then keep the focused regression cases.

## Scope / caveats

- Detect same-name declarations only. Finding renamed semantic clones such as
  `getParent` versus `parentOf` needs duplicate analysis and is not this leaf.
- Avoid a new lint rule or general module-classification framework. Share or
  colocate the small classification only if doing so deletes duplication.
- Do not merge all shared helpers into `ast-helpers.js`; multiple focused helper
  homes are valid. The missing piece is guarding their exported names.
- Keep `eslint-rules/*` on the existing full changed-mode run so the
  filesystem-discovered guard remains selectable.

## Verify

Follow TDD with the two collision mutations above, then run the focused lint-rule
project and the changed-routing shell smoke before the full gate required for
changes to `eslint-rules/*.js`.
