#!/usr/bin/env bash
# check-fast-uri-override.sh — watchdog for the transitive fast-uri override.
#
# Background: the May 2026 dependency refresh added a root `overrides` entry
# pinning fast-uri to 3.1.2 to lift transitive chains (ajv,
# @fastify/ajv-compiler, fast-json-stringify, json-schema-resolver) off the
# vulnerable fast-uri 3.1.0 they still declare. `bun audit` reports clean
# *because* of that override, so the audit gate alone can never tell us when
# upstream has caught up and the override has quietly become a version-freeze
# that could mask future fast-uri patches.
#
# This guard fails the moment the override stops being load-bearing — i.e. when
# no package in bun.lock hard-pins fast-uri 3.1.0 any more — so the override is
# removed deliberately instead of rotting. It reads package.json + bun.lock
# only; no network, so it is safe to run in CI alongside `bun audit`.
#
# See docs/agent_notes/backlog/fast-uri-override-removal.md.

set -euo pipefail

# The vulnerable version the override exists to displace. A literal exact pin
# is what actually forces the bad version; range specs like "^3.1.0" self-heal
# to a patched release without the override, so matching the bare exact pin is
# the precise "a chain still forces the vulnerable version" signal.
VULNERABLE_PIN='"fast-uri": "3.1.0"'

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MANIFEST="${MUSI_FAST_URI_MANIFEST:-$REPO_ROOT/package.json}"
LOCKFILE="${MUSI_FAST_URI_LOCKFILE:-$REPO_ROOT/bun.lock}"

if [ ! -f "$MANIFEST" ]; then
  printf 'check:fast-uri-override: manifest not found at %s\n' "$MANIFEST" >&2
  exit 2
fi

# fast-uri is not a direct dependency, so its only occurrence in the root
# manifest is the overrides key. If it is gone, the override has already been
# removed and there is nothing left to watch.
if ! grep -qF '"fast-uri"' "$MANIFEST"; then
  printf 'check:fast-uri-override: no fast-uri override in %s — nothing to watch.\n' "$MANIFEST"
  exit 0
fi

if [ ! -f "$LOCKFILE" ]; then
  printf "check:fast-uri-override: %s missing — run 'bun install' before checking.\n" "$LOCKFILE" >&2
  exit 2
fi

if grep -qF "$VULNERABLE_PIN" "$LOCKFILE"; then
  printf 'check:fast-uri-override: override still load-bearing — a chain pins fast-uri 3.1.0.\n'
  exit 0
fi

cat >&2 <<EOF
check:fast-uri-override: the fast-uri override is no longer load-bearing.

No package in $LOCKFILE pins fast-uri 3.1.0 any more, so the root "overrides"
entry now only freezes fast-uri and could mask future patches.

Action:
  1. Remove the "fast-uri" entry from the root package.json "overrides" block.
  2. Run 'bun install' to regenerate bun.lock.
  3. Run 'bun run audit:deps' to confirm the advisory stays clear.
  4. Delete docs/agent_notes/backlog/fast-uri-override-removal.md.
EOF
exit 1
