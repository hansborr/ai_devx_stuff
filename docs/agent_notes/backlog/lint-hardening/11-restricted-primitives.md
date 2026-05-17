# Leaf 11: Restricted Primitives

Status: Partial landing (2026-05-16); process.exit gated.
Depends on: Leaf 1 preferred

Dependency detail: Leaf 1 is preferred so newly restricted primitives can land
as deterministic errors after cleanup. A small local-rule or
`no-restricted-*` inventory can still run before Leaf 1 if it stays
report-only or uses a throwaway config.

## Problem

Some dangerous primitives should be allowed only at named boundaries. This
should be a small disallowed-methods layer using `no-restricted-properties`,
`no-restricted-syntax`, or a local rule when stock rules cannot express the
scope cleanly.

Every diagnostic must name the sanctioned helper, wrapper, or allowed boundary.

## Candidate Primitives

- `process.exit(...)`: allow only CLI/bootstrap scripts that must terminate the
  process; prefer `process.exitCode` elsewhere.
- Raw `fetch(...)`: allow the tRPC refresh/upload wrappers and deliberate
  utility boundaries; prefer the app's API/client helper path elsewhere.
- Direct `process.env` reads: defer as a gate until each package has a named env
  boundary. Server app code has `loadServerEnv`, but Vite config, Prisma config,
  seed scripts, test harnesses, and script entrypoints are legitimate direct
  readers today.
- `Date.now()` / `new Date()` in deterministic shared rules or server domain
  services: defer until a clock helper exists. Tests, serializers/parsers, and
  UI relative-time display stay exempt.
- Direct timers or polling loops in tests: only lint after a helper exists for
  the specific wait pattern.

## Rollout

1. Inventory current use with `rg` before writing a rule.
2. Write allowlists as data plus comments in `eslint.config.js`, or as fixtures
   in a local rule test.
3. Ensure the diagnostic names the helper, wrapper, or allowed boundary.
4. Use report-only output if the first pass finds many legacy callers.
5. Promote to `error` only when the sanctioned alternative is obvious from the
   diagnostic.

## Best First Candidate

Start with `process.exit(...)`, because the inventory is small and the allowed
surface is mostly scripts/bootstrap. Raw `fetch(...)` may also be low-noise
because current direct calls appear concentrated in the tRPC refresh and upload
wrapper paths.

## Implementation Result

2026-05-16: Landed the `process.exit(...)` slice as a scoped
`no-restricted-syntax` error in `eslint.config.js`.

- Direct `process.exit(...)` calls are banned outside a 6-file CLI/bootstrap
  allowlist.
- The pre-completed inventory found 9 sites across those 6 files, all
  legitimate process-terminating contexts; no call sites were migrated in this
  slice.
- The diagnostic points callers to `process.exitCode = N` plus return/throw,
  or to documenting the file as an allowlisted bootstrap entrypoint.
- Raw `fetch(...)`, direct `process.env` reads, `Date.now()` / `new Date()`,
  and direct timers remain deferred candidates.

## Verification

- `rg` inventory before and after the change.
- `bun run lint -- --max-warnings=0`
- `bun run vitest run --project=eslint-rules` if adding or changing a local
  rule.
- `bun run verify:changed`
- If a primitive is rejected, deferred, scoped, or fully adopted with caveats,
  append a row to `evaluation-verdicts.md` before closing the slice.
