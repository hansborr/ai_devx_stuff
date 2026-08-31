#!/usr/bin/env bash
# smoke-order: 060
# smoke-subjects: scripts/worktree-db.sh
# smoke-subjects: scripts/import-closure/closure-walk.ts
# smoke-subjects: scripts/import-closure/runtime-imports.ts
# smoke-subjects: scripts/import-closure/runtime-resolution.ts
# smoke-subjects: scripts/worktree-drift-hook.sh
# smoke-subjects: scripts/dev.sh
# smoke-subjects: scripts/tests/test-worktree-db.sh
# smoke-subjects: scripts/tests/lib/test-tmpdir.sh
# test-worktree-db.sh — shell smoke tests for the worktree DB/init/dev helpers.
#
# Sources scripts/worktree-db.sh, scripts/worktree-drift-hook.sh and
# scripts/dev.sh (each guards its own main, so sourcing is safe) and exercises
# slug/parsing/membership helpers, seed fingerprinting and runtime
# import-closure validation, worktree:init orchestration, and the dev prebuild
# — all without touching Postgres.
#
# The worktree helpers are covered by four standalone suites so a failure in
# one narrative cannot hide the contracts of the others:
#   scripts/tests/test-worktree-db.sh       DB/init/dev helpers and seed fingerprints
#   scripts/tests/test-worktree-new.sh      worktree:new creation and failure recovery
#   scripts/tests/test-worktree-drop-gc.sh  worktree:drop / worktree:gc teardown
#   scripts/tests/test-worktree-locking.sh  init locks, allocation, and state writers
#
# Run via `bash scripts/tests/test-worktree-db.sh`.

set -euo pipefail

TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-tmpdir.sh
. "$TEST_SCRIPT_DIR/lib/test-tmpdir.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-db.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../worktree-drift-hook.sh"
# shellcheck source=/dev/null
. "$TEST_SCRIPT_DIR/../dev.sh"

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

env_success_dir="$(musi_test_tmp_dir)"
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

env_failure_dir="$(musi_test_tmp_dir)"
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

env_signal_dir="$(musi_test_tmp_dir)"
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
empty_dir="$(musi_test_tmp_dir)"
out="$(safe_compute_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_fingerprint should be empty for bare dir, got: $out"
ok "safe_compute_fingerprint swallows missing-input die"

out="$(safe_compute_migration_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_migration_fingerprint should be empty for bare dir, got: $out"
out="$(safe_compute_seed_fingerprint "$empty_dir")"
[[ -z "$out" ]] || fail "safe_compute_seed_fingerprint should be empty for bare dir, got: $out"
ok "split fingerprint helpers swallow missing-input die"

# A relatively sourced caller must keep using its own checker after fingerprint
# production changes into a peer worktree.
relative_source_dir="$(musi_test_tmp_dir)"
mkdir -p \
  "$relative_source_dir/caller/scripts/import-closure" \
  "$relative_source_dir/bin" \
  "$relative_source_dir/peer"
# fixture-closure: unmodelled-copy - the source is the live script resolved
# dynamically from this smoke test's absolute directory.
cp "$TEST_SCRIPT_DIR/../worktree-db.sh" "$relative_source_dir/caller/scripts/worktree-db.sh"
touch "$relative_source_dir/caller/scripts/import-closure/closure-walk.ts"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$1" > "$CHECKER_LOG"' \
  > "$relative_source_dir/bin/bun"
chmod +x "$relative_source_dir/bin/bun"
(
  cd "$relative_source_dir/caller"
  CHECKER_LOG="$relative_source_dir/checker.log" \
    CDPATH="$relative_source_dir/caller" \
    PATH="$relative_source_dir/bin:$PATH" \
    bash -c '. scripts/worktree-db.sh; cd "$1"; validate_seed_runtime_import_closure >/dev/null' \
    _ "$relative_source_dir/peer"
) || fail "relative-source caller should invoke its checker from a peer under CDPATH"
[[ "$(cat "$relative_source_dir/checker.log")" \
  == "$relative_source_dir/caller/scripts/import-closure/closure-walk.ts" ]] \
  || fail "peer fingerprint should resolve the checker from the caller script tree"
rm -rf "$relative_source_dir"
ok "peer fingerprinting keeps relative-source checker resolution stable"

# The live seed entrypoint is the copy-set contract provisioning actually uses.
# Keep it in the normal scripts gate so repository-local import drift is caught
# when introduced, rather than later by worktree:init or worktree:gc.
repo_root="$(git -C "$TEST_SCRIPT_DIR" rev-parse --show-toplevel)"
(
  cd "$repo_root"
  validate_seed_runtime_import_closure >/dev/null
) || fail "live seed import closure should be completely fingerprinted"
ok "live seed import closure is completely fingerprinted"

fingerprint_dir="$(musi_test_tmp_dir)"
mkdir -p "$fingerprint_dir/packages/server/prisma/migrations/20260426000000_init"
mkdir -p "$fingerprint_dir/packages/server"
mkdir -p "$fingerprint_dir/packages/server/src/seed"
mkdir -p "$fingerprint_dir/packages/server/src/seed/data"
mkdir -p "$fingerprint_dir/packages/server/src/generated/prisma"
mkdir -p "$fingerprint_dir/packages/server/src/utils"
mkdir -p "$fingerprint_dir/packages/shared/src/rules"
mkdir -p "$fingerprint_dir/node_modules/seed-runtime"
printf 'datasource db {}\n' > "$fingerprint_dir/packages/server/prisma/schema.prisma"
printf '%s\n' \
  'import type { PrismaConfig } from "prisma";' \
  '// Keep the migrations path: "prisma/migrations", relative to packages/server.' \
  'const note = "path: is documented above";' \
  'export default ({' \
  '  migrations: {' \
  '    path: "prisma/migrations",' \
  '  },' \
  '} satisfies PrismaConfig);' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
printf 'smol = false\n' > "$fingerprint_dir/packages/server/bunfig.toml"
printf '{"mode":"srd"}\n' > "$fingerprint_dir/packages/server/prisma/seed-settings.json"
printf 'CREATE TABLE test(id TEXT PRIMARY KEY);\n' > "$fingerprint_dir/packages/server/prisma/migrations/20260426000000_init/migration.sql"
printf 'import { seedSrd } from "../src/seed/seed-srd.js";\nvoid seedSrd;\n' \
  > "$fingerprint_dir/packages/server/prisma/seed-template.ts"
printf 'import "seed-runtime";\n' \
  >> "$fingerprint_dir/packages/server/prisma/seed-template.ts"
printf '{"name":"seed-runtime","type":"module","exports":"./index.js"}\n' \
  > "$fingerprint_dir/node_modules/seed-runtime/package.json"
printf 'export const runtime = true;\n' > "$fingerprint_dir/node_modules/seed-runtime/index.js"
printf '%s\n' \
  'import "../utils/prisma-json.js";' \
  'import "../utils/script-logger.js";' \
  'export const seedSrd = true;' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
printf 'seed data\n' > "$fingerprint_dir/packages/server/src/seed/species.json"
printf 'level,xp\n1,0\n' > "$fingerprint_dir/packages/server/src/seed/class-progression.csv"
printf '# Seed data attribution\n' > "$fingerprint_dir/packages/server/src/seed/data/NOTICE.md"
printf '# Seed developer notes\n' > "$fingerprint_dir/packages/server/src/seed/MODULE.md"
printf 'export const PrismaClient = true;\n' \
  > "$fingerprint_dir/packages/server/src/generated/prisma/client.ts"
printf 'prisma json helper\n' > "$fingerprint_dir/packages/server/src/utils/prisma-json.ts"
printf 'script logger helper\n' > "$fingerprint_dir/packages/server/src/utils/script-logger.ts"
printf 'shared rule\n' > "$fingerprint_dir/packages/shared/src/rules/conditions.ts"
printf '{"name":"@musi/shared"}\n' > "$fingerprint_dir/packages/shared/package.json"
printf '{"name":"musi","private":true}\n' > "$fingerprint_dir/package.json"
printf '{"extends":"../../tsconfig.base.json"}\n' > "$fingerprint_dir/packages/shared/tsconfig.json"
printf '{"compilerOptions":{}}\n' > "$fingerprint_dir/tsconfig.base.json"
printf '%s\n' \
  '{' \
  '  "lockfileVersion": 1,' \
  '  "workspaces": { "": { "name": "musi" } },' \
  '  "packages": {' \
  '    "seed-runtime": ["seed-runtime@1.0.0", "", {}, "sha512-seed-runtime"],' \
  '    "unrelated": ["unrelated@1.0.0", "", {}, "sha512-unrelated"]' \
  '  }' \
  '}' \
  > "$fingerprint_dir/bun.lock"

assert_fingerprint_rejects_symlink() {
  local scope="$1" target="$2" link="$3" fingerprint_command="$4"
  local output rc

  printf 'symlink target\n' > "$target"
  ln -s "$target" "$link"
  set +e
  output="$($fingerprint_command "$fingerprint_dir" 2>&1)"
  rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || fail "$scope symlink should fail fingerprinting"
  [[ "$output" == *"fingerprint cannot follow symlink"* ]] \
    || fail "$scope symlink rejection should explain the fingerprint boundary: $output"
  rm "$link" "$target"
}

assert_fingerprint_rejects_symlink \
  "blanket-hashed root" \
  "$fingerprint_dir/blanket-target.ts" \
  "$fingerprint_dir/packages/shared/src/linked.ts" \
  compute_seed_fingerprint
assert_fingerprint_rejects_symlink \
  "seed data root" \
  "$fingerprint_dir/data-target.json" \
  "$fingerprint_dir/packages/server/src/seed/data/linked.json" \
  compute_seed_fingerprint
assert_fingerprint_rejects_symlink \
  "seed entry directory" \
  "$fingerprint_dir/entry-target.json" \
  "$fingerprint_dir/packages/server/prisma/linked.json" \
  compute_seed_fingerprint

migration_directory="$fingerprint_dir/packages/server/prisma/migrations"
mv "$migration_directory" "$migration_directory-real"
ln -s "$migration_directory-real" "$migration_directory"
set +e
migration_symlink_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_symlink_rc=$?
set -e
[[ "$migration_symlink_rc" -ne 0 ]] \
  || fail "migration root symlink should fail fingerprinting"
[[ "$migration_symlink_output" == *"fingerprint cannot follow symlink"* ]] \
  || fail "migration root symlink rejection should explain the fingerprint boundary: $migration_symlink_output"
rm "$migration_directory"
mv "$migration_directory-real" "$migration_directory"

split_migration_before="$(compute_migration_fingerprint "$fingerprint_dir")"
split_seed_before="$(compute_seed_fingerprint "$fingerprint_dir")"
combined_before="$(compute_fingerprint "$fingerprint_dir")"
# Dependency identity is hashed at whole-lockfile granularity: any lockfile or
# root manifest edit reseeds, including one the seed does not import. That
# deliberate over-approximation replaces a Bun lockfile subgraph resolver.
lock_seed_before="$split_seed_before"
sed -i 's/unrelated@1\.0\.0/unrelated@2.0.0/' "$fingerprint_dir/bun.lock"
lock_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$lock_seed_before" != "$lock_seed_after" ]] \
  || fail "lockfile identity edit should change seed fingerprint"
manifest_seed_before="$lock_seed_after"
printf '{"name":"musi","private":true,"patchedDependencies":{}}\n' > "$fingerprint_dir/package.json"
manifest_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$manifest_seed_before" != "$manifest_seed_after" ]] \
  || fail "root package manifest edit should change seed fingerprint"
rm "$fingerprint_dir/bun.lock"
set +e
missing_lock_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
missing_lock_rc=$?
set -e
[[ "$missing_lock_rc" -ne 0 ]] || fail "missing lockfile should fail seed fingerprinting"
[[ "$missing_lock_output" == *"bun.lock"* ]] \
  || fail "missing lockfile rejection should name the input: $missing_lock_output"
printf '{"lockfileVersion":1}\n' > "$fingerprint_dir/bun.lock"
split_seed_before="$(compute_seed_fingerprint "$fingerprint_dir")"
combined_before="$(compute_fingerprint "$fingerprint_dir")"
bunfig_seed_before="$split_seed_before"
printf 'smol = true\n' > "$fingerprint_dir/packages/server/bunfig.toml"
bunfig_seed_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$bunfig_seed_before" != "$bunfig_seed_after" ]] \
  || fail "package-local Bun runtime config edit should change seed fingerprint"
printf 'preload = ["./prisma/seed-preload.ts"]\n' \
  > "$fingerprint_dir/packages/server/bunfig.toml"
set +e
bunfig_preload_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
bunfig_preload_rc=$?
set -e
[[ "$bunfig_preload_rc" -ne 0 ]] \
  || fail "an unmodelled package-local Bun preload should fail seed fingerprinting"
[[ "$bunfig_preload_output" == *"preload"* ]] \
  || fail "Bun preload rejection should explain the uncovered runtime input: $bunfig_preload_output"
printf 'smol = false\n' > "$fingerprint_dir/packages/server/bunfig.toml"
printf 'void process.env.MUSI_SEED_MODE;\nexport const seedSrd = true;\n' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
set +e
environment_policy_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
environment_policy_rc=$?
set -e
[[ "$environment_policy_rc" -ne 0 ]] \
  || fail "unallowlisted seed environment key should fail fingerprinting"
[[ "$environment_policy_output" == *"MUSI_SEED_MODE"*"not allowlisted"* ]] \
  || fail "environment rejection should name the key and allowlist boundary: $environment_policy_output"
# An environment object the walker cannot name a key for fails closed rather
# than being tracked through aliases.
printf 'const environment = process.env;\nvoid environment;\nexport const seedSrd = true;\n' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
set +e
environment_alias_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
environment_alias_rc=$?
set -e
[[ "$environment_alias_rc" -ne 0 ]] \
  || fail "aliased seed environment object should fail fingerprinting"
[[ "$environment_alias_output" == *"direct static key"* ]] \
  || fail "aliased environment rejection should require a direct key: $environment_alias_output"
printf '%s\n' \
  'import "../utils/prisma-json.js";' \
  'import "../utils/script-logger.js";' \
  'export const seedSrd = true;' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
printf '%s\n' \
  'export default {' \
  '  migrations: {' \
  '    path: "prisma/alternate-migrations",' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_config_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_config_rc=$?
set -e
[[ "$migration_config_rc" -ne 0 ]] \
  || fail "unexpected Prisma migrations.path should fail closed"
[[ "$migration_config_output" == *"prisma/migrations"* ]] \
  || fail "migration path rejection should name the fingerprinted path: $migration_config_output"
printf '%s\n' \
  'import { migrationsPath } from "./prisma/config-paths.js";' \
  'export default {' \
  '  migrations: {' \
  '    path: migrationsPath,' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_helper_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_helper_rc=$?
set -e
[[ "$migration_helper_rc" -ne 0 ]] \
  || fail "non-literal Prisma migrations.path should fail closed"
[[ "$migration_helper_output" == *"literal"* ]] \
  || fail "non-literal path rejection should require the literal contract: $migration_helper_output"
printf '%s\n' \
  '// path: "prisma/migrations" is the contract this config used to honor.' \
  'export default {' \
  '  migrations: {' \
  '    path: "prisma/alternate-migrations",' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_decoy_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_decoy_rc=$?
set -e
[[ "$migration_decoy_rc" -ne 0 ]] \
  || fail "a commented-out canonical path should not satisfy the migrations.path contract"
[[ "$migration_decoy_output" == *"prisma/migrations"* ]] \
  || fail "decoy comment rejection should name the fingerprinted path: $migration_decoy_output"
printf '%s\n' \
  'export default {' \
  '  migrations: {' \
  '    path: "prisma/migrations",' \
  '  },' \
  '  legacyMigrations: {' \
  '    path: "prisma/alternate-migrations",' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_duplicate_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_duplicate_rc=$?
set -e
[[ "$migration_duplicate_rc" -ne 0 ]] \
  || fail "a competing path assignment should fail the migrations.path contract"
[[ "$migration_duplicate_output" == *"exactly one"* ]] \
  || fail "competing path rejection should require a single assignment: $migration_duplicate_output"
printf '%s\n' \
  'import { migrationsPath } from "./prisma/config-paths.js";' \
  'export default {' \
  '  legacyMigrations: {' \
  '    path: "prisma/migrations",' \
  '  },' \
  '  migrations: {' \
  '    path: migrationsPath,' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_vouch_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_vouch_rc=$?
set -e
[[ "$migration_vouch_rc" -ne 0 ]] \
  || fail "a canonical path elsewhere should not vouch for a computed migrations.path"
[[ "$migration_vouch_output" == *"exactly one"* ]] \
  || fail "vouching path rejection should require a single assignment: $migration_vouch_output"
printf '%s\n' \
  'export default {' \
  '  legacyMigrations: {' \
  '    path: "prisma/migrations",' \
  '  },' \
  '  migrations: {' \
  '    seed: "bun prisma/seed.ts",' \
  '  },' \
  '};' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
set +e
migration_block_output="$(compute_migration_fingerprint "$fingerprint_dir" 2>&1)"
migration_block_rc=$?
set -e
[[ "$migration_block_rc" -ne 0 ]] \
  || fail "a canonical path outside the migrations block should fail the contract"
[[ "$migration_block_output" == *"migrations"* ]] \
  || fail "misplaced path rejection should name the migrations block: $migration_block_output"
printf '%s\n' \
  'import type { PrismaConfig } from "prisma";' \
  '// Keep the migrations path: "prisma/migrations", relative to packages/server.' \
  'const note = "path: is documented above";' \
  'export default ({' \
  '  migrations: {' \
  '    path: "prisma/migrations",' \
  '  },' \
  '} satisfies PrismaConfig);' \
  > "$fingerprint_dir/packages/server/prisma.config.ts"
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
seed_asset_before="$shared_seed_after"
printf 'level,xp\n1,0\n2,300\n' > "$fingerprint_dir/packages/server/src/seed/class-progression.csv"
seed_asset_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$seed_asset_before" != "$seed_asset_after" ]] \
  || fail "non-code seed data asset edit should change seed fingerprint"
seed_doc_before="$seed_asset_after"
printf '# Revised seed data attribution\n' > "$fingerprint_dir/packages/server/src/seed/data/NOTICE.md"
seed_doc_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$seed_doc_before" != "$seed_doc_after" ]] \
  || fail "Markdown seed data asset edit should change seed fingerprint"
developer_doc_before="$seed_doc_after"
printf '# Revised seed developer notes\n' > "$fingerprint_dir/packages/server/src/seed/MODULE.md"
developer_doc_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$developer_doc_before" == "$developer_doc_after" ]] \
  || fail "developer-only seed documentation should not change seed fingerprint"
prisma_sibling_before="$developer_doc_after"
printf '{"mode":"expanded"}\n' > "$fingerprint_dir/packages/server/prisma/seed-settings.json"
prisma_sibling_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$prisma_sibling_before" != "$prisma_sibling_after" ]] \
  || fail "seed entry sibling data edit should change seed fingerprint"
shared_seed_after="$prisma_sibling_after"
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

for runtime_extension in ts tsx js mjs json; do
  case "$runtime_extension" in
    ts | tsx) runtime_specifier_extension=js ;;
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

# Bun can load more extensions than the walker resolves; an unlisted one fails
# closed instead of being silently dropped from the fingerprint.
printf 'import "./seed-taxonomy.toml";\nexport const seedSrd = true;\n' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
printf 'mode = "srd"\n' > "$fingerprint_dir/packages/server/src/seed/seed-taxonomy.toml"
set +e
unsupported_extension_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
unsupported_extension_rc=$?
set -e
[[ "$unsupported_extension_rc" -ne 0 ]] \
  || fail "an unresolvable runtime import extension should fail seed fingerprinting"
[[ "$unsupported_extension_output" == *"unsupported extension"* ]] \
  || fail "unsupported extension rejection should name the extension policy: $unsupported_extension_output"
rm -f "$fingerprint_dir/packages/server/src/seed/seed-taxonomy.toml"

for commonjs_extension in cts cjs; do
  commonjs_file="$fingerprint_dir/packages/server/src/seed/runtime-extension-$commonjs_extension.$commonjs_extension"
  printf 'import "./runtime-extension-%s.%s";\nexport const seedSrd = true;\n' \
    "$commonjs_extension" "$commonjs_extension" \
    > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
  printf 'module.exports = "unsupported";\n' > "$commonjs_file"
  set +e
  commonjs_extension_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
  commonjs_extension_rc=$?
  set -e
  [[ "$commonjs_extension_rc" -ne 0 ]] \
    || fail ".$commonjs_extension extension should fail the ESM-only closure policy"
  [[ "$commonjs_extension_output" == *"CommonJS runtime loading is not supported"* ]] \
    || fail ".$commonjs_extension rejection should explain the ESM-only policy: $commonjs_extension_output"
done
printf 'export const seedSrd = true;\n' > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"

set +e
(
  sha256sum() {
    if [[ "${1:-}" == "packages/server/prisma/seed-template.ts" ]]; then
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
printf 'export const runtimeHelper = true;\n' \
  > "$fingerprint_dir/packages/server/src/services/runtime-helper.ts"
printf 'import { runtimeHelper } from "../services/runtime-helper.js";\nexport const seedSrd = runtimeHelper;\n' \
  > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
derived_import_before="$(compute_seed_fingerprint "$fingerprint_dir")"
printf 'export const runtimeHelper = false;\n' \
  > "$fingerprint_dir/packages/server/src/services/runtime-helper.ts"
derived_import_after="$(compute_seed_fingerprint "$fingerprint_dir")"
[[ "$derived_import_before" != "$derived_import_after" ]] \
  || fail "derived runtime import edit should change seed fingerprint"

assert_commonjs_loader_rejected() {
  local label="$1" source="$2" loader_output loader_rc
  printf '%s\n' "$source" > "$fingerprint_dir/packages/server/src/seed/seed-srd.ts"
  set +e
  loader_output="$(compute_seed_fingerprint "$fingerprint_dir" 2>&1)"
  loader_rc=$?
  set -e
  [[ "$loader_rc" -ne 0 ]] || fail "$label should fail the ESM-only closure policy"
  [[ "$loader_output" == *"CommonJS runtime loading is not supported"* ]] \
    || fail "$label should explain the ESM-only policy: $loader_output"
}

assert_commonjs_loader_rejected "direct require" \
  $'require("../services/runtime-helper.js");\nexport const seedSrd = true;'
assert_commonjs_loader_rejected "aliased require" \
  $'const loadSeedDependency = require;\nloadSeedDependency("../services/runtime-helper.js");\nexport const seedSrd = true;'
assert_commonjs_loader_rejected "createRequire loader" \
  $'import { createRequire } from "node:module";\nconst loadSeedDependency = createRequire(import.meta.url);\nloadSeedDependency("../services/runtime-helper.js");\nexport const seedSrd = true;'
assert_commonjs_loader_rejected "module.require loader" \
  $'module.require("../services/runtime-helper.js");\nexport const seedSrd = true;'

printf '%s\n' \
  $'const runtimePath = "../services/runtime-helper.js";\nawait import(runtimePath);\nexport const seedSrd = true;' \
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
ok "split fingerprints enforce runtime extensions, ESM imports, and CommonJS policy"

# Path-independence: identical Prisma/seed inputs at two different worktree
# paths must produce the same fingerprint, so they share one
# musi_template_<hash> DB instead of each rebuilding their own.
fingerprint_a="$(musi_test_tmp_dir)"
fingerprint_b="$(musi_test_tmp_dir)"
for dir in "$fingerprint_a" "$fingerprint_b"; do
  mkdir -p "$dir/packages/server/prisma/migrations/20260426000000_init"
  mkdir -p "$dir/packages/server/src/seed"
  mkdir -p "$dir/packages/server/src/seed/data"
  mkdir -p "$dir/packages/server/src/generated/prisma"
  mkdir -p "$dir/packages/server/src/utils"
  mkdir -p "$dir/packages/shared/src/rules"
  printf 'datasource db {}\n' > "$dir/packages/server/prisma/schema.prisma"
  printf '%s\n' \
    'export default {' \
    '  migrations: {' \
    '    path: "prisma/migrations",' \
    '  },' \
    '};' \
    > "$dir/packages/server/prisma.config.ts"
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
  printf '{"name":"musi","private":true}\n' > "$dir/package.json"
  printf '{"lockfileVersion":1}\n' > "$dir/bun.lock"
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
dependency_dir="$(musi_test_tmp_dir)"
dependency_stub_dir="$(musi_test_tmp_dir)"
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
shared_build_dir="$(musi_test_tmp_dir)"
shared_build_stub_dir="$(musi_test_tmp_dir)"
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
# requires the shared-output marker, and the GC seam fails with an ordinary
# command before a sentinel so the containment boundary must preserve errexit.
cmd_init_shared_marker="$shared_build_dir/cmd-init-shared-ready"
cmd_init_template_marker="$shared_build_dir/cmd-init-template-refreshed"
cmd_init_gc_after_failure="$shared_build_dir/cmd-init-gc-after-failure"
set +e
cmd_init_output="$(
  (
    # This is a hand-maintained mirror of cmd_init's collaborators. Keep
    # errexit explicit so a newly added, unstubbed call fails loudly instead
    # of reaching the real helper against this fixture tree.
    set -e
    is_primary_worktree() { return 1; }
    compute_slug() { printf 'ordering_abc123'; }
    slug_hash_int() { printf '1'; }
    current_root() { printf '%s' "$shared_build_dir"; }
    install_lint_ratchet_merge_driver() { :; }
    install_knip_unused_exports_merge_driver() { :; }
    install_near_duplicates_merge_driver() { :; }
    install_max_lines_exceptions_merge_driver() { :; }
    ensure_state_dir() { :; }
    acquire_worktree_init_lock() { printf -v "$2" '%s' '99'; }
    release_worktree_init_lock() { :; }
    ensure_dependencies() { :; }
    ensure_shared_output() { touch "$cmd_init_shared_marker"; }
    cmd_gc() {
      false
      touch "$cmd_init_gc_after_failure"
    }
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

    cmd_init
  ) 2>&1
)"
cmd_init_rc=$?
set -e
[[ "$cmd_init_rc" -eq 0 ]] \
  || fail "cmd_init should continue after opportunistic GC failure: $cmd_init_output"
[[ -e "$cmd_init_template_marker" ]] \
  || fail "cmd_init ordering seam did not reach template refresh"
[[ ! -e "$cmd_init_gc_after_failure" ]] \
  || fail "opportunistic GC continued after an ordinary command failure"
[[ "$cmd_init_output" == *"WARN: opportunistic GC did not complete"* ]] \
  || fail "contained GC failure should emit a warning: $cmd_init_output"
[[ "$cmd_init_output" == *"bun run worktree:gc"* ]] \
  || fail "contained GC warning should name the diagnostic command: $cmd_init_output"
ok "cmd_init contains opportunistic GC exit and continues provisioning"

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

# A checkout can retain older shared output after switching branches. The dev
# prebuild must rebuild when a newly exported runtime subpath is absent, even
# if the longstanding schemas and constants outputs are still present.
dev_prebuild_dir="$(musi_test_tmp_dir)"
dev_prebuild_stub_dir="$(musi_test_tmp_dir)"
mkdir -p "$dev_prebuild_dir/packages/shared/dist/schemas"
touch "$dev_prebuild_dir/packages/shared/dist/constants.js"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$@" > "$DEV_PREBUILD_BUN_OUT"' \
  'touch packages/shared/dist/logging-policy.js' \
  > "$dev_prebuild_stub_dir/bun"
chmod +x "$dev_prebuild_stub_dir/bun"
export DEV_PREBUILD_BUN_OUT="$dev_prebuild_stub_dir/argv"
(
  cd "$dev_prebuild_dir"
  PATH="$dev_prebuild_stub_dir:$PATH" musi_dev_prebuild_shared >/dev/null 2>&1
)
[[ -s "$DEV_PREBUILD_BUN_OUT" ]] \
  || fail "dev prebuild should rebuild when logging-policy output is missing"
expected_dev_prebuild_argv=$'run\n--filter\n@musi/shared\nbuild\n--\n--force'
[[ "$(cat "$DEV_PREBUILD_BUN_OUT")" == "$expected_dev_prebuild_argv" ]] \
  || fail "dev prebuild used the wrong shared build command:
got:
$(cat "$DEV_PREBUILD_BUN_OUT")
want:
$expected_dev_prebuild_argv"
rm -rf "$dev_prebuild_dir" "$dev_prebuild_stub_dir"
ok "dev prebuild detects a missing logging-policy runtime subpath"

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

workspace_env_dir="$(musi_test_tmp_dir)"
workspace_stub_dir="$(musi_test_tmp_dir)"
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

cleanup_dir="$(musi_test_tmp_dir)"
cleanup_stub_dir="$(musi_test_tmp_dir)"
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

printf '\nworktree-db smoke tests passed (%d assertions)\n' "$PASS"
