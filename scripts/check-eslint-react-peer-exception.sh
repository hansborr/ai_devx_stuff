#!/usr/bin/env bash
# check-eslint-react-peer-exception.sh — watchdog for the ESLint 10 React-plugin
# peer exception.
#
# Background: the ESLint 10 upgrade (2026-05) shipped while two direct
# devDependencies still declared no ESLint `^10` peer range:
#
#   eslint-plugin-react    peerDependencies.eslint = "... || ^9.7"  (caps at 9)
#   eslint-plugin-jsx-a11y  peerDependencies.eslint = "... || ^9"   (caps at 9)
#
# Bun only *warns* on a peer-version mismatch (it does not hard-fail like npm's
# ERESOLVE), and ESLint does not enforce plugin peers at runtime, so both
# plugins install and run under ESLint 10 anyway. We therefore knowingly run
# them on an unsupported engine — a deliberate *peer exception*, not an
# `overrides` entry (Bun overrides force resolved versions; they cannot widen a
# peer range).
#
# This guard fails the moment the exception is obsolete — i.e. once BOTH plugins
# ship a peer range that admits ESLint 10 — so the exception is removed
# deliberately instead of rotting. It reads each plugin's installed
# package.json only (no network), so it is safe to run in CI alongside
# `bun audit`.
#
# See docs/agent_notes/backlog/eslint-react-peer-exception-removal.md.

set -euo pipefail

# The ESLint major the exception exists to tolerate. The plugins are supported
# again once their peer range admits this version.
ESLINT_TARGET="10.0.0"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REACT_PKG="${MUSI_ESLINT_REACT_PKG:-$REPO_ROOT/node_modules/eslint-plugin-react/package.json}"
JSXA11Y_PKG="${MUSI_ESLINT_JSXA11Y_PKG:-$REPO_ROOT/node_modules/eslint-plugin-jsx-a11y/package.json}"

# peer_admits_target <plugin-label> <package.json-path>
# Prints the plugin's peerDependencies.eslint range to stdout and returns:
#   0 — the range admits $ESLINT_TARGET (plugin now supports ESLint 10)
#   1 — the range excludes $ESLINT_TARGET (exception still load-bearing)
#   2 — cannot evaluate (package or eslint peer missing/invalid); diagnostic on
#       stderr. The caller turns this into a hard exit 2 — a human, not a silent
#       pass, must resolve it.
# bun reads JSON natively and ships Bun.semver, so this needs no jq/semver dep.
peer_admits_target() {
  local label="$1" pkg="$2" output status
  if [ ! -f "$pkg" ]; then
    printf 'check:eslint-react-peer-exception: %s package.json not found at %s\n' "$label" "$pkg" >&2
    printf "check:eslint-react-peer-exception: run 'bun install' before checking.\n" >&2
    return 2
  fi
  set +e
  output="$(MUSI_PEER_PKG="$pkg" MUSI_PEER_TARGET="$ESLINT_TARGET" bun -e '
    const fs = require("node:fs");
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(process.env.MUSI_PEER_PKG, "utf8"));
    } catch {
      process.exit(4);
    }
    const range = pkg.peerDependencies?.eslint;
    if (typeof range !== "string" || range.length === 0) process.exit(3);
    // Bun.semver.satisfies returns true for EVERY version when the range string
    // is malformed (e.g. "garbage"), a wildcard, or unbounded. A real plugin
    // eslint peer is a finite union of caret/exact comparators that can never
    // admit an impossibly-high version, so if this range does, it is not a
    // usable "admits exactly ESLint <target>" signal -> report uninterpretable.
    if (Bun.semver.satisfies("999999.0.0", range)) process.exit(5);
    process.stdout.write(range);
    process.exit(Bun.semver.satisfies(process.env.MUSI_PEER_TARGET, range) ? 0 : 1);
  ')"
  status=$?
  set -e
  case "$status" in
    0)
      printf '%s' "$output"
      return 0
      ;;
    1)
      printf '%s' "$output"
      return 1
      ;;
    *)
      printf 'check:eslint-react-peer-exception: %s declares no usable eslint peer (missing or uninterpretable range) in %s\n' "$label" "$pkg" >&2
      return 2
      ;;
  esac
}

set +e
REACT_PEER="$(peer_admits_target eslint-plugin-react "$REACT_PKG")"
REACT_ADMITS=$?
set -e
if [ "$REACT_ADMITS" -eq 2 ]; then
  exit 2
fi

set +e
JSXA11Y_PEER="$(peer_admits_target eslint-plugin-jsx-a11y "$JSXA11Y_PKG")"
JSXA11Y_ADMITS=$?
set -e
if [ "$JSXA11Y_ADMITS" -eq 2 ]; then
  exit 2
fi

if [ "$REACT_ADMITS" -ne 0 ] || [ "$JSXA11Y_ADMITS" -ne 0 ]; then
  printf 'check:eslint-react-peer-exception: exception still needed — '
  if [ "$REACT_ADMITS" -ne 0 ]; then
    printf 'eslint-plugin-react peer "%s" still excludes ESLint %s' "$REACT_PEER" "$ESLINT_TARGET"
  fi
  if [ "$REACT_ADMITS" -ne 0 ] && [ "$JSXA11Y_ADMITS" -ne 0 ]; then
    printf '; '
  fi
  if [ "$JSXA11Y_ADMITS" -ne 0 ]; then
    printf 'eslint-plugin-jsx-a11y peer "%s" still excludes ESLint %s' "$JSXA11Y_PEER" "$ESLINT_TARGET"
  fi
  printf '.\n'
  exit 0
fi

cat >&2 <<EOF
check:eslint-react-peer-exception: the ESLint 10 React-plugin exception is obsolete.

Both plugins now declare an eslint peer range that admits ESLint $ESLINT_TARGET:
  eslint-plugin-react    -> "$REACT_PEER"
  eslint-plugin-jsx-a11y -> "$JSXA11Y_PEER"

Action:
  1. Bump eslint-plugin-react and eslint-plugin-jsx-a11y to the versions that
     declare the ESLint 10 peer (and run 'bun install').
  2. Run 'bun run audit:deps' to confirm no peer warnings remain.
  3. Delete scripts/check-eslint-react-peer-exception.sh,
     scripts/test-check-eslint-react-peer-exception.sh, the
     check:eslint-react-peer-exception package script, the audit:deps wiring,
     the smoke-test registrations (scripts/path-policy.ts,
     scripts/path-policy-smoke-subjects.ts, scripts/path-policy-query.test.ts,
     scripts/test-test-scripts.sh), and
     docs/agent_notes/backlog/eslint-react-peer-exception-removal.md.
EOF
exit 1
