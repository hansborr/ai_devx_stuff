# strict-boolean-expressions: Server Inventory And First Slice

Status: Done (2026-06-12, landed in "feat(lint): add strict-boolean-expressions
server encounter-combat ratchet")
Order: 07
Source: promoted from the lint-review-2026-06 watchlist
("strict-boolean-expressions: expand only package-by-package or
module-by-module after a fresh inventory"), 2026-06-12 re-triage.

## Context

`@typescript-eslint/strict-boolean-expressions` is off project-wide in
normal lint; the shared production slice is held by the
`ratchet/strict-boolean-expressions-shared` zero floor
(`intentional-ratchet-only` per the 03l verdict). The server package is
the natural next slice: it is production code where truthiness bugs on
`string | undefined` / nullable Prisma fields are the classic failure
mode, and it has no coverage today.

## Scope

- Fresh inventory: probe the rule (shared-slice option shape) over
  `packages/server/src` and record total findings, findings per
  directory, and the dominant violation shapes.
- Pick the smallest viable slice (likely `services/` subtree or a single
  high-value module family) where findings are zero or trivially
  drainable in this run.
- Land that slice as a zero ratchet floor mirroring
  `strict-boolean-expressions-shared` (same option shape, server scope),
  or — if a slice is already clean — consider direct normal-lint adoption
  for it and say why in the verdict.
- If the inventory shows no viable slice within a single run, do not
  start a drain: record a defer verdict with the counts and the suggested
  slicing plan as new leaf candidates.

## Definition Of Done

Either a server slice is guarded (ratchet or normal lint) with the
inventory recorded, or a defer verdict with per-directory counts exists
in `evaluation-verdicts.md` and the watchlist entry points at it.

## Verification

- lint, lint:ratchet, lint:ratchet:check-registry, zero-baseline gates.
- `bun run --filter @musi/server test` green if any code changed.
- `bun run verify:changed`.

## Notes (2026-06-12)

- Landed Scope option (a): a zero floor on the smallest drainable subtree
  rather than a package-wide debt freeze. Full inventory (149/61,
  nullable-string-dominated) and the remaining-slice plan are in
  `evaluation-verdicts.md` (Leaf 07 entry).
- Slice = `services/encounter-combat/` (1 finding,
  `combat-log.ts` nullable cursor). The drain preserves empty-cursor
  semantics (`!== undefined && !== ""`), not a bare `!== undefined` which
  would pass `new Date("")` to Prisma; covered by a new
  `encounter-combat-logs.test.ts` regression.
- Stale ref: `bun run --filter @musi/server test` does not exist; used the
  root `bun run test:server`. Server test-helper glob is hyphenated
  (`*-test-helper.ts`), unlike shared's `*.test-helper.ts`.
