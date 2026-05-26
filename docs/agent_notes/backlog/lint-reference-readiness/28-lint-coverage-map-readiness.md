# Document Lint Coverage Map Design

Status: Done
Order: 28
Landed: see finished_work/task-28-lint-coverage-map-readiness.md

## Context

Pre-commit runs `docs:lint-coverage-map:check -- --check-eslint-reach
--staged` as a parallel gate. This infrastructure is novel enough that
reference readers need to understand how it fits the lint-ratchet and local-rule
design. The accepted direction is to document it as part of the recommended
reference design, not to treat it as Musi-only internal machinery.

## Scope

- Add authored documentation explaining the coverage-map check's role in the
  recommended lint-ratchet/local-rule design.
- Cover why ESLint reachability matters, how the staged pre-commit mode differs
  from full checks, and what adopters should copy or adapt.
- Link the explanation from the lint-ratchet and/or local-rule docs where an
  adopter would encounter local-rule coverage responsibilities.
- If implementation gaps appear while documenting, split focused follow-up tasks
  instead of reopening the reference-readiness decision.

## Definition Of Done

The lint-ratchet/local-rule docs describe the coverage-map check as a
recommended part of the reference design.

## Verification

- `bun run docs:lint-coverage-map:check -- --staged`
- Documentation formatting checks for edited docs
- `bun run verify:changed` if scripts/docs gates change
