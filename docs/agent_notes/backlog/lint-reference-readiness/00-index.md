# Lint Reference Readiness

Status: Parked task index
Last updated: 2026-05-25

This backlog contains the work needed before treating Musi's lint setup as
reference material for other projects. Promote one task file at a time; agents
implementing a task should not need to read every other task note.

Keep adopter-facing strategy in PR descriptions, decision records, and
`docs/guides/lint-ratchet.md`. This folder is for implementation work.

## Scope

The goal is not maximum rule count or every suggested optimization. The goal is
a lint system that is correct, explainable, portable, and easy to copy without
inheriting Musi-specific maintenance traps.

Reference-quality lint infrastructure needs two properties:

1. A copied setup should fail closed. Missing tools, empty globs, stale
   manifests, and duplicated path filters should fail loudly rather than
   becoming silent no-op coverage.
2. Policy should have one owner. Another project copying Musi's patterns
   should know where to change file scopes, allowlists, ratchet lifecycle
   decisions, and external tool provisioning.

The full review verdict table and resolved licensing discussion were removed
from this active backlog. Musi is MIT-licensed; no implementation task remains
for licensing. Historical context is in
`docs/agent_notes/finished_work/lint-reference-roadmap-review-followup.md` and
git history.

## Promotion Rules

1. Promote exactly one task file into `docs/agent_notes/NEXT.md`.
2. Re-run live audit commands named by the task before implementing; counts in
   these notes are snapshots from 2026-05-25.
3. If a promoted task is still too large, split it again and record that
   decision instead of broadening the active leaf.
4. When a task lands, update durable handoff notes and this index only if the
   backlog order or task status changed.

## Reference Repo Sync

The public/reference dump at `/home/node/tmp/ai_devx_stuff` is currently out of
date. Do not sync it during intermediate leaves. At the end of the
lint-reference readiness cycle, sync the DX-shaped upstream changes from
`/workspace` into that repo using
`/home/node/tmp/ai_devx_stuff/docs/agent_notes/sync-from-upstream.md`.

## Ordering

Tasks are ordered for lowest rework. Harness drift is first because it is
small and prevents documentation lies. Zero-baseline lifecycle cleanup is the
first substantive lint lifecycle work. Correctness and portability come before
performance work. Path-policy infrastructure is split into model, shell
interface, and caller-family migrations so agents can review one boundary at a
time.

1. `01-harness-controls-drift.md` - fix harness controls drift.
2. `02-zero-baseline-normal-covered.md` - retire or narrow zero-baseline rows
   already covered by normal lint.
3. `03-zero-baseline-complexity-core.md` - decide zero-baseline complexity and
   core script ratchets.
4. `04-zero-baseline-max-lines.md` - decide script-family max-lines
   zero-baseline ratchets.
5. `05-zero-baseline-type-assertion.md` - decide the broad
   `local/type-assertion-boundary` zero-baseline ratchet.
6. `06-zero-baseline-strict-boolean.md` - decide the shared strict-boolean
   zero-baseline ratchet.
7. `07-zero-baseline-top-level-typescript.md` - decide top-level script
   type-aware zero-baseline ratchets.
8. `08-zero-baseline-codemod-tests.md` - decide codemod test zero-baseline
   ratchets.
9. `09-zero-baseline-script-tests.md` - decide script and drift test
   zero-baseline ratchets.
10. `10-zero-baseline-custom-rule-tests.md` - clean or document custom-rule
    test and small regex zero-baseline ratchets.
11. `11-zero-baseline-lifecycle-check.md` - add the checked lifecycle gate
    after the current zero rows are triaged.
12. `12-ratchet-registry-safe-default.md` - make registry validation part of
    the safe local default.
13. `13-path-policy-inventory.md` - inventory duplicated path policies.
14. `14-path-policy-data-model.md` - introduce shared path-policy data.
15. `15-path-policy-shell-interface.md` - expose path-policy data through a
    shell-safe interface.
16. `16-path-policy-lint-callers.md` - migrate lint callers to shared
    path-policy data.
17. `17-path-policy-format-callers.md` - migrate format callers to shared
    path-policy data.
18. `18-path-policy-source-smoke-callers.md` - migrate source-relevance and
    script-smoke callers.
19. `19-changed-format-check.md` - add local changed-format checking.
20. `20-external-tool-provisioning.md` - provision system lint tools and report
    versions.
21. `21-external-tool-dev-parity.md` - mirror provisioning in devcontainer and
    onboarding docs.
22. `22-lint-agent-changed-semantics.md` - rename the lint-agent local-rule
    envelope commands.
23. `23-eslint-shared-policy.md` - extract shared ESLint restriction and
    surface policy.
24. `24-eslint-max-lines-policy.md` - unify large-file caps with ratchet
    ignores.
25. `25-eslint-config-composition.md` - split the remaining ESLint config only
    where justified.
26. `26-ratchet-registry-builders.md` - add ratchet family builders after
    zero-baseline cleanup.
27. `27-ratchet-test-portability.md` - verify the ratchet test copy story.
28. `28-lint-coverage-map-readiness.md` - document coverage-map in the
    reference design.
29. `29-ratchet-adopter-quickstart.md` - add a short first-ratchet quickstart.
30. `30-local-rule-adopter-docs.md` - improve local-rule catalog and
    JavaScript-rule rationale.
31. `31-ratchet-run-grouping.md` - investigate compatible ratchet run grouping.
32. `32-ci-parallelization.md` - investigate CI validate parallelization.
33. `33-ci-commit-shape-validation.md` - document commit-shape policy without
    adding CI enforcement.

## Explicit Non-Goals

- Post-edit ratchets. Tidy hooks should stay fast, mechanical, and
  non-blocking.
- Changed-only ratchets until proven safe. Symmetric ratchets can change
  because of rule source, config, parser, plugin, baseline, or dependency
  changes.
- Custom-rule TypeScript migration for now. Direct JavaScript keeps local rules
  loadable before a build step.
- Pre-commit trivial-change shortcuts for now. Use success markers, bounded
  parallelism, ratchet retirement, and measured runner optimization first.
