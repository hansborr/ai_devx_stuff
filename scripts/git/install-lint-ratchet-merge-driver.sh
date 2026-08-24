#!/usr/bin/env bash
# Install local Git config for the lint-ratchet baseline merge driver.
#
# Thin per-metric entry point retained for the shared root dispatcher. The
# versioned package owns the installer implementation.
set -uo pipefail

# Git GUI hook environments can omit Bun from PATH. Installation is advisory;
# the presence checker remains the operator-facing tripwire once Bun is available.
command -v bun >/dev/null 2>&1 || exit 0

exec bun -e 'import("@musi/lint-ratchet/git-rail/executable-cli.js").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- install \
  --adapter scripts/lint-ratchet/engine-binding.ts \
  --repair-command 'bun run lint:ratchet:install-merge-driver'
