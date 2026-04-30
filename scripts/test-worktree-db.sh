#!/usr/bin/env bash
# test-worktree-db.sh — pure-shell smoke tests for worktree-db helpers.
#
# Sources scripts/worktree-db.sh (main is guarded so sourcing is safe) and
# exercises slug/parsing/membership helpers without touching Postgres or git.
# Run via `bash scripts/test-worktree-db.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/worktree-db.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/worktree-drift-hook.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/dev.sh"
# worktree-new.sh sources worktree-db.sh idempotently, so loading it after
# worktree-db.sh is safe and gives the parser tests below access to its helpers.
# shellcheck source=/dev/null
. "$SCRIPT_DIR/worktree-new.sh"

PASS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$(( PASS + 1 )); printf 'ok %d - %s\n' "$PASS" "$1"; }

# compute_slug is deterministic and produces <base>_<6-hex> for fixed paths.
slug_a="$(compute_slug '/some/path/foo-bar')"
slug_b="$(compute_slug '/some/path/foo-bar')"
[[ "$slug_a" == "$slug_b" ]] || fail "compute_slug not deterministic"
[[ "$slug_a" =~ ^[a-z0-9_]+_[0-9a-f]{6}$ ]] || fail "compute_slug format wrong: $slug_a"
ok "compute_slug deterministic and well-formed"

# compute_slug normalizes spaces and uppercase to lowercase + underscore.
slug_c="$(compute_slug '/tmp/Foo Bar')"
[[ "$slug_c" =~ ^foo_bar_[0-9a-f]{6}$ ]] || fail "compute_slug normalize: $slug_c"
ok "compute_slug normalizes spaces and case"

# slug_from_dbname strips musi_wt_ prefix and worktree DB suffixes.
roundtrip="$(slug_from_dbname "musi_wt_${slug_a}_test")"
[[ "$roundtrip" == "$slug_a" ]] || fail "slug_from_dbname round-trip: $roundtrip"
roundtrip="$(slug_from_dbname "musi_wt_${slug_a}_w4")"
[[ "$roundtrip" == "$slug_a" ]] || fail "slug_from_dbname worker round-trip: $roundtrip"
roundtrip="$(slug_from_dbname "musi_wt_${slug_a}_test_wabc123")"
[[ "$roundtrip" == "$slug_a" ]] || fail "slug_from_dbname legacy worker round-trip: $roundtrip"
roundtrip="$(slug_from_dbname "musi_wt_${slug_a}_e2e")"
[[ "$roundtrip" == "$slug_a" ]] || fail "slug_from_dbname e2e round-trip: $roundtrip"
roundtrip="$(slug_from_dbname "musi_wt_${slug_a}")"
[[ "$roundtrip" == "$slug_a" ]] || fail "slug_from_dbname dev round-trip: $roundtrip"
ok "slug_from_dbname strips suffixes including compact test workers"

long_slug="$(compute_slug "/tmp/$(printf 'very-long-worktree-path-%.0s' {1..8})")"
(( ${#long_slug} <= SLUG_MAX_LEN )) || fail "compute_slug exceeded slug max: $long_slug"
worker_db_name="musi_wt_${long_slug}_wzz"
(( ${#worker_db_name} <= 63 )) || fail "worker DB name exceeds Postgres identifier limit: $worker_db_name"
( validate_wt_db_name "$worker_db_name" ) || fail "validate_wt_db_name should accept worker DBs"
( validate_wt_db_name "musi_wt_${long_slug}_wabc" 2>/dev/null ) \
  && fail "validate_wt_db_name should reject overlong worker DB suffixes"
( validate_wt_db_name "musi_wt_${long_slug}_test_wabc123" 2>/dev/null ) \
  && fail "validate_wt_db_name should reject legacy worker DBs with 49-byte slugs"
ok "worktree DB validation accepts bounded compact worker test DBs"

# template_db_for_fingerprint truncates the SHA-256 to TEMPLATE_HASH_LEN hex chars.
fake_fp="$(printf '%064d' 0)"
template_name="$(template_db_for_fingerprint "$fake_fp")"
[[ "$template_name" == "musi_template_000000000000" ]] || fail "template name: $template_name"
ok "template_db_for_fingerprint produces expected name"

# dbset_contains / dbset_label classify presence in a newline-delimited set.
existing_dbs=$'musi_template_aaa\nmusi_wt_foo_abc123\nmusi_wt_foo_abc123_test'
dbset_contains "$existing_dbs" "musi_template_aaa" || fail "dbset_contains true case"
if dbset_contains "$existing_dbs" "musi_template_zzz"; then fail "dbset_contains false case"; fi
[[ "$(dbset_label "$existing_dbs" "musi_template_aaa")" == "yes" ]] || fail "dbset_label yes"
[[ "$(dbset_label "$existing_dbs" "missing_db")" == "no" ]] || fail "dbset_label no"
[[ "$(dbset_label "" "musi_template_aaa")" == "no" ]] || fail "dbset_label empty set"
ok "dbset_contains/dbset_label classify presence"

dbset_has_worktree_slug $'musi_wt_foo_abc123_w2' "foo_abc123" \
  || fail "compact worker DB should keep slug state alive"
dbset_has_worktree_slug $'musi_wt_foo_abc123_test_wabc123' "foo_abc123" \
  || fail "legacy worker DB should keep slug state alive"
if dbset_has_worktree_slug $'musi_wt_foo_abc123_w2' "bar_abc123"; then
  fail "worker DB for another slug should not keep slug state alive"
fi
ok "worktree DB slug membership includes worker leftovers"

# parse_worktree_porcelain marks the primary path and emits one row per
# worktree, including bare and detached variants.
fixture=$(printf '%s\n' \
  "worktree /tmp/a" \
  "HEAD aaaaaa" \
  "branch refs/heads/main" \
  "" \
  "worktree /tmp/b" \
  "HEAD bbbbbb" \
  "branch refs/heads/feat/x" \
  "" \
  "worktree /tmp/c" \
  "HEAD cccccc" \
  "detached" \
  "" \
  "worktree /tmp/d" \
  "bare")
out="$(parse_worktree_porcelain "/tmp/a" <<< "$fixture")"
expected=$'/tmp/a\tmain\tyes\n/tmp/b\tfeat/x\tno\n/tmp/c\t<detached>\tno\n/tmp/d\t<bare>\tno'
[[ "$out" == "$expected" ]] || fail "parse_worktree_porcelain output:
got:
$out
want:
$expected"
ok "parse_worktree_porcelain emits tab-separated rows with primary/bare/detached"

# parse_worktree_porcelain flushes the final record even without a trailing
# newline (the `|| [[ -n "$line" ]]` read guard).
no_trailing="worktree /tmp/x"$'\n'"branch refs/heads/main"
out="$(printf '%s' "$no_trailing" | parse_worktree_porcelain "/tmp/other")"
[[ "$out" == $'/tmp/x\tmain\tno' ]] || fail "no-trailing-newline parse:
got: $out"
ok "parse_worktree_porcelain flushes final record without trailing newline"

# safe_compute_fingerprint returns empty (not aborts) when prisma inputs are missing.
empty_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir"' EXIT
out="$(safe_compute_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_fingerprint should be empty for bare dir, got: $out"
ok "safe_compute_fingerprint swallows missing-input die"

out="$(safe_compute_migration_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_migration_fingerprint should be empty for bare dir, got: $out"
out="$(safe_compute_seed_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_seed_fingerprint should be empty for bare dir, got: $out"
ok "split fingerprint helpers swallow missing-input die"

fingerprint_dir="$(mktemp -d)"
mkdir -p "$fingerprint_dir/packages/server/prisma/migrations/20260426000000_init"
mkdir -p "$fingerprint_dir/packages/server/src/seed"
printf 'datasource db {}\n' > "$fingerprint_dir/packages/server/prisma/schema.prisma"
printf 'CREATE TABLE test(id TEXT PRIMARY KEY);\n' > "$fingerprint_dir/packages/server/prisma/migrations/20260426000000_init/migration.sql"
printf 'seed template\n' > "$fingerprint_dir/packages/server/prisma/seed-template.ts"
printf 'seed data\n' > "$fingerprint_dir/packages/server/src/seed/species.ts"
split_migration_before="$(compute_migration_fingerprint "$fingerprint_dir")"
split_seed_before="$(compute_seed_fingerprint "$fingerprint_dir")"
combined_before="$(compute_fingerprint "$fingerprint_dir")"
printf 'seed data changed\n' > "$fingerprint_dir/packages/server/src/seed/species.ts"
split_migration_after="$(compute_migration_fingerprint "$fingerprint_dir")"
split_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
combined_after="$(compute_fingerprint "$fingerprint_dir")"
[[ "$split_migration_before" == "$split_migration_after" ]] || fail "seed edit should not change migration fingerprint"
[[ "$split_seed_before" != "$split_seed_after" ]] || fail "seed edit should change seed fingerprint"
[[ "$combined_before" != "$combined_after" ]] || fail "seed edit should change combined template fingerprint"
rm -rf "$fingerprint_dir"
ok "split fingerprints distinguish migration inputs from SRD seed inputs"

# Path-independence: identical Prisma/seed inputs at two different worktree
# paths must produce the same fingerprint, so they share one
# musi_template_<hash> DB instead of each rebuilding their own.
fingerprint_a="$(mktemp -d)"
fingerprint_b="$(mktemp -d)"
for dir in "$fingerprint_a" "$fingerprint_b"; do
  mkdir -p "$dir/packages/server/prisma/migrations/20260426000000_init"
  mkdir -p "$dir/packages/server/src/seed"
  printf 'datasource db {}\n' > "$dir/packages/server/prisma/schema.prisma"
  printf 'CREATE TABLE test(id TEXT PRIMARY KEY);\n' > "$dir/packages/server/prisma/migrations/20260426000000_init/migration.sql"
  printf 'seed template\n' > "$dir/packages/server/prisma/seed-template.ts"
  printf 'seed data\n' > "$dir/packages/server/src/seed/species.ts"
done
fp_a_combined="$(compute_fingerprint "$fingerprint_a")"
fp_b_combined="$(compute_fingerprint "$fingerprint_b")"
[[ "$fp_a_combined" == "$fp_b_combined" ]] || fail "compute_fingerprint must be path-independent:
$fingerprint_a -> $fp_a_combined
$fingerprint_b -> $fp_b_combined"
fp_a_migration="$(compute_migration_fingerprint "$fingerprint_a")"
fp_b_migration="$(compute_migration_fingerprint "$fingerprint_b")"
[[ "$fp_a_migration" == "$fp_b_migration" ]] || fail "compute_migration_fingerprint must be path-independent:
$fingerprint_a -> $fp_a_migration
$fingerprint_b -> $fp_b_migration"
fp_a_seed="$(compute_seed_fingerprint "$fingerprint_a")"
fp_b_seed="$(compute_seed_fingerprint "$fingerprint_b")"
[[ "$fp_a_seed" == "$fp_b_seed" ]] || fail "compute_seed_fingerprint must be path-independent:
$fingerprint_a -> $fp_a_seed
$fingerprint_b -> $fp_b_seed"
# Sanity: a content change in one tree must still diverge from the unchanged tree.
printf 'CREATE TABLE other(id TEXT PRIMARY KEY);\n' \
  > "$fingerprint_b/packages/server/prisma/migrations/20260426000000_init/migration.sql"
fp_b_migration_changed="$(compute_migration_fingerprint "$fingerprint_b")"
[[ "$fp_a_migration" != "$fp_b_migration_changed" ]] || fail "migration content change should still alter fingerprint"
rm -rf "$fingerprint_a" "$fingerprint_b"
ok "fingerprints depend on contents and relative paths, not the worktree's absolute path"

current_template_fp="$(printf 'c%.0s' {1..64})"
current_migration_fp="$(printf 'd%.0s' {1..64})"
current_seed_fp="$(printf 'e%.0s' {1..64})"
refresh_recorded="$(refresh_data_recorded_fingerprints 1 "old-template" "old-seed" "$current_template_fp" "$current_migration_fp" "$current_seed_fp")"
expected_refresh_recorded="${current_template_fp}"$'\t'"${current_migration_fp}"$'\t'"${current_seed_fp}"
[[ "$refresh_recorded" == "$expected_refresh_recorded" ]] || fail "destructive refresh should record current fingerprints:
got:
$refresh_recorded
want:
$expected_refresh_recorded"

refresh_recorded="$(refresh_data_recorded_fingerprints 0 "old-template" "old-seed" "$current_template_fp" "$current_migration_fp" "$current_seed_fp")"
expected_refresh_recorded="old-template"$'\t'"${current_migration_fp}"$'\t'"old-seed"
[[ "$refresh_recorded" == "$expected_refresh_recorded" ]] || fail "preserve refresh should keep seed drift metadata:
got:
$refresh_recorded
want:
$expected_refresh_recorded"

refresh_recorded="$(refresh_data_recorded_fingerprints 0 "" "" "$current_template_fp" "$current_migration_fp" "$current_seed_fp")"
expected_refresh_recorded="seed-drift"$'\t'"${current_migration_fp}"$'\t'"${PRESERVE_REFRESH_SEED_FP}"
[[ "$refresh_recorded" == "$expected_refresh_recorded" ]] || fail "preserve refresh should use stale sentinels when prior metadata is missing:
got:
$refresh_recorded
want:
$expected_refresh_recorded"
ok "refresh-data fingerprint metadata keeps preserve-mode seed drift visible"

fp_a="$(printf 'a%.0s' {1..64})"
fp_b="$(printf 'b%.0s' {1..64})"
[[ "$(musi_short_fp "$fp_a")" == "aaaaaaaaaaaa" ]] || fail "musi_short_fp truncates valid hashes"
[[ "$(musi_short_fp "")" == "<none>" ]] || fail "musi_short_fp empty fallback"
ok "musi_short_fp formats fingerprint labels"

musi_template_fingerprint_drifted "$fp_b" "$fp_a" || fail "expected fingerprint drift"
if musi_template_fingerprint_drifted "$fp_a" "$fp_a"; then fail "same fingerprint should not drift"; fi
if musi_template_fingerprint_drifted "$fp_a" ""; then fail "missing clone fingerprint should not drift"; fi
ok "musi_template_fingerprint_drifted compares current and clone fingerprints"

musi_drift_event_is_no_op "post-checkout" "0" || fail "post-checkout file checkout should be a no-op"
if musi_drift_event_is_no_op "post-checkout" "1"; then fail "post-checkout branch checkout must run check"; fi
if musi_drift_event_is_no_op "post-checkout" ""; then fail "missing flag must default to running check"; fi
if musi_drift_event_is_no_op "post-merge" "0"; then fail "post-merge has no branch_flag and must always run"; fi
ok "musi_drift_event_is_no_op skips only post-checkout file checkouts"

warning="$(musi_template_drift_warning "post-checkout" "/tmp/wt" "$fp_b" "$fp_a" "musi_template_bbbbbbbbbbbb" 2>&1)"
[[ "$warning" == *"worktree drift: template fingerprint changed after post-checkout."* ]] || fail "warning headline missing:
$warning"
[[ "$warning" == *"clone fingerprint: aaaaaaaaaaaa"* ]] || fail "warning clone fingerprint missing:
$warning"
[[ "$warning" == *"current fingerprint: bbbbbbbbbbbb"* ]] || fail "warning current fingerprint missing:
$warning"
[[ "$warning" == *"Run 'bun run worktree:init'"* ]] || fail "warning follow-up command missing:
$warning"
ok "musi_template_drift_warning includes expected warning text"

unset MUSI_DEV_DRIFT_GATE
[[ "$(musi_dev_drift_gate_mode)" == "warn" ]] || fail "default dev drift gate mode should warn"
MUSI_DEV_DRIFT_GATE=fail
[[ "$(musi_dev_drift_gate_mode)" == "fail" ]] || fail "MUSI_DEV_DRIFT_GATE=fail should fail"
MUSI_DEV_DRIFT_GATE=off
[[ "$(musi_dev_drift_gate_mode)" == "off" ]] || fail "MUSI_DEV_DRIFT_GATE=off should opt out"
unset MUSI_DEV_DRIFT_GATE
ok "dev drift gate mode defaults to warn and supports fail/off"

if ( MUSI_DEV_LOG_COLOR=off; musi_dev_log_color_enabled ); then fail "MUSI_DEV_LOG_COLOR=off should disable color"; fi
( MUSI_DEV_LOG_COLOR=on; musi_dev_log_color_enabled ) || fail "MUSI_DEV_LOG_COLOR=on should enable color"
if ( MUSI_DEV_LOG_COLOR=auto NO_COLOR=1; musi_dev_log_color_enabled ); then fail "NO_COLOR should disable auto color"; fi
ok "dev log color mode supports on/off/auto with NO_COLOR"

prefixed="$(printf 'alpha\nbeta' | musi_dev_prefix_stream server 0)"
expected_prefixed=$'[server] alpha\n[server] beta'
[[ "$prefixed" == "$expected_prefixed" ]] || fail "plain dev log prefix mismatch:
got:
$prefixed
want:
$expected_prefixed"

prefixed="$(printf 'alpha\n' | musi_dev_prefix_stream client 1)"
expected_prefixed=$'\033[32m[client]\033[0m alpha'
[[ "$prefixed" == "$expected_prefixed" ]] || fail "colored dev log prefix mismatch:
got:
$prefixed
want:
$expected_prefixed"
ok "dev log prefixer preserves original lines after readable tags"

workspace_specs="$(musi_dev_workspace_specs)"
expected_specs=$'shared\tpackages/shared\t\nserver\tpackages/server\t\nclient\tpackages/client\t.env'
[[ "$workspace_specs" == "$expected_specs" ]] || fail "dev workspace specs mismatch:
got:
$workspace_specs
want:
$expected_specs"
ok "dev workspace runner covers shared, server, and client streams"

workspace_env_dir="$(mktemp -d)"
workspace_stub_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$workspace_env_dir" "$workspace_stub_dir"' EXIT
printf 'VITE_DEV_PORT=8123\n' > "$workspace_env_dir/.env"
cat > "$workspace_stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_BUN_OUT"
STUB
chmod +x "$workspace_stub_dir/bun"
export STUB_BUN_OUT="$workspace_stub_dir/argv"
PATH="$workspace_stub_dir:$PATH" musi_dev_start_workspace client "$workspace_env_dir" 0 ".env"
wait "$!"
expected_bun_argv=$'--env-file=.env\nrun\ndev'
[[ "$(cat "$STUB_BUN_OUT")" == "$expected_bun_argv" ]] || fail "client workspace should use bun dotenv loading:
got:
$(cat "$STUB_BUN_OUT")
want:
$expected_bun_argv"
ok "dev workspace runner passes package-local env files through bun"

cleanup_dir="$(mktemp -d)"
cleanup_stub_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$workspace_env_dir" "$workspace_stub_dir" "$cleanup_dir" "$cleanup_stub_dir"' EXIT
cat > "$cleanup_stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$$" > "$FAKE_BUN_PID_FILE"
trap 'printf term > "$FAKE_BUN_TERM_FILE"; exit 0' TERM INT
while :; do sleep 1; done
STUB
chmod +x "$cleanup_stub_dir/bun"
export FAKE_BUN_PID_FILE="$cleanup_stub_dir/pid"
export FAKE_BUN_TERM_FILE="$cleanup_stub_dir/term"
PATH="$cleanup_stub_dir:$PATH" musi_dev_start_workspace server "$cleanup_dir" 0 ""
cleanup_pid="$!"
for _ in {1..50}; do
  [[ -s "$FAKE_BUN_PID_FILE" ]] && break
  sleep 0.1
done
[[ "$(cat "$FAKE_BUN_PID_FILE" 2>/dev/null)" == "$cleanup_pid" ]] || fail "workspace pid should be the bun process after exec"
musi_dev_stop_workspaces "$cleanup_pid"
[[ "$(cat "$FAKE_BUN_TERM_FILE" 2>/dev/null)" == "term" ]] || fail "workspace stop should terminate the bun process"
if kill -0 "$cleanup_pid" >/dev/null 2>&1; then fail "workspace process still alive after stop"; fi
ok "dev workspace runner stops actual bun children"

reasons="$(musi_dev_residual_drift_reasons "$fp_b" "$current_migration_fp" "$current_seed_fp" "$fp_a" "$current_migration_fp" "$current_seed_fp")"
[[ "$reasons" == *"clone fingerprint stale after worktree:init"* ]] || fail "expected stale clone fingerprint reason:
$reasons"

reasons="$(musi_dev_residual_drift_reasons "$fp_b" "$current_migration_fp" "$current_seed_fp" "$fp_a" "$current_migration_fp" "old-seed")"
[[ "$reasons" == *"SRD seed fingerprint stale after worktree:init"* ]] || fail "expected stale seed reason:
$reasons"
[[ "$reasons" != *"clone fingerprint stale after worktree:init"* ]] || fail "seed drift should not duplicate clone fingerprint reason:
$reasons"

reasons="$(musi_dev_residual_drift_reasons "$fp_b" "$current_migration_fp" "$current_seed_fp" "" "" "")"
[[ "$reasons" == *"clone fingerprint missing after worktree:init"* ]] || fail "expected missing clone fingerprint reason:
$reasons"

reasons="$(musi_dev_residual_drift_reasons "$fp_b" "$current_migration_fp" "$current_seed_fp" "$fp_b" "$current_migration_fp" "$current_seed_fp")"
[[ -z "$reasons" ]] || fail "clean fingerprints should produce no residual drift reasons:
$reasons"
ok "dev residual drift helper classifies template and SRD seed drift"

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
stub_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir"' EXIT
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

# CR18: cmd_drop must abort on list_worktree_dbs failure before clearing local
# registry state; on an empty SELECT it must still succeed and forget local state.
cmd_drop_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir"' EXIT
is_primary_worktree() { return 1; }
compute_slug() { printf 'cr18_test'; }
slug_from_dbname() { printf '%s' "$1"; }
drop_db() { printf 'drop_db %s\n' "$1" >> "$cmd_drop_dir/dropped"; }
forget_worktree_fingerprint() { touch "$cmd_drop_dir/forget"; }
tombstone_forget()           { touch "$cmd_drop_dir/tombstone"; }
allocation_forget()          { touch "$cmd_drop_dir/allocation"; }

list_worktree_dbs() { return 5; }
# `set +e` around the subshell keeps the parent shell from suppressing the
# inner `set -e` propagation; bash treats subshells in if/||/&& contexts as
# errexit-ignored, which would mask the failure we are asserting.
set +e
( set -e; cmd_drop ) >/dev/null 2>&1
cr18_rc=$?
set -e
[[ "$cr18_rc" -ne 0 ]]                || fail "cmd_drop should propagate list_worktree_dbs failure"
[[ ! -e "$cmd_drop_dir/forget" ]]     || fail "cmd_drop must not forget fingerprint after admin failure"
[[ ! -e "$cmd_drop_dir/tombstone" ]]  || fail "cmd_drop must not forget tombstone after admin failure"
[[ ! -e "$cmd_drop_dir/allocation" ]] || fail "cmd_drop must not forget allocation after admin failure"
[[ ! -e "$cmd_drop_dir/dropped" ]]    || fail "cmd_drop must not iterate drop loop after admin failure"
ok "cmd_drop fails loud when list_worktree_dbs fails and preserves local state"

list_worktree_dbs() { printf ''; }
( set -e; cmd_drop ) >/dev/null 2>&1 || fail "cmd_drop should succeed when no worktree DBs exist"
[[ -e "$cmd_drop_dir/forget" ]]     || fail "cmd_drop must forget fingerprint when DB list is empty"
[[ -e "$cmd_drop_dir/tombstone" ]]  || fail "cmd_drop must forget tombstone when DB list is empty"
[[ -e "$cmd_drop_dir/allocation" ]] || fail "cmd_drop must forget allocation when DB list is empty"
[[ ! -e "$cmd_drop_dir/dropped" ]]  || fail "cmd_drop must not call drop_db when DB list is empty"
ok "cmd_drop succeeds and clears local state when no worktree DBs exist"

printf '\nworktree-db smoke tests passed (%d assertions)\n' "$PASS"
