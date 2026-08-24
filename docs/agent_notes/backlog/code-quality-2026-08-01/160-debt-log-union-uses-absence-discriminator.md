# 160. Accepted debt is the only debt-log variant whose kind is inferred from a missing discriminator

Status: Landed on fix/cq-160
Theme: discriminated persistence contract · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The committed lint-ratchet debt log models four record variants, but accepted
debt is the only one without a `kind` field. Its current writer preserves that
historical shape, and downstream code recognizes it indirectly through the
presence of `acceptanceReason`.

This makes historical compatibility the current authoring contract. Adding a
record kind requires coordinated edits across interfaces, schemas, predicates,
parsing, accounting, summary counts, and rendering. TypeScript cannot enforce
exhaustive dispatch because the union is not uniformly discriminated. An
unrecognized `kind` also falls into the accepted-debt parser and produces
accepted-schema diagnostics instead of naming the unsupported record kind,
making malformed persisted data harder to diagnose.

## Evidence

- `tools/lint-ratchet/src/governance/debt-log-schema.ts:23-66` — the accepted-debt interface has `version`, `acceptanceReason`, `regressions`, and `orphansRemoved`; the retirement, metric-migration, and coverage-shrink interfaces all carry literal `kind` fields.
- `tools/lint-ratchet/src/governance/debt-log-schema.ts:68-90` — four exported predicates classify the union; accepted debt is detected with `"acceptanceReason" in entry`, while the other three test `entry.kind`.
- `tools/lint-ratchet/src/governance/debt-log-schema.ts:338-350` and `:409-420` — the accepted schema has no discriminator, and the parser’s `default` switch arm sends both missing and unrecognized kinds to that strict schema.
- `tools/lint-ratchet/src/governance/debt-log-write.ts:57-67` — `buildLintRatchetDebtLogEntry` still emits accepted-debt records without `kind`; `:115-128` then reparses every entry before appending it.
- `tools/lint-ratchet/src/governance/debt-log.ts:93-181` — semantic classification, four-way rendering, and both summary counts are implemented as overlapping predicate chains rather than exhaustive `entry.kind` switches.
- `tools/lint-ratchet/src/governance/baseline-debt-accounting-chains.ts:10-23` and `baseline-debt-accounting-lifecycle.ts:69-83,106-134` — accounting consumers repeat the same predicate-based variant classification.
- `lint-ratchet.debt-log.jsonl:1-15` — the committed log contains 15 records: lines 1-13 are kind-less accepted-debt records, line 14 is `coverage-shrink`, and line 15 is `retirement`.

## Proposed direction

1. Make newly authored accepted debt explicit. Add required
   `kind: "accepted-debt"` to `LintRatchetAcceptedDebtLogEntry`, require the
   literal in the accepted-entry schema, and emit it from
   `buildLintRatchetDebtLogEntry`. Update the hand-written-interface design
   comment at `debt-log-schema.ts:15-21` to explain that persisted legacy input
   is normalized before entering the typed union. Land the schema and writer
   together because `appendValidatedDebtLogEntries` validates its own inputs
   before writing.

2. Confine compatibility to `parseLintRatchetDebtLogEntry`. Define the legacy
   version-1 accepted schema once and derive the kinded schema from it, so field
   changes cannot make the two variants drift. Switch on `value.kind`: route
   every known literal to its schema, route only `undefined` through the legacy
   schema, and stamp a successfully parsed legacy record with
   `kind: "accepted-debt"`. Reject every other defined kind with an explicit
   `unknown debt-log entry kind` failure. Do not rewrite the 13 committed
   kind-less lines.

3. Treat everything downstream of that parser as a fully discriminated union.
   Convert `formatEntrySection`, report summary classification, and the
   accounting code in `baseline-debt-accounting-chains.ts` and
   `baseline-debt-accounting-lifecycle.ts` to `switch (entry.kind)` dispatch.
   Use the existing `assertNever` at
   `tools/lint-ratchet/src/kernel/runtime-config.ts:22-23` as the compile-time
   exhaustiveness backstop. Remove the four exported shape predicates where
   native narrowing replaces them; retain semantic questions such as
   `isLegacyRemovalOnlyEntry` and `isAcceptedDebtRecord` as ordinary functions
   over the discriminated type.

4. Drive the change with focused coverage for legacy-line normalization,
   explicit unknown-kind diagnostics, and writer output. Add a fixture check
   that parses the committed mixed-vintage JSONL and passes its normalized
   entries through `appendValidatedDebtLogEntries`’ validation-before-append
   path. Preserve report headings, counts, tables, and append order.

## Scope / caveats

- The `testId` to `ratchetId` vocabulary migration is separate work recorded as
  CQ25-74 in
  [36-lint-ratchet-vocabulary.md](../code-quality-2026-07-25/36-lint-ratchet-vocabulary.md).
  It touches some of the same files, but there is no required ordering; whichever
  change lands second should rebase its schema and fixture edits.
- Do not rewrite committed log history, alter regression or orphan-removal row
  schemas, change `REGRESSION_SHAPE_RULES`, or revise renderer wording.
- Unknown kinds already fail because the accepted schema is strict. The intended
  behavior change is a precise kind-level diagnostic rather than an
  accepted-schema `unknown key(s): kind` failure; update any fixture that pins
  the old message.
- Making `kind` required affects every accepted-entry object literal. Typed
  construction sites should fail compilation when missed, but cast or raw-JSON
  fixtures can instead reach the append-time `ConfigError`, so sweep both
  production writers and tests.
- The legacy and current schemas must share one field definition. Hand-copying
  them would recreate the synchronization problem at the compatibility boundary.
- Tail deduplication at `debt-log-write.ts:129-133` compares the newly serialized
  batch with itself at the file tail; adding `kind` to new lines does not collide
  with historical kind-less lines.
