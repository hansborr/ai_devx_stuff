#!/usr/bin/env bash
# Smoke tests for the one-shot code:intel CLI.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

exports_output="$(bun run code:intel -- exports packages/shared/src/schemas/character.ts)"
grep -qF "characterDetailSchema value export" <<< "$exports_output"

dependents_output="$(bun run code:intel -- dependents packages/shared/src/schemas/character.ts)"
grep -qF "packages/server/" <<< "$dependents_output"

printf 'code-intel smoke passed\n'
