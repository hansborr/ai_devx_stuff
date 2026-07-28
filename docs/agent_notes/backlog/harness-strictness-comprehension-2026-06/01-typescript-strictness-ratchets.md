# 01 - TypeScript strictness ratchets

Status: Partial — `noFallthroughCasesInSwitch` (`f6fd1c81`) and
`noImplicitOverride` (`88092cfd`) landed in `tsconfig.base.json` 2026-06-22.
Open residue: promotion (steps 3–6) for `exactOptionalPropertyTypes` and
`noPropertyAccessFromIndexSignature`. **Steps 1–2 are done (2026-07-25) —
see [03](03-strictness-flag-error-inventory.md)** for the measured per-flag,
per-project inventory, the error families, and the recommended first flag.
Neither flag has been flipped. Re-verify current compiler errors before
promotion; TypeScript diagnostics drift quickly as code changes.

## Problem

The harness research recommends enabling TypeScript's strictest practical guard
flags for agent-heavy development. Musi already has a strong base:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`
- unused locals/parameters enabled
- `noFallthroughCasesInSwitch: true` (landed 2026-06-22, `f6fd1c81`)
- `noImplicitOverride: true` (landed 2026-06-22, `88092cfd`)

Of the four flags this leaf originally proposed, two are now on (the two above).
Two useful strictness flags remain off in `tsconfig.base.json`:

- `exactOptionalPropertyTypes`
- `noPropertyAccessFromIndexSignature`

These catch common AI-generated mistakes, but they are broad compiler behavior
changes. Treat them as ratchets with measured baselines and repair guidance, not
as a single repo-wide flip. The two landed flags' sections below are kept as the
historical record of how they were introduced.

## Candidate Flags

### `noFallthroughCasesInSwitch`

Likely the cheapest first flag. It catches accidental missing `break`, `return`,
or `throw` in switches. If intentional fallthrough exists, make it explicit by
rewriting the branch shape rather than relying on comments unless TypeScript's
diagnostic accepts the comment form in the current compiler.

### `noImplicitOverride`

Useful anywhere classes extend framework or domain base classes. The likely
repair is mechanical: add `override` to methods that intentionally override a
base member, or rename/remove members that were accidentally shadowing. This is
often a good second flag if the diagnostic count is small.

### `noPropertyAccessFromIndexSignature`

Forces `obj["dynamicKey"]` when a property comes only from an index signature.
This is a useful clarity rule around maps and dictionaries, but it can create
churn in config, JSON-ish, and record-heavy code. Triage diagnostics by package
and prefer typed key unions or explicit properties where the shape is actually
known.

### `exactOptionalPropertyTypes`

Highest value and highest churn. It distinguishes "property may be omitted" from
"property may be present with `undefined`." This matters for Zod/Prisma/tRPC
payload boundaries and React props, but it often exposes existing code that uses
`undefined` as a deletion or omission marker. Enable only after an inventory has
separated real bugs from intentional boundary patterns.

## Proposed Implementation

1. ~~Add a discovery script or one-off documented command that runs typecheck
   with each candidate flag enabled independently. Keep results grouped by
   package and by diagnostic code.~~ **Done 2026-07-25.** Note the two
   corrections found while doing it: `tsc -b` rejects flag overrides
   (`TS5094`), so the runs must be per-project
   `tsc -p <proj> --noEmit --<flag>`; and there are **five** projects, not the
   four named here — `tools/lint-ratchet` joined the workspace.
2. ~~Produce a short inventory in this backlog or `in_progress/` before code
   changes: per-flag diagnostic count, representative examples, false-positive
   categories, and recommended first flag.~~ **Done 2026-07-25** —
   [03](03-strictness-flag-error-inventory.md).
3. Promote the lowest-risk flag first. Prefer a direct `tsconfig.base.json` flip
   only if the error count is low and repairs are uncontroversial.
4. If a flag has too many existing findings, add a dedicated ratchet/check rather
   than weakening the flag's value. Options:
   - package-local temporary `tsconfig` overlays for discovery;
   - a small `scripts/` check that runs `tsc` with one flag and compares a
     committed diagnostic baseline;
   - staged package adoption in package-flow order: `shared` -> `server` ->
     `client`.
5. For each repaired category, prefer type-model fixes over assertions. Use type
   assertions only at the repo's accepted boundaries: framework, JSON, Prisma,
   tests, or `as const`.
6. After the first flag lands, document the adopted repair patterns in the
   implementation PR only if they are not already covered by existing guides.

## TDD / Verification

- Start with the failing compiler diagnostics as the red state.
- Add focused tests only where a diagnostic exposes behavior ambiguity, such as
  optional property omission versus explicit `undefined` in a shared schema or
  server input path.
- Run targeted typecheck commands while iterating, then stage intended
  source-relevant changes and run `bun run verify:changed`.

## Acceptance Criteria

- The promoted flag has an explicit inventory and chosen adoption path.
- Any committed baseline has stable, actionable output and a clear update
  command.
- `tsconfig.base.json` only changes when the repo or selected adoption scope is
  actually green under that flag.
- `bun run verify:changed` remains the final local gate.

## Risks

- `exactOptionalPropertyTypes` can force payload-shape decisions at shared,
  server, and client boundaries. Do not paper over those with broad `| undefined`
  additions.
- `noPropertyAccessFromIndexSignature` can create noisy mechanical churn in
  record-like code. Keep repairs scoped and avoid unrelated renames.
- A custom baseline check adds maintenance cost. Use it only when direct adoption
  is too large for a reviewable PR.
