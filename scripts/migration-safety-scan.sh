#!/usr/bin/env bash
# migration-safety-scan.sh — Prisma migration safety scanner (DX8.1a/b).
#
# Thin exec-forwarder. The scanner itself — SQL lexing, the four destructive
# operation rules, allowlist and stale-acknowledgement policy, and both the
# human and `--json` renderings — lives in TypeScript under
# `scripts/lib/migration-safety-cli.ts` (backlog leaf 119). This file survives
# at its exact path because `scripts/doctor.sh` and the smokes invoke the
# scanner by path, and it keeps the frozen CLI contract: `--json`, positional
# PATH arguments, `--` end-of-options, warn-only exit 0, and invocation from any
# working directory.
#
# Usage:
#   bash scripts/migration-safety-scan.sh                # scan every migration
#   bash scripts/migration-safety-scan.sh PATH ...       # scan specific
#                                                          migration dirs or
#                                                          .sql files
#   bash scripts/migration-safety-scan.sh --json         # diagnostics envelope
#   bash scripts/migration-safety-scan.sh --help

set -uo pipefail

# Resolve script-relative so the scanner works from any cwd; tests run from a
# sandbox directory where a repo-relative module path would not resolve.
SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

exec bun "$SCRIPT_DIR/lib/migration-safety-cli.ts" "$@"
