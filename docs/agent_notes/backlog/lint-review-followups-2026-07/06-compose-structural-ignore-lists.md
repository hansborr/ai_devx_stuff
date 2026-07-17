# 06 — Compose structural ignore lists in shared-policy

Status: Done — `3f2ca4d2` (composed list deliberately gains the server `__type-tests__` glob: strict superset, 0 baseline items affected — owner-approved heal)
Track: T (tooling) · Priority: P3 · Size: M

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- `eslint-config/shared-policy.js:147-159` —
  `productionFunctionStructureIgnores` hand-restates the client/server/shared
  test-and-helper globs as a third copy instead of composing the package
  lists; the same globs recur in ratchet config entries.
- Prerequisite landed with the branch's DO NOW set: the
  `clientTestAndHelperSourceFiles` / `sharedTestAndHelperSourceFiles` globs
  were widened to `*test-helper*`, so the lists are now composable without a
  behavior change.
- Constraint: the ratchet registry requires codepoint-sorted entries (comment
  near `shared-policy.js:134`), so composition must sort programmatically,
  not by hand-ordering the source lists.

Failure: three hand-synced copies of the same file-class definition — the
2026-07 branch already shipped one divergence (`*.test-helper.*` vs
`*test-helper*`) that three separate policies disagreed on; any future
test-file convention change has to be found and applied in every copy.

## Do

1. Build `productionFunctionStructureIgnores` (and the ratchet entries that
   restate the same globs) by composing the per-package test/helper lists
   plus the common dist/generated ignores, with programmatic codepoint
   sorting.
2. Expect ratchet data churn from the reordering; regenerate through the
   ratchet tooling per `docs/guides/lint-ratchet.md`, never hand-edit.

## Verify

```
bun run verify:changed
bun run harness:check
```

## Acceptance

The test-and-helper file-class is defined once per package and composed
everywhere it is consumed; a deliberate glob change propagates to structural
ignores and ratchet entries without hand-syncing; resulting lists remain
codepoint-sorted (pinned by the existing sort check).

Sources: Grok cross-review P1/simplification; Fable 5 adjudication
(deferred until glob widening landed).
