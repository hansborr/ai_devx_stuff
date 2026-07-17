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

# Claude and Codex shims translate adapter specifics and then exec exactly one
# canonical body. A missing body makes bash exit 127 with no decision JSON —
# non-blocking for Claude Code — so zero, multiple, and wrong edges all fail.
assert_shim_exec_target() {
  local shim="$1"
  local expected="$2"
  local exec_line target
  local -a exec_lines=()
  local -a targets=()

  mapfile -t exec_lines < <(grep '^exec ' "$shim" || true)
  for exec_line in "${exec_lines[@]}"; do
    case "$exec_line" in
      "exec bash \"\$REPO_ROOT/"*"\"")
        target="${exec_line#exec bash \"\$REPO_ROOT/}"
        target="${target%\"}"
        targets+=("$target")
        ;;
      *)
        fail "unrecognized exec line in shim $shim: $exec_line"
        ;;
    esac
  done

  [ "${#targets[@]}" -eq 1 ] \
    || fail "shim $shim must exec exactly one canonical body; found ${#targets[@]}"
  [ "${targets[0]}" = "$expected" ] \
    || fail "shim $shim execs ${targets[0]}, expected canonical body $expected"
  [ -f "$REPO_ROOT/$expected" ] || fail "shim $shim execs a missing body: $expected"
}

# Copilot shims run bodies through the copilot-adapter translation instead of
# exec, so the shim→body edge is the `ai_copilot_dispatch ... "$HOOK_LIB/<body>.sh"`
# body argument. Sourced helper references are not body edges.
copilot_shim_body_refs() {
  local shim="$1"

  sed -nE \
    -e 's/^[[:space:]]*ai_copilot_dispatch[[:space:]][^#]*"\$HOOK_LIB\/([A-Za-z0-9._-]+\.sh)".*/$HOOK_LIB\/\1/p' \
    "$shim"
}

assert_copilot_shim_body_target() {
  local shim="$1"
  local expected="$2"
  local ref target
  local -a refs=()
  local -a targets=()

  mapfile -t refs < <(copilot_shim_body_refs "$shim")
  for ref in "${refs[@]}"; do
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
    targets+=("$target")
  done

  [ "${#targets[@]}" -eq 1 ] \
    || fail "copilot shim $shim must dispatch exactly one canonical body; found ${#targets[@]}"
  [ "${targets[0]}" = "$expected" ] \
    || fail "copilot shim $shim dispatches ${targets[0]}, expected canonical body $expected"
  [ -f "$REPO_ROOT/$expected" ] \
    || fail "copilot shim $shim references a missing body: $expected"
}

REFERENCED_ADAPTERS_FILE="$TMP_ROOT/referenced-adapters.txt"
DECLARED_UNWIRED_ADAPTERS_FILE="$TMP_ROOT/declared-unwired-adapters.txt"
: > "$REFERENCED_ADAPTERS_FILE"
# Intentional unwired adapters must be explicitly inventoried here. Keep the
# file empty when there are no exemptions.
: > "$DECLARED_UNWIRED_ADAPTERS_FILE"

assert_hook_shim() {
  local rel_path="$1"
  local canonical_body="$2"
  local hook_path="$REPO_ROOT/$rel_path"

  [ -f "$hook_path" ] || fail "referenced hook file is missing: $rel_path"
  [ -x "$hook_path" ] || fail "referenced hook file is not executable: $rel_path"
  case "$rel_path" in
    .copilot/hooks/*)
      assert_copilot_shim_body_target "$hook_path" "$canonical_body"
      ;;
    *)
      assert_shim_exec_target "$hook_path" "$canonical_body"
      ;;
  esac
  printf '%s\n' "$hook_path" >> "$REFERENCED_ADAPTERS_FILE"
}

assert_no_unreferenced_adapters() {
  local adapter_dir="$1"
  local referenced_file="$2"
  local allowed_file="$3"
  local adapter

  while IFS= read -r adapter; do
    grep -Fxq "$adapter" "$referenced_file" && continue
    grep -Fxq "$adapter" "$allowed_file" && continue
    fail "hook adapter is not referenced by generated manifest wiring: $adapter"
  done < <(find "$adapter_dir" -maxdepth 1 \( -type f -o -type l \) -name '*.sh' | sort)
}

assert_unique_adapter_references() {
  local referenced_file="$1"
  local duplicate

  duplicate=$(sort "$referenced_file" | uniq -d | head -1)
  [ -z "$duplicate" ] || fail "hook adapter is referenced more than once: $duplicate"
}

manifest_bodies_for_command() {
  local manifest="$1"
  local harness="$2"
  local command="$3"

  jq -r --arg harness "$harness" --arg command "$command" \
    '.controls[] | select(.hookWiring.harnesses[$harness].command? == $command) | .hookWiring.body // empty' \
    "$manifest"
}

assert_generated_hook_config() {
  local config="$1"
  local command_field="$2"
  local harness="$3"
  local command rel_path
  local -a manifest_bodies=()

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
    mapfile -t manifest_bodies < <(
      manifest_bodies_for_command "$REPO_ROOT/harness.controls.json" "$harness" "$command"
    )
    [ "${#manifest_bodies[@]}" -eq 1 ] \
      || fail "generated $harness command must map to exactly one manifest body: $command"
    [ -n "${manifest_bodies[0]}" ] \
      || fail "generated $harness command has an empty manifest body: $command"
    assert_hook_shim "$rel_path" "${manifest_bodies[0]}"
  done < <(jq -r --arg field "$command_field" \
    '.. | objects | select(.type? == "command") | .[$field] // empty' "$config")
}

# Self-check the exec-target assertion against fixtures so a future refactor
# of the shim shape cannot silently turn it into a no-op.
SHIM_FIXTURE_DIR="$TMP_ROOT/shim-fixtures"
mkdir -p "$SHIM_FIXTURE_DIR"
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/check-wiring.sh"\n' \
  > "$SHIM_FIXTURE_DIR/present-body.sh"
assert_shim_exec_target "$SHIM_FIXTURE_DIR/present-body.sh" "scripts/ai-hooks/check-wiring.sh"
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/no-direct-db.sh"\n' \
  > "$SHIM_FIXTURE_DIR/wrong-existing-body.sh"
if (assert_shim_exec_target "$SHIM_FIXTURE_DIR/wrong-existing-body.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "shim exec-target assertion should reject a wrong existing body"
fi
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/no-such-body.sh"\n' \
  > "$SHIM_FIXTURE_DIR/missing-body.sh"
if (assert_shim_exec_target "$SHIM_FIXTURE_DIR/missing-body.sh" "scripts/ai-hooks/no-such-body.sh") 2>/dev/null; then
  fail "shim exec-target assertion should reject a missing body"
fi
printf '#!/bin/bash\nexit 0\n' > "$SHIM_FIXTURE_DIR/no-body.sh"
if (assert_shim_exec_target "$SHIM_FIXTURE_DIR/no-body.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "shim exec-target assertion should reject a shim without a body"
fi
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/check-wiring.sh"\nexec bash "$REPO_ROOT/scripts/ai-hooks/check-wiring.sh"\n' \
  > "$SHIM_FIXTURE_DIR/multiple-bodies.sh"
if (assert_shim_exec_target "$SHIM_FIXTURE_DIR/multiple-bodies.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "shim exec-target assertion should reject multiple body edges"
fi
printf '#!/bin/bash\nai_copilot_dispatch pre bash "$HOOK_LIB/check-wiring.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-present-body.sh"
assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-present-body.sh" "scripts/ai-hooks/check-wiring.sh"
printf '#!/bin/bash\nai_copilot_dispatch pre bash "$HOOK_LIB/no-direct-db.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-wrong-existing-body.sh"
if (assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-wrong-existing-body.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject a wrong existing body"
fi
printf '#!/bin/bash\nai_copilot_dispatch pre bash "$HOOK_LIB/no-such-body.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-missing-body.sh"
if (assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-missing-body.sh" "scripts/ai-hooks/no-such-body.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject a missing body"
fi
printf '#!/bin/bash\n. "$HOOK_LIB/common.sh"\n. "$HOOK_LIB/copilot-adapter.sh"\n' \
  > "$SHIM_FIXTURE_DIR/copilot-source-only.sh"
if (assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-source-only.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject helper-only source references"
fi
printf '#!/bin/bash\nexit 0\n' > "$SHIM_FIXTURE_DIR/copilot-no-body.sh"
if (assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-no-body.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject a shim without body references"
fi
printf '#!/bin/bash\n# ai_copilot_dispatch pre bash "$HOOK_LIB/check-wiring.sh"\nexit 0\n' \
  > "$SHIM_FIXTURE_DIR/copilot-commented-body.sh"
if (assert_copilot_shim_body_target "$SHIM_FIXTURE_DIR/copilot-commented-body.sh" "scripts/ai-hooks/check-wiring.sh") 2>/dev/null; then
  fail "copilot shim body assertion should reject commented-out dispatches"
fi

MANIFEST_BODY_FIXTURE="$TMP_ROOT/manifest-body.json"
printf '%s\n' \
  '{"controls":[{"id":"hook/pre","hookWiring":{"event":"PreToolUse","body":"scripts/ai-hooks/bash-pre-tool-use.sh","harnesses":{"codex":{"command":"bash swapped-adapter.sh"}}}}]}' \
  > "$MANIFEST_BODY_FIXTURE"
mapfile -t manifest_body_fixture_refs < <(
  manifest_bodies_for_command "$MANIFEST_BODY_FIXTURE" codex "bash swapped-adapter.sh"
)
[ "${#manifest_body_fixture_refs[@]}" -eq 1 ] \
  || fail "manifest body fixture should resolve exactly one control body"
printf '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/bash-post-tool-use.sh"\n' \
  > "$SHIM_FIXTURE_DIR/swapped-adapter.sh"
if (assert_shim_exec_target "$SHIM_FIXTURE_DIR/swapped-adapter.sh" "${manifest_body_fixture_refs[0]}") 2>/dev/null; then
  fail "manifest body assertion should reject an adapter swapped across event controls"
fi

INVENTORY_FIXTURE_DIR="$TMP_ROOT/inventory-fixtures"
INVENTORY_REFERENCES="$TMP_ROOT/inventory-references.txt"
INVENTORY_ALLOWED="$TMP_ROOT/inventory-allowed.txt"
mkdir -p "$INVENTORY_FIXTURE_DIR"
printf '#!/bin/bash\n' > "$INVENTORY_FIXTURE_DIR/referenced.sh"
printf '#!/bin/bash\n' > "$INVENTORY_FIXTURE_DIR/orphan.sh"
printf '%s\n' "$INVENTORY_FIXTURE_DIR/referenced.sh" > "$INVENTORY_REFERENCES"
: > "$INVENTORY_ALLOWED"
if (assert_no_unreferenced_adapters "$INVENTORY_FIXTURE_DIR" "$INVENTORY_REFERENCES" "$INVENTORY_ALLOWED") 2>/dev/null; then
  fail "adapter inventory assertion should reject an unreferenced adapter"
fi
printf '%s\n' "$INVENTORY_FIXTURE_DIR/orphan.sh" >> "$INVENTORY_REFERENCES"
assert_no_unreferenced_adapters "$INVENTORY_FIXTURE_DIR" "$INVENTORY_REFERENCES" "$INVENTORY_ALLOWED"
ln -s referenced.sh "$INVENTORY_FIXTURE_DIR/orphan-link.sh"
if (assert_no_unreferenced_adapters "$INVENTORY_FIXTURE_DIR" "$INVENTORY_REFERENCES" "$INVENTORY_ALLOWED") 2>/dev/null; then
  fail "adapter inventory assertion should reject an unreferenced symlink adapter"
fi
printf '%s\n' "$INVENTORY_FIXTURE_DIR/orphan-link.sh" >> "$INVENTORY_REFERENCES"
assert_no_unreferenced_adapters "$INVENTORY_FIXTURE_DIR" "$INVENTORY_REFERENCES" "$INVENTORY_ALLOWED"

assert_generated_hook_config "$REPO_ROOT/.claude/settings.json" command claude
assert_generated_hook_config "$REPO_ROOT/.codex/hooks.json" command codex
assert_generated_hook_config "$REPO_ROOT/.github/hooks/copilot.json" bash copilot
assert_unique_adapter_references "$REFERENCED_ADAPTERS_FILE"
assert_no_unreferenced_adapters "$REPO_ROOT/.claude/hooks" "$REFERENCED_ADAPTERS_FILE" "$DECLARED_UNWIRED_ADAPTERS_FILE"
assert_no_unreferenced_adapters "$REPO_ROOT/.codex/hooks" "$REFERENCED_ADAPTERS_FILE" "$DECLARED_UNWIRED_ADAPTERS_FILE"
assert_no_unreferenced_adapters "$REPO_ROOT/.copilot/hooks" "$REFERENCED_ADAPTERS_FILE" "$DECLARED_UNWIRED_ADAPTERS_FILE"

echo "Generated AI hook wiring OK."
