# 170. Semgrep manifest key lists are not compiler-bound to the rule-source types

Status: Landed on fix/cq-170
Theme: manifest key exhaustiveness · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The Semgrep manifest parser has two allowed-key arrays that independently repeat
the fields of its local and registry source types. Removing or renaming a type
field can leave an obsolete accepted key, while adding a field can leave the
strict parser unaware of it. The parser’s object builders and the CLI collector
are already checked against the union types, so the remaining drift hazard is
narrower than a four-way schema rewrite: it is the unchecked key inventories.

The bespoke parser also carries exact, user-facing manifest paths, indexed key
paths, license-conflict checks, and exit-code semantics. Replacing it with a
runtime schema library would be a separate behavioral migration, not a
size-S repair for the static drift gap.

## Evidence

- `scripts/drift-ai/semgrep-rule-sources.ts:22-41` declares the seven-field
  `SemgrepLocalRuleSource`, four-field `SemgrepRegistryRuleSource`, and their
  union.
- `scripts/drift-ai/semgrep-rule-manifest.ts:23-32` repeats those field names in
  untyped `LOCAL_SOURCE_KEYS` and `REGISTRY_SOURCE_KEYS` arrays.
- `scripts/drift-ai/semgrep-rule-manifest.ts:74-130` returns the two arm types
  explicitly, so its object builders are already compiler-checked for field
  names and value types.
- `scripts/drift-ai/semgrep-rule-sources.ts:240-288` collects CLI literals into
  a `SemgrepRuleSource[]`; this second construction path is also contextually
  checked against the union.
- `scripts/drift-ai/semgrep-rule-manifest.ts:175-232` implements strict-key and
  typed-value diagnostics with manifest and key-path context.
  `scripts/drift-ai/semgrep-rule-sources.test.ts:383-492` pins invalid JSON,
  `sources[0]` paths, known-pack license conflicts, unknown keys, and manifest
  path reporting.
- `scripts/drift-ai/commit-intent.ts:53` and
  `scripts/drift-ai/prototype-subcommand-definitions.ts:50` already demonstrate
  the repository’s `as const satisfies readonly …[]` pattern.

## Proposed direction

1. In `scripts/drift-ai/semgrep-rule-manifest.ts`, anchor each key array to its
   arm type:

   `LOCAL_SOURCE_KEYS` should use
   `as const satisfies readonly (keyof SemgrepLocalRuleSource)[]`, with the
   equivalent registry declaration for `SemgrepRegistryRuleSource`. The arrays
   remain assignable to `assertManifestKeys`’s `readonly string[]` parameter, so
   no parser call site changes.

2. Add a named, file-local completeness assertion for each arm, based on
   `Exclude<keyof Arm, (typeof KEYS)[number]>`. Choose a type-only spelling that
   satisfies the repository’s unused-symbol rules. The `satisfies` clause
   rejects removed or misspelled keys; the completeness assertion rejects newly
   added fields omitted from the array.

3. Extend the module header at
   `scripts/drift-ai/semgrep-rule-manifest.ts:1-8` to explain that these arrays
   are compiler-proven against the arm types and that the bespoke parser remains
   intentional because its diagnostic and exit-2 behavior is a tested contract.

Acceptance is zero runtime or fixture change: the existing Semgrep source,
manifest, and argument tests retain identical expectations, typecheck succeeds,
and a temporary scratch mutation that removes `"sha256"` from the local key
array or adds a source field fails compilation.

## Scope / caveats

Binding rulings for this leaf:

- Do not port the parser to Zod or another runtime-authoritative schema. A future
  port must be separately scoped around manifest-path and indexed-key wording,
  strict-key diagnostics, cross-field license checks, and exit-code parity. That
  scope is consistent with the separate-parser precedent in the 2026-07-25
  [34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md#step-7-ruling-carved-out-scoped-not-dropped).
- Do not centralize the manifest builders with the CLI collector; they are
  already type-checked and serve different error contracts.
- Do not extract a generic exhaustiveness utility. Keep the small named
  assertions in `semgrep-rule-manifest.ts` until multiple real consumers justify
  shared machinery.
- Do not move the key arrays into `semgrep-rule-sources.ts`; strict unknown-key
  rejection belongs to the manifest parser, and `keyof` provides the cross-file
  link.

The prior pack’s CQ25-47 ruling concerns the drift-triage contracts family, not
this Semgrep manifest. This leaf follows its scoping rule without expanding that
earlier work.
