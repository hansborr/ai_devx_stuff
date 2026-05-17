# Leaf 19: Package And Dependency Policy Sensors

Status: Landed Pass 2 (2026-05-17); import-x/no-extraneous-dependencies adopted at error with tiered file-glob design.
Depends on: none, but later than early lint correctness work

## Problem

ESLint import rules catch source import drift, but they do not cover package
metadata conventions or dependency-policy placement. Musi should borrow the
manifest/dependency-policy idea without copying Rust's Cargo shape.

## Candidate Work

- Add a package/workspace manifest policy script that checks root and
  `packages/*/package.json` conventions:
  - package naming;
  - `private` where expected;
  - `type: "module"`;
  - `workspace:*` internal dependency edges;
  - package-direction expectations;
  - required root scripts.
- Keep this separate from ESLint import rules. Manifest policy catches package
  metadata drift; ESLint catches source import drift.
- Decide where `bun run audit:deps` belongs. It already exists as `audit:deps`,
  but this plan should record whether dependency advisory checks are
  CI/manual/doctor-only or part of a slow verification tier.
- If license/source policy becomes important, evaluate a JavaScript ecosystem
  tool deliberately. Do not treat `bun audit` as equivalent to `cargo deny`;
  it covers advisories, not full license/source policy.
- Evaluate `eslint-plugin-import-x/no-extraneous-dependencies` as a cautious
  ESLint-side companion. The failure mode to catch is "AI imported a package
  but added it to the wrong workspace `package.json`" or "imported a package
  that is only in a sibling package's deps". `import-x` is the
  actively-maintained fork of `eslint-plugin-import` and is the right
  candidate. Roll out per-package, scoped to that package's `src/`, after
  the manifest-policy script lands; the two are complementary (manifest
  policy catches metadata drift; `no-extraneous-dependencies` catches
  source-side mismatches).
- Pair with Leaf 17 (`@eslint/json`) if the manifest-policy script wants to
  consume ESLint's JSON diagnostics rather than parsing manifests itself.

## Rollout

Start report-only through `doctor`, then gate package manifest edits once the
policy has explicit exceptions, repair text, and tests.

## Implementation Result

Pass 2 adopted `eslint-plugin-import-x@4.16.2` and
`import-x/no-extraneous-dependencies` at `error` across
`packages/{shared,server,client}/src`.

The ESLint config uses a two-tier per-package shape:

- Strict package source: `packageDir` points only at `packages/<pkg>`, so
  production-ish package source cannot import root-only dev tooling.
- Tests and helpers: `packageDir` includes both `packages/<pkg>` and the repo
  root with `devDependencies: true`, so package tests and helper files can use
  root-owned test infrastructure without duplicating `vitest` in every package
  manifest. This tier covers `*.test.{ts,tsx}`, `*.spec.{ts,tsx}`,
  `*.test-helper.{ts,tsx}`, and the repo's existing `src/test/**` helper
  directories.

The server SRD generator scripts under `packages/server/src/seed/` remain
server-owned dev tooling. `prettier` is now declared in
`packages/server/package.json` `devDependencies`, and the server strict tier
allows package-local devDependencies only for `generate-srd-*.ts` generator
entrypoints.

## Verification

- `bun run test:scripts:changed`
- Targeted manifest-policy script tests.
- `bun run verify:changed`
- If `import-x/no-extraneous-dependencies` or any manifest-policy check is
  rejected, deferred, subset-adopted, or fully adopted with caveats, append a
  row to `evaluation-verdicts.md`.
