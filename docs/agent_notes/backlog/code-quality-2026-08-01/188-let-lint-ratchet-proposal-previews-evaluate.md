# 188. Let lint-ratchet proposal previews evaluate third-party rules safely

Status: Landed on fix/cq-158
Theme: Third-party ratchet previews · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet proposal command is intended to preview a rule’s current cost and print a configuration that can be promoted without touching the registry or baseline. That path supports only core and local rules, even though third-party rules account for nine live registry entries and are therefore a primary adoption case.

A contributor evaluating a third-party rule must currently create its allowlist entry, source object, parser profile, and registry entry before learning what the proposed floor would contain. That reverses the preview workflow: experimental configuration must enter governed production surfaces before it can be evaluated, and external adopters must understand several internal contracts that the proposal command otherwise assembles for them.

## Evidence

- `ProposeSummary.sourceKind` admits only `"core" | "local"`, and `buildProposeRatchet` selects only the corresponding two builders (`tools/lint-ratchet/src/governance/propose.ts:36-49`, `tools/lint-ratchet/src/governance/propose.ts:154-180`).
- Namespaced rule IDs reach an unconditional error saying that third-party rules require a future `--plugin` option (`tools/lint-ratchet/src/governance/propose.ts:137-143`).
- The proposal engine already receives a `LintRatchetEngineBinding`, whose contract includes the third-party plugin allowlist (`tools/lint-ratchet/src/governance/propose.ts:68-78`, `tools/lint-ratchet/src/kernel/engine-context.ts:34-37`).
- The kernel already models the required third-party source and allowlist shapes, including optional `pluginExport`; unlike local rules, a third-party configuration must carry an explicit parser profile (`tools/lint-ratchet/src/kernel/config-types.ts:26-29`, `tools/lint-ratchet/src/kernel/config-types.ts:62-83`).
- `ruleNamespace` handles both ordinary and scoped plugin rule IDs, while `thirdPartySupportFor` validates the `(pluginModule, ruleNamespace)` pair against the injected allowlist (`tools/lint-ratchet/src/kernel/baseline-hash.ts:62-71`, `tools/lint-ratchet/src/kernel/rule-source.ts:103-121`).
- A pinned count finds nine live third-party registry entries: `scripts/lint-ratchet/lint-ratchet-config.ts:238`, `:250`, `:271`, `:303`, `:336`, `:369`, `:386`, `:403`, and `:423`.
- The CLI adapter recognizes only `--ignore`, `--metric`, and `--rule-options`, in both inline and two-argument forms; its usage text still describes proposal mode as core-or-local only (`scripts/lint-ratchet/propose-cli-options.ts:5-20`, `scripts/lint-ratchet/propose-cli-options.ts:28-72`, `scripts/lint-ratchet/cli-usage.ts:3-10`).
- The contributor guide explicitly defers third-party previews and instead instructs users to add an allowlist pair and complete registry entry first (`docs/guides/lint-ratchet.md:95-107`, `docs/guides/lint-ratchet.md:289-297`).

## Proposed direction

1. Extend `ProposeOptions`, `RunLintRatchetProposeCliOptions`, and `ProposeSummary` in `tools/lint-ratchet/src/governance/propose.ts` with third-party source metadata: optional `pluginModule`, `pluginExport`, and `parserProfile`, plus `"third-party"` as a summary source kind. Use `ruleNamespace()` to recognize namespaced non-local IDs rather than inventing another rule-ID parser.

2. Add a third-party proposal builder using the existing source shape `{ kind: "third-party", pluginModule }`. Require an explicit parser profile in the resulting `LintRatchetConfig`, defaulting proposal input to `"minimal-ts"` and permitting `"type-aware-ts"` as an opt-in. Do not expose `typeAwareProject`; generated configurations already have the portable `projectService` default.

3. Resolve plugin identity against `engine.binding.thirdPartyPluginAllowlist` without requiring prior allowlisting:

   - If the namespace is already allowlisted, infer its module when `--plugin` is absent and reject a conflicting supplied module.
   - If it is not allowlisted, require `--plugin`; accept optional `--plugin-export`, defaulting to `"default"` as the generated ESLint configuration does at `tools/lint-ratchet/src/kernel/eslint-config.ts:163`.
   - For an unlisted pair, construct a preview-scoped copy of the binding with a synthesized allowlist entry and pass that copy through source hashing and collection. Never mutate the injected binding.

4. Keep the output promotable. `formatPromotableConfig` must print the complete third-party source and selected parser profile. When the allowlist pair was synthesized for preview, print the corresponding `lintRatchetThirdPartyPluginAllowlist` entry alongside the registry block and label it clearly as a required governance addition. The preview remains read-only.

5. Add `--plugin`, `--plugin-export`, and `--parser-profile` to `scripts/lint-ratchet/propose-cli-options.ts`, supporting both `--name=value` and `--name value`, and thread them through `cli-types.ts`, `cli-validate.ts`, `cli.ts`, and `modes.ts`. Reject plugin options for core or local rule IDs. Convert module-resolution and bad-export failures into actionable `ConfigError`s rather than exposing raw dynamic-import errors.

Update `scripts/lint-ratchet/cli-usage.ts`, both proposal passages in `docs/guides/lint-ratchet.md`, and the proposal guidance around `docs/guides/lint-ratchet-reference.md:552-585`. Extend the existing proposal and CLI suites with already-allowlisted, newly synthesized, scoped-namespace, mismatched-module, bad-export, parser-profile, and core/local rejection cases.

## Scope / caveats

- The synthesized allowlist is preview-only. Output that hides this fact or omits the required allowlist addition would teach adopters to bypass the governance boundary the harness is meant to demonstrate.
- Out of scope: `typeAwareProject` or `--type-aware-project`, registry or baseline writes, new ratchet modes, and feature parity in the demo adapter beyond keeping it compatible.
- Broad globs combined with `"type-aware-ts"` may make a preview appear stalled; documentation and progress/error output should make that cost understandable.
- `metricPairingFailures` already accepts the third-party source kind; this work should not expand kernel metric policy.
- This has a soft option-parser overlap with [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md). There is no required order, but if that leaf lands first, the three new options belong in its typed catalog; whichever lands second must reconcile the shared CLI surface.
