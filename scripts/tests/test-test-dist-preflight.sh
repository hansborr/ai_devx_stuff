#!/usr/bin/env bash
# smoke-order: 220
# smoke-subjects: scripts/lib/test-dist-preflight.sh
# smoke-subjects: scripts/prisma-client-freshness.sh
# smoke-subjects: scripts/vitest.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/tests/test-test-dist-preflight.sh
# smoke-subjects: packages/shared/package.json
# smoke-subjects: packages/server/package.json
# Smoke test for the TEST-path stale-dist / prisma-client staleness preflight.
#
# Proves the mtime-based fail-fast guard: a fresh tree passes silently, a
# missing or stale @musi/shared dist fails with an actionable build message,
# a stale-or-missing generated Prisma client fails with an actionable
# prisma:generate message, and vitest.sh aborts (exit 1, no Vitest run) when
# the preflight fails.
set -euo pipefail

# This suite asserts the preflight's own behavior, including the cases that
# expect it to FAIL and the case that exercises the MUSI_SKIP_TEST_DIST_PREFLIGHT
# opt-out explicitly. The preflight is active everywhere (no harness auto-skip),
# but clear any inherited value defensively so a stray export in the caller's
# environment cannot mask a fail-expecting case; each case sets the flag locally.
unset MUSI_SKIP_TEST_DIST_PREFLIGHT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/../lib/test-dist-preflight.sh"
PRISMA_HELPER="$SCRIPT_DIR/../prisma-client-freshness.sh"
VITEST_WRAPPER="$SCRIPT_DIR/../vitest.sh"
OUTPUT_FILTER="$SCRIPT_DIR/../ai-hooks/output-filter.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$HELPER" || fail "test-dist-preflight.sh fails bash -n"
ok "test-dist-preflight.sh passes bash -n"

bash -n "$VITEST_WRAPPER" || fail "vitest.sh fails bash -n"
ok "vitest.sh passes bash -n"

# shellcheck source=/dev/null
. "$PRISMA_HELPER"
# shellcheck source=/dev/null
. "$HELPER"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/test-dist-preflight-smoke-XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

# Build a tree whose @musi/shared dist and generated Prisma client are BOTH
# fresh: src is created first, then (after a perceptible mtime gap) the dist
# sentinels and the client dir, so src is older than its built output.
make_fresh_repo() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p \
    "$repo/packages/shared/src" \
    "$repo/packages/shared/dist/dice" \
    "$repo/packages/shared/dist/map" \
    "$repo/packages/shared/dist/rules" \
    "$repo/packages/shared/dist/schemas" \
    "$repo/packages/shared/dist/test" \
    "$repo/packages/server/prisma" \
    "$repo/packages/server/src/generated/prisma"
  printf 'export const x = 1;\n' > "$repo/packages/shared/src/constants.ts"
  printf 'schema\n' > "$repo/packages/server/prisma/schema.prisma"
  # Backdate the src tree and schema so they are unambiguously older than the
  # built outputs and the build marker created below.
  touch -d '2020-01-01 00:00:00' \
    "$repo/packages/shared/src/constants.ts" \
    "$repo/packages/server/prisma/schema.prisma"
  touch \
    "$repo/packages/shared/dist/constants.js" \
    "$repo/packages/shared/dist/dice/dice-roller.js" \
    "$repo/packages/shared/dist/map/drawing.js" \
    "$repo/packages/shared/dist/rules/attack-damage.js" \
    "$repo/packages/shared/dist/schemas/auth.js" \
    "$repo/packages/shared/dist/test/parse-helpers.js"
  # `tsc -b` writes tsconfig.tsbuildinfo on every build; the staleness rule now
  # compares src against THIS marker (not a dist .js), so a fresh tree needs it
  # to exist and be newer than src. Backdate it to a FIXED point after the src
  # backdate (2020) but well before "now": the "stale" cases below prove staleness
  # by touch-ing a src file to NOW, and `find -newer` is a STRICT greater-than on
  # mtime — were the marker also touched to NOW, on a coarse (1-second) mtime
  # filesystem the two could land in the same second and a stale case would
  # spuriously read fresh and flake. A fixed past marker makes every
  # src-newer-than-marker case deterministic regardless of FS granularity.
  touch -d '2021-01-01 00:00:00' "$repo/packages/shared/tsconfig.tsbuildinfo"
  # The freshness rule is `schema -nt client`; ensure the client dir is at
  # least as new as the schema by touching it after the backdate.
  touch "$repo/packages/server/src/generated/prisma"
}

# expect_preflight_ok <label> <repo> [includes_server] [includes_shared_consumer]
# Both gate args default to 1 (full coverage) so existing callers keep the full
# Prisma+dist checks; pass includes_server=0 to model a non-server run that must
# NOT abort on a stale Prisma client, and includes_shared_consumer=0 to model a
# scripts/eslint-rules/shared run that must NOT abort on a stale shared dist.
expect_preflight_ok() {
  local label="$1" repo="$2" includes_server="${3:-1}" includes_shared="${4:-1}"
  if ! musi_test_dist_preflight "$repo" "$includes_server" "$includes_shared" \
      >"$ROOT/$label.out" 2>"$ROOT/$label.err"; then
    printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$ROOT/$label.out")" "$(cat "$ROOT/$label.err")"
    fail "$label expected preflight success"
  fi
  [ ! -s "$ROOT/$label.out" ] || fail "$label expected empty stdout"
  [ ! -s "$ROOT/$label.err" ] || fail "$label expected empty stderr (fresh tree must be silent)"
}

# expect_preflight_fail <label> <repo> <needle> [includes_server] [includes_shared_consumer]
expect_preflight_fail() {
  local label="$1" repo="$2" needle="$3" includes_server="${4:-1}" includes_shared="${5:-1}"
  local rc=0
  musi_test_dist_preflight "$repo" "$includes_server" "$includes_shared" \
    >"$ROOT/$label.out" 2>"$ROOT/$label.err" || rc=$?
  [ "$rc" -ne 0 ] || fail "$label expected preflight failure"
  grep -qF "$needle" "$ROOT/$label.err" \
    || { cat "$ROOT/$label.err" >&2; fail "$label missing actionable message: $needle"; }
}

# --- fresh tree passes silently ----------------------------------------------
REPO_FRESH="$ROOT/fresh"
make_fresh_repo "$REPO_FRESH"
expect_preflight_ok "fresh" "$REPO_FRESH"
ok "fresh shared dist + prisma client passes silently"

# --- missing shared dist fails fast ------------------------------------------
REPO_DIST_MISSING="$ROOT/dist-missing"
make_fresh_repo "$REPO_DIST_MISSING"
rm "$REPO_DIST_MISSING/packages/shared/dist/constants.js"
expect_preflight_fail "dist-missing" "$REPO_DIST_MISSING" \
  "bun run --filter @musi/shared build"
ok "missing shared dist output fails with build remediation"

# --- stale shared dist (src newer than dist) fails fast ----------------------
REPO_DIST_STALE="$ROOT/dist-stale"
make_fresh_repo "$REPO_DIST_STALE"
# Touch a src file to NOW so it is newer than the built dist sentinels.
touch "$REPO_DIST_STALE/packages/shared/src/constants.ts"
expect_preflight_fail "dist-stale" "$REPO_DIST_STALE" \
  "@musi/shared src newer than dist"
ok "stale shared dist (src newer) fails with build remediation"

# --- non-TS edit newer than tsbuildinfo stays fresh --------------------------
# Only files `tsc -b` compiles (the `*.ts` under src) are build inputs. A
# Markdown-only change (e.g. a MODULE.md) never refreshes tsconfig.tsbuildinfo,
# so if the staleness scan counted it the tree would read stale forever and the
# user could not escape the build-remediation loop. Editing a non-.ts file newer
# than the marker must stay fresh.
REPO_NON_TS_FRESH="$ROOT/non-ts-fresh"
make_fresh_repo "$REPO_NON_TS_FRESH"
# A doc that the build does not compile, made newer than the build marker.
printf '# module\n' > "$REPO_NON_TS_FRESH/packages/shared/src/MODULE.md"
touch "$REPO_NON_TS_FRESH/packages/shared/src/MODULE.md"
expect_preflight_ok "non-ts-fresh" "$REPO_NON_TS_FRESH"
ok "non-.ts src edit (MODULE.md) newer than tsbuildinfo stays fresh"

# --- compiled .ts edit newer than tsbuildinfo is stale -----------------------
# The companion to the case above: a real compiled source file newer than the
# marker must still report stale so a genuine unbuilt edit fails fast. Uses a
# nested src/**/*.ts (not the top-level sentinel) to prove the scan walks the
# tree, not just the root.
REPO_TS_STALE="$ROOT/ts-stale"
make_fresh_repo "$REPO_TS_STALE"
mkdir -p "$REPO_TS_STALE/packages/shared/src/rules"
printf 'export const y = 2;\n' > "$REPO_TS_STALE/packages/shared/src/rules/attack-damage.ts"
touch "$REPO_TS_STALE/packages/shared/src/rules/attack-damage.ts"
expect_preflight_fail "ts-stale" "$REPO_TS_STALE" \
  "@musi/shared src newer than dist"
ok "compiled src/**/*.ts newer than tsbuildinfo still reports stale"

# --- incremental rebuild clears stale (P1 regression) ------------------------
# An incremental `tsc -b` only rewrites the dist outputs affected by the edited
# file, so unrelated dist sentinels keep their old mtimes. The staleness check
# must therefore key on tsconfig.tsbuildinfo (which tsc -b rewrites on EVERY
# build), not the oldest dist sentinel. Simulate: edit a src file (now newer
# than the old marker => stale), then rebuild touching ONLY tsconfig.tsbuildinfo
# while leaving the dist .js sentinels at their old mtimes. The preflight must
# now report fresh; the pre-fix oldest-sentinel comparison would still see the
# edited src as newer than the untouched sentinels and keep failing.
REPO_INCREMENTAL="$ROOT/incremental"
make_fresh_repo "$REPO_INCREMENTAL"
# Edit a src file to NOW: with the old marker it is stale.
touch "$REPO_INCREMENTAL/packages/shared/src/constants.ts"
expect_preflight_fail "incremental-pre" "$REPO_INCREMENTAL" \
  "@musi/shared src newer than dist"
ok "edited src is stale before the incremental rebuild marker is refreshed"
# Incremental rebuild: tsc -b rewrites the marker. Leave the dist .js sentinels
# untouched (an incremental build need not rewrite unrelated outputs) and make
# the marker unambiguously newer than the edited src.
sleep 1
touch "$REPO_INCREMENTAL/packages/shared/tsconfig.tsbuildinfo"
expect_preflight_ok "incremental-post" "$REPO_INCREMENTAL"
ok "incremental rebuild (tsbuildinfo refreshed, dist sentinels untouched) clears stale"

# --- missing tsconfig.tsbuildinfo does not loop on stale ---------------------
# If the build marker is absent we have no trustworthy "built at" timestamp;
# the stale branch must NOT fire (missing-dist still owns "needs build"). With
# dist sentinels present but no marker, even a freshly-edited src is treated as
# not-stale so the tree does not get stuck reporting stale forever.
REPO_NO_MARKER="$ROOT/no-marker"
make_fresh_repo "$REPO_NO_MARKER"
rm "$REPO_NO_MARKER/packages/shared/tsconfig.tsbuildinfo"
touch "$REPO_NO_MARKER/packages/shared/src/constants.ts"
expect_preflight_ok "no-marker" "$REPO_NO_MARKER"
ok "absent tsconfig.tsbuildinfo skips the stale branch (no false-stale loop)"

# --- missing generated prisma client fails fast (server/full run) ------------
REPO_PRISMA_MISSING="$ROOT/prisma-missing"
make_fresh_repo "$REPO_PRISMA_MISSING"
rm -rf "$REPO_PRISMA_MISSING/packages/server/src/generated/prisma"
expect_preflight_fail "prisma-missing" "$REPO_PRISMA_MISSING" \
  "bun run --filter @musi/server prisma:generate" 1
ok "missing prisma client fails with prisma:generate remediation (server run)"

# --- stale generated prisma client (schema newer than client) fails fast -----
REPO_PRISMA_STALE="$ROOT/prisma-stale"
make_fresh_repo "$REPO_PRISMA_STALE"
# Backdate the generated client, then touch the schema to NOW so schema is
# unambiguously -nt the client (second-resolution mtimes make a bare touch
# of both in the same second non-strict).
touch -d '2020-01-01 00:00:00' "$REPO_PRISMA_STALE/packages/server/src/generated/prisma"
touch "$REPO_PRISMA_STALE/packages/server/prisma/schema.prisma"
expect_preflight_fail "prisma-stale" "$REPO_PRISMA_STALE" \
  "schema.prisma newer than generated client" 1
ok "stale prisma client (schema newer) fails with prisma:generate remediation (server run)"

# --- non-server run tolerates a stale/missing prisma client ------------------
# Only server tests import the generated Prisma client, so a non-server run
# (includes_server=0) must NOT abort on a stale or missing client it never
# touches. These cases keep includes_shared_consumer=1 (default) with a FRESH
# shared dist, so they isolate the Prisma gate; the shared-dist gate is
# exercised separately below.
REPO_PRISMA_MISSING_CLIENT="$ROOT/prisma-missing-client-run"
make_fresh_repo "$REPO_PRISMA_MISSING_CLIENT"
rm -rf "$REPO_PRISMA_MISSING_CLIENT/packages/server/src/generated/prisma"
expect_preflight_ok "prisma-missing-client-run" "$REPO_PRISMA_MISSING_CLIENT" 0
ok "client/shared/scripts run does NOT abort on a missing prisma client"

REPO_PRISMA_STALE_CLIENT="$ROOT/prisma-stale-client-run"
make_fresh_repo "$REPO_PRISMA_STALE_CLIENT"
touch -d '2020-01-01 00:00:00' "$REPO_PRISMA_STALE_CLIENT/packages/server/src/generated/prisma"
touch "$REPO_PRISMA_STALE_CLIENT/packages/server/prisma/schema.prisma"
expect_preflight_ok "prisma-stale-client-run" "$REPO_PRISMA_STALE_CLIENT" 0
ok "client/shared/scripts run does NOT abort on a stale prisma client"

# --- a shared-dist CONSUMER run STILL fails on a stale shared dist -----------
# Gating the Prisma check on server-context must not weaken the shared-dist
# check for runs that DO import the dist: a client run (a consumer,
# includes_shared_consumer=1) with stale shared dist must still abort.
REPO_SHARED_STALE_CLIENT="$ROOT/shared-stale-client-run"
make_fresh_repo "$REPO_SHARED_STALE_CLIENT"
touch "$REPO_SHARED_STALE_CLIENT/packages/shared/src/constants.ts"
expect_preflight_fail "shared-stale-client-run" "$REPO_SHARED_STALE_CLIENT" \
  "@musi/shared src newer than dist" 0 1
ok "a shared-dist consumer (client) run still aborts on stale shared dist"

# --- a NON-consumer run tolerates a stale shared dist ------------------------
# scripts/eslint-rules tests never import @musi/shared, and the shared project's
# own tests import ./src directly (not the built dist), so a focused
# --project=scripts/eslint-rules/shared run (includes_shared_consumer=0) must
# NOT be aborted by a stale shared dist it never loads — the dist gate is for
# client/server only, mirroring the Prisma gate for server.
REPO_SHARED_STALE_SCRIPTS="$ROOT/shared-stale-scripts-run"
make_fresh_repo "$REPO_SHARED_STALE_SCRIPTS"
touch "$REPO_SHARED_STALE_SCRIPTS/packages/shared/src/constants.ts"
expect_preflight_ok "shared-stale-scripts-run" "$REPO_SHARED_STALE_SCRIPTS" 0 0
ok "scripts/eslint-rules/shared run does NOT abort on stale shared dist"

# --- musi_test_dist_run_includes_server reads --project filters --------------
# The wrapper derives server-context from its own Vitest argv: no --project =>
# full suite (server included); --project=server (or --project server) => yes;
# only non-server projects => no.
assert_includes_server() {
  local expected="$1"; shift
  local got
  got="$(musi_test_dist_run_includes_server "$@")"
  [ "$got" = "$expected" ] \
    || fail "includes_server: expected $expected for [$*], got $got"
}
assert_includes_server 1 run --passWithNoTests
assert_includes_server 1 run --passWithNoTests --project=server
assert_includes_server 1 run --project server
assert_includes_server 1 run --project=client --project=server
assert_includes_server 0 run --project=client
assert_includes_server 0 run --passWithNoTests --project=shared
assert_includes_server 0 run --project=scripts somefile.test.ts
assert_includes_server 0 run --project eslint-rules
ok "musi_test_dist_run_includes_server maps --project filters to server-context"

# --- musi_test_dist_run_includes_shared_consumer reads --project filters ------
# A shared-dist consumer (client or server) is in the run when there is no
# --project filter (full suite) or an explicit --project=client/server; a run
# filtered to only scripts/eslint-rules/shared is not.
assert_includes_shared_consumer() {
  local expected="$1"; shift
  local got
  got="$(musi_test_dist_run_includes_shared_consumer "$@")"
  [ "$got" = "$expected" ] \
    || fail "includes_shared_consumer: expected $expected for [$*], got $got"
}
assert_includes_shared_consumer 1 run --passWithNoTests
assert_includes_shared_consumer 1 run --project=client
assert_includes_shared_consumer 1 run --project server
assert_includes_shared_consumer 1 run --project=scripts --project=server
assert_includes_shared_consumer 0 run --project=scripts somefile.test.ts
assert_includes_shared_consumer 0 run --passWithNoTests --project=shared
assert_includes_shared_consumer 0 run --project eslint-rules
ok "musi_test_dist_run_includes_shared_consumer maps --project filters to shared-consumer context"

# --- project scope inferred from positional file paths (no --project) ---------
# `bun run test -- <path>` passes a positional file with NO --project; the gate
# must infer the project from the path so a focused shared/scripts/eslint-rules
# run is not blocked by a stale dep it never imports, while a server/client
# path still is.
assert_includes_server 0 run --passWithNoTests packages/shared/src/foo.test.ts
assert_includes_shared_consumer 0 run --passWithNoTests packages/shared/src/foo.test.ts
assert_includes_server 0 run --passWithNoTests scripts/foo.test.ts
assert_includes_shared_consumer 0 run --passWithNoTests scripts/foo.test.ts
assert_includes_server 0 run --passWithNoTests eslint-rules/foo.test.js
assert_includes_shared_consumer 0 run --passWithNoTests eslint-rules/foo.test.js
assert_includes_server 1 run --passWithNoTests packages/server/src/x.test.ts
assert_includes_shared_consumer 1 run --passWithNoTests packages/server/src/x.test.ts
assert_includes_server 0 run --passWithNoTests packages/client/src/x.test.tsx
assert_includes_shared_consumer 1 run --passWithNoTests packages/client/src/x.test.tsx
ok "positional file paths infer project scope when no --project is present"

# --- an unrecognized positional / bare filter stays conservative (ALL) -------
assert_includes_server 1 run --passWithNoTests somebarefilter
assert_includes_shared_consumer 1 run --passWithNoTests somebarefilter
ok "an unrecognized positional filter keeps every gate conservatively active"

# --- positionals do NOT broaden scope when --project is present --------------
assert_includes_server 0 run --project=scripts packages/server/src/x.test.ts
assert_includes_shared_consumer 0 run --project=scripts packages/server/src/x.test.ts
ok "positional paths do not broaden scope when --project is present"

# --- wildcard / negation --project patterns stay conservative (ALL) ---------
# Vitest supports --project=pkg*, --project=*, --project=!name; an exact
# membership test cannot resolve these, so the gate must stay conservative
# rather than silently skip a run that DOES import the stale dep.
assert_includes_server 1 run '--project=*'
assert_includes_shared_consumer 1 run '--project=*'
assert_includes_server 1 run '--project=server*'
assert_includes_server 1 run '--project=!scripts'
assert_includes_shared_consumer 1 run '--project=!scripts'
ok "wildcard/negation --project patterns keep every gate conservatively active"

# --- opt-out env var skips the preflight -------------------------------------
REPO_OPTOUT="$ROOT/optout"
make_fresh_repo "$REPO_OPTOUT"
rm "$REPO_OPTOUT/packages/shared/dist/constants.js"
if ! MUSI_SKIP_TEST_DIST_PREFLIGHT=1 musi_test_dist_preflight "$REPO_OPTOUT" \
    >"$ROOT/optout.out" 2>"$ROOT/optout.err"; then
  fail "MUSI_SKIP_TEST_DIST_PREFLIGHT=1 should bypass the preflight"
fi
ok "MUSI_SKIP_TEST_DIST_PREFLIGHT=1 bypasses the preflight"

# --- non-monorepo (no packages/shared/src) no-ops silently -------------------
REPO_NOT_MONOREPO="$ROOT/not-monorepo"
rm -rf "$REPO_NOT_MONOREPO"
mkdir -p "$REPO_NOT_MONOREPO"
if ! musi_test_dist_preflight "$REPO_NOT_MONOREPO" \
    >"$ROOT/not-monorepo.out" 2>"$ROOT/not-monorepo.err"; then
  fail "a tree without packages/shared/src should no-op"
fi
[ ! -s "$ROOT/not-monorepo.err" ] || fail "non-monorepo tree must be silent"
ok "tree without packages/shared/src no-ops silently"

# --- vitest.sh aborts (exit 1, no Vitest run) when preflight fails ------------
install_vitest_stub() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'stub vitest invoked\n' >> "${VITEST_LOG:?}"
exit 0
STUB
  chmod +x "$bin_dir/vitest"
}

copy_vitest_wrapper() {
  local repo="$1"
  mkdir -p "$repo/scripts/ai-hooks" "$repo/scripts/lib"
  cp "$VITEST_WRAPPER" "$repo/scripts/vitest.sh"
  cp "$OUTPUT_FILTER" "$repo/scripts/ai-hooks/output-filter.sh"
  cp "$PRISMA_HELPER" "$repo/scripts/prisma-client-freshness.sh"
  cp "$HELPER" "$repo/scripts/lib/test-dist-preflight.sh"
}

install_vitest_stub "$ROOT/bin"

REPO_WRAPPER_FAIL="$ROOT/vitest-wrapper-fail"
make_fresh_repo "$REPO_WRAPPER_FAIL"
git -C "$ROOT" init -q -b main "$REPO_WRAPPER_FAIL"
copy_vitest_wrapper "$REPO_WRAPPER_FAIL"
rm "$REPO_WRAPPER_FAIL/packages/shared/dist/constants.js"
: > "$ROOT/wrapper-fail.vitest.log"
rc=0
(
  cd "$REPO_WRAPPER_FAIL"
  VITEST_LOG="$ROOT/wrapper-fail.vitest.log" PATH="$ROOT/bin:$PATH" \
    bash scripts/vitest.sh run --passWithNoTests
) >"$ROOT/wrapper-fail.out" 2>"$ROOT/wrapper-fail.err" || rc=$?
[ "$rc" -eq 1 ] || fail "vitest.sh should exit 1 on stale dist, got $rc"
grep -qF "bun run --filter @musi/shared build" "$ROOT/wrapper-fail.err" \
  || fail "vitest.sh should print build remediation: $(cat "$ROOT/wrapper-fail.err")"
[ ! -s "$ROOT/wrapper-fail.vitest.log" ] \
  || fail "vitest.sh should not invoke Vitest when preflight fails"
ok "vitest.sh aborts before Vitest when shared dist is stale"

# --- manual opt-out: stale dist still runs Vitest under the skip flag ---------
# The preflight is active everywhere (no harness auto-skip), but the
# MUSI_SKIP_TEST_DIST_PREFLIGHT escape hatch must still work end-to-end for
# emergencies / deliberate manual runs. The SAME stale-dist tree that aborts
# vitest.sh above must run Vitest (exit 0, Vitest invoked, no remediation) when a
# caller sets the flag explicitly.
REPO_WRAPPER_SKIP="$ROOT/vitest-wrapper-skip"
make_fresh_repo "$REPO_WRAPPER_SKIP"
git -C "$ROOT" init -q -b main "$REPO_WRAPPER_SKIP"
copy_vitest_wrapper "$REPO_WRAPPER_SKIP"
rm "$REPO_WRAPPER_SKIP/packages/shared/dist/constants.js"
: > "$ROOT/wrapper-skip.vitest.log"
rc=0
(
  cd "$REPO_WRAPPER_SKIP"
  MUSI_SKIP_TEST_DIST_PREFLIGHT=1 \
    VITEST_LOG="$ROOT/wrapper-skip.vitest.log" PATH="$ROOT/bin:$PATH" \
    bash scripts/vitest.sh run --passWithNoTests
) >"$ROOT/wrapper-skip.out" 2>"$ROOT/wrapper-skip.err" || rc=$?
[ "$rc" -eq 0 ] || fail "vitest.sh should run despite stale dist under the explicit skip flag, got $rc: $(cat "$ROOT/wrapper-skip.err")"
grep -qF "stub vitest invoked" "$ROOT/wrapper-skip.vitest.log" \
  || fail "vitest.sh should invoke Vitest when the explicit skip flag is set"
! grep -qF "bun run --filter @musi/shared build" "$ROOT/wrapper-skip.err" \
  || fail "vitest.sh should not print stale-dist remediation under the explicit skip flag"
ok "MUSI_SKIP_TEST_DIST_PREFLIGHT=1 (explicit opt-out) runs Vitest despite stale dist"

REPO_WRAPPER_OK="$ROOT/vitest-wrapper-ok"
make_fresh_repo "$REPO_WRAPPER_OK"
git -C "$ROOT" init -q -b main "$REPO_WRAPPER_OK"
copy_vitest_wrapper "$REPO_WRAPPER_OK"
: > "$ROOT/wrapper-ok.vitest.log"
rc=0
(
  cd "$REPO_WRAPPER_OK"
  VITEST_LOG="$ROOT/wrapper-ok.vitest.log" PATH="$ROOT/bin:$PATH" \
    bash scripts/vitest.sh run --passWithNoTests
) >"$ROOT/wrapper-ok.out" 2>"$ROOT/wrapper-ok.err" || rc=$?
[ "$rc" -eq 0 ] || fail "vitest.sh should pass with a fresh tree, got $rc: $(cat "$ROOT/wrapper-ok.err")"
grep -qF "stub vitest invoked" "$ROOT/wrapper-ok.vitest.log" \
  || fail "vitest.sh should invoke Vitest when the tree is fresh"
ok "vitest.sh runs Vitest when shared dist + prisma client are fresh"

# --- focused non-consumer path run is NOT blocked by stale server deps (P2) ---
# `bun run test -- scripts/foo.test.ts` selects only the scripts project (no
# --project, positional under scripts/), which imports neither the generated
# Prisma client nor the @musi/shared dist. A stale client AND dist must NOT
# abort it.
REPO_PATH_SCOPED="$ROOT/path-scoped-scripts"
make_fresh_repo "$REPO_PATH_SCOPED"
git -C "$ROOT" init -q -b main "$REPO_PATH_SCOPED"
copy_vitest_wrapper "$REPO_PATH_SCOPED"
rm "$REPO_PATH_SCOPED/packages/shared/dist/constants.js"
touch -d "2020-01-01 00:00:00" "$REPO_PATH_SCOPED/packages/server/src/generated/prisma"
touch "$REPO_PATH_SCOPED/packages/server/prisma/schema.prisma"
: > "$ROOT/path-scoped.vitest.log"
rc=0
(
  cd "$REPO_PATH_SCOPED"
  VITEST_LOG="$ROOT/path-scoped.vitest.log" PATH="$ROOT/bin:$PATH" \
    bash scripts/vitest.sh run --passWithNoTests scripts/foo.test.ts
) >"$ROOT/path-scoped.out" 2>"$ROOT/path-scoped.err" || rc=$?
[ "$rc" -eq 0 ] || fail "scripts-path run must not abort on stale server deps, got $rc: $(cat "$ROOT/path-scoped.err")"
grep -qF "stub vitest invoked" "$ROOT/path-scoped.vitest.log" \
  || fail "scripts-path run should invoke Vitest despite stale server deps"
ok "focused scripts/ path run is not blocked by a stale shared dist or prisma client (P2)"

# --- focused server path run STILL aborts on a stale shared dist ------------
REPO_PATH_SERVER="$ROOT/path-scoped-server"
make_fresh_repo "$REPO_PATH_SERVER"
git -C "$ROOT" init -q -b main "$REPO_PATH_SERVER"
copy_vitest_wrapper "$REPO_PATH_SERVER"
rm "$REPO_PATH_SERVER/packages/shared/dist/constants.js"
: > "$ROOT/path-server.vitest.log"
rc=0
(
  cd "$REPO_PATH_SERVER"
  VITEST_LOG="$ROOT/path-server.vitest.log" PATH="$ROOT/bin:$PATH" \
    bash scripts/vitest.sh run --passWithNoTests packages/server/src/foo.test.ts
) >"$ROOT/path-server.out" 2>"$ROOT/path-server.err" || rc=$?
[ "$rc" -eq 1 ] || fail "server-path run should abort on stale shared dist, got $rc"
[ ! -s "$ROOT/path-server.vitest.log" ] || fail "server-path run should not invoke Vitest when preflight fails"
ok "focused server/ path run still aborts on a stale shared dist"

printf '\nall %d test-dist-preflight checks passed\n' "$PASS"
