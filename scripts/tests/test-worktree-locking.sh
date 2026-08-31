#!/usr/bin/env bash
# smoke-order: 066
# smoke-subjects: scripts/worktree-db.sh
# smoke-subjects: scripts/tests/test-worktree-locking.sh
# smoke-subjects: scripts/tests/lib/test-tmpdir.sh
# test-worktree-locking.sh — shell smoke tests for worktree init locking,
# resource allocation, and state persistence.
#
# Sources scripts/worktree-db.sh only (its main is guarded, so sourcing is
# safe) and covers per-slug init locks with bounded waits, Redis/port
# allocation including pool exhaustion and registry validation, and the
# tombstone/allocation state writers that must refuse a non-object payload
# rather than blank a good file.
#
# The worktree helpers are covered by four standalone suites so a failure in
# one narrative cannot hide the contracts of the others:
#   scripts/tests/test-worktree-db.sh       DB/init/dev helpers and seed fingerprints
#   scripts/tests/test-worktree-new.sh      worktree:new creation and failure recovery
#   scripts/tests/test-worktree-drop-gc.sh  worktree:drop / worktree:gc teardown
#   scripts/tests/test-worktree-locking.sh  init locks, allocation, and state writers
#
# Run via `bash scripts/tests/test-worktree-locking.sh`.

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-tmpdir.sh
. "$TEST_SCRIPT_DIR/lib/test-tmpdir.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-db.sh"

PASS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$(( PASS + 1 )); printf 'ok %d - %s\n' "$PASS" "$1"; }

# One EXIT cleanup for the whole suite: this replaces the handler test-tmpdir.sh
# installs so the init-lock case's background flock holder is reaped alongside
# the musi_test_tmp_dir registry.
init_lock_holder_pid=""
kill_init_lock_holder() {
  [[ -z "${init_lock_holder_pid:-}" ]] || kill "$init_lock_holder_pid" 2>/dev/null || true
}
trap 'kill_init_lock_holder; musi_test_tmp_cleanup' EXIT

# Init/refresh locking remains per-slug so one stalled lane cannot block an
# unrelated worktree. Acquisition is bounded, and GC never unlinks these stable
# pathnames because an older-revision sibling may already have their inode open.
init_lock_gc_dir="$(musi_test_tmp_dir)"
init_lock_holder_pid=""
state_dir() { printf '%s' "$init_lock_gc_dir"; }
ensure_state_dir

lane_a_lock="$(worktree_init_lock_path lane_a_abc123)"
lane_b_lock="$(worktree_init_lock_path lane_b_def456)"
[[ "$lane_a_lock" != "$lane_b_lock" ]] || fail "unrelated slugs must not share one init lock"
(
  exec {holder_fd}>"$lane_a_lock"
  flock "$holder_fd"
  touch "$init_lock_gc_dir/holder-ready"
  sleep 10
) &
init_lock_holder_pid=$!
for _ in {1..50}; do
  [[ -e "$init_lock_gc_dir/holder-ready" ]] && break
  sleep 0.1
done
[[ -e "$init_lock_gc_dir/holder-ready" ]] || fail "init lock holder did not start"

lane_b_fd=""
MUSI_WT_INIT_LOCK_TIMEOUT=1 acquire_worktree_init_lock "lane_b_def456" lane_b_fd
release_worktree_init_lock "$lane_b_fd"

set +e
same_slug_error="$(MUSI_WT_INIT_LOCK_TIMEOUT=1 acquire_worktree_init_lock "lane_a_abc123" blocked_fd 2>&1)"
same_slug_rc=$?
set -e
[[ "$same_slug_rc" -ne 0 ]] || fail "same-slug init lock wait should time out"
[[ "$same_slug_error" == *"timed out after 1s"* ]] \
  || fail "same-slug timeout should be actionable: $same_slug_error"

kill "$init_lock_holder_pid" 2>/dev/null || true
wait "$init_lock_holder_pid" 2>/dev/null || true
init_lock_holder_pid=""

touch "$init_lock_gc_dir/init-obsolete_789abc.lock"
(
  ensure_meta_db() { :; }
  list_live_slugs() { printf ''; }
  list_worktree_dbs() { printf ''; }
  tombstone_read() { printf '{}'; }
  list_live_template_dbs() { printf ''; }
  list_template_dbs() { printf ''; }
  template_tombstone_read() { printf '{}'; }
  cmd_gc
) >/dev/null 2>&1 || fail "GC should succeed while retaining legacy init locks"
[[ -e "$init_lock_gc_dir/init-obsolete_789abc.lock" ]] \
  || fail "GC must not unlink mixed-revision init lock paths"
ok "per-slug init locks have bounded waits and remain stable across GC"

# ---------------------------------------------------------------------------
# Pool exhaustion must fail loud, not poison .env (leaf worktree-lane-hardening
# 2026-07/01). Reserve all 15 Redis slots with live slugs, then a fresh slug's
# allocation must exit non-zero at the allocation site — never emit an empty
# allocation line that write_worktree_env would coerce into SERVER_PORT=0.
alloc_state_dir="$(musi_test_tmp_dir)"

state_dir() { printf '%s' "$alloc_state_dir"; }
allocations_file() { printf '%s' "$alloc_state_dir/allocations.json"; }
port_in_use() { return 1; }   # deterministic: never probe real ports

reserved_json='{}'
reserved_slugs=''
for i in $(seq 1 15); do
  reserved_slug="lane_$(printf '%02d' "$i")_abc123"
  reserved_json="$(printf '%s' "$reserved_json" | jq \
    --arg s "$reserved_slug" \
    --argjson srv "$(( 8100 + i ))" \
    --argjson cli "$(( 8010 + i ))" \
    --argjson redis "$i" \
    '. + {($s): {server: $srv, client: $cli, redis: $redis, updatedAt: 0}}')"
  reserved_slugs="$reserved_slugs$reserved_slug"$'\n'
done
mkdir -p "$alloc_state_dir"
printf '%s\n' "$reserved_json" > "$alloc_state_dir/allocations.json"
# All 15 reserved slugs are live, so allocate_resources prunes none of them.
list_live_slugs() { printf '%s' "$reserved_slugs"; }

set +e
exhausted_out="$( ( set -e; allocate_resources "newlane_ffffff" 0 0 0 ) 2>/dev/null )"
exhausted_rc=$?
set -e
[[ "$exhausted_rc" -ne 0 ]] || fail "allocate_resources must exit non-zero when all 15 Redis slots are reserved"
[[ -z "$exhausted_out" ]]   || fail "allocate_resources must not emit an allocation line when the pool is exhausted"
ok "allocate_resources fails loud when the Redis pool is exhausted"

# A hand-edited registry can still be valid JSON while containing impossible
# ranges or collisions. Reject it before returning an existing row or pruning
# and rewriting state.
expect_invalid_allocation_registry() {
  local label="$1" json="$2" slug="$3" before out rc error_file
  printf '%s\n' "$json" > "$alloc_state_dir/allocations.json"
  before="$(cat "$alloc_state_dir/allocations.json")"
  list_live_slugs() { jq -r 'keys[]' "$alloc_state_dir/allocations.json"; }
  error_file="$(mktemp)"

  set +e
  out="$( ( set -e; allocate_resources "$slug" 0 0 0 ) 2>"$error_file" )"
  rc=$?
  set -e

  [[ "$rc" -ne 0 ]] || fail "$label registry should be rejected"
  [[ -z "$out" ]] || fail "$label registry should not emit an allocation"
  grep -qF "invalid allocations.json" "$error_file" \
    || fail "$label registry should report semantic validation failure:
$(cat "$error_file")"
  [[ "$(cat "$alloc_state_dir/allocations.json")" == "$before" ]] \
    || fail "$label registry should remain byte-for-byte unchanged"
  rm -f "$error_file"
}

expect_invalid_allocation_registry \
  "out-of-range" \
  '{"lane_a_abc123":{"server":8099,"client":8100,"redis":0,"updatedAt":0}}' \
  "lane_a_abc123"
expect_invalid_allocation_registry \
  "duplicate server port" \
  '{"lane_a_abc123":{"server":8100,"client":8010,"redis":1,"updatedAt":0},"lane_b_def456":{"server":8100,"client":8011,"redis":2,"updatedAt":0}}' \
  "lane_a_abc123"
expect_invalid_allocation_registry \
  "duplicate client port" \
  '{"lane_a_abc123":{"server":8100,"client":8010,"redis":1,"updatedAt":0},"lane_b_def456":{"server":8101,"client":8010,"redis":2,"updatedAt":0}}' \
  "lane_a_abc123"
expect_invalid_allocation_registry \
  "duplicate Redis database" \
  '{"lane_a_abc123":{"server":8100,"client":8010,"redis":1,"updatedAt":0},"lane_b_def456":{"server":8101,"client":8011,"redis":1,"updatedAt":0}}' \
  "lane_a_abc123"
ok "allocation registry rejects impossible ranges and duplicate resources without rewriting"

# A failed allocation-state rename must fail the public resolution seam without
# reporting resources that were never persisted. The old registry must survive
# and the failed write must not leave scratch state behind.
write_failure_alloc='{"somelane":{"server":8100,"client":8010,"redis":3,"updatedAt":0}}'
printf '%s\n' "$write_failure_alloc" > "$alloc_state_dir/allocations.json"
list_live_slugs() { printf 'somelane\n'; }
write_failure_files_before="$(find "$alloc_state_dir" -maxdepth 1 -type f -printf '%f\n' | sort)"
set +e
resolve_write_failure_out="$( (
  mv() {
    if [[ "${2:-}" == "$alloc_state_dir/allocations.json" ]]; then
      return 23
    fi
    command mv "$@"
  }
  resolve_worktree_resources "somelane" 0 0 0
) 2>/dev/null )"
resolve_write_failure_rc=$?
set -e
[[ "$resolve_write_failure_rc" -ne 0 ]] \
  || fail "resolve_worktree_resources must fail when allocation persistence fails"
[[ -z "$resolve_write_failure_out" ]] \
  || fail "resolve_worktree_resources must not report an unpersisted allocation"
[[ "$(cat "$alloc_state_dir/allocations.json")" == "$write_failure_alloc" ]] \
  || fail "failed allocation persistence must preserve the existing registry"
[[ "$(find "$alloc_state_dir" -maxdepth 1 -type f -printf '%f\n' | sort)" == "$write_failure_files_before" ]] \
  || fail "failed allocation persistence must clean up scratch state"
ok "resolve_worktree_resources propagates allocation persistence failure"

# The init consumer must propagate that failure instead of swallowing it via
# `read <<< "$(...)"`. resolve_worktree_resources is the guarded seam.
printf '%s\n' \
  '{"somelane":{"server":null,"client":null,"redis":null,"updatedAt":0}}' \
  > "$alloc_state_dir/allocations.json"
list_live_slugs() { printf 'somelane\n'; }
write_worktree_env() { touch "$alloc_state_dir/poisoned-env"; }
set +e
(
  set -e
  alloc_line="$(resolve_worktree_resources "somelane" 0 0 0)"
  IFS=$'\t' read -r server_port client_port redis_db <<< "$alloc_line"
  write_worktree_env "somelane" "$server_port" "$client_port" "$redis_db"
) >/dev/null 2>&1
null_row_rc=$?
set -e
[[ "$null_row_rc" -ne 0 ]] || fail "init allocation seam must reject a null-field registry row"
[[ ! -e "$alloc_state_dir/poisoned-env" ]] \
  || fail "init allocation seam must not write an env after a null-field registry row"
ok "init allocation seam rejects null-field registry rows before writing env"

allocate_resources() { printf '8100\t8010\t3\n'; }
resolve_pass="$(resolve_worktree_resources "somelane" 0 0 0)"
[[ "$resolve_pass" == $'8100\t8010\t3' ]] \
  || fail "resolve_worktree_resources must pass a good allocation through unchanged"

allocate_resources() { printf '8100\t8010\t3\n'; return 1; }
set +e
resolve_out="$( ( set -e; resolve_worktree_resources "somelane" 0 0 0 ) 2>/dev/null )"
resolve_stdout_fail_rc=$?
set -e
[[ "$resolve_stdout_fail_rc" -ne 0 ]] \
  || fail "resolve_worktree_resources must preserve failure after allocation stdout"
[[ -z "$resolve_out" ]] \
  || fail "resolve_worktree_resources must not pass through stdout from a failed allocation"
ok "resolve_worktree_resources preserves allocation failure after stdout"

allocate_resources() { log "no free Redis DB in [1, 15]"; return 1; }
set +e
resolve_out="$( ( set -e; resolve_worktree_resources "somelane" 0 0 0 ) 2>/dev/null )"
resolve_rc=$?
set -e
[[ "$resolve_rc" -ne 0 ]] || fail "resolve_worktree_resources must exit non-zero when allocation fails"
[[ -z "$resolve_out" ]]   || fail "resolve_worktree_resources must not emit output when allocation fails"
ok "resolve_worktree_resources fails loud instead of swallowing an empty allocation"

# ---------------------------------------------------------------------------
# State writers must refuse a non-object payload rather than wipe a good file
# (leaf worktree-lane-hardening 2026-07/02). A corrupt allocation_read upstream
# can leave $json empty or malformed; the writer must not cascade that into a
# blanked registry that drops every other worktree's reservation.
writer_state_dir="$(musi_test_tmp_dir)"
state_dir() { printf '%s' "$writer_state_dir"; }
tombstones_file() { printf '%s' "$writer_state_dir/tombstones.json"; }
template_tombstones_file() { printf '%s' "$writer_state_dir/template-tombstones.json"; }
allocations_file() { printf '%s' "$writer_state_dir/allocations.json"; }
mkdir -p "$writer_state_dir"

good_tombstones='{"lane_x_abc123":1700000000}'
printf '%s\n' "$good_tombstones" > "$writer_state_dir/tombstones.json"

set +e
( set -e; tombstone_write "" ) >/dev/null 2>&1;              writer_empty_rc=$?
( set -e; tombstone_write "not valid json" ) >/dev/null 2>&1; writer_bad_rc=$?
( set -e; tombstone_write "[1,2,3]" ) >/dev/null 2>&1;        writer_arr_rc=$?
set -e
[[ "$writer_empty_rc" -ne 0 ]] || fail "tombstone_write must refuse an empty payload"
[[ "$writer_bad_rc" -ne 0 ]]   || fail "tombstone_write must refuse a malformed payload"
[[ "$writer_arr_rc" -ne 0 ]]   || fail "tombstone_write must refuse a non-object (array) payload"
[[ "$(cat "$writer_state_dir/tombstones.json")" == "$good_tombstones" ]] \
  || fail "tombstone_write must leave the good state file unchanged when it refuses"
ok "tombstone_write refuses non-object payloads and preserves the good state file"

( set -e; tombstone_write '{"lane_y_def456":1700000001}' ) \
  || fail "tombstone_write must accept a valid object payload"
jq -e '.lane_y_def456 == 1700000001' "$writer_state_dir/tombstones.json" >/dev/null \
  || fail "tombstone_write must persist a valid object payload"
ok "tombstone_write persists a valid object payload"

good_template_tombstones='{"musi_template_abcdef123456":1700000000}'
printf '%s\n' "$good_template_tombstones" > "$writer_state_dir/template-tombstones.json"

set +e
( set -e; template_tombstone_write "" ) >/dev/null 2>&1;              writer_empty_rc=$?
( set -e; template_tombstone_write "not valid json" ) >/dev/null 2>&1; writer_bad_rc=$?
( set -e; template_tombstone_write "[1,2,3]" ) >/dev/null 2>&1;        writer_arr_rc=$?
set -e
[[ "$writer_empty_rc" -ne 0 ]] || fail "template_tombstone_write must refuse an empty payload"
[[ "$writer_bad_rc" -ne 0 ]]   || fail "template_tombstone_write must refuse a malformed payload"
[[ "$writer_arr_rc" -ne 0 ]]   || fail "template_tombstone_write must refuse a non-object (array) payload"
[[ "$(cat "$writer_state_dir/template-tombstones.json")" == "$good_template_tombstones" ]] \
  || fail "template_tombstone_write must leave the good state file unchanged when it refuses"
ok "template_tombstone_write refuses non-object payloads and preserves the good state file"

( set -e; template_tombstone_write '{"musi_template_def456abcdef":1700000001}' ) \
  || fail "template_tombstone_write must accept a valid object payload"
jq -e '.musi_template_def456abcdef == 1700000001' \
  "$writer_state_dir/template-tombstones.json" >/dev/null \
  || fail "template_tombstone_write must persist a valid object payload"
ok "template_tombstone_write persists a valid object payload"

good_alloc='{"lane_x_abc123":{"server":8100,"client":8010,"redis":3,"updatedAt":0}}'
printf '%s\n' "$good_alloc" > "$writer_state_dir/allocations.json"

set +e
( set -e; allocation_write "" ) >/dev/null 2>&1;              writer_empty_rc=$?
( set -e; allocation_write "not valid json" ) >/dev/null 2>&1; writer_bad_rc=$?
( set -e; allocation_write "[1,2,3]" ) >/dev/null 2>&1;        writer_arr_rc=$?
set -e
[[ "$writer_empty_rc" -ne 0 ]] || fail "allocation_write must refuse an empty payload"
[[ "$writer_bad_rc" -ne 0 ]]   || fail "allocation_write must refuse a malformed payload"
[[ "$writer_arr_rc" -ne 0 ]]   || fail "allocation_write must refuse a non-object (array) payload"
[[ "$(cat "$writer_state_dir/allocations.json")" == "$good_alloc" ]] \
  || fail "allocation_write must leave the good state file unchanged when it refuses"
ok "allocation_write refuses non-object payloads and preserves the good state file"

( set -e; allocation_write '{"lane_y_def456":{"server":8101,"client":8011,"redis":4,"updatedAt":0}}' ) \
  || fail "allocation_write must accept a valid object payload"
jq -e '.lane_y_def456.redis == 4' "$writer_state_dir/allocations.json" >/dev/null \
  || fail "allocation_write must persist a valid object payload"
ok "allocation_write persists a valid object payload"

printf '\nworktree-locking smoke tests passed (%d assertions)\n' "$PASS"
