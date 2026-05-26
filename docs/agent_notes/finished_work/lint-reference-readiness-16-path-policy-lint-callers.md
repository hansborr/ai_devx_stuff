# Lint Reference Readiness: Path Policy Lint Callers

Completed 2026-05-25.

- `lint-changed.sh`, `lint-agent-changed.sh`, `lint-config-sensors.sh`,
  `lint-shell.sh`, and `verify-metadata.sh` now query
  `scripts/path-policy-query.ts` for path-surface classification instead of
  carrying local extension/glob classifiers.
- The callers still own changed/base/untracked/deletion behavior, existing-file
  filtering, and full-scan fallbacks. Path-policy query invocations use
  `bun --config=/dev/null` so a changed or invalid repo `bunfig.toml` cannot
  break classification.
- Regression coverage was added for JSON/JSONC selection, deleted files,
  unsupported paths, config full-scan triggers, and source/deletion metadata
  helpers.
