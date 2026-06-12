# 03i: Adopt Codemod Sources And Lib

Status: Done (2026-06-12, landed in "refactor(lint): adopt codemod sources")
Order: 03i
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

The biggest unadopted surface: `scripts/codemods/**` is entirely outside
normal lint (~37 non-fixture files: `concurrency-guard*`, `expand-barrel*`,
`structured-logging-fix*`, `trpc-shared-schema-codemod*`, and
`scripts/codemods/lib/` with 8 files). `tsconfig.scripts.json` already
includes `scripts/codemods/**/*.ts` and excludes
`scripts/codemods/fixtures/**`.

This sub-leaf covers SOURCES AND LIB ONLY; 03j takes the four test files.

Ratchets (zero, `intentional-ratchet-only` — codemods were deliberately
outside normal lint, which this batch ends for sources):

- `ratchet/core-complexity-codemods` (ignores tests and fixtures)
- `ratchet/local-max-lines-codemods`

The legacy family map's known finding families for codemods: `void`
callbacks, non-`Error` throws, concurrency/structured-logging codemod
patterns, and barrel / tRPC schema codemod patterns including `lib/`.

Fixture caveat: `scripts/codemods/fixtures/**` are before/after snapshots of
historical source patterns and must stay unlinted; the
`local/type-assertion-boundary` ratchet already documents this. Make sure
the re-include pattern cannot reach fixtures.

## Scope

1. Add `scripts/codemods/**/*.ts` (excluding `**/*.test.ts` and
   `fixtures/**`) to `lintedScriptFiles`; probe the full rule surface.
   Expect a real finding count — this family has never been linted.
2. Fix findings by codemod family (concurrency-guard, expand-barrel,
   structured-logging, trpc-shared-schema, lib) — if one family is too
   noisy, add a temporary no-new message-count ratchet floor for it and
   record that in this leaf's notes rather than stalling the batch.
3. Drain `core-complexity-codemods` and `local-max-lines-codemods` once
   normal lint holds equal-or-stricter floors for non-test sources (their
   ignores already exclude tests, so 03j is not a blocker).
4. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

All non-test, non-fixture codemod sources are under normal lint; the
complexity and max-lines codemod ratchets are drained or replaced by
narrower documented floors; codemod behavior is unchanged (fixture tests
pass untouched).

## Notes

- Adopted codemod sources through an explicit shared `codemodSourceFiles`
  re-include list instead of a broad `scripts/codemods/**/*.ts` glob, so the
  four codemod test files remain parked for 03j and `fixtures/**` stays
  unreachable by normal lint.
- Normal lint now owns the codemod source complexity and max-lines floors.
  Removed `ratchet/core-complexity-codemods` and
  `ratchet/local-max-lines-codemods` from the registry, baseline, and harness
  manifest/docs. `lint:ratchet:update` required an orphan-removal reason even
  for these zero-finding ratchets, so the debt log records the promotion.
- Kept codemod behavior unchanged while fixing the normal-lint findings:
  import ordering/type-import cleanup, explicit `String(...)` for numeric
  template values, one nested-ternary split, one enum comparison fix, one
  return type, and removal of unnecessary generic parameters.
- Added a narrow codemod-source policy override for AST rewrite helper shape:
  `max-params` is capped at 8 and `no-magic-numbers` allows 2 and 3 alongside
  the existing small literal allowances. No temporary message-count ratchet was
  needed.

## Verification

Umbrella gate set, plus the codemod test files run green WITHOUT
modification (`bash scripts/vitest.sh run scripts/codemods/`): they pin
behavior while this batch only touches sources.
