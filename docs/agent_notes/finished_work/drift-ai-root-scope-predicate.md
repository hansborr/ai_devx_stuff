# Drift:ai Root Scope Predicate

Completed drift-ai review task 18.

`scripts/drift-ai/path-util.ts` now owns broad current-scope whole-repo root
semantics with `isWholeRepoRoots()`: no roots, or any normalized root equal to
`"."`, means the current inventory is whole-repo. `current-inventory.ts` uses the
shared helper in its root filter and ignore handling, so mixed roots containing
`"."` apply normal whole-repo ignore semantics instead of explicit-root suffix
stripping.

`duplicates-runner.ts` intentionally keeps a stricter local predicate for the
large-inventory warning. It warns for no roots or exactly normalized `["."]`, and
does not warn for mixed roots such as `[".", "packages/server/src"]`.

Validation:

- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/path-util.test.ts scripts/drift-ai/current-inventory.test.ts scripts/drift-ai/duplicates.test.ts scripts/drift-ai/knip-orphan-files.test.ts`
- `bun run drift:ai --scope current --root scripts/drift-ai --check orphan-files --format text`
