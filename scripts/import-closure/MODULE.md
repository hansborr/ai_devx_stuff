# import-closure module

Concepts: source import closure, synthetic sandboxes, seed fingerprints, ESM-only policy

## Purpose

This directory owns the repository's source-level runtime import-closure walk.
It deliberately does not implement package-exports resolution: the built-in
`@musi/shared` and `@musi/server` mappings point at `packages/*/src`, never
`dist/`, because seed fingerprints and fixture copy sets must enumerate source
bytes. A walk can be rooted at any `--root`, including a synthetic sandbox with
no populated `node_modules`; consumers declare packages that leave the tree or
exact repository-package mappings when that sandbox needs them.

The output contract is byte-deterministic for fingerprint enumeration: source
analysis is reused only while the bytes and policy options match, and returned
repository-relative file and violation lists are sorted. Resolution and
containment fail closed when a repository-local import is missing, unsupported,
or escapes the selected root.

[`scripts/code-intel`](../code-intel/) owns real TypeScript project semantics for
symbol, definition, reference, export, and dependent queries. It follows package
exports (including `@musi/shared` into `dist/`) and expects a populated dependency
tree. Use code-intel for repository understanding; use this module only when a
source-rooted closure must work in a synthetic tree or become a fingerprint/copy
set.

## Data Flow

`validateSeedImportClosure` realpaths the root and entry, then walks pending
files through `analyzeRuntimeSource`. Static runtime ESM imports, exports, and
single-literal dynamic imports become edges. `runtimeResolutionCandidates`
maps compiled `.js` specifiers back to TypeScript source and probes the module's
small supported extension set. The walker records every visited local file,
checks it against the caller's `allowedRoots` and `allowedFiles`, and returns
sorted files plus sorted policy violations.

The source policy is intentionally ESM-only. CommonJS loader roots, CommonJS
extensions, ambiguous environment/capability escapes, and—by default—non-static
runtime specifiers throw with a remedy to migrate the source to a static ESM
import. Callers walking runtime-configured loaders may explicitly choose the
existing `nonStaticSpecifiers: "skip"` policy; that choice belongs at the call
site and does not weaken the default.

## External Entry Points

- `validateSeedImportClosure`, `ClosureOptions`, and `ClosureValidation` from
  [`closure-walk.ts`](./closure-walk.ts) are the programmatic API.
- `bun scripts/import-closure/closure-walk.ts --root ... --entry ...` is the CLI
  used by [`scripts/worktree-db.sh`](../worktree-db.sh); `--emit-closure-nul`
  emits the fingerprint copy set.

The four consumer domains are worktree-db (`scripts/worktree-db.sh`), path
policy (`scripts/path-policy/fixture-import-closure.ts`), harness generated
surface derivation (`scripts/harness/generated-surface-dependencies.ts`), and
lint-ratchet fixture checks (`scripts/lint-ratchet/output-emission.test.ts` plus
`scripts/tests/test-lint-ratchet.sh`). Consumer-specific allowlists, terminal
files, external packages, and non-static-specifier choices stay at those call
sites; do not centralize them into this module.

## State Ownership

The module owns no persistent state or generated artifact. It keeps one bounded
in-process source-analysis cache keyed by path and policy, guarded by an exact
source-byte comparison. Consumers own fingerprints, fixture manifests, copy
sets, and diagnostics derived from the returned closure.

## Test Seams

- [`closure-walk.test.ts`](./closure-walk.test.ts) covers resolution,
  containment, traversal, CLI output, consumer options, and failure behavior.
- [`runtime-imports.test.ts`](./runtime-imports.test.ts) covers the ESM collector
  and fail-closed CommonJS, environment, import-attribute, and dynamic-import
  policy.
- `alias-parity.test.ts` pins built-in `@musi/*` mappings to the workspace list.
- Run focused tests with
  `bun run test:scripts:file -- scripts/import-closure/*.test.ts`; the
  worktree-db, harness-check, and lint-ratchet shell smokes cover the external
  call sites.

## Gotchas

- This resolver's divergence from package exports is intentional; replacing it
  with `ts.resolveModuleName` or code-intel breaks source fingerprints and
  synthetic sandboxes.
- Keep output ordering stable. Seed fingerprints hash the emitted path sequence.
- CommonJS or ambiguous loader support is not a missing feature. Migrate the
  source to static ESM instead of adding source-flow analysis here.
- [`fixture-import-closure.ts`](../path-policy/fixture-import-closure.ts) records
  three 2026-07-19 under-closure incidents that motivate deriving copy closures
  instead of trusting hand-maintained file lists.
