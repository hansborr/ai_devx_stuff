#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Generator runs clean and writes the file.
bun run docs:lint-guidance >/tmp/leaf23-gen.out 2>&1
test -s docs/generated/local-lint-rules.md

# Check mode passes after generation.
bun run docs:lint-guidance:check >/tmp/leaf23-check.out 2>&1
grep -q 'up to date' /tmp/leaf23-check.out

rm -f /tmp/leaf23-gen.out /tmp/leaf23-check.out
echo "PASS: generate-lint-guidance smoke"
