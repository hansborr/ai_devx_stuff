#!/usr/bin/env sh
# Record a content digest of bun.lock after `bun install` so dependency
# freshness checks (scripts/dependency-freshness.sh, used by doctor and the
# Husky pre-commit hook) compare lockfile CONTENT rather than mtime.
#
# Why: `bun install` re-saves bun.lock on every run — even a no-op — which
# bumps its mtime ~1s past node_modules/.bin. The old `bun.lock -nt .bin`
# check then reported a phantom 'stale' right after a clean install and the
# nudge to "run 'bun install'" never cleared it.
#
# Wired as the repo-root `postinstall` lifecycle script. Best-effort by
# design: it must never fail an install, so every path exits 0.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || exit 0
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)" || exit 0

# shellcheck source=scripts/dependency-freshness.sh
. "$SCRIPT_DIR/dependency-freshness.sh" || exit 0
musi_dependency_write_marker "$REPO_ROOT" || true
exit 0
