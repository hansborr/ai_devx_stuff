# Leaf 41 Batch 5: Core ESLint Rule Source Support

Date: 2026-05-20

## Summary

Added the lint ratchet runner's core ESLint rule-source infrastructure without
adding any live registry entries that use it.

The new registry source shape is:

- `source: { kind: "core" }`

Core ratchets can use either `minimal-ts` or `type-aware-ts`. Registry
validation requires a bare built-in ESLint rule id such as `complexity`; slashed
or non-lowercase bare ids are rejected before ESLint runs. Core entries do not
use the third-party plugin allowlist.

Core rule-source hashing now includes:

- source kind
- bare rule id
- normalized rule options
- installed ESLint package version from `node_modules/eslint/package.json`

Generated configs for core ratchets import only `typescript-eslint`, emit the
bare rule id directly in `rules`, and do not add plugin imports or a `plugins`
block. Generic ratchet diagnostics are reused for core regressions.

Unit coverage now exercises valid core configs across both parser profiles,
bare-rule-id validation failures, and core source-hash identity/version drift.
The lint-ratchet smoke fixture injects a temporary `complexity` core ratchet to
prove registry loading, generated config emission, baseline writing, and the
default gate end to end.

No `lintRatchets` entry uses `source: { kind: "core" }` yet. Leaf 41 Batch 6 is
the planned first user.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun test scripts/lint-ratchet-baseline.test.ts`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `FORCE_VERIFY=1 bun run typecheck`

`lint-ratchet.baseline.json` and generated harness controls stayed unchanged.
