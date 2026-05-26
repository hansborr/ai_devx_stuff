# Lint Reference Roadmap Review Follow-Up

Completed 2026-05-25.

## Summary

Applied review feedback to
`docs/agent_notes/backlog/lint-reference-readiness-roadmap.md` and made Musi
MIT-licensed at the repository metadata level.

## Changes

- Reworked the roadmap from phase sections plus a separate suggested order into
  one ordered implementation backlog.
- Recorded licensing as resolved: root `LICENSE`, `README.md`, and all package
  manifests now state MIT. Workspace package `"private": true` flags remain as
  npm publish protection.
- Kept the document implementation-focused while retaining the short
  correctness principles that justify the order.
- Made harness drift first and zero-baseline cleanup the first substantive
  lint lifecycle leaf.
- Constrained path-policy work to shared data and a shell-friendly, NUL-safe
  interface while leaving staged/base/untracked/deletion semantics with each
  caller.
- Moved changed-format checking after path-policy data and clarified that the
  expected failure is an unformatted staged file, not a formatting-only diff.
- Merged shared ESLint policy extraction, config split, and max-lines/ratchet
  ignore unification into one lower-rework item.
- Added missing follow-ups for ratchet test portability,
  `eslint-rules/*.test.js` lint exceptions, and
  `docs:lint-coverage-map:check` reference readiness.
- Reframed commit-shape validation as policy documentation. Musi preserves
  commit text with non-squash merges, so squash-merge PR title/body checks do
  not apply.

## Verification

- `bunx prettier --check --ignore-unknown LICENSE README.md package.json packages/client/package.json packages/server/package.json packages/shared/package.json docs/agent_notes/backlog/lint-reference-readiness-roadmap.md docs/agent_notes/finished_work/lint-reference-roadmap-review-followup.md docs/agent_notes/LOG.md docs/agent_notes/NEXT.md`
- `jq empty package.json packages/client/package.json packages/server/package.json packages/shared/package.json`
- `git diff --check`
- Targeted `rg` for retired private-distribution/license-blocker wording across
  README and docs returned no matches before this verification note was added.
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` passed in 170s after
  staging the intended files for the duration of the command; the files were
  unstaged afterward.
