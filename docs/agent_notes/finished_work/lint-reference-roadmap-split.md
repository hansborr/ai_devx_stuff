# Lint Reference Roadmap Split

Completed 2026-05-25.

## Summary

Split `docs/agent_notes/backlog/lint-reference-readiness-roadmap.md` into a
small compatibility pointer plus a dedicated
`docs/agent_notes/backlog/lint-reference-readiness/` task folder.

## Changes

- Added `00-index.md` as the promotion index and ordering source.
- Added one document per implementation task so agents can promote a single
  leaf without reading the entire roadmap.
- Follow-up refinement expanded the active backlog to 33 task files so
  path-policy work can land one boundary at a time.
- Trimmed active backlog noise: the full review verdict table, resolved
  licensing detail, and repeated reviewed/updated provenance are no longer in
  implementer task notes.
- Split oversized tasks:
  - zero-baseline cleanup into normal-covered, complexity/core, max-lines,
    type-assertion, strict-boolean, top-level TypeScript, codemod-test,
    script-test, custom-rule-test, and lifecycle-check leaves;
  - shared path policy into inventory, data model, shell interface, lint caller
    migration, format caller migration, and source-relevance/script-smoke caller
    migration;
  - external tool work into CI/tool provisioning and dev parity docs;
  - ESLint config work into shared policy, max-lines policy, and final
    composition split;
  - adopter docs into ratchet quickstart and local-rule documentation leaves.
- Updated the backlog README pointer to the new folder index.

## Verification

- `bun run lint:ratchet:zero-baseline` was used to split the zero-baseline
  leaves against the live 44-row snapshot.
- `bunx prettier --check --ignore-unknown docs/agent_notes/backlog/lint-reference-readiness-roadmap.md docs/agent_notes/backlog/lint-reference-readiness/*.md docs/agent_notes/backlog/README.md docs/agent_notes/LOG.md docs/agent_notes/NEXT.md docs/agent_notes/STATUS.md docs/agent_notes/finished_work/lint-reference-roadmap-split.md`
- `git diff --check`
