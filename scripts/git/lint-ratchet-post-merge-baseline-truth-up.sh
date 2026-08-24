#!/usr/bin/env bash
# Thin per-driver entry point retained for the shared root dispatcher. The
# versioned package owns truth-up behavior.
set -uo pipefail

# Git GUI hook environments can omit Bun from PATH. Truth-up is advisory and
# must preserve any pending marker for the next capable invocation.
command -v bun >/dev/null 2>&1 || exit 0

args=(post-merge --adapter scripts/lint-ratchet/engine-binding.ts --)
[ "${MUSI_RATCHET_POSTMERGE:-}" = "full" ] && args+=(--full)
args+=("${1:-post-merge}")
exec bun -e 'import("@musi/lint-ratchet/git-rail/executable-cli.js").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- "${args[@]}"
