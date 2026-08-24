#!/usr/bin/env bash
# Thin root allowlist shim over the package-owned stage restore implementation.
set -uo pipefail

# porting-knob: baseline-restore-allowlist -- retarget generated baseline paths
exec bun -e 'import("@musi/lint-ratchet/git-rail/executable-cli.js").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- restore-stage \
  --usage-command "bun run baseline:restore-stage --" \
  --allow-baseline lint-ratchet.baseline.json \
  --allow-baseline sensor-knip-unused-exports.baseline.json \
  --allow-baseline eslint-config/max-lines-exceptions.baseline.json \
  -- "$@"
