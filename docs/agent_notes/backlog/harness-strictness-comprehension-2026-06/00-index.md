# Harness Strictness & Comprehension Backlog (2026-06-15)

> **Status: HC-1 landed (`1fdea456`); HS-1 remains a proposal.** The PR
> template now carries the `## Intent / Comprehension` section; the TypeScript
> strictness ratchets (HS-1) are still an unstarted, measurement-first proposal.
> These leaves translate two harness-engineering research follow-ups into
> reviewable work items.

## Source

Requested from the harness-engineering research notes:

- `../../harness-engineering-research/04-static-analysis-and-ci-cd-gates.md`
- `../../harness-engineering-research/13-typescript-react-storybook.md`
- `../../harness-engineering-research/17-team-process-and-org.md`

The repo already has `strict`, `noUncheckedIndexedAccess`, and
`verbatimModuleSyntax` in `tsconfig.base.json`. It does not currently enable
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`noImplicitOverride`, or `noFallthroughCasesInSwitch`.

The PR template currently keeps `bun run verify:changed` in the test plan, but
has no explicit intent/comprehension prompt beyond `Summary`.

## Items

| ID | Item | Plan | Effort | Risk |
| --- | --- | --- | --- | --- |
| HS-1 | Ratchet remaining TypeScript strictness flags | [01](01-typescript-strictness-ratchets.md) | M-L | medium |
| HC-1 | Strengthen PR template around human comprehension — **DONE** (`1fdea456`) | [02](02-pr-comprehension-template.md) | S | low |

## Suggested Sequencing

1. Ship [02](02-pr-comprehension-template.md) first. It is tiny, low-risk, and
   reinforces the human-side review expectation immediately.
2. Promote [01](01-typescript-strictness-ratchets.md) as a measured ratchet, not
   a blind flag flip. Start with discovery and per-flag error inventories before
   deciding whether the first implementation PR enables a flag globally,
   package-by-package, or through a generated baseline/check.

## Non-Goals

- Do not weaken the existing `verify:changed` expectation in the PR template.
- Do not enable all missing TypeScript flags in one unmeasured change.
- Do not add slow or noisy checks to `verify:changed` without a clear latency and
  repair-text review.
