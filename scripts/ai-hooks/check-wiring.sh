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
# Self-contained hooks (no exec line) are skipped.
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

# Copilot shims run bodies through the copilot-adapter translation instead of
# exec, so the shim→body edge is the `ai_copilot_dispatch ... "$HOOK_LIB/<body>.sh"`
# body argument. Sourced helper references are not body edges.
copilot_shim_body_refs() {
  local shim="$1"

  sed -nE \
    -e 's/.*ai_copilot_dispatch[[:space:]][^#]*"\$HOOK_LIB\/([A-Za-z0-9._-]+\.sh)".*/$HOOK_LIB\/\1/p' \
    "$shim"
}

assert_copilot_shim_body_targets() {
  local shim="$1"
  local ref target found=0

  while IFS= read -r ref; do
    found=1
    case "$ref" in
      '$HOOK_LIB/'*)
        target="scripts/ai-hooks/${ref#\$HOOK_LIB/}"
        ;;
      '$REPO_ROOT/'*)
        target="${ref#\$REPO_ROOT/}"
        ;;
      *)
        fail "unrecognized copilot shim body reference in $shim: $ref"
        ;;
    esac
    [ -f "$REPO_ROOT/$target" ] || fail "copilot shim $shim references a missing body: $target"
  done < <(copilot_shim_body_refs "$shim")
  [ "$found" -eq 1 ] || fail "copilot shim $shim has no dispatch or stop body reference"
}

assert_hook_shim() {
  local rel_path="$1"
  local hook_path="$REPO_ROOT/$rel_path"

  [ -f "$hook_path" ] || fail "referenced hook file is missing: $rel_path"
  [ -x "$hook_path" ] || fail "referenced hook file is not executable: $rel_path"
  case "$rel_path" in
    .copilot/hooks/*)
      assert_copilot_shim_body_targets "$hook_path"
      ;;
    *)
      assert_shim_exec_targets "$hook_path"
      ;;
  esac
}

assert_generated_hook_config() {
  local config="$1"
  local command_field="$2"
  local command rel_path

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
    assert_hook_shim "$rel_path"
  done < <(jq -r --arg field "$command_field" \
    '.. | objects | select(.type? == "command") | .[$field] // empty' "$config")
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
printf '#!/bin/bash\nai_copilot_dispatch pre bash "$HOOK_LIB/check-wiring.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-present-body.sh"
assert_copilot_shim_body_targets "$SHIM_FIXTURE_DIR/copilot-present-body.sh"
printf '#!/bin/bash\nai_copilot_dispatch pre bash "$HOOK_LIB/no-such-body.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-missing-body.sh"
if (assert_copilot_shim_body_targets "$SHIM_FIXTURE_DIR/copilot-missing-body.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject a missing body"
fi
printf '#!/bin/bash\n. "$HOOK_LIB/common.sh"\n. "$HOOK_LIB/copilot-adapter.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-source-only.sh"
if (assert_copilot_shim_body_targets "$SHIM_FIXTURE_DIR/copilot-source-only.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject helper-only source references"
fi
printf '#!/bin/bash\nexit 0\n' > "$SHIM_FIXTURE_DIR/copilot-no-body.sh"
if (assert_copilot_shim_body_targets "$SHIM_FIXTURE_DIR/copilot-no-body.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject a shim without body references"
fi

assert_generated_hook_config "$REPO_ROOT/.claude/settings.json" command
assert_generated_hook_config "$REPO_ROOT/.codex/hooks.json" command
assert_generated_hook_config "$REPO_ROOT/.github/hooks/copilot.json" bash

echo "Generated AI hook wiring OK."
