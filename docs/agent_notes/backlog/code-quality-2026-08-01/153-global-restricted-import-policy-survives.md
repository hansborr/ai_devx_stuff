# 153. Compose restricted-import rules so scoped flat configs cannot erase the global schemas-barrel fence

Status: Landed on fix/cq-157
Theme: additive restricted-import policy · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Musi globally forbids the removed `@musi/shared/schemas` barrel, but ESLint flat
config replaces a rule's entire value when a later scoped entry sets the same
rule key. Four scoped `@typescript-eslint/no-restricted-imports` entries
therefore copy the global barrel pattern manually alongside their local
restrictions.

The comments correctly describe the replace-not-merge trap, but they do not
enforce the convention. A contributor adding a new scoped restriction can
silently remove the repository-wide fence for that file class. Existing
resolved-config tests cover representative client, server, and shared files,
but not the drift-analysis scope or an arbitrary future scope.

There is also a portable-tools restriction that omits the exact barrel pattern
because its broader `@musi/shared/**` group already subsumes it. That behavior is
correct today, but it must be handled deliberately by any structural
all-rule-sites guard rather than becoming an undocumented exemption.

## Evidence

- `eslint-config/shared-policy.js:180-184` defines and exports the canonical
  `sharedSchemasBarrelRestrictedImportPattern`, including its ADR-0005 message.
- `eslint-config/code-quality-configs.js:218-226` installs the pattern globally
  as the complete `@typescript-eslint/no-restricted-imports` rule value.
- `eslint-config/client-configs.js:107-126` manually repeats the pattern beside
  the Socket.io client restriction and comments that flat-config rule entries
  replace by key.
- `eslint-config/script-configs.js:20-53` repeats the pattern in the drift-ai
  direction-law block with the same replace-not-merge explanation.
- `eslint-config/package-boundary-configs.js:114-144` repeats it in the shared
  package's dependency boundary, and `:195-218` repeats it again beside the
  server `RawTxClient` restriction.
- A tree-wide count at the audit pin finds five rule-value uses of
  `sharedSchemasBarrelRestrictedImportPattern`: one global installation and four
  scoped restatements, not five restatements.
- `eslint-config/tools-configs.js:36-63` defines another scoped
  `no-restricted-imports` value without the exact pattern; its
  `@musi/shared/**` group at `:43-48` independently blocks the barrel and all
  other shared imports.
- `eslint-rules/no-shared-schemas-barrel.test.js:43-64` already provides
  `patternsMatchingBareBarrel`; `:75-145` uses resolved-config spot checks for
  client, server, and shared files. There is no corresponding drift-ai or tools
  file-class check.
- `eslint.config.js:59-94` default-exports the flattened `defineConfig` result,
  giving a structural test one iterable source for every configured rule site.
- `scripts/eslint-config-shared-policy.test.ts:13-21` documents that the ambient
  declaration promises only selected runtime exports and deliberately permits
  `shared-policy.js` to export more.

## Proposed direction

1. Take the composer approach, not a new local ESLint rule. Add an exported
   helper to `eslint-config/shared-policy.js`, for example
   `restrictedImportsRule(extraPatterns)`, returning the full rule value
   `["error", { patterns: [sharedSchemasBarrelRestrictedImportPattern,
   ...extraPatterns] }]`. Keep
   `sharedSchemasBarrelRestrictedImportPattern` exported and preserve its regex,
   ADR-0005 message, severity, and first-in-list ordering.

2. Convert the global installation and all four current restatements to the
   composer. Route the tools block through it as well; adding the exact pattern
   there is redundant with `@musi/shared/**` but harmless, and it keeps the
   structural invariant exemption-free. Replace the four distributed
   replace-not-merge comments with one comment on the composer explaining the
   flat-config trap and why every scoped rule must be built through this
   function.

3. Extend `eslint-rules/no-shared-schemas-barrel.test.js` rather than creating a
   new test surface. Import the default-exported config array, collect every
   entry whose `rules` object sets
   `@typescript-eslint/no-restricted-imports`, assert that at least one site was
   found, and require every site's patterns to pass the existing
   `patternsMatchingBareBarrel` check. Retain the current
   `calculateConfigForFile` tests because they separately prove file-matching
   and companion-restriction wiring.

4. Use the focused
   `bun run test:eslint-rules -- eslint-rules/no-shared-schemas-barrel.test.js`
   check and `bun run lint` for implementation validation. Because the helper
   lives in the already-covered `shared-policy.js`, no new config-surface
   manifest row is needed. Recheck
   `scripts/eslint-config-shared-policy.d.ts`; add a declaration only if a
   scripts TypeScript consumer imports the new helper, since its existing
   parity contract intentionally does not require runtime export-set equality.

## Scope / caveats

- Do not implement a dedicated local rule. The composer and config-array
  iteration test provide the structural guarantee without rule registration,
  documentation, or coverage-map machinery.
- Do not alter `no-restricted-globals`, the separately composed
  `no-restricted-syntax` policy, the barrel regex, or the ADR-0005 message.
- Preserve exact severity and pattern order at the five existing pattern sites.
  The tools block deliberately gains a redundant pattern, so any resolved-config
  fixture or ratchet metadata affected by that change must be reviewed rather
  than regenerated blindly.
- The structural test depends intentionally on `eslint.config.js` producing an
  iterable flat-config array. It must assert a nonzero number of restricted-
  import sites so a future export-shape change fails loudly instead of passing
  vacuously.
- Coordinate with
  [157-shared-policyjs-grab-bag-unrelated-lint.md](./157-shared-policyjs-grab-bag-unrelated-lint.md):
  if this leaf lands first, leaf 157 must move the composer with the focused
  package-boundary policy; if leaf 157 lands first, add the composer to that new
  module rather than recreating `shared-policy.js`. No prior-pack work owns this
  invariant.
