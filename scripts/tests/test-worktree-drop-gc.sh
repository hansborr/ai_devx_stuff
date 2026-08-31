#!/usr/bin/env bash
# smoke-order: 064
# smoke-subjects: scripts/worktree-db.sh
# smoke-subjects: scripts/tests/test-worktree-drop-gc.sh
# smoke-subjects: scripts/tests/lib/test-tmpdir.sh
# test-worktree-drop-gc.sh — shell smoke tests for `worktree:drop` and
# `worktree:gc` teardown.
#
# Sources scripts/worktree-db.sh only (its main is guarded, so sourcing is
# safe) and covers cmd_drop target resolution, its refusal guards, the ordered
# DB/state teardown, and the fail-closed behaviour of cmd_gc when database or
# live-template discovery fails.
#
# The worktree helpers are covered by four standalone suites so a failure in
# one narrative cannot hide the contracts of the others:
#   scripts/tests/test-worktree-db.sh       DB/init/dev helpers and seed fingerprints
#   scripts/tests/test-worktree-new.sh      worktree:new creation and failure recovery
#   scripts/tests/test-worktree-drop-gc.sh  worktree:drop / worktree:gc teardown
#   scripts/tests/test-worktree-locking.sh  init locks, allocation, and state writers
#
# Run via `bash scripts/tests/test-worktree-drop-gc.sh`.

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-tmpdir.sh
. "$TEST_SCRIPT_DIR/lib/test-tmpdir.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-db.sh"

PASS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$(( PASS + 1 )); printf 'ok %d - %s\n' "$PASS" "$1"; }

# --- worktree:drop full teardown (leaf 03) -----------------------------------

drop_feature_dir="$(musi_test_tmp_dir)"

# path-argument: resolve the explicit worktree path and use that root for the
# primary guard and slug, even when the caller is somewhere else.
(
  resolve_worktree_root() {
    printf 'resolve %s\n' "$1" >> "$drop_feature_dir/path-events"
    printf '/resolved/lane'
  }
  is_primary_worktree() {
    printf 'primary %s\n' "${1:-}" >> "$drop_feature_dir/path-events"
    return 1
  }
  compute_slug() {
    printf 'slug %s\n' "${1:-}" >> "$drop_feature_dir/path-events"
    printf 'path_arg_abc123'
  }
  list_worktree_dbs() { printf 'path_arg_abc123\nother_def456\n'; }
  slug_from_dbname() { printf '%s' "$1"; }
  drop_db() { printf 'drop %s\n' "$1" >> "$drop_feature_dir/path-events"; }
  forget_worktree_fingerprint() { printf 'fingerprint %s\n' "$1" >> "$drop_feature_dir/path-events"; }
  tombstone_forget() { printf 'tombstone %s\n' "$1" >> "$drop_feature_dir/path-events"; }
  allocation_forget() { printf 'allocation %s\n' "$1" >> "$drop_feature_dir/path-events"; }

  cmd_drop ../lane
) >"$drop_feature_dir/path-out" 2>&1 \
  || fail "worktree:drop path-argument should succeed:\n$(cat "$drop_feature_dir/path-out")"
grep -qFx 'resolve ../lane' "$drop_feature_dir/path-events" \
  || fail "worktree:drop path-argument did not resolve the supplied path"
grep -qFx 'primary /resolved/lane' "$drop_feature_dir/path-events" \
  || fail "worktree:drop path-argument did not guard the resolved target"
grep -qFx 'slug /resolved/lane' "$drop_feature_dir/path-events" \
  || fail "worktree:drop path-argument did not derive the target slug"
grep -qFx 'drop path_arg_abc123' "$drop_feature_dir/path-events" \
  || fail "worktree:drop path-argument did not drop the target DB"
[[ "$(grep -c '^drop ' "$drop_feature_dir/path-events")" == "1" ]] \
  || fail "worktree:drop path-argument touched a non-target DB"
ok "worktree:drop path-argument targets an explicit worktree"

# --remove: DB/state teardown must finish before git removes the worktree, and
# the branch is never deleted automatically — only a safe follow-up is printed.
(
  resolve_worktree_root() { printf '/resolved/remove-lane'; }
  is_primary_worktree() { return 1; }
  compute_slug() { printf 'remove_lane_abc123'; }
  list_worktree_dbs() {
    printf 'list\n' >> "$drop_feature_dir/remove-events"
    printf 'remove_lane_abc123\n'
  }
  slug_from_dbname() { printf '%s' "$1"; }
  drop_db() { printf 'drop\n' >> "$drop_feature_dir/remove-events"; }
  forget_worktree_fingerprint() { printf 'fingerprint\n' >> "$drop_feature_dir/remove-events"; }
  tombstone_forget() { printf 'tombstone\n' >> "$drop_feature_dir/remove-events"; }
  allocation_forget() { printf 'allocation\n' >> "$drop_feature_dir/remove-events"; }
  git() {
    if [[ "$1" == "-C" && "$3" == "status" ]]; then
      printf 'status\n' >> "$drop_feature_dir/remove-events"
      return 0
    fi
    if [[ "$1" == "-C" && "$3" == "branch" && "$4" == "--show-current" ]]; then
      printf 'branch\n' >> "$drop_feature_dir/remove-events"
      printf 'feat/remove-lane\n'
      return 0
    fi
    if [[ "$1" == "worktree" && "$2" == "remove" ]]; then
      printf 'remove %s\n' "$3" >> "$drop_feature_dir/remove-events"
      return 0
    fi
    printf 'unexpected git %s\n' "$*" >> "$drop_feature_dir/remove-events"
    return 97
  }

  cmd_drop /input/remove-lane --remove
) >"$drop_feature_dir/remove-out" 2>&1 \
  || fail "worktree:drop --remove should succeed:\n$(cat "$drop_feature_dir/remove-out")"
expected_remove_events=$'status\nbranch\nlist\ndrop\nfingerprint\ntombstone\nallocation\nremove /resolved/remove-lane'
[[ "$(cat "$drop_feature_dir/remove-events")" == "$expected_remove_events" ]] \
  || fail "worktree:drop --remove ordering was wrong:\n$(cat "$drop_feature_dir/remove-events")"
grep -qF 'git branch -d feat/remove-lane' "$drop_feature_dir/remove-out" \
  || fail "worktree:drop --remove did not print the branch cleanup hint"
[[ "$(cat "$drop_feature_dir/remove-events")" != *'branch -d'* ]] \
  || fail "worktree:drop --remove must never auto-delete the branch"
ok "worktree:drop --remove performs full ordered teardown and prints the branch hint"

# dirty-target-refusal: cleanliness is checked before every DB/state teardown
# operation, because a later non-force git removal would leave a half-torn lane.
set +e
(
  resolve_worktree_root() { printf '/resolved/dirty-lane'; }
  is_primary_worktree() { return 1; }
  compute_slug() { printf 'dirty_lane_abc123'; }
  list_worktree_dbs() { touch "$drop_feature_dir/dirty-list"; printf ''; }
  drop_db() { touch "$drop_feature_dir/dirty-drop"; }
  forget_worktree_fingerprint() { touch "$drop_feature_dir/dirty-fingerprint"; }
  tombstone_forget() { touch "$drop_feature_dir/dirty-tombstone"; }
  allocation_forget() { touch "$drop_feature_dir/dirty-allocation"; }
  git() {
    if [[ "$1" == "-C" && "$3" == "status" ]]; then
      printf ' M packages/server/src/dirty.ts\n'
      return 0
    fi
    touch "$drop_feature_dir/dirty-other-git"
    return 0
  }

  set -e
  cmd_drop /input/dirty-lane --remove
) >"$drop_feature_dir/dirty-out" 2>&1
dirty_drop_rc=$?
set -e
[[ "$dirty_drop_rc" -ne 0 ]] || fail "worktree:drop dirty-target-refusal should fail"
grep -qF 'uncommitted work at /resolved/dirty-lane; commit or inspect before dropping' "$drop_feature_dir/dirty-out" \
  || fail "worktree:drop dirty-target-refusal message was missing:\n$(cat "$drop_feature_dir/dirty-out")"
for dirty_marker in dirty-list dirty-drop dirty-fingerprint dirty-tombstone dirty-allocation dirty-other-git; do
  [[ ! -e "$drop_feature_dir/$dirty_marker" ]] \
    || fail "worktree:drop dirty-target-refusal performed forbidden work: $dirty_marker"
done
ok "worktree:drop dirty-target-refusal happens before DB or state teardown"

# inside-target-refusal: --remove without an explicit path must not remove the
# worktree containing the caller's current shell.
set +e
(
  current_root() { printf '/resolved/current-lane'; }
  is_primary_worktree() { return 1; }
  compute_slug() { touch "$drop_feature_dir/inside-slug"; printf 'inside_abc123'; }
  list_worktree_dbs() { touch "$drop_feature_dir/inside-list"; printf ''; }
  forget_worktree_fingerprint() { touch "$drop_feature_dir/inside-fingerprint"; }
  tombstone_forget() { touch "$drop_feature_dir/inside-tombstone"; }
  allocation_forget() { touch "$drop_feature_dir/inside-allocation"; }
  git() { touch "$drop_feature_dir/inside-git"; return 0; }

  set -e
  cmd_drop --remove
) >"$drop_feature_dir/inside-out" 2>&1
inside_drop_rc=$?
set -e
[[ "$inside_drop_rc" -ne 0 ]] || fail "worktree:drop inside-target-refusal should fail"
grep -qF 'run it from the primary with an explicit path' "$drop_feature_dir/inside-out" \
  || fail "worktree:drop inside-target-refusal hint was missing:\n$(cat "$drop_feature_dir/inside-out")"
for inside_marker in inside-slug inside-list inside-fingerprint inside-tombstone inside-allocation inside-git; do
  [[ ! -e "$drop_feature_dir/$inside_marker" ]] \
    || fail "worktree:drop inside-target-refusal performed forbidden work: $inside_marker"
done
ok "worktree:drop inside-target-refusal requires an explicit path"

# explicit-self-path-refusal: an explicit path (e.g. `.`) that resolves to the
# caller's own lane must be refused BEFORE any teardown, not after — otherwise
# git worktree remove fails on the cwd worktree, stranding a half-torn lane.
set +e
(
  self_pwd="$(pwd -P)"
  resolve_worktree_root() { printf '%s' "$self_pwd"; }
  is_primary_worktree() { return 1; }
  compute_slug() { touch "$drop_feature_dir/self-slug"; printf 'self_abc123'; }
  list_worktree_dbs() { touch "$drop_feature_dir/self-list"; printf ''; }
  forget_worktree_fingerprint() { touch "$drop_feature_dir/self-fingerprint"; }
  tombstone_forget() { touch "$drop_feature_dir/self-tombstone"; }
  allocation_forget() { touch "$drop_feature_dir/self-allocation"; }
  git() { touch "$drop_feature_dir/self-git"; return 0; }

  set -e
  cmd_drop . --remove
) >"$drop_feature_dir/self-out" 2>&1
self_drop_rc=$?
set -e
[[ "$self_drop_rc" -ne 0 ]] || fail "worktree:drop explicit-self-path-refusal should fail"
grep -qF 'run it from the primary with an explicit path' "$drop_feature_dir/self-out" \
  || fail "worktree:drop explicit-self-path-refusal hint was missing:\n$(cat "$drop_feature_dir/self-out")"
for self_marker in self-slug self-list self-fingerprint self-tombstone self-allocation self-git; do
  [[ ! -e "$drop_feature_dir/$self_marker" ]] \
    || fail "worktree:drop explicit-self-path-refusal performed forbidden work before refusing: $self_marker"
done
ok "worktree:drop refuses an explicit path that resolves to the caller's own lane"

# The primary checkout remains protected whether it is selected implicitly or
# supplied as the explicit target path.
set +e
(
  is_primary_worktree() { return 0; }
  list_worktree_dbs() { touch "$drop_feature_dir/primary-implicit-teardown"; printf ''; }
  cmd_drop
) >"$drop_feature_dir/primary-implicit-out" 2>&1
primary_implicit_rc=$?
(
  resolve_worktree_root() { printf '/resolved/primary'; }
  is_primary_worktree() { [[ "$1" == '/resolved/primary' ]]; }
  list_worktree_dbs() { touch "$drop_feature_dir/primary-explicit-teardown"; printf ''; }
  cmd_drop /input/primary
) >"$drop_feature_dir/primary-explicit-out" 2>&1
primary_explicit_rc=$?
set -e
[[ "$primary_implicit_rc" -ne 0 && "$primary_explicit_rc" -ne 0 ]] \
  || fail "worktree:drop should refuse the primary checkout in both target forms"
grep -qF 'refusing to drop DBs from the primary worktree' "$drop_feature_dir/primary-implicit-out" \
  || fail "worktree:drop implicit primary refusal message was missing"
grep -qF 'refusing to drop DBs from the primary worktree' "$drop_feature_dir/primary-explicit-out" \
  || fail "worktree:drop explicit primary refusal message was missing"
[[ ! -e "$drop_feature_dir/primary-implicit-teardown" && ! -e "$drop_feature_dir/primary-explicit-teardown" ]] \
  || fail "worktree:drop primary refusal must happen before DB teardown"
ok "worktree:drop preserves primary refusal for implicit and explicit targets"

rm -rf "$drop_feature_dir"

# CR18: cmd_drop must abort on list_worktree_dbs failure before clearing local
# registry state; on an empty SELECT it must still succeed and forget local state.
cmd_drop_dir="$(musi_test_tmp_dir)"
# Installed from inside each case's subshell rather than at the top level, so
# the replacements cannot stay ambient for the cmd_gc cases below, which drive
# several of the same helpers with different fakes.
cr18_stubs() {
  is_primary_worktree() { return 1; }
  compute_slug() { printf 'cr18_test'; }
  slug_from_dbname() { printf '%s' "$1"; }
  drop_db() { printf 'drop_db %s\n' "$1" >> "$cmd_drop_dir/dropped"; }
  forget_worktree_fingerprint() { touch "$cmd_drop_dir/forget"; }
  tombstone_forget()           { touch "$cmd_drop_dir/tombstone"; }
  allocation_forget()          { touch "$cmd_drop_dir/allocation"; }
}

# `set +e` around the subshell keeps the parent shell from suppressing the
# inner `set -e` propagation; bash treats subshells in if/||/&& contexts as
# errexit-ignored, which would mask the failure we are asserting.
set +e
(
  set -e
  cr18_stubs
  list_worktree_dbs() { return 5; }
  cmd_drop
) >/dev/null 2>&1
cr18_rc=$?
set -e
[[ "$cr18_rc" -ne 0 ]]                || fail "cmd_drop should propagate list_worktree_dbs failure"
[[ ! -e "$cmd_drop_dir/forget" ]]     || fail "cmd_drop must not forget fingerprint after admin failure"
[[ ! -e "$cmd_drop_dir/tombstone" ]]  || fail "cmd_drop must not forget tombstone after admin failure"
[[ ! -e "$cmd_drop_dir/allocation" ]] || fail "cmd_drop must not forget allocation after admin failure"
[[ ! -e "$cmd_drop_dir/dropped" ]]    || fail "cmd_drop must not iterate drop loop after admin failure"
ok "cmd_drop fails loud when list_worktree_dbs fails and preserves local state"

(
  set -e
  cr18_stubs
  list_worktree_dbs() { printf ''; }
  cmd_drop
) >/dev/null 2>&1 || fail "cmd_drop should succeed when no worktree DBs exist"
[[ -e "$cmd_drop_dir/forget" ]]     || fail "cmd_drop must forget fingerprint when DB list is empty"
[[ -e "$cmd_drop_dir/tombstone" ]]  || fail "cmd_drop must forget tombstone when DB list is empty"
[[ -e "$cmd_drop_dir/allocation" ]] || fail "cmd_drop must forget allocation when DB list is empty"
[[ ! -e "$cmd_drop_dir/dropped" ]]  || fail "cmd_drop must not call drop_db when DB list is empty"
ok "cmd_drop succeeds and clears local state when no worktree DBs exist"

# GC must distinguish a failed post-drop database re-query from a successful
# empty result. A failure must preserve all reservation metadata and skip the
# template phases; an empty result should still clear metadata for dead slugs.
gc_failure_dir="$(musi_test_tmp_dir)"
printf '0\n' > "$gc_failure_dir/list-count"
set +e
(
  state_dir() { printf '%s' "$gc_failure_dir"; }
  ensure_meta_db() { :; }
  list_live_slugs() { printf 'live_abc123\n'; }
  list_worktree_dbs() {
    local count
    count="$(cat "$gc_failure_dir/list-count")"
    printf '%s\n' "$(( count + 1 ))" > "$gc_failure_dir/list-count"
    if [[ "$count" == "0" ]]; then
      printf 'musi_wt_dead_def456\n'
      return 0
    fi
    return 23
  }
  slug_from_dbname() { printf 'dead_def456'; }
  tombstone_age() { printf '0'; }
  drop_db() { :; }
  tombstone_read() { printf '{"dead_def456":0}'; }
  _tombstone_forget_unlocked() { touch "$gc_failure_dir/tombstone-forgotten"; }
  forget_worktree_fingerprint() { touch "$gc_failure_dir/fingerprint-forgotten"; }
  allocation_forget() { touch "$gc_failure_dir/allocation-forgotten"; }
  list_live_template_dbs() { touch "$gc_failure_dir/template-phase-reached"; }

  cmd_gc
) >"$gc_failure_dir/out" 2>&1
gc_failure_rc=$?
set -e
[[ "$gc_failure_rc" -ne 0 ]] || fail "cmd_gc should report a failed database re-query"
grep -qF "database discovery failed" "$gc_failure_dir/out" \
  || fail "cmd_gc should explain that database discovery failed"
[[ ! -e "$gc_failure_dir/tombstone-forgotten" ]] \
  || fail "failed database discovery must preserve tombstones"
[[ ! -e "$gc_failure_dir/fingerprint-forgotten" ]] \
  || fail "failed database discovery must preserve clone fingerprints"
[[ ! -e "$gc_failure_dir/allocation-forgotten" ]] \
  || fail "failed database discovery must preserve allocations"
[[ ! -e "$gc_failure_dir/template-phase-reached" ]] \
  || fail "failed worktree database discovery must skip template cleanup"
ok "cmd_gc preserves reservation metadata when database discovery fails"

gc_empty_dir="$(musi_test_tmp_dir)"
(
  state_dir() { printf '%s' "$gc_empty_dir"; }
  ensure_meta_db() { :; }
  list_live_slugs() { printf 'live_abc123\n'; }
  list_worktree_dbs() { printf ''; }
  tombstone_read() { printf '{"dead_def456":0}'; }
  _tombstone_forget_unlocked() { touch "$gc_empty_dir/tombstone-forgotten"; }
  forget_worktree_fingerprint() { touch "$gc_empty_dir/fingerprint-forgotten"; }
  allocation_forget() { touch "$gc_empty_dir/allocation-forgotten"; }
  list_live_template_dbs() { printf ''; }
  list_template_dbs() { printf ''; }
  template_tombstone_read() { printf '{"musi_template_aaaaaaaaaaaa":0}'; }
  _template_tombstone_forget_unlocked() { touch "$gc_empty_dir/template-forgotten"; }

  cmd_gc
) >/dev/null 2>&1 || fail "cmd_gc should accept successful empty database lists"
[[ -e "$gc_empty_dir/tombstone-forgotten" ]] \
  || fail "successful empty list should clear dead tombstones"
[[ -e "$gc_empty_dir/fingerprint-forgotten" ]] \
  || fail "successful empty list should clear dead clone fingerprints"
[[ -e "$gc_empty_dir/allocation-forgotten" ]] \
  || fail "successful empty list should clear dead allocations"
[[ -e "$gc_empty_dir/template-forgotten" ]] \
  || fail "successful empty template list should clear dead template tombstones"
ok "cmd_gc still cleans stale metadata after successful empty database lists"

# Live-template discovery must fail as a whole when any live worktree cannot be
# fingerprinted. Returning a successful partial set would let GC classify that
# worktree's live template as orphaned.
(
  git() {
    if [[ "$*" == "worktree list --porcelain" ]]; then
      printf 'worktree /tmp/live-good\nHEAD aaaaaa\n\nworktree /tmp/live-bad\nHEAD bbbbbb\n\n'
      return 0
    fi
    command git "$@"
  }
  compute_fingerprint() {
    if [[ "$1" == "/tmp/live-bad" ]]; then
      return 29
    fi
    printf '%064d' 0
  }

  set +e
  partial_live_templates="$(list_live_template_dbs 2>/dev/null)"
  partial_live_templates_rc=$?
  set -e
  [[ "$partial_live_templates_rc" -ne 0 ]] \
    || fail "live-template discovery must reject a partial set: $partial_live_templates"
)
ok "live-template discovery propagates individual fingerprint failures"

gc_incomplete_dir="$(musi_test_tmp_dir)"
git -C "$gc_incomplete_dir" init -q -b main repo
set +e
(
  cd "$gc_incomplete_dir/repo"
  state_dir() { printf '%s' "$gc_incomplete_dir"; }
  ensure_meta_db() { :; }
  list_live_slugs() { printf 'live_abc123\n'; }
  list_worktree_dbs() { printf ''; }
  tombstone_read() { printf '{}'; }
  list_live_template_dbs() { return 29; }
  list_template_dbs() { touch "$gc_incomplete_dir/template-listed"; }
  _template_tombstone_mark_unlocked() { touch "$gc_incomplete_dir/template-tombstoned"; }
  drop_template_db() { touch "$gc_incomplete_dir/template-dropped"; }

  cmd_gc
) > "$gc_incomplete_dir/output" 2>&1
gc_incomplete_rc=$?
set -e
[[ "$gc_incomplete_rc" -ne 0 ]] \
  || fail "direct cmd_gc should fail on an incomplete live template set"
grep -qF "refusing to GC templates with an incomplete live set" "$gc_incomplete_dir/output" \
  || fail "direct cmd_gc should explain its fail-closed result"
for forbidden_marker in template-listed template-tombstoned template-dropped; do
  [[ ! -e "$gc_incomplete_dir/$forbidden_marker" ]] \
    || fail "direct cmd_gc reached unsafe template action $forbidden_marker"
done
rm -rf "$gc_incomplete_dir"
ok "direct cmd_gc fails closed before template discovery or cleanup"

printf '\nworktree-drop-gc smoke tests passed (%d assertions)\n' "$PASS"
