# 150. Make local-rule and cache directories explicit lint-ratchet engine bindings

Status: Landed on fix/cq-148
Theme: portable engine layout · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet engine exposes repository and data-file locations through its
context, and its documentation says the kernel has zero Musi bindings. Two
remaining filesystem conventions bypass that seam: local rules must live under
`eslint-rules/`, and generated configs plus ESLint caches must live under
`node_modules/.cache/eslint-ratchet/`.

The cache convention is also reconstructed independently by the config writer
and stale-entry sweeper. An adopter with compiled rules or a different cache
policy must patch kernel code, while a future internal layout change must keep
two modules synchronized. This matters in a package explicitly presented as the
copyable, repository-neutral harness kernel.

## Evidence

- `tools/lint-ratchet/src/kernel/engine-context.ts:5-17` says repository access
  is injected so the engine has zero Musi bindings, but the context contains
  only `repoRoot`, `baselinePath`, and `debtLogPath`.
- `tools/lint-ratchet/src/kernel/engine-context.ts:25-37` describes and declares
  `LintRatchetEngineBinding` with only `repoRoot` and the third-party-plugin
  allowlist, despite naming cache directories and rule sources among its uses.
- `tools/lint-ratchet/src/kernel/rule-source.ts:99-101` constructs every local
  rule path as `repoRoot/eslint-rules/<rule>.js`.
- `tools/lint-ratchet/src/kernel/eslint-config.ts:45-72` independently builds
  generated configs and ESLint cache files beneath
  `node_modules/.cache/eslint-ratchet`.
- `tools/lint-ratchet/src/kernel/eslint-runner.ts:100-129` reconstructs the same
  cache and `configs` roots before recursively deleting stale entries whose
  names match the ratchet/hash patterns.
- Exactly three production layout literals need centralization:
  `tools/lint-ratchet/src/kernel/eslint-config.ts:46`,
  `tools/lint-ratchet/src/kernel/eslint-config.ts:68`, and
  `tools/lint-ratchet/src/kernel/eslint-runner.ts:108`; the local-rule literal is
  at `tools/lint-ratchet/src/kernel/rule-source.ts:100`.
- `tools/lint-ratchet/src/kernel/eslint-config.ts:28-42` derives cache-entry
  names from ratchet behavior and source identity, with no directory path in the
  key. Overriding a root therefore need not re-key entries.
- `scripts/lint-ratchet/engine-binding.ts:9-18` and
  `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts:46-55` construct
  plain bindings with the current two fields, so optional directory fields can
  preserve existing callers.
- `examples/lint-ratchet-demo/README.md:90-99` tells adopters to construct the
  engine context/binding but does not describe a local-rule or cache-layout
  override.

## Proposed direction

Extend `LintRatchetEngineBinding` with two optional, repository-root-relative
fields:

- `localRulesDirectory`, defaulting to `eslint-rules`.
- `cacheDirectory`, defaulting to
  `node_modules/.cache/eslint-ratchet`.

Export those defaults as `DEFAULT_*` constants beside
`DEFAULT_BASELINE_FILENAME` and `DEFAULT_DEBT_LOG_FILENAME`. Add small pure
resolvers in `engine-context.ts`, such as `localRulesRootFor(binding)`,
`cacheRootFor(binding)`, and `configRootFor(binding)`, that apply defaults and
join paths consistently. Keep directory strings, rather than injected resolver
functions, as the deliberate portability seam and document that choice in the
binding JSDoc.

Thread the binding through the three path-producing surfaces:

- Change `localRulePath` to take the binding and resolve beneath
  `localRulesRootFor(binding)`. Repoint rule-source hashing and local ESLint
  config rendering accordingly.
- Make `defaultEslintConfigDirectory` and `eslintCachePathFor` derive from
  `configRootFor(binding)` and `cacheRootFor(binding)`.
- Make `sweepStaleCacheEntries` use the same two resolvers instead of joining
  its own literal.

All affected production callers already hold a `LintRatchetEngineBinding`, so
this is signature threading through hashing, config writing, the runner, and
scheduler rather than a new ambient configuration channel. Keep the fields
optional so the Musi adapter, demo adapter, and test fixtures retain today’s
layout without edits beyond documentation or necessary signature updates.

Add focused tests for default-path and hash stability, both override paths, and
stale-cache sweep containment. Keep
`WriteEslintConfigOptions.configDirectory`, currently exercised at
`eslint-config.test.ts:134-151`, as the narrower test seam rather than removing
it. Update the engine-context JSDoc and the demo README/adapter comments to state
the default-plus-override contract plainly for adopters.

## Scope / caveats

- The default filesystem layout and on-disk hash/key formats must not change.
  Existing Musi and demo bindings should produce byte-identical rule-source
  hashes and the same cache/config paths.
- Do not rewrite the default-layout literals in
  `scripts/lint-probe-rule.test.ts`,
  `scripts/tests/test-lint-probe-rule.sh`, or
  `scripts/tests/test-lint-ratchet.sh`; they intentionally pin the defaults and
  serve as the no-drift regression net.
- Preserve the stale-entry filename guards at
  `eslint-runner.ts:105-128`. Override testing must prove the resolved sweep
  stays under the configured cache root before the recursive deletion logic is
  exercised.
- Do not add arbitrary injected path functions, remove the test-only
  `configDirectory` override, or address the package's other Musi-specific
  vocabulary.
- Land this before
  [122-portable-lint-ratchet-package-hard-codes.md](./122-portable-lint-ratchet-package-hard-codes.md),
  or plan the two together, so that leaf extends the same engine-binding
  convention instead of adding a competing seam.
- [148-rule-source-hashing-depends-home-grown.md](./148-rule-source-hashing-depends-home-grown.md)
  changes import discovery in the same `rule-source.ts` file but a disjoint
  region. Neither leaf depends on the other; coordinate only for merge friction.
- No 2026-07-25 leaf establishes a dependency for this layout seam.
