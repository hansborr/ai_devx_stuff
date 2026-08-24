#!/usr/bin/env bash
# Read-only health check for the lint-ratchet baseline merge driver.
#
# Thin per-metric entry point retained for root callers. The versioned package
# owns the read-only check implementation.
set -euo pipefail

exec bun -e 'import("@musi/lint-ratchet/git-rail/executable-cli.js").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- check \
  --adapter scripts/lint-ratchet/engine-binding.ts \
  --repair-command 'bun run lint:ratchet:install-merge-driver'
