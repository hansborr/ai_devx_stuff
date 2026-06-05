#!/usr/bin/env bash
# Install local Git config for the lint-ratchet baseline merge driver.
set -euo pipefail

DRIVER_NAME="lint-ratchet-baseline"
INFO_ATTRIBUTES_BEGIN="# BEGIN musi lint-ratchet merge attributes"
INFO_ATTRIBUTES_END="# END musi lint-ratchet merge attributes"
INSTALLED_DRIVER_RELATIVE_PATH="musi/lint-ratchet-baseline-merge-driver.sh"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  cat >&2 <<'EOF'
lint-ratchet merge driver install: run from inside a Git worktree.
EOF
  exit 1
}

cd "$repo_root"

driver_script="$repo_root/scripts/git/lint-ratchet-baseline-merge-driver.sh"
if [ ! -f "$driver_script" ]; then
  printf 'lint-ratchet merge driver install: missing %s\n' "$driver_script" >&2
  exit 1
fi

git_common_dir=$(git rev-parse --git-common-dir)
case "$git_common_dir" in
  /*) git_common_dir_path="$git_common_dir" ;;
  *) git_common_dir_path="$repo_root/$git_common_dir" ;;
esac
git_common_dir_abs=$(cd "$git_common_dir_path" && pwd -P)
installed_driver_script="$git_common_dir_abs/$INSTALLED_DRIVER_RELATIVE_PATH"
installed_driver_dir=$(dirname "$installed_driver_script")
mkdir -p "$installed_driver_dir"
cp "$driver_script" "$installed_driver_script"
chmod 755 "$installed_driver_script"

driver_command="bash -c 'set -e; driver=\"\$(git rev-parse --git-common-dir)/$INSTALLED_DRIVER_RELATIVE_PATH\"; exec bash \"\$driver\" \"\$@\"' lint-ratchet-baseline-merge-driver %O %A %B %L %P"
git config --local "merge.$DRIVER_NAME.name" "lint ratchet baseline regeneration guidance"
git config --local "merge.$DRIVER_NAME.driver" "$driver_command"
git config --local "merge.$DRIVER_NAME.recursive" "binary"

info_attributes=$(git rev-parse --git-path info/attributes)
info_attributes_dir=$(dirname "$info_attributes")
mkdir -p "$info_attributes_dir"

temp_attributes=""
cleanup() {
  if [ -n "$temp_attributes" ]; then
    rm -f "$temp_attributes"
  fi
}
trap cleanup EXIT

temp_attributes=$(mktemp "$info_attributes_dir/attributes.XXXXXX")

if [ -f "$info_attributes" ]; then
  awk -v begin="$INFO_ATTRIBUTES_BEGIN" -v end="$INFO_ATTRIBUTES_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip { next }
    $1 == "lint-ratchet.debt-log.jsonl" { next }
    $1 == "lint-ratchet.baseline.json" { next }
    $1 == "/lint-ratchet.debt-log.jsonl" { next }
    $1 == "/lint-ratchet.baseline.json" { next }
    { print }
  ' "$info_attributes" >"$temp_attributes"
fi

if [ -s "$temp_attributes" ]; then
  printf '\n' >>"$temp_attributes"
fi

cat >>"$temp_attributes" <<EOF
$INFO_ATTRIBUTES_BEGIN
/lint-ratchet.debt-log.jsonl merge=union
/lint-ratchet.baseline.json merge=$DRIVER_NAME
$INFO_ATTRIBUTES_END
EOF

mv "$temp_attributes" "$info_attributes"
temp_attributes=""

cat <<EOF
lint-ratchet merge driver installed.
  driver: merge.$DRIVER_NAME.driver
  installed driver: $installed_driver_script
  attributes: $info_attributes
EOF
