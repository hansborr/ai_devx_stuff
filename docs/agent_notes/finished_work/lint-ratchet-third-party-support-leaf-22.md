# Leaf 22: Lint Ratchet Third-Party Support

Completed: 2026-05-19

## What Changed

- `lint:ratchet` now supports two registry source kinds:
  - implicit local source for existing `local/*` rules from `eslint-rules/*.js`;
  - explicit third-party source with `source.kind: "third-party"` and a plugin npm package name.
- Third-party entries require a namespaced `ruleId`, a parser profile, and a matching package/namespace entry in `lintRatchetThirdPartyPluginAllowlist`.
- Parser profiles:
  - `minimal-ts`: the original no-type-info `tseslint.parser` profile;
  - `type-aware-ts`: `projectService: true` plus `tsconfigRootDir` set to the repo root, mirroring the main ESLint config.
- Third-party cache identity includes the registry config hash, parser profile identity, plugin package version, plugin export mode, plugin module, and rule namespace.
- Third-party regressions now emit generic ratchet harness findings instead of requiring local rule metadata.
- Fixture coverage was added for unsupported third-party plugins, supported fake-plugin execution, type-aware config rendering, third-party baseline behavior, deterministic config/cache paths, plugin-version invalidation, and local-entry identity regression.

## Review Cycle

The codex review pass was clean. The Explore-agent review raised four findings:

- F1 fixed: the runner now uses the same validated `ruleNamespace` helper as baseline validation, and the smoke fixture asserts malformed scoped `ruleId` values fail with a rule-id validation error instead of an allowlist error.
- F2 fixed: `docs/guides/lint-ratchet.md` now states that `pluginExport` defaults to `"default"` and that `"plugin"` is for packages exposing rules from `module.plugin`.
- F3 rejected: the `LintRatchetConfig` discriminated union already rejects local entries with `parserProfile: "type-aware-ts"` at compile time because the local branch only accepts `"minimal-ts"` and the third-party branch requires a third-party source. The runtime check remains defense in depth.
- F4 deferred: a dedicated wrong-`pluginModule`-for-namespace fixture is a P3 follow-up for Leaf 23, when a real third-party ratchet provides a natural fixture template. Existing unsupported-plugin coverage exercises the same `thirdPartySupportFor` branch.
- P2 fixed: the shared rule-id pattern now accepts scoped third-party rule IDs whose scope has no hyphen, such as `@stylistic/indent`, while keeping malformed forms like `@badly` and `Foo/bar` rejected.

## Shape Decision

Existing local ratchets remain implicit local/minimal-parser entries. That was chosen to preserve byte-identical generated config and the existing cache keys for:

- `ratchet/local-max-lines`: `04f2e06f57af`
- `ratchet/local-type-assertion-boundary`: `02e6d4270880`

Local entries can still spell `source: { kind: "local" }`, but the default avoids registry churn and keeps current baselines valid. Third-party entries must be explicit because their plugin module, allowlist binding, and parser profile are part of the reviewable contract.

## Deferred To Leaf 23

- No real third-party ratchet entry was added.
- The first likely candidate remains `@typescript-eslint/strict-boolean-expressions`.
- Leaf 23 should add the concrete allowlist entry, rule options, scoped files/ignores, and initial baseline for that rule.

## Runtime

Measured with `node_modules/.cache/eslint-ratchet` cleared before the cold run.

- Before: cold 8.366s, warm 1.637s
- After: cold 8.248s, warm 1.630s

No regression was observed on the existing two local ratchets.

## P2/P3 Notes

- The fake third-party plugin lives only inside the shell fixture; no reusable test package was added.
- The allowlist currently has no real third-party package entries by design.
- The type-aware fixture asserts the generated `projectService` shape rather than implementing a rule that consumes TypeScript checker APIs.

## What Could Break This

- Changing the local generated-config render path will trip the fixture expected files and cache-key assertions.
- Changing `eslint.config.js` parser project-service knobs should be mirrored in the `type-aware-ts` profile and `docs/guides/lint-ratchet.md`.
- Upgrading a ratcheted third-party plugin changes its package version and intentionally invalidates the baseline `ruleSourceHash` and ESLint cache path.
- Adding a third-party ratchet without the package/namespace allowlist entry fails registry validation before ESLint runs.
