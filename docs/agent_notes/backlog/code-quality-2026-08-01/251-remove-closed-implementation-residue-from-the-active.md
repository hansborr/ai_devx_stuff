# 251. Remove closed implementation residue from the active lint coverage map

Status: Landed on fix/cq-251
Theme: Remove completed leaf implementation instructions from the active lint coverage map · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint coverage map is both a live policy inventory and a contributor-facing
follow-up map, but parts of its hand-maintained prose still describe completed
implementation work in future tense. One live row even recommends draining an
import-sorting rule from a ratchet although normal TypeScript lint already
enforces that rule as an error.

This mixes current policy, actionable debt, and closed implementation history
without distinguishing them. Contributors cannot reliably tell which
follow-ups remain open, so they may repeat completed work or discount genuine
blockers elsewhere in the map.

## Evidence

- `docs/generated/lint-coverage-map.md:409-419` — the portable lint-ratchet
  package and demo are described as future implementation slices that will
  move into a workspace package and join the workspace.
- `tools/lint-ratchet/package.json:1-23` — `@musi/lint-ratchet` already exists
  as a workspace package with governance exports.
- `examples/lint-ratchet-demo/package.json:1-18` — the demo already exists and
  depends on `@musi/lint-ratchet`; root `package.json:6-10` already includes it
  in the workspace.
- `docs/generated/lint-coverage-map.md:223` — the live `scripts/drift-ai.ts`
  row says a follow-up can still drain `simple-import-sort/imports` from its
  ratchet.
- `eslint-config/code-quality-configs.js:189-195` — the TypeScript rule set
  already configures `simple-import-sort/imports` as an error.
- `docs/generated/lint-coverage-map.md:458-487` — the document ends with an
  implementation-notes section that combines landed outcomes, present policy,
  remaining-work assertions, and refresh instructions.
- `docs/generated/lint-coverage-map.md:13-17` and `:228-232` — the document
  declares hybrid ownership: only the marker-delimited drift-ai row is
  generated, while all policy prose remains hand-maintained.
- `package.json:121-125` — the existing map commands include semantic checking,
  ESLint-reach auditing, generation, generated-span freshness checking, and
  suggestions.

## Proposed direction

Audit every factual claim in `docs/generated/lint-coverage-map.md` against the
live repository configuration, runnable scripts, ratchet registry, generated
records, and landed implementation state. This is a full-document truth pass,
not a search-and-replace limited to the examples above.

For each hand-maintained statement, classify its current purpose:

1. Keep and update claims that describe current policy or ownership.
2. Keep unfinished work only when it names a concrete, still-actionable gap
   supported by the live configuration.
3. Remove completed implementation instructions, obsolete future tense, and
   landing chronology. Historical records and git history remain the home for
   that material.

Correct the portable-package paragraph, remove the already-satisfied
import-sorting follow-up, and reduce the closing implementation section to any
current policy or genuinely unfinished actions that survive the full audit.
Do not preserve old audit identifiers merely as chronology.

After the prose audit, run the existing
`bun run docs:lint-coverage-map:check`,
`bun run docs:lint-coverage-map:audit`, and
`bun run docs:lint-coverage-map:generate:check` gates. Review the final diff to
confirm that the generated marker span is byte-identical.

## Scope / caveats

- Apply the full-document factual-claim rule recorded in
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md):
  because this slice exists to make the document true, verify every factual
  claim in the document, not only the claims cited here.
- Land before
  [111-lint-coverage-map-reverse-parses-generated.md](./111-lint-coverage-map-reverse-parses-generated.md)
  so its full-document renderer migrates corrected policy rather than
  preserving stale prose. That proposal explicitly carries policy content
  without changing what it says; this proposal owns the content-truth
  residual.
- [102-generated-doc-ownership-table-misclassifies.md](./102-generated-doc-ownership-table-misclassifies.md)
  corrects the separate ownership description in `docs/generated/README.md`;
  it does not audit or rewrite the map's policy prose.
- [code-quality-2026-07-25/28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md)
  (CQ25-44) relocates the lint-coverage-map family atomically but does not
  correct its content. Land this cleanup before slice 28.11 or fold it into
  that atomic move; never interleave the cleanup and relocation.
- Respect the current hybrid-ownership boundary until
  [111-lint-coverage-map-reverse-parses-generated.md](./111-lint-coverage-map-reverse-parses-generated.md)
  changes it. Do not manually alter any byte between the generated markers.
- Preserve current lint policy and actionable work. This proposal removes
  obsolete documentation residue; it does not weaken lint configuration,
  ratchet floors, or map coverage.
