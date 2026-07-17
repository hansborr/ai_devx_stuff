#!/usr/bin/env bash
# smoke-order: 060
# smoke-subjects: scripts/worktree-db.sh
# smoke-subjects: scripts/worktree-seed-import-closure.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-exports.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-identifiers.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-validation.ts
# smoke-subjects: scripts/worktree-seed-runtime-loaders.ts
# smoke-subjects: scripts/worktree-new.sh
# smoke-subjects: scripts/worktree-drift-hook.sh
# smoke-subjects: scripts/dev.sh
# smoke-subjects: scripts/tests/test-worktree-db.sh
# test-worktree-db.sh — pure-shell smoke tests for worktree-db helpers.
#
# Sources scripts/worktree-db.sh (main is guarded so sourcing is safe) and
# exercises slug/parsing/membership helpers without touching Postgres or git.
# Run via `bash scripts/tests/test-worktree-db.sh`.

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-db.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-drift-hook.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../dev.sh"
# worktree-new.sh sources worktree-db.sh idempotently, so loading it after
# worktree-db.sh is safe and gives the parser tests below access to its helpers.
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-new.sh"

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

redis_url_prefix="redis://"
redis_url_host="redis:6379"
[[ "$(worktree_redis_url 7)" == "${redis_url_prefix}${redis_url_host}/7" ]] \
  || fail "worktree_redis_url should format the shared Redis URL"
ok "worktree_redis_url formats the shared Redis URL"

env_success_dir="$(mktemp -d)"
(
  admin_url() { printf 'postgresql://musi:pass@db:5432/postgres'; }
  git() {
    if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
      printf '%s\n' "$env_success_dir"
      return 0
    fi
    command git "$@"
  }
  mv() {
    local src_dir dst_dir
    src_dir="${1%/*}"
    dst_dir="${2%/*}"
    [[ "$src_dir" == "$dst_dir" ]] || fail "write_worktree_env used cross-dir mv: $1 -> $2"
    command mv "$@"
  }

  mkdir -p "$env_success_dir/packages/client"
  printf 'KEEP_ROOT=1\nDATABASE_URL=old\n' > "$env_success_dir/.env"
  printf 'KEEP_CLIENT=1\nVITE_DEV_PORT=old\n' > "$env_success_dir/packages/client/.env"

  write_worktree_env "env_slug" 3101 5173 7 >/dev/null 2>&1

  [[ -f "$env_success_dir/.env" ]] || fail "root .env was not written"
  [[ -f "$env_success_dir/packages/client/.env" ]] || fail "client .env was not written"
  grep -q '^KEEP_ROOT=1$' "$env_success_dir/.env" || fail "root .env did not preserve unmanaged key"
  grep -q '^DATABASE_URL=postgresql://musi:pass@db:5432/musi_wt_env_slug$' "$env_success_dir/.env" \
    || fail "root .env missing managed DATABASE_URL"
  grep -q '^KEEP_CLIENT=1$' "$env_success_dir/packages/client/.env" \
    || fail "client .env did not preserve unmanaged key"
  grep -q '^VITE_DEV_PORT=5173$' "$env_success_dir/packages/client/.env" \
    || fail "client .env missing managed VITE_DEV_PORT"
)
[[ -z "$(find "$env_success_dir" -name '.env.tmp.*' -print -quit)" ]] \
  || fail "write_worktree_env left a temp file after success"
rm -rf "$env_success_dir"
ok "write_worktree_env writes both env files with same-directory renames"

env_failure_dir="$(mktemp -d)"
(
  admin_url() { printf 'postgresql://musi:pass@db:5432/postgres'; }
  git() {
    if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
      printf '%s\n' "$env_failure_dir"
      return 0
    fi
    command git "$@"
  }
  mv() {
    local src_dir dst_dir
    src_dir="${1%/*}"
    dst_dir="${2%/*}"
    [[ "$src_dir" == "$dst_dir" ]] || fail "write_worktree_env used cross-dir mv: $1 -> $2"
    if [[ "$2" == "$env_failure_dir/packages/client/.env" ]]; then
      return 23
    fi
    command mv "$@"
  }

  mkdir -p "$env_failure_dir/packages/client"
  set +e
  write_worktree_env "env_slug" 3101 5173 7 >/dev/null 2>&1
  env_failure_rc=$?
  set -e
  [[ "$env_failure_rc" -ne 0 ]] || fail "write_worktree_env should fail when client mv fails"
)
[[ -z "$(find "$env_failure_dir" -name '.env.tmp.*' -print -quit)" ]] \
  || fail "write_worktree_env left a temp file after client write failure"
rm -rf "$env_failure_dir"
ok "write_worktree_env cleans temp files after failed rename"

env_signal_dir="$(mktemp -d)"
set +e
(
  admin_url() { printf 'postgresql://musi:pass@db:5432/postgres'; }
  git() {
    if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
      printf '%s\n' "$env_signal_dir"
      return 0
    fi
    command git "$@"
  }
  mv() {
    local src_dir dst_dir
    src_dir="${1%/*}"
    dst_dir="${2%/*}"
    [[ "$src_dir" == "$dst_dir" ]] || fail "write_worktree_env used cross-dir mv: $1 -> $2"
    if [[ "$2" == "$env_signal_dir/packages/client/.env" ]]; then
      kill -TERM "$BASHPID"
      sleep 1
    fi
    command mv "$@"
  }

  mkdir -p "$env_signal_dir/packages/client"
  write_worktree_env "env_slug" 3101 5173 7 >/dev/null 2>&1
)
env_signal_rc=$?
set -e
[[ "$env_signal_rc" -ne 0 ]] || fail "write_worktree_env should stop when interrupted"
[[ -z "$(find "$env_signal_dir" -name '.env.tmp.*' -print -quit)" ]] \
  || fail "write_worktree_env left a temp file after signal interruption"
rm -rf "$env_signal_dir"
ok "write_worktree_env cleans temp files after signal interruption"

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

# count_status_porcelain splits `git status --porcelain` output into staged vs
# unstaged counts: X column (index) vs Y column (worktree), untracked counts as
# unstaged, and a both-columns line increments both.
counts="$(printf 'M  staged.ts\n M dirty.ts\nMM both.ts\n?? new.ts\nR  old.ts -> new.ts\n' | count_status_porcelain)"
[[ "$counts" == $'3\t3' ]] || fail "count_status_porcelain mixed fixture: $counts"
counts="$(printf '' | count_status_porcelain)"
[[ "$counts" == $'0\t0' ]] || fail "count_status_porcelain empty input: $counts"
counts="$(printf '?? only-untracked.ts' | count_status_porcelain)"
[[ "$counts" == $'0\t1' ]] || fail "count_status_porcelain no-trailing-newline untracked: $counts"
ok "count_status_porcelain classifies staged/unstaged/untracked columns"

# resolve_lane_base precedence: explicit --base override, then the branch's
# upstream, then the primary worktree's checked-out branch, then origin/HEAD.
# Lanes fan out from arbitrary feature bases, so `main` is never assumed while
# any earlier source resolves.
(
  git() { fail "resolve_lane_base must not call git when --base is given"; }
  out="$(resolve_lane_base /tmp/wt "release/2.0" "docs/base")"
  [[ "$out" == "release/2.0" ]] || fail "resolve_lane_base override: $out"
)
(
  git() {
    case "$*" in
      *'@{upstream}'*) printf 'origin/feat/up\n'; return 0 ;;
      *) return 1 ;;
    esac
  }
  out="$(resolve_lane_base /tmp/wt "" "docs/base")"
  [[ "$out" == "origin/feat/up" ]] || fail "resolve_lane_base upstream: $out"
)
(
  git() { return 1; }
  out="$(resolve_lane_base /tmp/wt "" "docs/base")"
  [[ "$out" == "docs/base" ]] || fail "resolve_lane_base primary branch: $out"
)
(
  git() {
    case "$*" in
      *"symbolic-ref"*"origin/HEAD"*) printf 'origin/main\n'; return 0 ;;
      *) return 1 ;;
    esac
  }
  out="$(resolve_lane_base /tmp/wt "" "")"
  [[ "$out" == "origin/main" ]] || fail "resolve_lane_base origin/HEAD: $out"
)
(
  git() { return 1; }
  out="$(resolve_lane_base /tmp/wt "" "<detached>")"
  [[ -z "$out" ]] || fail "resolve_lane_base detached primary must not become a base: $out"
)
ok "resolve_lane_base resolves override, upstream, primary branch, origin/HEAD"

# lane_git_work_facts assembles raw read-only facts (behind<TAB>ahead from
# rev-list --left-right against the merge-base, porcelain counts, %cr age) and
# degrades to '?' when the base cannot be compared.
(
  git() {
    case "$*" in
      *"rev-list --left-right --count"*) printf '1\t4\n'; return 0 ;;
      *"status --porcelain"*) printf 'M  staged.ts\n M dirty.ts\nMM both.ts\n?? new.ts\n'; return 0 ;;
      *"log -1 --format=%cr"*) printf '2 hours ago\n'; return 0 ;;
      *) return 1 ;;
    esac
  }
  facts="$(lane_git_work_facts /tmp/wt main)"
  [[ "$facts" == $'4\t1\t2\t3\t2 hours ago' ]] || fail "lane_git_work_facts assembled: $facts"
)
(
  git() {
    case "$*" in
      *"status --porcelain"*) return 0 ;;
      *"log -1 --format=%cr"*) printf '3 days ago\n'; return 0 ;;
      *) return 1 ;;
    esac
  }
  facts="$(lane_git_work_facts /tmp/wt "")"
  [[ "$facts" == $'?\t?\t0\t0\t3 days ago' ]] || fail "lane_git_work_facts no base: $facts"
)
ok "lane_git_work_facts emits raw facts and degrades to '?' without a base"

# format_lane_work_line renders the raw facts without any derived lifecycle
# word — git state cannot distinguish an active agent from an abandoned lane.
line="$(format_lane_work_line 4 1 2 3 "2 hours ago" "docs/base")"
[[ "$line" == 'ahead=4 behind=1 staged=2 unstaged=3 last_commit="2 hours ago" base=docs/base' ]] \
  || fail "format_lane_work_line: $line"
line="$(format_lane_work_line "?" "?" 0 0 "<none>" "")"
[[ "$line" == 'ahead=? behind=? staged=0 unstaged=0 last_commit="<none>" base=<none>' ]] \
  || fail "format_lane_work_line fallback: $line"
ok "format_lane_work_line prints raw facts only"

# cmd_status_lanes: one glance-able row per worktree, primary marked, bare
# skipped, git facts computed per lane.
(
  primary_root() { printf '/tmp/a'; }
  list_worktrees_porcelain() {
    printf '/tmp/a\tmain\tyes\n/tmp/b\tfeat/x\tno\n/tmp/d\t<bare>\tno\n'
  }
  git() {
    case "$*" in
      *"rev-parse --abbrev-ref HEAD"*) printf 'main\n'; return 0 ;;
      *'@{upstream}'*) return 1 ;;
      *"rev-list --left-right --count"*) printf '0\t2\n'; return 0 ;;
      *"status --porcelain"*) printf '?? x.ts\n'; return 0 ;;
      *"log -1 --format=%cr"*) printf '5 minutes ago\n'; return 0 ;;
      *) return 1 ;;
    esac
  }
  out="$(cmd_status_lanes "")"
  [[ "$out" == *'lane /tmp/a [primary] (main): ahead=2 behind=0 staged=0 unstaged=1 last_commit="5 minutes ago" base=main'* ]] \
    || fail "cmd_status_lanes primary row:
$out"
  [[ "$out" == *'lane /tmp/b (feat/x): ahead=2 behind=0 staged=0 unstaged=1 last_commit="5 minutes ago" base=main'* ]] \
    || fail "cmd_status_lanes lane row:
$out"
  [[ "$out" == *'lane /tmp/d (<bare>): skipped (bare worktree)'* ]] \
    || fail "cmd_status_lanes bare row:
$out"
)
ok "cmd_status_lanes prints one raw-fact row per worktree"

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
mkdir -p "$fingerprint_dir/packages/server/src/generated/prisma"
mkdir -p "$fingerprint_dir/packages/server/src/utils"
mkdir -p "$fingerprint_dir/packages/shared/src/rules"
printf 'datasource db {}\n' > "$fingerprint_dir/packages/server/prisma/schema.prisma"
printf 'CREATE TABLE test(id TEXT PRIMARY KEY);\n' > "$fingerprint_dir/packages/server/prisma/migrations/20260426000000_init/migration.sql"
printf 'import { seedSrd } from "../src/seed/seed-srd.js";\nvoid seedSrd;\n' \
  > "$fingerprint_dir/packages/server/prisma/seed-template.ts"
printf 'export const seedSrd = true;\n' > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
printf 'seed data\n' > "$fingerprint_dir/packages/server/src/seed/species.json"
printf 'export const PrismaClient = true;\n' \
  > "$fingerprint_dir/packages/server/src/generated/prisma/client.ts"
printf 'prisma json helper\n' > "$fingerprint_dir/packages/server/src/utils/prisma-json.ts"
printf 'script logger helper\n' > "$fingerprint_dir/packages/server/src/utils/script-logger.ts"
printf 'shared rule\n' > "$fingerprint_dir/packages/shared/src/rules/conditions.ts"
printf '{"name":"@musi/shared"}\n' > "$fingerprint_dir/packages/shared/package.json"
printf '{"extends":"../../tsconfig.base.json"}\n' > "$fingerprint_dir/packages/shared/tsconfig.json"
printf '{"compilerOptions":{}}\n' > "$fingerprint_dir/tsconfig.base.json"
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
shared_seed_before="$split_seed_after"
shared_combined_before="$combined_after"
printf 'shared rule changed\n' > "$fingerprint_dir/packages/shared/src/rules/conditions.ts"
shared_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
shared_combined_after="$(compute_fingerprint "$fingerprint_dir")"
[[ "$shared_seed_before" != "$shared_seed_after" ]] \
  || fail "shared runtime source edit should change seed fingerprint"
[[ "$shared_combined_before" != "$shared_combined_after" ]] \
  || fail "shared runtime source edit should change combined template fingerprint"
shared_seed_before="$shared_seed_after"
printf '{"name":"@musi/shared","sideEffects":false}\n' \
  > "$fingerprint_dir/packages/shared/package.json"
shared_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$shared_seed_before" != "$shared_seed_after" ]] \
  || fail "shared package config edit should change seed fingerprint"
server_helper_seed_before="$shared_seed_after"
printf 'prisma json helper changed\n' > "$fingerprint_dir/packages/server/src/utils/prisma-json.ts"
server_helper_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$server_helper_seed_before" != "$server_helper_seed_after" ]] \
  || fail "server runtime helper edit should change seed fingerprint"
server_helper_seed_before="$server_helper_seed_after"
printf 'script logger helper changed\n' > "$fingerprint_dir/packages/server/src/utils/script-logger.ts"
server_helper_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$server_helper_seed_before" != "$server_helper_seed_after" ]] \
  || fail "seed logger helper edit should change seed fingerprint"

for runtime_extension in ts tsx mts cts js mjs cjs json; do
  case "$runtime_extension" in
    ts | tsx) runtime_specifier_extension=js ;;
    mts) runtime_specifier_extension=mjs ;;
    cts) runtime_specifier_extension=cjs ;;
    *) runtime_specifier_extension="$runtime_extension" ;;
  esac
  runtime_stem="runtime-extension-$runtime_extension"
  runtime_file="$fingerprint_dir/packages/server/src/seed/$runtime_stem.$runtime_extension"
  printf 'import "./%s.%s";\nexport const seedSrd = true;\n' \
    "$runtime_stem" "$runtime_specifier_extension" \
    > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
  printf 'runtime dependency before\n' > "$runtime_file"
  runtime_extension_before="$(compute_seed_fingerprint "$fingerprint_dir")"
  printf 'runtime dependency after\n' > "$runtime_file"
  runtime_extension_after="$(compute_seed_fingerprint "$fingerprint_dir")"
  [[ "$runtime_extension_before" != "$runtime_extension_after" ]] \
    || fail ".$runtime_extension runtime dependency edit should change seed fingerprint"
done

set +e
(
  sha256sum() {
    if [[ "${1:-}" == "packages/server/src/utils/prisma-json.ts" ]]; then
      return 23
    fi
    command sha256sum "$@"
  }
  compute_seed_fingerprint "$fingerprint_dir" >/dev/null 2>&1
)
digest_failure_rc=$?
(
  find() {
    if [[ "${1:-}" == "packages/server/src/seed" ]]; then
      return 24
    fi
    command find "$@"
  }
  compute_seed_fingerprint "$fingerprint_dir" >/dev/null 2>&1
)
enumeration_failure_rc=$?
set -e
[[ "$digest_failure_rc" -ne 0 ]] \
  || fail "seed fingerprint should fail when an input digest fails"
[[ "$enumeration_failure_rc" -ne 0 ]] \
  || fail "seed fingerprint should fail when input enumeration fails"

mkdir -p "$fingerprint_dir/packages/server/src/services"
printf 'export const unlistedSeedHelper = true;\n' \
  > "$fingerprint_dir/packages/server/src/services/unlisted-seed-helper.ts"
printf 'import { unlistedSeedHelper } from "../services/unlisted-seed-helper.js";\nexport const seedSrd = unlistedSeedHelper;\n' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
set +e
unlisted_import_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
unlisted_import_rc=$?
set -e
[[ "$unlisted_import_rc" -ne 0 ]] \
  || fail "seed fingerprint should reject an unlisted repository-local runtime import"
[[ "$unlisted_import_output" == *"packages/server/src/services/unlisted-seed-helper.ts"* ]] \
  || fail "seed closure failure should identify the unlisted helper: $unlisted_import_output"

assert_unlisted_loader_rejected() {
  local label="$1" source="$2" loader_output loader_rc
  printf '%s\n' "$source" > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
  set +e
  loader_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
  loader_rc=$?
  set -e
  [[ "$loader_rc" -ne 0 ]] \
    || fail "$label should reject an unlisted runtime-loaded helper"
  [[ "$loader_output" == *"packages/server/src/services/unlisted-seed-helper.ts"* ]] \
    || fail "$label should identify the unlisted runtime-loaded helper: $loader_output"
}

assert_unlisted_loader_rejected "direct require" \
  $'require("../services/unlisted-seed-helper.js");\nexport const seedSrd = true;'
assert_unlisted_loader_rejected "aliased require" \
  $'const loadSeedDependency = require;\nloadSeedDependency("../services/unlisted-seed-helper.js");\nexport const seedSrd = true;'
assert_unlisted_loader_rejected "createRequire loader" \
  $'import { createRequire } from "node:module";\nconst loadSeedDependency = createRequire(import.meta.url);\nloadSeedDependency("../services/unlisted-seed-helper.js");\nexport const seedSrd = true;'
assert_unlisted_loader_rejected "module.require loader" \
  $'module.require("../services/unlisted-seed-helper.js");\nexport const seedSrd = true;'

printf '%s\n' \
  $'const runtimePath = "../services/unlisted-seed-helper.js";\nrequire(runtimePath);\nexport const seedSrd = true;' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
set +e
non_static_loader_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
non_static_loader_rc=$?
set -e
[[ "$non_static_loader_rc" -ne 0 ]] \
  || fail "non-static runtime loader argument should fail closed"
[[ "$non_static_loader_output" == *"must use a static string specifier"* ]] \
  || fail "non-static runtime loader should explain the static requirement: $non_static_loader_output"
rm -rf "$fingerprint_dir"
ok "split fingerprints enforce runtime extensions, imports, and loaders"

# Path-independence: identical Prisma/seed inputs at two different worktree
# paths must produce the same fingerprint, so they share one
# musi_template_<hash> DB instead of each rebuilding their own.
fingerprint_a="$(mktemp -d)"
fingerprint_b="$(mktemp -d)"
for dir in "$fingerprint_a" "$fingerprint_b"; do
  mkdir -p "$dir/packages/server/prisma/migrations/20260426000000_init"
  mkdir -p "$dir/packages/server/src/seed"
  mkdir -p "$dir/packages/server/src/generated/prisma"
  mkdir -p "$dir/packages/server/src/utils"
  mkdir -p "$dir/packages/shared/src/rules"
  printf 'datasource db {}\n' > "$dir/packages/server/prisma/schema.prisma"
  printf 'CREATE TABLE test(id TEXT PRIMARY KEY);\n' > "$dir/packages/server/prisma/migrations/20260426000000_init/migration.sql"
  printf 'export const seedTemplate = true;\n' > "$dir/packages/server/prisma/seed-template.ts"
  printf 'seed data\n' > "$dir/packages/server/src/seed/species.ts"
  printf 'export const PrismaClient = true;\n' \
    > "$dir/packages/server/src/generated/prisma/client.ts"
  printf 'prisma json helper\n' > "$dir/packages/server/src/utils/prisma-json.ts"
  printf 'script logger helper\n' > "$dir/packages/server/src/utils/script-logger.ts"
  printf 'shared rule\n' > "$dir/packages/shared/src/rules/conditions.ts"
  printf '{"name":"@musi/shared"}\n' > "$dir/packages/shared/package.json"
  printf '{"extends":"../../tsconfig.base.json"}\n' > "$dir/packages/shared/tsconfig.json"
  printf '{"compilerOptions":{}}\n' > "$dir/tsconfig.base.json"
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

# A generated Prisma client is reusable only while its stored schema
# fingerprint matches the checked-out schema. Presence alone is not freshness.
dependency_dir="$(mktemp -d)"
dependency_stub_dir="$(mktemp -d)"
mkdir -p "$dependency_dir/node_modules"
mkdir -p "$dependency_dir/packages/server/prisma"
mkdir -p "$dependency_dir/packages/server/src/generated/prisma"
printf 'datasource db { provider = "postgresql" }\n' \
  > "$dependency_dir/packages/server/prisma/schema.prisma"
printf '{ "name": "@musi/server", "dependencies": { "@prisma/client": "5.0.0" } }\n' \
  > "$dependency_dir/packages/server/package.json"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$@" >> "$DEPENDENCY_BUN_OUT"' \
  > "$dependency_stub_dir/bun"
chmod +x "$dependency_stub_dir/bun"
export DEPENDENCY_BUN_OUT="$dependency_stub_dir/argv"
ensure_dependencies_in_test_root() (
  git() {
    if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
      printf '%s\n' "$dependency_dir"
      return 0
    fi
    command git "$@"
  }
  PATH="$dependency_stub_dir:$PATH" ensure_dependencies >/dev/null 2>&1
)
ensure_dependencies_in_test_root
expected_prisma_generate_argv='run'$'\n''--filter'$'\n''@musi/server'$'\n''prisma:generate'
[[ "$(cat "$DEPENDENCY_BUN_OUT")" == "$expected_prisma_generate_argv" ]] \
  || fail "missing Prisma fingerprint should regenerate the client"
prisma_fingerprint_file="$dependency_dir/packages/server/src/generated/prisma/.musi-schema-fingerprint"
[[ -s "$prisma_fingerprint_file" ]] \
  || fail "Prisma generation should store a schema fingerprint beside its output"
initial_prisma_fingerprint="$(cat "$prisma_fingerprint_file")"
: > "$DEPENDENCY_BUN_OUT"
ensure_dependencies_in_test_root
[[ ! -s "$DEPENDENCY_BUN_OUT" ]] \
  || fail "matching Prisma schema fingerprint should skip regeneration"
printf 'datasource db { provider = "sqlite" }\n' \
  > "$dependency_dir/packages/server/prisma/schema.prisma"
ensure_dependencies_in_test_root
[[ "$(cat "$DEPENDENCY_BUN_OUT")" == "$expected_prisma_generate_argv" ]] \
  || fail "schema mismatch should regenerate the Prisma client"
[[ "$(cat "$prisma_fingerprint_file")" != "$initial_prisma_fingerprint" ]] \
  || fail "schema mismatch should replace the stored Prisma fingerprint"
# A @prisma/client version bump with an unchanged schema still produces a
# different generated client, so it must also invalidate the fingerprint.
post_schema_prisma_fingerprint="$(cat "$prisma_fingerprint_file")"
: > "$DEPENDENCY_BUN_OUT"
printf '{ "name": "@musi/server", "dependencies": { "@prisma/client": "5.1.0" } }\n' \
  > "$dependency_dir/packages/server/package.json"
ensure_dependencies_in_test_root
[[ "$(cat "$DEPENDENCY_BUN_OUT")" == "$expected_prisma_generate_argv" ]] \
  || fail "a @prisma/client version bump should regenerate the client even with an unchanged schema"
[[ "$(cat "$prisma_fingerprint_file")" != "$post_schema_prisma_fingerprint" ]] \
  || fail "a @prisma/client version bump should replace the stored Prisma fingerprint"
: > "$DEPENDENCY_BUN_OUT"
rm -rf "$dependency_dir/node_modules"
ensure_dependencies_in_test_root
[[ "$(cat "$DEPENDENCY_BUN_OUT")" == 'install' ]] \
  || fail "missing node_modules should retain the cold bun install fallback"
ok "ensure_dependencies fingerprints the generated Prisma client schema"

# Fresh worktree initialization must build shared output before template
# seeding. The seed imports @musi/shared package exports, which resolve to
# packages/shared/dist and are absent in a newly created worktree. A persisted
# source/config fingerprint lets later init processes skip an unchanged build.
shared_build_dir="$(mktemp -d)"
shared_build_stub_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$dependency_dir" "$dependency_stub_dir" "$shared_build_dir" "$shared_build_stub_dir"' EXIT
mkdir -p "$shared_build_dir/packages/shared/src"
printf 'export const shared = true;\n' > "$shared_build_dir/packages/shared/src/index.ts"
printf '{"name":"@musi/shared","scripts":{"build":"tsc -b"}}\n' \
  > "$shared_build_dir/packages/shared/package.json"
printf '{"extends":"../../tsconfig.base.json","include":["src"]}\n' \
  > "$shared_build_dir/packages/shared/tsconfig.json"
printf '{"compilerOptions":{}}\n' > "$shared_build_dir/tsconfig.base.json"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "cwd=%s\n" "$PWD" >> "$SHARED_BUILD_OUT"' \
  'printf "%s\n" "$@" >> "$SHARED_BUILD_OUT"' \
  'mkdir -p packages/shared/dist' \
  > "$shared_build_stub_dir/bun"
chmod +x "$shared_build_stub_dir/bun"
export SHARED_BUILD_OUT="$shared_build_stub_dir/argv"
PATH="$shared_build_stub_dir:$PATH" ensure_shared_output "$shared_build_dir" >/dev/null 2>&1
expected_shared_build_argv="cwd=$shared_build_dir"$'\n''run'$'\n''--filter'$'\n''@musi/shared'$'\n''build'
[[ "$(cat "$SHARED_BUILD_OUT")" == "$expected_shared_build_argv" ]] \
  || fail "ensure_shared_output must build @musi/shared from the worktree root:
got:
$(cat "$SHARED_BUILD_OUT")
want:
$expected_shared_build_argv"

shared_fingerprint_file="$shared_build_dir/packages/shared/dist/.musi-build-fingerprint"
[[ -s "$shared_fingerprint_file" ]] \
  || fail "shared build should store a source fingerprint beside its output"
: > "$SHARED_BUILD_OUT"
unset MUSI_SHARED_OUTPUT_READY_ROOT
PATH="$shared_build_stub_dir:$PATH" ensure_shared_output "$shared_build_dir" >/dev/null 2>&1
[[ ! -s "$SHARED_BUILD_OUT" ]] \
  || fail "unchanged shared output fingerprint should skip the build"
printf 'export const shared = false;\n' > "$shared_build_dir/packages/shared/src/index.ts"
unset MUSI_SHARED_OUTPUT_READY_ROOT
PATH="$shared_build_stub_dir:$PATH" ensure_shared_output "$shared_build_dir" >/dev/null 2>&1
[[ "$(cat "$SHARED_BUILD_OUT")" == "$expected_shared_build_argv" ]] \
  || fail "shared source mismatch should rebuild the output"
: > "$SHARED_BUILD_OUT"
printf '{"extends":"../../tsconfig.base.json","include":["src"],"compilerOptions":{"declaration":true}}\n' \
  > "$shared_build_dir/packages/shared/tsconfig.json"
unset MUSI_SHARED_OUTPUT_READY_ROOT
PATH="$shared_build_stub_dir:$PATH" ensure_shared_output "$shared_build_dir" >/dev/null 2>&1
[[ "$(cat "$SHARED_BUILD_OUT")" == "$expected_shared_build_argv" ]] \
  || fail "shared build-config mismatch should rebuild the output"

printf '%s\n' '#!/usr/bin/env bash' 'exit 19' > "$shared_build_stub_dir/bun"
chmod +x "$shared_build_stub_dir/bun"
printf 'export const shared = null;\n' > "$shared_build_dir/packages/shared/src/index.ts"
unset MUSI_SHARED_OUTPUT_READY_ROOT
set +e
shared_build_error="$(PATH="$shared_build_stub_dir:$PATH" ensure_shared_output "$shared_build_dir" 2>&1)"
shared_build_rc=$?
set -e
[[ "$shared_build_rc" -ne 0 ]] || fail "ensure_shared_output should fail when the shared build fails"
[[ "$shared_build_error" == *"shared output required by template seeding"* ]] \
  || fail "shared build failure should explain why output is required:
$shared_build_error"
ok "ensure_shared_output persists and enforces build freshness"

# Drive the actual init orchestration as well as the helper. The template seam
# requires the shared-output marker, so moving ensure_shared_output below
# template_refresh_for_fingerprint makes this regression fail.
cmd_init_shared_marker="$shared_build_dir/cmd-init-shared-ready"
cmd_init_template_marker="$shared_build_dir/cmd-init-template-refreshed"
(
  is_primary_worktree() { return 1; }
  compute_slug() { printf 'ordering_abc123'; }
  slug_hash_int() { printf '1'; }
  current_root() { printf '%s' "$shared_build_dir"; }
  install_lint_ratchet_merge_driver() { :; }
  install_knip_unused_exports_merge_driver() { :; }
  install_max_lines_exceptions_merge_driver() { :; }
  ensure_state_dir() { :; }
  acquire_worktree_init_lock() { printf -v "$2" '%s' '99'; }
  release_worktree_init_lock() { :; }
  ensure_dependencies() { :; }
  ensure_shared_output() { touch "$cmd_init_shared_marker"; }
  cmd_gc() { :; }
  copy_worktreeinclude_entries() { :; }
  compute_fingerprint() { printf '%064d' 0; }
  compute_migration_fingerprint() { printf '%064d' 1; }
  compute_seed_fingerprint() { printf '%064d' 2; }
  template_db_for_fingerprint() { printf 'musi_template_000000000000'; }
  template_refresh_for_fingerprint() {
    [[ -e "$cmd_init_shared_marker" ]] \
      || fail "cmd_init reached template refresh before shared output was built"
    touch "$cmd_init_template_marker"
  }
  ensure_per_worktree_dbs() { :; }
  resolve_worktree_resources() { printf '4100\t5100\t3'; }
  write_worktree_env() { :; }
  tombstone_forget() { :; }
  log() { :; }

  cmd_init
) || fail "cmd_init should build shared output before refreshing its template"
[[ -e "$cmd_init_template_marker" ]] \
  || fail "cmd_init ordering seam did not reach template refresh"

template_refresh_shared_marker="$shared_build_dir/template-refresh-shared-ready"
(
  current_root() { printf '%s' "$shared_build_dir"; }
  compute_fingerprint() { printf '%064d' 0; }
  ensure_shared_output() { touch "$template_refresh_shared_marker"; }
  template_refresh_for_fingerprint() {
    [[ -e "$template_refresh_shared_marker" ]] \
      || fail "template_refresh reached seed orchestration before shared output was built"
  }

  template_refresh
) || fail "template_refresh should build shared output before seed orchestration"

refresh_shared_marker="$shared_build_dir/refresh-data-shared-ready"
refresh_reseed_count="$shared_build_dir/refresh-data-reseed-count"
(
  is_primary_worktree() { return 1; }
  current_root() { printf '%s' "$shared_build_dir"; }
  compute_slug() { printf 'ordering_abc123'; }
  ensure_state_dir() { :; }
  acquire_worktree_init_lock() { printf -v "$2" '%s' '99'; }
  release_worktree_init_lock() { :; }
  ensure_dependencies() { :; }
  ensure_shared_output() { touch "$refresh_shared_marker"; }
  compute_fingerprint() { printf '%064d' 0; }
  compute_migration_fingerprint() { printf '%064d' 1; }
  compute_seed_fingerprint() { printf '%064d' 2; }
  template_db_for_fingerprint() { printf 'musi_template_000000000000'; }
  template_refresh_for_fingerprint() {
    [[ -e "$refresh_shared_marker" ]] \
      || fail "refresh-data reached template seed before shared output was built"
  }
  db_exists() { return 0; }
  reseed_worktree_db() {
    [[ -e "$refresh_shared_marker" ]] \
      || fail "refresh-data reached worktree seed before shared output was built"
    printf 'seeded\n' >> "$refresh_reseed_count"
  }
  stored_worktree_fingerprint() { printf 'old-template'; }
  stored_worktree_seed_fingerprint() { printf 'old-seed'; }
  store_worktree_fingerprints() { :; }
  log() { :; }

  cmd_refresh_data
) || fail "cmd_refresh_data should build shared output before every seed path"
[[ "$(wc -l < "$refresh_reseed_count")" -eq 3 ]] \
  || fail "refresh-data ordering seam did not exercise all three worktree seeds"

rm -rf "$shared_build_dir" "$shared_build_stub_dir"
ok "worktree seed command paths build shared output before seeding"

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
[[ "$(MUSI_DEV_DRIFT_GATE=fail musi_dev_drift_gate_mode)" == "fail" ]] || fail "MUSI_DEV_DRIFT_GATE=fail should fail"
[[ "$(MUSI_DEV_DRIFT_GATE=off musi_dev_drift_gate_mode)" == "off" ]] || fail "MUSI_DEV_DRIFT_GATE=off should opt out"
ok "dev drift gate mode defaults to warn and supports fail/off"

if MUSI_DEV_LOG_COLOR=off musi_dev_log_color_enabled; then fail "MUSI_DEV_LOG_COLOR=off should disable color"; fi
MUSI_DEV_LOG_COLOR=on musi_dev_log_color_enabled || fail "MUSI_DEV_LOG_COLOR=on should enable color"
if MUSI_DEV_LOG_COLOR=auto NO_COLOR=1 musi_dev_log_color_enabled; then fail "NO_COLOR should disable auto color"; fi
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

# --- worktree:new failure recovery (leaf 02) ----------------------------------

# assert_writable_parent must fail fast (before any git state) when the lane
# parent is missing, not a directory, or unwritable, and pass for a writable one.
wtnew_parent_root="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$wtnew_parent_root"' EXIT
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

# init_failure_recovery_block prints copy-pasteable, agent-allowed recovery only.
recovery_new="$(init_failure_recovery_block /abs/wt/path feat/lane)"
[[ "$recovery_new" == *"cd /abs/wt/path && bun run worktree:drop"* ]] \
  || fail "recovery block missing worktree:drop line:
$recovery_new"
[[ "$recovery_new" == *"git worktree remove /abs/wt/path"* ]] \
  || fail "recovery block missing worktree remove line:
$recovery_new"
[[ "$recovery_new" == *"git branch -d feat/lane"* ]] \
  || fail "recovery block missing branch delete line:
$recovery_new"
[[ "$recovery_new" != *"branch -D"* && "$recovery_new" != *"--force"* ]] \
  || fail "recovery block must never suggest blocked commands (-D/--force):
$recovery_new"
# An existing checked-out branch (no -b) must not be offered for deletion.
recovery_existing="$(init_failure_recovery_block /abs/wt/path "")"
[[ "$recovery_existing" != *"git branch -d"* ]] \
  || fail "recovery block must omit branch delete when no new branch was created:
$recovery_existing"
ok "init_failure_recovery_block prints agent-allowed recovery commands"

# cleanup_failed_add deletes the just-created branch only when it provably points
# at the resolved start commit; every mismatch leaves state untouched. A stub git
# reports the branch's commit and records any `git branch -d`.
wtnew_stub_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$wtnew_parent_root" "$wtnew_stub_dir"' EXIT
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

# --- worktree:drop full teardown (leaf 03) -----------------------------------

drop_feature_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$wtnew_parent_root" "$wtnew_stub_dir" "$drop_feature_dir"' EXIT

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

# GC must distinguish a failed post-drop database re-query from a successful
# empty result. A failure must preserve all reservation metadata and skip the
# template phases; an empty result should still clear metadata for dead slugs.
gc_failure_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir" "$gc_failure_dir"' EXIT
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

gc_empty_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir" "$gc_failure_dir" "$gc_empty_dir"' EXIT
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

# Init/refresh locking remains per-slug so one stalled lane cannot block an
# unrelated worktree. Acquisition is bounded, and GC never unlinks these stable
# pathnames because an older-revision sibling may already have their inode open.
init_lock_gc_dir="$(mktemp -d)"
init_lock_holder_pid=""
trap '[[ -z "${init_lock_holder_pid:-}" ]] || kill "$init_lock_holder_pid" 2>/dev/null || true; rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir" "$gc_failure_dir" "$gc_empty_dir" "$init_lock_gc_dir"' EXIT
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
alloc_state_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir" "$alloc_state_dir"' EXIT

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
writer_state_dir="$(mktemp -d)"
trap 'rm -rf "$empty_dir" "$stub_dir" "$cmd_drop_dir" "$alloc_state_dir" "$writer_state_dir"' EXIT
state_dir() { printf '%s' "$writer_state_dir"; }
allocations_file() { printf '%s' "$writer_state_dir/allocations.json"; }
mkdir -p "$writer_state_dir"
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

printf '\nworktree-db smoke tests passed (%d assertions)\n' "$PASS"
