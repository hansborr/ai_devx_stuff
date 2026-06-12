#!/usr/bin/env bash
# Validates generated AI hook config wiring and shim-to-body exec targets.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/musi-ai-hook-wiring.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# Shims translate adapter specifics and then `exec bash "$REPO_ROOT/<body>"`.
# A missing body makes bash exit 127 with no decision JSON — non-blocking for
# Claude Code — so the shim→body edge must be asserted, not just the shim file.
# Self-contained hooks (no exec line, e.g. the Codex dispatchers) are skipped.
assert_shim_exec_targets() {
  local shim="$1"
  local exec_line target

  while IFS= read -r exec_line; do
    case "$exec_line" in
      "exec bash \"\$REPO_ROOT/"*"\"")
        target="${exec_line#exec bash \"\$REPO_ROOT/}"
        target="${target%\"}"
        [ -f "$REPO_ROOT/$target" ] || fail "shim $shim execs a missing body: $target"
        ;;
      *)
        fail "unrecognized exec line in shim $shim: $exec_line"
        ;;
    esac
  done < <(grep '^exec ' "$shim" || true)
}

assert_generated_hook_config() {
  local config="$1"
  local command rel_path hook_path

  jq empty "$config" >/dev/null || fail "$config is not valid JSON"
  while IFS= read -r command; do
    case "$command" in
      "bash \$CLAUDE_PROJECT_DIR/"*)
        rel_path="${command#bash \$CLAUDE_PROJECT_DIR/}"
        ;;
      "bash \"\$(git rev-parse --show-toplevel)/"*)
        rel_path="${command#bash \"\$(git rev-parse --show-toplevel)/}"
        rel_path="${rel_path%\"}"
        ;;
      *)
        fail "unrecognized hook command in $config: $command"
        ;;
    esac
    hook_path="$REPO_ROOT/$rel_path"
    [ -f "$hook_path" ] || fail "referenced hook file is missing: $rel_path"
    [ -x "$hook_path" ] || fail "referenced hook file is not executable: $rel_path"
    assert_shim_exec_targets "$hook_path"
  done < <(jq -r '.. | objects | select(.type? == "command") | .command' "$config")
}

# Self-check the exec-target assertion against fixtures so a future refactor
# of the shim shape cannot silently turn it into a no-op.
SHIM_FIXTURE_DIR="$TMP_ROOT/shim-fixtures"
mkdir -p "$SHIM_FIXTURE_DIR"
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/check-wiring.sh"\n' \
  > "$SHIM_FIXTURE_DIR/present-body.sh"
assert_shim_exec_targets "$SHIM_FIXTURE_DIR/present-body.sh"
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/no-such-body.sh"\n' \
  > "$SHIM_FIXTURE_DIR/missing-body.sh"
if (assert_shim_exec_targets "$SHIM_FIXTURE_DIR/missing-body.sh") 2>/dev/null; then
  fail "shim exec-target assertion should reject a missing body"
fi

assert_generated_hook_config "$REPO_ROOT/.claude/settings.json"
assert_generated_hook_config "$REPO_ROOT/.codex/hooks.json"

echo "Generated AI hook wiring OK."
