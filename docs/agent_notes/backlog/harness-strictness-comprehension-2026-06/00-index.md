# Harness Strictness & Comprehension Backlog (2026-06-15)

> **Status: HC-1 landed (`1fdea456`); HS-1 is half-landed** (reconciled
> 2026-07-19). The PR template carries the `## Intent / Comprehension`
> section, and two of HS-1's four flags shipped 2026-06-22:
> `noFallthroughCasesInSwitch` (`f6fd1c81`) and `noImplicitOverride`
> (`88092cfd`) are on in `tsconfig.base.json`. The residue — a
> measurement-first discovery pass for `exactOptionalPropertyTypes` and
> `noPropertyAccessFromIndexSignature` — is tracked in
> `../ready-2026-07/00-index.md`. **Update 2026-07-25:** that discovery pass
> (leaf 01 steps 1–2) is done and recorded in
> [03](03-strictness-flag-error-inventory.md); the promotion decision (leaf 01
> steps 3–6) is still open and no flag was flipped.

## Source

Requested from the harness-engineering research notes:

- `../../harness-engineering-research/04-static-analysis-and-ci-cd-gates.md`
- `../../harness-engineering-research/13-typescript-react-storybook.md`
- `../../harness-engineering-research/17-team-process-and-org.md`

The repo already has `strict`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, and (since 2026-06-22) `noFallthroughCasesInSwitch`
and `noImplicitOverride` in `tsconfig.base.json`. It does not currently
enable `exactOptionalPropertyTypes` or `noPropertyAccessFromIndexSignature`.

The PR template currently keeps `bun run verify:changed` in the test plan, but
has no explicit intent/comprehension prompt beyond `Summary`.

## Items

| ID | Item | Plan | Effort | Risk |
| --- | --- | --- | --- | --- |
| HS-1 | Ratchet remaining TypeScript strictness flags — half-landed: `noFallthroughCasesInSwitch` + `noImplicitOverride` on (2026-06-22); residue = discovery pass for the two harder flags | [01](01-typescript-strictness-ratchets.md) | M-L | medium |
| HC-1 | Strengthen PR template around human comprehension — **DONE** (`1fdea456`) | leaf 02 (removed at the 2026-07-19 triage; git history) | S | low |
| — | HS-1 discovery pass: measured per-flag `tsc` error inventory for the two open flags (2026-07-25) — **DONE**, no flag flipped | [03](03-strictness-flag-error-inventory.md) | M | low |

## Suggested Sequencing

1. HC-1 shipped (`1fdea456`); its leaf 02 was removed at the 2026-07-19
   triage (git history).
2. Promote [01](01-typescript-strictness-ratchets.md) as a measured ratchet, not
   a blind flag flip. Start with discovery and per-flag error inventories before
   deciding whether the first implementation PR enables a flag globally,
   package-by-package, or through a generated baseline/check.
3. That discovery step is now done — read
   [03](03-strictness-flag-error-inventory.md) before proposing an adoption
   path. It carries the measured counts (838 and 404 unique diagnostics), the
   dominant error families, and one open owner question about whether the
   mechanical repair should be allowed to hide two type-modelling smells.

## Non-Goals

- Do not weaken the existing `verify:changed` expectation in the PR template.
- Do not enable all missing TypeScript flags in one unmeasured change.
- Do not add slow or noisy checks to `verify:changed` without a clear latency and
  repair-text review.
