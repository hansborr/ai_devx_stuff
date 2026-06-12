# 03f: Adopt code-intel.ts And Drain Its Max-Lines Floor

Status: Done (2026-06-12, landed in "refactor(lint): adopt code-intel facade
linting")

Completion notes (2026-06-12):

- Rewrote the facade's `typeof import()` module annotations to erased
  `import type * as ...` namespace imports. Normal lint adoption then only
  surfaced mechanical `simple-import-sort` fixes.
- Added `scripts/code-intel.ts` to `lintedScriptFiles`; no new suppression
  entries were needed, and the facade stays below the normal `local/max-lines`
  cap. The code-intel test guard now rejects runtime static runner imports
  while allowing type-only imports.
- Removed `ratchet/local-max-lines-code-intel` from max-lines policy,
  ratchet registry, baseline, harness-control manifest/docs, and coverage-map
  ownership. `lint:ratchet:update` required the explicit `--allow-worse`
  removal acknowledgement; the debt-log entry records an empty zero-baseline
  orphan removal because normal lint now owns the floor.
- Used `bun run code:intel -- exports packages/shared/src/schemas/character.ts`
  for the smoke because the suggested `packages/shared/src/index.ts`
  equivalent does not exist in this tree.
- Review follow-up: moved the code-intel facade/test rows under the linted
  scripts coverage-map section and retargeted the local max-lines config
  fixture to the live codemods ratchet used by the smoke.
Order: 03f
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

`scripts/code-intel/**`, `code-intel-server.ts`, and `code-intel.test.ts`
are already linted; the entrypoint `scripts/code-intel.ts` is not in
`lintedScriptFiles` (it IS in `tsconfig.scripts.json`). The recorded blocker
from the legacy backlog: `typeof import()` annotations that need manual
`import type * as ...` rewrites before normal lint passes.

`ratchet/local-max-lines-code-intel` (zero) holds the max-lines floor over
the code-intel family.

`docs/guides/code-intel.md` documents the tool; `bun run code:intel` and the
code-intel daemon are exercised by `scripts/code-intel.test.ts`, so behavior
regressions here surface quickly.

## Scope

1. Rewrite the `typeof import()` annotations in `code-intel.ts` to proper
   `import type` declarations; keep the rewrite behavior-neutral.
2. Add `scripts/code-intel.ts` to `lintedScriptFiles`; probe the full rule
   surface and fix remaining findings (prior probes also surfaced
   `simple-import-sort` and `no-confusing-void-expression` on adoption).
3. Check whether `code-intel.ts` and the rest of the family sit under the
   normal max-lines cap; split if not (policy doc applies), then drain
   `ratchet/local-max-lines-code-intel`.
4. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

The whole code-intel family is under normal lint with no dedicated ratchet
and no new suppression entries; `bun run code:intel -- def <symbol>` and the
code-intel test suite behave unchanged.

## Verification

Umbrella gate set, plus
`bash scripts/vitest.sh run scripts/code-intel.test.ts` and a smoke
`bun run code:intel -- exports packages/shared/src/index.ts` (or equivalent)
to confirm the entrypoint still runs.
