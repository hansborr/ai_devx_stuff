#!/usr/bin/env bash
# smoke-order: 062
# smoke-subjects: scripts/worktree-new.sh
# smoke-subjects: scripts/worktree-db.sh
# smoke-subjects: scripts/tests/test-worktree-new.sh
# smoke-subjects: scripts/tests/lib/test-tmpdir.sh
# test-worktree-new.sh — shell smoke tests for `worktree:new`.
#
# Sources scripts/worktree-new.sh only (its main is guarded, and it sources
# scripts/worktree-db.sh idempotently) and covers argument parsing, the
# `git worktree add` argv shapes, the writable-parent precondition, and the
# failure-recovery command emitted when worktree:init dies after git has
# already created the lane.
#
# scripts/worktree-db.sh is declared as a subject even though this suite never
# sources it directly: the recovery case executes its cmd_drop and asserts on
# its `not a git worktree:` refusal message, so an edit there must select this
# suite in changed mode.
#
# The worktree helpers are covered by four standalone suites so a failure in
# one narrative cannot hide the contracts of the others:
#   scripts/tests/test-worktree-db.sh       DB/init/dev helpers and seed fingerprints
#   scripts/tests/test-worktree-new.sh      worktree:new creation and failure recovery
#   scripts/tests/test-worktree-drop-gc.sh  worktree:drop / worktree:gc teardown
#   scripts/tests/test-worktree-locking.sh  init locks, allocation, and state writers
#
# Run via `bash scripts/tests/test-worktree-new.sh`.

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-tmpdir.sh
. "$TEST_SCRIPT_DIR/lib/test-tmpdir.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-new.sh"

PASS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$(( PASS + 1 )); printf 'ok %d - %s\n' "$PASS" "$1"; }

# worktree-new.sh sources worktree-db.sh only when its helpers are missing
# (scripts/worktree-new.sh:28-31); without that guard a process that already
# sourced worktree-db.sh re-runs its top-level `readonly` declarations and dies.
# The pre-split monolith exercised the guard implicitly by sourcing both files
# into one process. This suite sources worktree-new.sh alone, so the guard is
# checked here in a throwaway shell instead of by accident.
wtnew_double_source_out="$(bash -c '
  set -euo pipefail
  . "$1/worktree-db.sh"
  . "$1/worktree-new.sh"
  declare -F compute_slug >/dev/null || exit 3
  printf double-source-ok
' _ "$TEST_SCRIPT_DIR/.." 2>&1)" \
  || fail "sourcing worktree-db.sh then worktree-new.sh must not re-source the helper library:
$wtnew_double_source_out"
[[ "$wtnew_double_source_out" == "double-source-ok" ]] \
  || fail "double-source probe printed unexpected output: $wtnew_double_source_out"
ok "worktree-new.sh skips worktree-db.sh when its helpers are already sourced"

# parse_new_args (worktree:new) covers the arg shapes the wrapper accepts so a
# typo in the parser is caught before the smoke test creates a real worktree.
parse_new_args ../foo
[[ "$WT_NEW_PATH" == "../foo" && -z "$WT_NEW_NEW_BRANCH" && -z "$WT_NEW_EXISTING_BRANCH" && -z "$WT_NEW_START_REF" ]] \
  || fail "parse_new_args path-only: path=$WT_NEW_PATH new=$WT_NEW_NEW_BRANCH existing=$WT_NEW_EXISTING_BRANCH from=$WT_NEW_START_REF"

parse_new_args ../foo -b feat/foo
[[ "$WT_NEW_PATH" == "../foo" && "$WT_NEW_NEW_BRANCH" == "feat/foo" && -z "$WT_NEW_EXISTING_BRANCH" && -z "$WT_NEW_START_REF" ]] \
  || fail "parse_new_args path + -b: path=$WT_NEW_PATH new=$WT_NEW_NEW_BRANCH"

parse_new_args ../foo feat/foo
[[ "$WT_NEW_PATH" == "../foo" && -z "$WT_NEW_NEW_BRANCH" && "$WT_NEW_EXISTING_BRANCH" == "feat/foo" ]] \
  || fail "parse_new_args path + existing: path=$WT_NEW_PATH existing=$WT_NEW_EXISTING_BRANCH"

parse_new_args -b feat/foo --from main ../foo
[[ "$WT_NEW_PATH" == "../foo" && "$WT_NEW_NEW_BRANCH" == "feat/foo" && "$WT_NEW_START_REF" == "main" ]] \
  || fail "parse_new_args flags-before-path: path=$WT_NEW_PATH new=$WT_NEW_NEW_BRANCH from=$WT_NEW_START_REF"
ok "parse_new_args accepts path/-b/existing/--from in any order"

# Reject illegal combinations early so a bad invocation does not create a
# half-provisioned worktree.
( parse_new_args ../foo -b feat/foo other 2>/dev/null ) \
  && fail "parse_new_args should reject -b with positional existing branch"
( parse_new_args ../foo --from main 2>/dev/null ) \
  && fail "parse_new_args should reject --from without -b"
( parse_new_args 2>/dev/null ) \
  && fail "parse_new_args should require a path"
( parse_new_args ../foo --bogus 2>/dev/null ) \
  && fail "parse_new_args should reject unknown flags"
( parse_new_args ../foo -b a -b b 2>/dev/null ) \
  && fail "parse_new_args should reject duplicate -b"
( parse_new_args ../foo feat/foo --from main 2>/dev/null ) \
  && fail "parse_new_args should reject --from with an existing-branch positional"
ok "parse_new_args rejects invalid combinations"

# git_worktree_add builds the right argv for each shape. Use a stub `git`
# that records its argv to a file so we can assert it without depending on
# whether git_worktree_add forwards stdout or stderr.
stub_dir="$(musi_test_tmp_dir)"
cat > "$stub_dir/git" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_GIT_OUT"
STUB
chmod +x "$stub_dir/git"
export STUB_GIT_OUT="$stub_dir/argv"

PATH="$stub_dir:$PATH" git_worktree_add ../foo "feat/foo" "" "main" >/dev/null 2>&1
expected=$'worktree\nadd\n-b\nfeat/foo\n../foo\nmain'
[[ "$(cat "$STUB_GIT_OUT")" == "$expected" ]] || fail "git_worktree_add new+from argv:
got:
$(cat "$STUB_GIT_OUT")
want:
$expected"

PATH="$stub_dir:$PATH" git_worktree_add ../foo "" "feat/foo" "" >/dev/null 2>&1
expected=$'worktree\nadd\n../foo\nfeat/foo'
[[ "$(cat "$STUB_GIT_OUT")" == "$expected" ]] || fail "git_worktree_add existing argv:
got:
$(cat "$STUB_GIT_OUT")
want:
$expected"

PATH="$stub_dir:$PATH" git_worktree_add ../foo "" "" "" >/dev/null 2>&1
expected=$'worktree\nadd\n../foo'
[[ "$(cat "$STUB_GIT_OUT")" == "$expected" ]] || fail "git_worktree_add bare argv:
got:
$(cat "$STUB_GIT_OUT")
want:
$expected"

PATH="$stub_dir:$PATH" git_worktree_add ../foo "feat/foo" "" "" >/dev/null 2>&1
expected=$'worktree\nadd\n-b\nfeat/foo\n../foo'
[[ "$(cat "$STUB_GIT_OUT")" == "$expected" ]] || fail "git_worktree_add new-without-start argv:
got:
$(cat "$STUB_GIT_OUT")
want:
$expected"
ok "git_worktree_add forwards the right argv for each shape"

# --- worktree:new failure recovery (leaf 07) ----------------------------------

# assert_writable_parent must fail fast (before any git state) when the lane
# parent is missing, not a directory, or unwritable, and pass for a writable one.
wtnew_parent_root="$(musi_test_tmp_dir)"
( assert_writable_parent "$wtnew_parent_root/missing/foo" 2>/dev/null ) \
  && fail "assert_writable_parent should reject a missing parent directory"
: > "$wtnew_parent_root/afile"
( assert_writable_parent "$wtnew_parent_root/afile/foo" 2>/dev/null ) \
  && fail "assert_writable_parent should reject a non-directory parent"
mkdir -p "$wtnew_parent_root/writable"
( assert_writable_parent "$wtnew_parent_root/writable/foo" ) \
  || fail "assert_writable_parent should accept a writable parent"
if [[ "$(id -u)" -ne 0 ]]; then
  mkdir -p "$wtnew_parent_root/ro"
  chmod 555 "$wtnew_parent_root/ro"
  ( assert_writable_parent "$wtnew_parent_root/ro/foo" 2>/dev/null ) \
    && { chmod 755 "$wtnew_parent_root/ro"; fail "assert_writable_parent should reject an unwritable parent"; }
  chmod 755 "$wtnew_parent_root/ro"
fi
ok "assert_writable_parent fails fast on missing/non-dir/unwritable parents"

# init_failure_recovery_block prints one location-independent command. The
# caller checkout and failed target are already canonical literal paths; the
# printed command must not rediscover either one when it is pasted later.
recovery_plain="$(init_failure_recovery_block /abs/caller/root /abs/wt/path)"
expected_recovery_plain=$'inspect the worktree, then recover with:\n  bun --cwd=/abs/caller/root run worktree:drop -- /abs/wt/path --remove'
[[ "$recovery_plain" == "$expected_recovery_plain" ]] \
  || fail "recovery block should contain exactly one root-anchored command:
got:
$recovery_plain
want:
$expected_recovery_plain"

recovery_quoted="$(init_failure_recovery_block "/abs/caller root/it's" "-failed lane 'quote';\$(touch RECOVERY_OUTPUT_RAN);[glob]")"
[[ "$(printf '%s\n' "$recovery_quoted" | grep -c '^  bun ')" == "1" ]] \
  || fail "recovery block should contain exactly one bun command:
$recovery_quoted"
for forbidden in '  cd ' 'git worktree remove' 'git branch -d' '`'; do
  [[ "$recovery_quoted" != *"$forbidden"* ]] \
    || fail "recovery block contains forbidden follow-up '$forbidden':
$recovery_quoted"
done
[[ "$recovery_quoted" == *'worktree:drop -- -failed'* && "$recovery_quoted" == *'--remove'* ]] \
  || fail "recovery block must place -- before a leading-dash target:
$recovery_quoted"
ok "init_failure_recovery_block prints one shell-quoted recovery command"

# End-to-end: launch worktree:new from a package subdirectory in a throwaway
# checkout, fail worktree:init after git creates the lane, then copy/paste the
# emitted command from an unrelated directory. The fixture paths contain shell
# syntax so argv recording also proves the command does not evaluate target text.
wtnew_e2e_dir="$(musi_test_tmp_dir)"
wtnew_e2e_repo="$wtnew_e2e_dir/caller root 'quoted';repo"
wtnew_e2e_target="$wtnew_e2e_dir/-failed lane 'quoted';\$(touch RECOVERY_OUTPUT_RAN);[glob]"
wtnew_e2e_sentinels=(
  "$wtnew_e2e_repo/packages/server/RECOVERY_OUTPUT_RAN"
  "$wtnew_e2e_dir/RECOVERY_OUTPUT_RAN"
)
wtnew_e2e_stub="$wtnew_e2e_dir/stub"
mkdir -p "$wtnew_e2e_repo/packages/server" "$wtnew_e2e_stub"
git -C "$wtnew_e2e_dir" init -q -b main "$wtnew_e2e_repo"
git -C "$wtnew_e2e_repo" config user.email test@example.invalid
git -C "$wtnew_e2e_repo" config user.name Test
printf 'fixture\n' > "$wtnew_e2e_repo/README.md"
git -C "$wtnew_e2e_repo" add README.md
git -C "$wtnew_e2e_repo" commit -qm 'initial fixture'
printf '#!/usr/bin/env bash\nexit 42\n' > "$wtnew_e2e_stub/bun"
chmod +x "$wtnew_e2e_stub/bun"

assert_no_wtnew_e2e_sentinel() {
  local phase="$1" sentinel
  for sentinel in "${wtnew_e2e_sentinels[@]}"; do
    [[ ! -e "$sentinel" ]] \
      || fail "$phase evaluated shell syntax from the target path: $sentinel"
  done
}

set +e
(
  cd "$wtnew_e2e_repo/packages/server"
  PATH="$wtnew_e2e_stub:$PATH" bash "$TEST_SCRIPT_DIR/../worktree-new.sh" \
    "$wtnew_e2e_target" -b feat/recovery-output
) >"$wtnew_e2e_dir/new-out" 2>&1
wtnew_e2e_rc=$?
set -e
[[ "$wtnew_e2e_rc" -ne 0 ]] || fail "worktree:new fixture should fail during worktree:init"
[[ -d "$wtnew_e2e_target" ]] || fail "worktree:new fixture should leave the failed target for recovery"
assert_no_wtnew_e2e_sentinel "worktree:new"

wtnew_e2e_command_line="$(grep '^  bun --cwd=' "$wtnew_e2e_dir/new-out")"
[[ "$(grep -c '^  bun --cwd=' "$wtnew_e2e_dir/new-out")" == "1" ]] \
  || fail "worktree:new should emit exactly one recovery command:
$(cat "$wtnew_e2e_dir/new-out")"
wtnew_e2e_command="${wtnew_e2e_command_line#  }"
wtnew_e2e_caller_root="$(cd "$wtnew_e2e_repo" && pwd -P)"
wtnew_e2e_canonical_target="$(cd "$wtnew_e2e_target" && pwd -P)"
printf -v wtnew_e2e_expected_command \
  'bun --cwd=%q run worktree:drop -- %q --remove' \
  "$wtnew_e2e_caller_root" "$wtnew_e2e_canonical_target"
[[ "$wtnew_e2e_command" == "$wtnew_e2e_expected_command" ]] \
  || fail "worktree:new emitted the wrong recovery command:
got:  $wtnew_e2e_command
want: $wtnew_e2e_expected_command"
printf -v wtnew_e2e_expected_root_prefix 'bun --cwd=%q run ' "$wtnew_e2e_caller_root"
[[ "$wtnew_e2e_command" == "$wtnew_e2e_expected_root_prefix"* ]] \
  || fail "worktree:new recovery must use the fixture checkout root:
$wtnew_e2e_command"

execute_wtnew_recovery() (
  local argv_out="$1"
  list_worktree_dbs() { printf ''; }
  forget_worktree_fingerprint() { :; }
  tombstone_forget() { :; }
  allocation_forget() { :; }
  bun() {
    local bun_cwd="${1#--cwd=}"
    printf '%s\n' "$@" > "$argv_out"
    [[ "$1" == "--cwd=$wtnew_e2e_caller_root" && "$2" == "run" \
      && "$3" == "worktree:drop" && "$4" == "--" ]] \
      || return 91
    (
      cd "$bun_cwd"
      cmd_drop "${@:5}"
    )
  }
  cd "$wtnew_e2e_dir"
  eval "$wtnew_e2e_command"
)

execute_wtnew_recovery "$wtnew_e2e_dir/first-argv" >"$wtnew_e2e_dir/first-out" 2>&1
expected_recovery_argv="--cwd=$wtnew_e2e_caller_root"$'\n''run'$'\n''worktree:drop'$'\n''--'$'\n'"$wtnew_e2e_canonical_target"$'\n''--remove'
[[ "$(cat "$wtnew_e2e_dir/first-argv")" == "$expected_recovery_argv" ]] \
  || fail "copy/pasted recovery command did not preserve argv:
$(cat "$wtnew_e2e_dir/first-argv")"
[[ ! -e "$wtnew_e2e_target" ]] || fail "first recovery command should remove the failed worktree"
git -C "$wtnew_e2e_repo" show-ref --verify --quiet refs/heads/feat/recovery-output \
  || fail "recovery command must retain the failed worktree branch"
assert_no_wtnew_e2e_sentinel "copy/pasted recovery"

set +e
execute_wtnew_recovery "$wtnew_e2e_dir/second-argv" >"$wtnew_e2e_dir/second-out" 2>&1
wtnew_e2e_retry_rc=$?
set -e
[[ "$wtnew_e2e_retry_rc" -ne 0 ]] || fail "repeating the recovery command should fail strictly"
grep -qF "not a git worktree: $wtnew_e2e_canonical_target" "$wtnew_e2e_dir/second-out" \
  || fail "repeated recovery command should report not a git worktree:
$(cat "$wtnew_e2e_dir/second-out")"
assert_no_wtnew_e2e_sentinel "repeated recovery"
ok "worktree:new emits a location-independent recovery command with strict retry"

rm -rf "$wtnew_e2e_dir"

# cleanup_failed_add deletes the just-created branch only when it provably points
# at the resolved start commit; every mismatch leaves state untouched. A stub git
# reports the branch's commit and records any `git branch -d`.
wtnew_stub_dir="$(musi_test_tmp_dir)"
cat > "$wtnew_stub_dir/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" ]]; then
  [[ -n "${STUB_BRANCH_COMMIT:-}" ]] && { printf '%s\n' "$STUB_BRANCH_COMMIT"; exit 0; }
  exit 1
fi
if [[ "$1" == "branch" && "$2" == "-d" ]]; then
  printf '%s\n' "$3" >> "$STUB_DELETED"
  exit 0
fi
exit 0
STUB
chmod +x "$wtnew_stub_dir/git"
wtnew_missing_path="$wtnew_stub_dir/never-created"

# Branch points at the resolved start commit → delete it and say so.
: > "$wtnew_stub_dir/deleted"
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_BRANCH_COMMIT="c0ffee" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_missing_path" feat/lane c0ffee
)"
[[ "$msg" == *"deleted the branch this invocation created: feat/lane"* ]] \
  || fail "cleanup_failed_add should report the deletion on a start-ref match: $msg"
[[ "$(cat "$wtnew_stub_dir/deleted")" == "feat/lane" ]] \
  || fail "cleanup_failed_add should delete the branch on a start-ref match"

# Branch already existed at the same start commit before the add → the SHA match
# is not proof this invocation created it; refuse to delete the pre-existing branch.
: > "$wtnew_stub_dir/deleted"
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_BRANCH_COMMIT="c0ffee" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_missing_path" feat/lane c0ffee 1
)"
[[ "$msg" == *"already existed before this invocation"* ]] \
  || fail "cleanup_failed_add should refuse to delete a pre-existing branch at the same SHA: $msg"
[[ ! -s "$wtnew_stub_dir/deleted" ]] \
  || fail "cleanup_failed_add must not delete a branch that pre-existed the add, even at the start SHA"

# Branch moved / does not point at the start commit → refuse, leave it in place.
: > "$wtnew_stub_dir/deleted"
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_BRANCH_COMMIT="deadbeef" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_missing_path" feat/lane c0ffee
)"
[[ "$msg" == *"does not point at the requested start ref"* && "$msg" == *"git branch -d feat/lane"* ]] \
  || fail "cleanup_failed_add should refuse and name the branch on a mismatch: $msg"
[[ ! -s "$wtnew_stub_dir/deleted" ]] \
  || fail "cleanup_failed_add must not delete a branch that does not match the start ref"

# Branch was never created → nothing to clean up.
: > "$wtnew_stub_dir/deleted"
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_missing_path" feat/lane c0ffee
)"
[[ "$msg" == *"no branch feat/lane was created"* ]] \
  || fail "cleanup_failed_add should report when no branch exists: $msg"
[[ ! -s "$wtnew_stub_dir/deleted" ]] \
  || fail "cleanup_failed_add must not delete when no branch exists"

# Partial worktree directory present → leave everything for inspection.
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_BRANCH_COMMIT="c0ffee" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_stub_dir" feat/lane c0ffee
)"
[[ "$msg" == *"left the worktree path in place"* ]] \
  || fail "cleanup_failed_add should leave a materialized worktree path in place: $msg"

# No -b branch requested → nothing to clean up, empty message.
msg="$(
  export PATH="$wtnew_stub_dir:$PATH" STUB_DELETED="$wtnew_stub_dir/deleted"
  cleanup_failed_add "$wtnew_missing_path" "" ""
)"
[[ -z "$msg" ]] || fail "cleanup_failed_add should be a no-op without a new branch: $msg"
ok "cleanup_failed_add deletes only a provably-fresh branch on add failure"

printf '\nworktree-new smoke tests passed (%d assertions)\n' "$PASS"
