# 222. Make multiclass prerequisite table states exclusive and non-empty

Status: Not started
Theme: Multiclass prerequisite types admit rule states the table never defines · Area: shared · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The multiclass table uses two distinct rule forms: every listed ability is
required, or at least one listed group is required. Its exported value type
models both forms as optional containers, so it also admits no form, both forms,
empty requirement maps, and empty group lists even though no table row defines
those states.

Those impossible values do not fail uniformly. Empty requirements can pass
vacuously, empty alternatives produce malformed failure text, and a mixed row
silently acquires implicit AND semantics because the evaluator runs both
branches. A future table edit can therefore typecheck while introducing
behavior that has no stated rules meaning.

## Evidence

- `packages/shared/src/rules/multiclass-rules.ts:18-28` — both `all` and `anyOf`
  are optional, `AbilityRequirements` is a `Partial<Record<...>>`, and `anyOf`
  is an ordinary array; the types admit neither mode, both modes, empty maps,
  and an empty group list.
- `packages/shared/src/rules/multiclass-rules.ts:30-49` — all actual SRD
  class rows use exactly one mode, with at least one ability requirement and,
  for Fighter, a non-empty alternatives list.
- `packages/shared/src/rules/multiclass-rules.ts:69-85` — `.every(...)` makes an
  empty requirement group pass, while `.some(...)` rejects an empty group list
  and the empty descriptions array renders the malformed message
  `" required"`.
- `packages/shared/src/rules/multiclass-rules.ts:92-99` — the public lookup
  preserves an unknown-class fallback of no failures, then independently runs
  both optional branches, giving a mixed row implicit AND behavior.
- `packages/shared/src/rules/multiclass-rules.test.ts:117-155` — focused tests
  pin the current SRD table, normal all/any-of evaluation, and the unknown-ID
  fallback, but contain no malformed-state shape coverage.
- `docs/guides/change-rules-logic.md:7-10,21-33` — the standing rules guide
  requires rule provenance to be named, tables to remain reviewable, boundary
  states to be explicit, and focused shared tests to prove observable behavior.

## Proposed direction

Replace `MulticlassPrerequisite` with an exclusive union:

- an `all` variant containing a requirement map whose type requires at least
  one `AbilityAbbreviation`, with `anyOf` excluded;
- an `anyOf` variant containing a non-empty tuple of non-empty requirement
  maps, with `all` excluded.

Express exclusion with `never` fields or an equivalently inference-visible
union, and use a named non-empty requirement-map helper rather than a broad
`Partial<Record<...>>`. Keep the table checked against
`Readonly<Record<SrdClassId, MulticlassPrerequisite>>` while preserving every
existing row verbatim.

Refactor the evaluator to narrow once on the exclusive variant and execute one
branch, making the two modeled modes exhaustive instead of independently
optional. Preserve the public `classId: string` input and its unknown-ID empty
result.

Extend the focused test with compile-time shape cases rejecting `{}`, a mixed
row, empty `all`, an empty `anyOf` tuple, and an empty group. Retain evaluator
scenarios for both valid variants and every current row. Name the numeric/table
expectations as SRD 5.2.1 provenance, and name the exclusivity/non-empty cases
as representation invariants rather than presenting them as new numeric rules.

## Scope / caveats

- Do not change the prerequisite score, any class's abilities, AND/OR behavior
  for existing rows, failure strings for valid rows, or the public unknown-ID
  fallback.
- The non-empty constraint applies at both levels of `anyOf`: the tuple must
  contain a group, and every group must contain an ability requirement.
- `CQ25-115` in
  `code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md:560` retyped the table keys to
  `SrdClassId` while preserving numeric behavior and public string-lookup
  fallbacks. This proposal closes the remaining inference-visible impossible
  states in the table values; it does not revisit that key or fallback work.
- [026-monster-provenance-invariants-disappear.md](./026-monster-provenance-invariants-disappear.md)
  applies a related exclusive-state technique to monster provenance. Its
  schemas, runtime diagnostics, and consumers are distinct from this
  multiclass rules-table contract, so neither proposal should absorb the
  other.
