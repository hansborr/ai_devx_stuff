# 266. Add a human-focused contribution entrypoint

Status: Not started
Theme: Add a human-focused contribution entrypoint · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A human reader can install and start Musi from the root README but cannot find
a human-owned contribution workflow. The Development section delegates the
repository's standards to `AGENTS.md`, even though the documentation index
describes that file as the entrypoint for agents.

Branch, commit-message, push, and pull-request expectations are therefore
discoverable only inside automation instructions or late-stage surfaces.
`README.md:98-125` already documents focused verification and the commit gate,
and `.github/pull_request_template.md:1-22` provides a PR checklist, but neither
forms a human contribution entrypoint. The public onboarding path is complete
for running the project but incomplete for contributing to it.

## Evidence

- `README.md:173-177` — the Development section gives two brief assertions and
  sends readers to `AGENTS.md` for the full standards and conventions.
- `docs/README.md:3-9` — the documentation landing page assigns the root README
  to humans and `AGENTS.md` to agents.
- `AGENTS.md:44-51` — feature/fix branch naming, conventional commits, focused
  verification, the commit gate, push/PR coordination, merge behavior, and
  fast-commit handling are all recorded inside the agent workflow section.
- `.husky/pre-commit:24-30` and `:43-59` — the live commit gate rejects direct
  commits on protected branches and documents its verification and bypass
  boundaries.
- `.husky/commit-msg:4-20` — the live message hook invokes commitlint and prints
  the required conventional subject and non-empty body shape on failure.
- `.husky/pre-push:1-4` and `:134-147` — the live push hook requires fresh full
  verification before publishing commits created under fast-commit mode and
  prints the sanctioned recovery paths.
- `docs/public-release-notes.md:1-5` — the repository records public
  publication as an intended supported state.
- `README.md` — measurement: the exact command
  `git ls-tree -r --name-only ebf096580b31f604861fadb3d4cbd4079da4f017 | rg -i '(^|/)CONTRIBUTING(?:\.[^/]*)?$' | wc -l`
  returns `0`; the pinned repository has no conventionally named contribution
  guide.

## Proposed direction

Add a concise root `CONTRIBUTING.md` and link it prominently from the README's
Development section. Make it the human-owned contribution entrypoint while
leaving `AGENTS.md` as the agent control file.

Cover the core workflow in execution order:

1. Create a `feat/...` or `fix/...` branch rather than committing directly to
   the protected branch.
2. Make focused changes with focused verification, following the relevant
   task guide for specialized work.
3. Use the repository's enforced conventional-commit subject, scope, and body
   shape, and let the normal commit gate run.
4. Before pushing, satisfy any applicable full-verification backstop, push the
   feature branch, and open a pull request for review and integration.

Link authoritative detail rather than reproducing it: task-specific procedures
belong in `docs/guides/`, command definitions belong in package manifests, and
hook behavior belongs in `.husky/`. Include only enough explanation for a
human to find and follow the normal path.

Before landing the guide, compare every branch, commit, verification, push, and
PR statement with the live hooks and current guides. Check that every relative
link resolves and that every named command still exists; documentation must
describe the implemented workflow, not preserve a stale summary from
`AGENTS.md`.

## Scope / caveats

- Do not copy all of `AGENTS.md`, reproduce the task guides, or create another
  exhaustive command reference. `CONTRIBUTING.md` is a short human entrypoint
  that routes readers to the existing authorities.
- Do not change hooks, package scripts, branch protection, or review policy in
  this leaf. If the desired human workflow differs from live enforcement,
  resolve that policy separately before documenting it as fact.
- [103-primary-onboarding-omits-bashunix-runtime.md](./103-primary-onboarding-omits-bashunix-runtime.md)
  also edits the root README, but only to add a host prerequisite. Coordinate
  the shared file; neither proposal subsumes the other.
- [085-specialist-package-script-surface-has-no.md](./085-specialist-package-script-surface-has-no.md)
  owns the contributor-facing command catalog. If it lands first, link that
  catalog for specialist command lookup rather than duplicating it here.
- Keep `docs/README.md`'s human/agent distinction intact: humans should reach
  contribution policy through the README and `CONTRIBUTING.md`, while agents
  continue to receive `AGENTS.md`.
- No 2026-07-25 record covers the missing human contribution entrypoint.
