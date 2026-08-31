# 242. Derive slow-test project roots with fileURLToPath

Status: Landed on fix/cq-074
Theme: Slow-test Vitest config derives filesystem roots from a URL pathname · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The slow-test Vitest config treats a file URL's `pathname` as a filesystem
path. That retains percent encoding for characters such as spaces and produces
URL-shaped drive paths on Windows. Because the resulting value anchors all
three slow-test projects, affected checkouts cannot resolve the shared, server,
or client package roots.

Other root-pinning configuration already uses Node's URL-to-path conversion,
so this one config also creates an unnecessary portability exception in the
test harness.

## Evidence

- `vitest.slow.config.ts:22-49` — passes `new URL(import.meta.url).pathname`
  directly to `path.dirname`, then joins the resulting root into all three
  package project paths (measured: `rg -c '^  root: path\.join\(repoRoot, "packages/(shared|server|client)"\),$' vitest.slow.config.ts` reports `3`).
- `packages/server/vitest.mutation.config.ts:1-3,23-24` — converts
  `import.meta.url` with `fileURLToPath` before deriving the comparable
  mutation-test project root.
- `eslint-rules/vitest.config.ts:1-2,8-17` — uses the same canonical conversion
  for another root-pinned Vitest project.
- `e2e/helpers/environment.ts:3-9` — derives the E2E repository root from
  `dirname(fileURLToPath(import.meta.url))`, demonstrating the established
  repository idiom.

## Proposed direction

Import `fileURLToPath` from `node:url` in `vitest.slow.config.ts` and derive the
root as:

`path.dirname(fileURLToPath(import.meta.url))`

Keep the shared, server, and client `path.join` calls, imported base configs,
slow-test include patterns, default exclusions, and project order unchanged.
Run the registered `bun run test:slow` command to confirm that all three
projects remain discoverable through the dedicated slow tier.

## Scope / caveats

- This is one URL-to-filesystem-path correction. Do not expand it into general
  Windows support for POSIX-only hooks, shell scripts, or provisioning
  surfaces.
- Preserve the slow tier's routing contract: default package tests continue to
  exclude `*.slow.test.*`, and only the dedicated config includes them.
- [073-portable-lint-ratchet-tests-depend.md](./073-portable-lint-ratchet-tests-depend.md)
  addresses Windows directory-junction portability in lint-ratchet fixtures;
  it does not touch this Vitest root.
- No prior-pack residual or ordering dependency is recorded for this change.

## Disposition

Landed as written: `vitest.slow.config.ts` now derives `repoRoot` as
`path.dirname(fileURLToPath(import.meta.url))`, with `fileURLToPath` imported
from `node:url`. The three `path.join(repoRoot, "packages/…")` calls, the
imported base configs, include patterns, `defaultExclude`, and project order are
untouched.

TDD: the bug reproduces by copying the config into a directory whose name
contains a space and symlinking the siblings it imports — the roots come back as
`…/dir%20with%20space/packages/shared`. That is now a check in
`scripts/tests/test-test-slow.sh`, the registered smoke for this config: it
asserts every resolved slow project root is percent-free and exists on disk. Red
before the change, green after. `bash scripts/tests/test-test-slow.sh` passes
(10 assertions) and `vitest list --config vitest.slow.config.ts` resolves all
three projects.
