#!/usr/bin/env bash
# Shared expected-state definitions for the lint-ratchet baseline merge
# driver. Sourced by install-lint-ratchet-merge-driver.sh and
# check-lint-ratchet-merge-driver.sh so the installer and the health check
# cannot drift on what "installed and current" means. Functions return
# non-zero instead of exiting; each caller keeps its own advisory output
# contract (installer WARN lines, checker PASS/WARN line).

DRIVER_NAME="lint-ratchet-baseline"
INFO_ATTRIBUTES_BEGIN="# BEGIN musi lint-ratchet merge attributes"
INFO_ATTRIBUTES_END="# END musi lint-ratchet merge attributes"
INSTALLED_DRIVER_RELATIVE_PATH="musi/lint-ratchet-baseline-merge-driver.sh"
# shellcheck disable=SC2034 # Consumed by the sourcing installer and checker.
driver_command="bash -c 'set -e; driver=\"\$(git rev-parse --git-common-dir)/$INSTALLED_DRIVER_RELATIVE_PATH\"; exec bash \"\$driver\" \"\$@\"' lint-ratchet-baseline-merge-driver %O %A %B %L %P"

# Print the sha256 of $1; fail when no hash tool is available so callers
# treat unverifiable files as not matching (fail closed: the installer
# refreshes anyway, the checker never reports a false PASS).
file_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

files_match_by_hash() {
  local left="$1" right="$2" left_hash right_hash
  [ -f "$left" ] || return 1
  [ -f "$right" ] || return 1
  left_hash=$(file_hash "$left") || return 1
  right_hash=$(file_hash "$right") || return 1
  [ -n "$left_hash" ] && [ "$left_hash" = "$right_hash" ]
}

# Render the desired .git/info/attributes contents into $2 from the current
# attributes file $1 (which may not exist): strip a previously managed block
# and stale ratchet entries, then append the managed block. Returns non-zero
# on any write failure so callers never install or compare a truncated
# render.
render_lint_ratchet_attributes() {
  local current_attributes="$1" rendered="$2"

  if [ -f "$current_attributes" ]; then
    awk -v begin="$INFO_ATTRIBUTES_BEGIN" -v end="$INFO_ATTRIBUTES_END" '
      $0 == begin { skip = 1; next }
      $0 == end { skip = 0; next }
      skip { next }
      $1 == "lint-ratchet.debt-log.jsonl" { next }
      $1 == "lint-ratchet.baseline.json" { next }
      $1 == "/lint-ratchet.debt-log.jsonl" { next }
      $1 == "/lint-ratchet.baseline.json" { next }
      { lines[++count] = $0 }
      END {
        while (count > 0 && lines[count] == "") count--
        for (i = 1; i <= count; i++) print lines[i]
      }
    ' "$current_attributes" >"$rendered" || return 1
  fi

  if [ -s "$rendered" ]; then
    printf '\n' >>"$rendered" || return 1
  fi

  cat >>"$rendered" <<EOF || return 1
$INFO_ATTRIBUTES_BEGIN
/lint-ratchet.debt-log.jsonl merge=union
/lint-ratchet.baseline.json merge=$DRIVER_NAME
$INFO_ATTRIBUTES_END
EOF
}
