# drift:ai knip include selection

Date: 2026-05-31

Task: `/home/node/drift-ai-review/28-knip-include-set-aware-runner.md`

Landed selected-check-aware knip include categories:

- `--check orphan-files` resolves `--include files`.
- `--check unused-exports` resolves `--include exports,types,enumMembers,namespaceMembers`.
- Both knip checks, including `--check all`, resolve the full shared category set
  and still share one memoized spawn.

The memo key now includes include categories in addition to repo root, bin,
config path, and timeout budget.
