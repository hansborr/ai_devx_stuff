---
leaf: lint-hardening/19 (slice 4)
status: landed
landed: 2026-05-19
branch: feature/lint-hardening-leaf-19-code-intel-entry-and-logs-audit-test
parent_branch: feature/lint-hardening-review-followup
---

# Leaf 19 Slice 4: code-intel-server.ts + logs-audit.test.ts ESLint adoption

## Summary

Extended ESLint coverage to two more script files:

- `scripts/code-intel-server.ts` (4 lines — thin CLI entrypoint
  delegating to `code-intel/server-cli.ts`)
- `scripts/logs-audit.test.ts` (273 lines — script-side test for the
  logs audit utility)

Both files probed at **0 findings** before adoption, so no code
changes landed — only narrow `eslint.config.js` additions:

1. Ignore exemption block (`!scripts/code-intel-server.ts`,
   `!scripts/logs-audit.test.ts`)
2. Parser-options block targeting `tsconfig.scripts.json`
3. `local/type-assertion-boundary` rule block

## What was carved out

`scripts/code-intel.ts` (136 lines) was probed alongside the two
adopted files but produced **10 lint errors** — one autofixable
`simple-import-sort/exports` reorder plus **nine
`@typescript-eslint/consistent-type-imports` violations** on
`import()` type annotations of the shape:

```ts
type DefinitionQueryModule = typeof import("./code-intel/definition-query.js");
```

Converting these to top-level `import type` declarations is a
non-trivial structural rewrite (the file uses these typeof-import
shapes deliberately to defer module loading metadata), not a
mechanical mass-edit. Carving the file out of this slice mirrors the
slice 2 deferral pattern: the autonomous slice should not make
structural rewrite decisions on its own. The file stays parked in
the `19-scripts-eslint-remaining-families.md` queue until a future
leaf with explicit budget picks the repair.

## Why pair these two files

- `code-intel-server.ts` is the entrypoint sibling of the already-
  linted `scripts/code-intel/**/*.ts` glob — natural cohort.
- `logs-audit.test.ts` is a script-side test whose source counterpart
  is not yet linted; bringing the test under the gate first is the
  same pattern used for similar test-first adoptions.

Both files share the existing scripts parser-options block shape, so
no new config flavor is introduced.

## Verification

- `bun run lint -- --max-warnings=0` (exit 0)
- `bun run typecheck` (exit 0)
- `bun run test:scripts:changed` (exit 0; all 5 smokes pass)

## Cross-refs

- Backlog leaf: `backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- Verdict register: `backlog/lint-hardening/evaluation-verdicts.md`
- Sibling adoptions:
  - `lint-hardening-leaf-19-scripts-lint-rule-docs-adoption.md`
  - `lint-hardening-leaf-19-scripts-lint-ratchet-config-adoption.md`
  - `lint-hardening-leaf-19-scripts-generate-harness-controls-deferral.md`
