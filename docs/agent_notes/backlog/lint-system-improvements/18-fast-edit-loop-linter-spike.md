# Fast Edit-Loop Linter Spike

Status: Parked spike
Order: 18

## Context

The source review suggests considering oxlint or Biome for a fast,
approximate, post-edit tier covering mechanical rules that do not need type
information. ESLint would remain authoritative for pre-commit and CI.

Biome adapter guidance now lives in
`docs/guides/biome-lint-adoption.md`. That guide documents how a Biome adopter
could preserve custom repair guidance, the post-edit hook, and lint-ratchet
semantics; it does not replace this spike's measured latency and diff-churn
decision.

This is a measured spike because two lint tools can disagree and autofix churn
can fight Prettier or ESLint.

Re-evaluate the tool landscape at spike time. oxlint and Biome move quickly,
so do not rely on the rule parity or autofix behavior observed in the
2026-05-26 review.

## Scope

- Identify candidate syntax-level or mechanical rules:
  no-var/prefer-const style, obvious unused/import/style rules, simple
  footguns, and possibly import sorting only if compatible with current style.
- Run a latency and diff-churn experiment on representative edits.
- Confirm the fast tier does not conflict with Prettier, ESLint autofix, local
  custom rules, or type-aware policy.
- Keep ESLint as the enforcement gate.
- Record an adopt, narrow, or reject decision.

## Definition Of Done

The repo has measured evidence for whether a fast edit-loop lint tier improves
agent/developer feedback without introducing churn or policy disagreement.

## Verification

- Tool landscape note with audit date, exact versions, and commands tested
- Latency measurements for representative post-edit runs
- Diff-churn comparison against Prettier and ESLint autofix
- `bun run lint -- --max-warnings=0`
