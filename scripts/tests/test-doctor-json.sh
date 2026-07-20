#!/usr/bin/env bash
# smoke-order: 390
# smoke-subjects: scripts/doctor.sh
# smoke-subjects: scripts/dependency-freshness.sh
# smoke-subjects: scripts/harness-emit-envelope.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-doctor-json.sh
# smoke-subjects: harness.controls.json
# smoke-subjects: packages/shared/src/schemas/harness-diagnostics.ts
# test-doctor-json.sh — contract smoke tests for `bash scripts/doctor.sh --json`.
#
# Doctor's per-sensor output depends on the runtime environment (DB state, env
# files, dependency cache, staged blobs), so this script does not assert on
# specific finding contents. It exercises the contract surface:
#
#   1. --help exits 0 with a usage hint that mentions --json.
#   2. Unknown args exit 2.
#   3. --json produces a harness-diagnostics envelope on stdout that:
#        - parses as JSON
#        - validates against the shared schema (via the round-trip emitter)
#        - has tool == "doctor", version == "1"
#        - has every finding.control registered in harness.controls.json
#        - has summary counts that match the findings array
#   4. Default mode (no --json) still emits the human-readable PASS/WARN/FAIL
#      stream — JSON mode does not regress the default surface.
#
# Run via `bash scripts/tests/test-doctor-json.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
SCRIPT="$SCRIPT_DIR/../doctor.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MANIFEST="$REPO_ROOT/harness.controls.json"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

command -v jq >/dev/null 2>&1 || fail "jq is required for these tests"

REAL_BUN="$(command -v bun)"
FAST_ROOT="$(mktemp -d)"
FAST_FAKE_BIN="$(mktemp -d)"

# Provide stub eslint/prettier/taplo/node-actionlint/hadolint in $1 so
# check_lint_tools resolves them and emits no findings in the fixture. Each
# stub prints its own name as a version and exits 0.
make_fake_lint_tools() {
  local dir="$1" name
  for name in eslint prettier taplo node-actionlint hadolint; do
    cat >"$dir/$name" <<'SH'
#!/usr/bin/env bash
echo "$(basename "$0") 0.0.0-fake"
exit 0
SH
    chmod +x "$dir/$name"
  done
}

setup_fast_doctor_fixture() {
  git -C "$FAST_ROOT" init -q
  mkdir -p \
    "$FAST_ROOT/.devcontainer" \
    "$FAST_ROOT/node_modules/.bin" \
    "$FAST_ROOT/packages/client" \
    "$FAST_ROOT/scripts/git"
  printf 'JWT_SECRET=synthetic-doctor-json-secret\n' >"$FAST_ROOT/.devcontainer/.env"
  cat >"$FAST_ROOT/.env" <<'EOF'
DATABASE_URL=postgresql://musi:musi@localhost:5432/musi_synthetic
REDIS_URL=redis://localhost:6379/0
SERVER_PORT=47777
CORS_ORIGIN=http://localhost:47778
JWT_SECRET=synthetic-doctor-json-secret
EOF
  printf 'VITE_API_BASE_URL=http://localhost:47777\n' >"$FAST_ROOT/packages/client/.env"
  touch "$FAST_ROOT/bun.lock"
  touch "$FAST_ROOT/node_modules/.bin"

  for fake_script in worktree-db.sh suppression-register.sh; do
    cat >"$FAST_ROOT/scripts/$fake_script" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic clean check\n'
SH
    chmod +x "$FAST_ROOT/scripts/$fake_script"
  done

  cat >"$FAST_ROOT/scripts/git/check-lint-ratchet-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic lint-ratchet merge-driver health\n'
SH
  chmod +x "$FAST_ROOT/scripts/git/check-lint-ratchet-merge-driver.sh"

  cat >"$FAST_ROOT/scripts/git/check-knip-unused-exports-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic knip unused-exports merge-driver health\n'
SH
  chmod +x "$FAST_ROOT/scripts/git/check-knip-unused-exports-merge-driver.sh"

  cat >"$FAST_ROOT/scripts/git/check-max-lines-exceptions-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic max-lines exceptions merge-driver health\n'
SH
  chmod +x "$FAST_ROOT/scripts/git/check-max-lines-exceptions-merge-driver.sh"

  cat >"$FAST_ROOT/scripts/git/check-near-duplicates-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic near-duplicates merge-driver health\n'
SH
  chmod +x "$FAST_ROOT/scripts/git/check-near-duplicates-merge-driver.sh"

  cat >"$FAST_ROOT/scripts/eslint-disable-register.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'WARN: synthetic eslint-disable register warning\n'
SH
  chmod +x "$FAST_ROOT/scripts/eslint-disable-register.sh"

  cat >"$FAST_ROOT/scripts/migration-safety-scan.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--json" ]; then
  printf '{"findings":[{"control":"sensor/db-migration-safety","severity":"warn","path":"packages/server/prisma/migrations/synthetic/migration.sql","line":1,"messageId":"synthetic-migration-warning","why":"synthetic migration warning","howToFix":"review the synthetic migration warning","repairKind":"manual"}],"summary":{"blocking":0,"warning":1,"info":0}}\n'
else
  printf 'WARN: synthetic migration warning\n'
fi
SH
  chmod +x "$FAST_ROOT/scripts/migration-safety-scan.sh"

  cat >"$FAST_FAKE_BIN/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "run" ]; then
  case "${2:-}" in
    drift:ai)
      if [ "${3:-}" = "harness-freshness" ]; then
        printf 'WARN synthetic-drift: synthetic harness freshness warning\n'
        exit 0
      fi
      ;;
    sensor:knip)
      # Report-only sensor. Default clean (exit 0). The nonzero branches model
      # knip's real exit semantics for the run_report_subcommand tests:
      # DOCTOR_JSON_KNIP_EXIT=1 → findings present, =2 → tool crash.
      if [ -n "${DOCTOR_JSON_KNIP_EXIT:-}" ]; then
        printf '%s\n' "${DOCTOR_JSON_KNIP_OUTPUT:-}"
        exit "${DOCTOR_JSON_KNIP_EXIT}"
      fi
      exit 0
      ;;
    sensor:blob-size)
      printf 'PASS: synthetic blob-size clean\n'
      exit 0
      ;;
    sensor:context-budget)
      # Report-only context-budget reporter: exit 0 means "reported, no
      # findings" (run_report_subcommand semantics).
      printf 'context-budget total: 0 file(s), 0 lines, 0 bytes, ~0 tokens\n'
      exit 0
      ;;
    */scripts/db-status.ts)
      printf 'PASS: synthetic db status clean\n'
      exit 0
      ;;
    harness:check)
      # Model real `bun run <name>`: the script name is resolved against the
      # nearest package.json walking up from cwd. The fast fixture has no
      # package.json declaring harness:check, so the bare name never resolves —
      # exactly the U1 "Script not found" failure. doctor must invoke the
      # absolute module path (harness-check.ts) instead, which lands in the
      # *harness-check.ts) branch below.
      printf 'error: Script not found "harness:check"\n' >&2
      exit 1
      ;;
    *harness-check.ts)
      if [ -n "${DOCTOR_JSON_EXPECT_HARNESS_CWD:-}" ] \
        && [ "$(pwd -P)" != "$DOCTOR_JSON_EXPECT_HARNESS_CWD" ]; then
        printf 'harness:check ran from %s, expected %s\n' \
          "$(pwd -P)" "$DOCTOR_JSON_EXPECT_HARNESS_CWD"
        exit 1
      fi
      if [ "${DOCTOR_JSON_FORCE_HARNESS_FAIL:-0}" = "1" ]; then
        printf 'forced harness check stdout\n'
        printf 'forced harness check stderr\n' >&2
        exit 1
      fi
      if [ "${DOCTOR_JSON_RUN_REAL_HARNESS:-0}" = "1" ]; then
        exec "${REAL_BUN:?}" "$@"
      fi
      exit 0
      ;;
  esac
fi
exec "${REAL_BUN:?}" "$@"
SH
  chmod +x "$FAST_FAKE_BIN/bun"

  cat >"$FAST_FAKE_BIN/ss" <<'SH'
#!/usr/bin/env bash
exit 1
SH
  chmod +x "$FAST_FAKE_BIN/ss"

  make_fake_lint_tools "$FAST_FAKE_BIN"
}

run_fast_doctor() {
  (
    cd "$FAST_ROOT"
    REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" "$@"
  )
}

setup_fast_doctor_fixture

# --- syntax / argument parsing --------------------------------------------
bash -n "$SCRIPT" || fail "doctor.sh fails bash -n"
ok "doctor.sh passes bash -n"

bash "$SCRIPT" --help >/tmp/doctor-help.out 2>&1 || fail "doctor --help should succeed"
grep -qF -- '--json' /tmp/doctor-help.out \
  || fail "doctor --help should mention --json"
ok "doctor --help exits 0 and mentions --json"

# An unknown long flag must exit 2 (codex/CI parses this code).
# Capture exit explicitly: `if cmd; ...; fi` resets $? to 0 after `fi`, so a
# bare `bad_rc=$?` outside the if cannot read the script's true exit code.
bad_rc=0
bash "$SCRIPT" --does-not-exist >/tmp/doctor-bad.out 2>&1 || bad_rc=$?
[ "$bad_rc" -eq 2 ] || fail "doctor unknown-arg exit should be 2, got $bad_rc"
ok "doctor with unknown arg exits 2"

# --- --json envelope contract ---------------------------------------------
# Capture stdout to a file so a downstream `jq` failure surfaces the raw
# bytes (`bash -c '...|jq'` would swallow them via SIGPIPE).
DOCTOR_JSON="$(mktemp)"
DOCTOR_STDERR="$(mktemp)"
DOCTOR_EXIT=0
run_fast_doctor bash "$SCRIPT" --json >"$DOCTOR_JSON" 2>"$DOCTOR_STDERR" || DOCTOR_EXIT=$?

if ! jq -e . <"$DOCTOR_JSON" >/dev/null 2>&1; then
  printf '--- doctor --json stdout (head) ---\n' >&2
  head -c 2000 "$DOCTOR_JSON" >&2
  printf '\n--- doctor --json stderr ---\n' >&2
  cat "$DOCTOR_STDERR" >&2
  fail "doctor --json stdout did not parse as JSON"
fi
ok "doctor --json stdout parses as JSON"

# Exit code must be 0 or 1; anything else is a bug (jq missing → 1 is fine).
if [ "$DOCTOR_EXIT" -ne 0 ] && [ "$DOCTOR_EXIT" -ne 1 ]; then
  fail "doctor --json exit code must be 0 or 1, got $DOCTOR_EXIT"
fi
ok "doctor --json exit code is 0 or 1"

# Envelope shape.
TOOL=$(jq -r '.tool' "$DOCTOR_JSON")
VERSION=$(jq -r '.version' "$DOCTOR_JSON")
[ "$TOOL" = "doctor" ] || fail "envelope.tool != 'doctor' (got '$TOOL')"
[ "$VERSION" = "1" ] || fail "envelope.version != '1' (got '$VERSION')"
ok "envelope.tool=='doctor' and envelope.version=='1'"

# Findings array exists and is an array.
jq -e '.findings | type == "array"' "$DOCTOR_JSON" >/dev/null \
  || fail "envelope.findings is not an array"
ok "envelope.findings is an array"

# Summary shape.
jq -e '.summary.blocking | type == "number"' "$DOCTOR_JSON" >/dev/null \
  || fail "envelope.summary.blocking missing or non-numeric"
jq -e '.summary.warning  | type == "number"' "$DOCTOR_JSON" >/dev/null \
  || fail "envelope.summary.warning missing or non-numeric"
jq -e '.summary.info     | type == "number"' "$DOCTOR_JSON" >/dev/null \
  || fail "envelope.summary.info missing or non-numeric"
jq -e '.summary.byControl | type == "object"' "$DOCTOR_JSON" >/dev/null \
  || fail "envelope.summary.byControl missing or non-object"
ok "envelope.summary shape is well-formed"

# Summary counts must match the findings array.
EXPECTED_BLOCK=$(jq '[.findings[] | select(.severity=="block")] | length' "$DOCTOR_JSON")
EXPECTED_WARN=$(jq  '[.findings[] | select(.severity=="warn")]  | length' "$DOCTOR_JSON")
EXPECTED_INFO=$(jq  '[.findings[] | select(.severity=="info")]  | length' "$DOCTOR_JSON")
ACTUAL_BLOCK=$(jq '.summary.blocking' "$DOCTOR_JSON")
ACTUAL_WARN=$(jq  '.summary.warning'  "$DOCTOR_JSON")
ACTUAL_INFO=$(jq  '.summary.info'     "$DOCTOR_JSON")
[ "$EXPECTED_BLOCK" = "$ACTUAL_BLOCK" ] \
  || fail "summary.blocking $ACTUAL_BLOCK != findings blocking count $EXPECTED_BLOCK"
[ "$EXPECTED_WARN" = "$ACTUAL_WARN" ] \
  || fail "summary.warning $ACTUAL_WARN != findings warn count $EXPECTED_WARN"
[ "$EXPECTED_INFO" = "$ACTUAL_INFO" ] \
  || fail "summary.info $ACTUAL_INFO != findings info count $EXPECTED_INFO"
ok "summary counts match findings counts"

# Every finding.control must resolve to a registered control in the manifest.
# Build the registered set once, then diff against the findings' control set.
REGISTERED_CONTROLS="$(mktemp)"
jq -r '.controls[].id' "$MANIFEST" | sort -u >"$REGISTERED_CONTROLS"
EMITTED_CONTROLS="$(mktemp)"
jq -r '.findings[].control' "$DOCTOR_JSON" | sort -u >"$EMITTED_CONTROLS"
UNKNOWN_CONTROLS="$(comm -23 "$EMITTED_CONTROLS" "$REGISTERED_CONTROLS")"
if [ -n "$UNKNOWN_CONTROLS" ]; then
  printf 'Unknown control id(s) emitted by doctor --json:\n%s\n' "$UNKNOWN_CONTROLS" >&2
  fail "doctor --json emitted findings under unregistered controls"
fi
ok "every emitted control id resolves to harness.controls.json"

# Every finding must have a non-empty messageId, why, and howToFix
# (schema requires why/howToFix; messageId is encouraged for de-dupe).
jq -e '
  .findings | all(
    (.why    | type == "string" and length > 0) and
    (.howToFix | type == "string" and length > 0) and
    (.repairKind | IN("autofix","suggestion","codemod","manual")) and
    (.severity   | IN("block","warn","info"))
  )' "$DOCTOR_JSON" >/dev/null \
  || fail "one or more findings has empty why/howToFix or invalid enum"
ok "every finding has non-empty why/howToFix and valid enums"

# U1: JSON mode must run harness:check successfully even when doctor is invoked
# from a nested subdirectory inside a package workspace. doctor invokes the
# validator by its absolute module path (harness-check.ts), which resolves from
# any cwd — `bun run harness:check` would error `Script not found` because the
# bare name resolves against the nearest package.json walking up. The fake bun
# shim models that bare-name failure, so a regression to the script-name form
# surfaces a blocking `harness-check-failed` finding and fails the assertion
# below.
SUBDIR_JSON="$(mktemp)"
SUBDIR_ERR="$(mktemp)"
SUBDIR_EXIT=0
mkdir -p "$FAST_ROOT/packages/client/src"
(
  cd "$FAST_ROOT/packages/client/src"
  REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash "$SCRIPT" --json >"$SUBDIR_JSON" 2>"$SUBDIR_ERR"
) || SUBDIR_EXIT=$?
if [ "$SUBDIR_EXIT" -ne 0 ] && [ "$SUBDIR_EXIT" -ne 1 ]; then
  fail "subdirectory doctor --json exit code must be 0 or 1, got $SUBDIR_EXIT"
fi
jq -e . <"$SUBDIR_JSON" >/dev/null \
  || { cat "$SUBDIR_JSON" >&2; cat "$SUBDIR_ERR" >&2; fail "subdirectory doctor --json stdout did not parse as JSON"; }
jq -e '
  .findings
  | all(.messageId != "harness-check-failed")
' "$SUBDIR_JSON" >/dev/null \
  || { cat "$SUBDIR_JSON" >&2; cat "$SUBDIR_ERR" >&2; fail "subdirectory doctor --json failed harness:check (U1: bare script name not found from subdir)"; }
ok "subdirectory doctor --json runs harness:check from a nested subdir"

# --- default mode is unchanged ---------------------------------------------
# Run default mode and assert the prose stream still contains a `PASS=` /
# `WARN=` / `FAIL=` summary tail.
DEFAULT_OUT="$(mktemp)"
DEFAULT_EXIT=0
run_fast_doctor bash "$SCRIPT" >"$DEFAULT_OUT" 2>&1 || DEFAULT_EXIT=$?
if [ "$DEFAULT_EXIT" -ne 0 ] && [ "$DEFAULT_EXIT" -ne 1 ]; then
  fail "default-mode doctor exit code must be 0 or 1, got $DEFAULT_EXIT"
fi
grep -qE '^PASS=[0-9]+  WARN=[0-9]+  FAIL=[0-9]+$' "$DEFAULT_OUT" \
  || { head -c 2000 "$DEFAULT_OUT" >&2; fail "default-mode summary line missing"; }
grep -qF '=== summary ===' "$DEFAULT_OUT" \
  || fail "default-mode '=== summary ===' header missing"
ok "default-mode summary section is unchanged"

# The lint host-tool inventory section must render in default mode.
grep -qF '=== lint tools ===' "$DEFAULT_OUT" \
  || { head -c 2000 "$DEFAULT_OUT" >&2; fail "default-mode '=== lint tools ===' section missing"; }
ok "default-mode lint-tools section is present"

grep -qF '=== lint-ratchet merge-driver health ===' "$DEFAULT_OUT" \
  || { head -c 2000 "$DEFAULT_OUT" >&2; fail "default-mode lint-ratchet merge-driver health section missing"; }
ok "default-mode lint-ratchet merge-driver health section is present"

# U1: default (non-JSON) mode must run harness:check successfully from a nested
# package subdir. This is the human/programmatic path (`run_subcommand … bun run
# harness:check`); with the bare script name it would print `Script not found`
# and the parity step would be counted as a FAIL. The module-path invocation
# resolves from any cwd. The fake bun shim models the bare-name failure so a
# regression to the script-name form is caught here.
SUBDIR_DEFAULT_OUT="$(mktemp)"
SUBDIR_DEFAULT_EXIT=0
(
  cd "$FAST_ROOT/packages/client/src"
  REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash "$SCRIPT" >"$SUBDIR_DEFAULT_OUT" 2>&1
) || SUBDIR_DEFAULT_EXIT=$?
if [ "$SUBDIR_DEFAULT_EXIT" -ne 0 ] && [ "$SUBDIR_DEFAULT_EXIT" -ne 1 ]; then
  fail "subdirectory default-mode doctor exit code must be 0 or 1, got $SUBDIR_DEFAULT_EXIT"
fi
grep -qF '=== harness manifest parity ===' "$SUBDIR_DEFAULT_OUT" \
  || { head -c 2000 "$SUBDIR_DEFAULT_OUT" >&2; fail "subdirectory default-mode harness parity section missing"; }
if grep -qF 'Script not found' "$SUBDIR_DEFAULT_OUT"; then
  head -c 2000 "$SUBDIR_DEFAULT_OUT" >&2
  fail "subdirectory default-mode doctor failed harness:check (U1: bare script name not found from subdir)"
fi
if grep -qE '^FAIL: harness manifest parity' "$SUBDIR_DEFAULT_OUT"; then
  head -c 2000 "$SUBDIR_DEFAULT_OUT" >&2
  fail "subdirectory default-mode doctor reported harness parity as FAILED (U1 regression)"
fi
ok "default-mode doctor runs harness:check from a nested subdir"

# Default mode must NOT emit JSON to stdout.
if jq -e . <"$DEFAULT_OUT" >/dev/null 2>&1; then
  fail "default-mode stdout unexpectedly parses as JSON"
fi
ok "default-mode stdout is human-readable, not JSON"

# --- empty-envelope contract -----------------------------------------------
# Doctor's real findings list is rarely empty in a working repo, so we cannot
# rely on the live invocation above to exercise the empty-findings path.
# Drive the shared emitter directly with an empty NDJSON stream and assert
# the envelope shape that any --json consumer will see when every sub-check
# is clean.
EMPTY_ENV="$(mktemp)"
EMITTER="$REPO_ROOT/scripts/harness-emit-envelope.ts"
bun run "$EMITTER" --tool doctor </dev/null >"$EMPTY_ENV" 2>/dev/null \
  || { head -c 2000 "$EMPTY_ENV" >&2; fail "harness-emit-envelope rejected an empty doctor stream"; }
jq -e '
  (.tool == "doctor") and
  (.version == "1") and
  (.findings | type == "array" and length == 0) and
  (.summary.blocking == 0) and
  (.summary.warning  == 0) and
  (.summary.info     == 0) and
  (.summary.byControl | type == "object")
' "$EMPTY_ENV" >/dev/null \
  || { head -c 2000 "$EMPTY_ENV" >&2; fail "empty-findings envelope shape is wrong"; }
ok "empty-findings doctor envelope passes schema and reports zeroed summary"

# --- BLOCK prefix is report-only in JSON -------------------------------------
# Isolate doctor in a tiny git repo so the only finding is a synthetic
# `BLOCK:` line from the blob-size subcommand.
BLOCK_ROOT="$(mktemp -d)"
BLOCK_JSON="$(mktemp)"
BLOCK_ERR="$(mktemp)"
BLOCK_FAKE_BIN="$(mktemp -d)"
git -C "$BLOCK_ROOT" init -q
mkdir -p "$BLOCK_ROOT/.devcontainer" "$BLOCK_ROOT/node_modules/.bin" "$BLOCK_ROOT/scripts/git"
printf 'JWT_SECRET=synthetic-doctor-json-secret\n' >"$BLOCK_ROOT/.devcontainer/.env"
touch "$BLOCK_ROOT/bun.lock"
touch "$BLOCK_ROOT/node_modules/.bin"

for fake_script in worktree-db.sh eslint-disable-register.sh suppression-register.sh; do
  cat >"$BLOCK_ROOT/scripts/$fake_script" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic clean check\n'
SH
  chmod +x "$BLOCK_ROOT/scripts/$fake_script"
done

cat >"$BLOCK_ROOT/scripts/git/check-lint-ratchet-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic lint-ratchet merge-driver health\n'
SH
chmod +x "$BLOCK_ROOT/scripts/git/check-lint-ratchet-merge-driver.sh"

cat >"$BLOCK_ROOT/scripts/git/check-knip-unused-exports-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic knip unused-exports merge-driver health\n'
SH
chmod +x "$BLOCK_ROOT/scripts/git/check-knip-unused-exports-merge-driver.sh"

cat >"$BLOCK_ROOT/scripts/git/check-max-lines-exceptions-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic max-lines exceptions merge-driver health\n'
SH
chmod +x "$BLOCK_ROOT/scripts/git/check-max-lines-exceptions-merge-driver.sh"

cat >"$BLOCK_ROOT/scripts/git/check-near-duplicates-merge-driver.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic near-duplicates merge-driver health\n'
SH
chmod +x "$BLOCK_ROOT/scripts/git/check-near-duplicates-merge-driver.sh"

cat >"$BLOCK_ROOT/scripts/migration-safety-scan.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--json" ]; then
  printf '{"findings":[],"summary":{"blocking":0,"warning":0,"info":0}}\n'
else
  printf 'PASS: synthetic clean migration safety\n'
fi
SH
chmod +x "$BLOCK_ROOT/scripts/migration-safety-scan.sh"

cat >"$BLOCK_FAKE_BIN/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "run" ]; then
  case "${2:-}" in
    drift:ai)
      if [ "${3:-}" = "harness-freshness" ]; then
        exit 0
      fi
      ;;
    sensor:knip)
      exit 0
      ;;
    sensor:blob-size)
      printf 'BLOCK: synthetic staged blob exceeds limit\n'
      exit 0
      ;;
    sensor:context-budget)
      exit 0
      ;;
    */scripts/db-status.ts)
      printf 'PASS: synthetic db status clean\n'
      exit 0
      ;;
    harness:check)
      # Bare-name form is cwd-fragile (U1); doctor invokes the module path.
      printf 'error: Script not found "harness:check"\n' >&2
      exit 1
      ;;
    *harness-check.ts)
      exit 0
      ;;
  esac
fi
exec "${REAL_BUN:?}" "$@"
SH
chmod +x "$BLOCK_FAKE_BIN/bun"
cat >"$BLOCK_FAKE_BIN/ss" <<'SH'
#!/usr/bin/env bash
exit 1
SH
chmod +x "$BLOCK_FAKE_BIN/ss"
make_fake_lint_tools "$BLOCK_FAKE_BIN"

BLOCK_EXIT=0
(
  cd "$BLOCK_ROOT"
  REAL_BUN="$REAL_BUN" PATH="$BLOCK_FAKE_BIN:$PATH" \
    bash "$SCRIPT" --json >"$BLOCK_JSON" 2>"$BLOCK_ERR"
) || BLOCK_EXIT=$?
[ "$BLOCK_EXIT" -eq 0 ] \
  || { cat "$BLOCK_JSON" >&2; cat "$BLOCK_ERR" >&2; fail "BLOCK-only doctor --json should exit 0, got $BLOCK_EXIT"; }
jq -e '
  (.findings | length == 1) and
  (.findings[0].control == "sensor/blob-size") and
  (.findings[0].severity == "warn") and
  (.findings[0].why == "synthetic staged blob exceeds limit") and
  (.summary.blocking == 0) and
  (.summary.warning == 1)
' "$BLOCK_JSON" >/dev/null \
  || { cat "$BLOCK_JSON" >&2; cat "$BLOCK_ERR" >&2; fail "BLOCK line should emit one warn-severity finding"; }
ok "BLOCK-only doctor --json run exits 0 and maps BLOCK to warn"

# --- harness:check failure is represented in JSON ---------------------------
# JSON mode must not produce an apparently clean envelope when harness:check
# exits non-zero. Reuse the fast fixture and flip only the harness-check
# branch in its fake bun wrapper.

HARNESS_FAIL_JSON="$(mktemp)"
HARNESS_FAIL_ERR="$(mktemp)"
HARNESS_FAIL_EXIT=0
(
  cd "$FAST_ROOT"
  DOCTOR_JSON_FORCE_HARNESS_FAIL=1 REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash "$SCRIPT" --json >"$HARNESS_FAIL_JSON" 2>"$HARNESS_FAIL_ERR"
) || HARNESS_FAIL_EXIT=$?
[ "$HARNESS_FAIL_EXIT" -eq 1 ] \
  || fail "doctor --json should exit 1 when harness:check fails, got $HARNESS_FAIL_EXIT"
jq -e '
  .findings
  | any(
      .control == "verify-wrapper/doctor"
      and .severity == "block"
      and .messageId == "harness-check-failed"
      and (.why | contains("forced harness check stdout"))
      and (.why | contains("forced harness check stderr"))
    )
' "$HARNESS_FAIL_JSON" >/dev/null \
  || { cat "$HARNESS_FAIL_JSON" >&2; cat "$HARNESS_FAIL_ERR" >&2; fail "harness:check failure missing blocking doctor finding"; }
ok "harness:check failure emits a blocking doctor finding in --json mode"

# --- knip report-only sensor: findings (rc=1) vs crash (rc=2) ----------------
# run_report_subcommand (only caller: sensor:knip) must distinguish knip's
# exit codes in --json mode: rc=1 is report-only findings (carry a bounded
# output excerpt in the finding), rc>=2 is a tool crash (a distinct finding, not
# a report-only warn). Report-only sensors never gate doctor's exit, so both
# must keep the same exit code the clean fast run produced ($DOCTOR_EXIT).
KNIP_FINDINGS_JSON="$(mktemp)"
KNIP_FINDINGS_ERR="$(mktemp)"
KNIP_FINDINGS_EXIT=0
(
  cd "$FAST_ROOT"
  DOCTOR_JSON_KNIP_EXIT=1 \
    DOCTOR_JSON_KNIP_OUTPUT='Unused exports (2)
packages/server/src/foo.ts:10:3  bar
packages/server/src/baz.ts:4:1  qux' \
    REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash "$SCRIPT" --json >"$KNIP_FINDINGS_JSON" 2>"$KNIP_FINDINGS_ERR"
) || KNIP_FINDINGS_EXIT=$?
[ "$KNIP_FINDINGS_EXIT" = "$DOCTOR_EXIT" ] \
  || { cat "$KNIP_FINDINGS_JSON" >&2; cat "$KNIP_FINDINGS_ERR" >&2; fail "knip rc=1 must preserve report-only exit policy (expected $DOCTOR_EXIT, got $KNIP_FINDINGS_EXIT)"; }
jq -e '
  .findings
  | any(
      .control == "sensor/knip"
      and .severity == "warn"
      and (.messageId | test("crash") | not)
      and (.why | contains("report-only"))
      and (.why | contains("packages/server/src/foo.ts"))
    )
' "$KNIP_FINDINGS_JSON" >/dev/null \
  || { cat "$KNIP_FINDINGS_JSON" >&2; fail "knip rc=1 should emit a report-only warn carrying an output excerpt in why"; }
ok "knip rc=1 emits a report-only warn carrying an output excerpt"

KNIP_CRASH_JSON="$(mktemp)"
KNIP_CRASH_ERR="$(mktemp)"
KNIP_CRASH_EXIT=0
(
  cd "$FAST_ROOT"
  DOCTOR_JSON_KNIP_EXIT=2 \
    DOCTOR_JSON_KNIP_OUTPUT='Error: could not load knip config from knip.json' \
    REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash "$SCRIPT" --json >"$KNIP_CRASH_JSON" 2>"$KNIP_CRASH_ERR"
) || KNIP_CRASH_EXIT=$?
[ "$KNIP_CRASH_EXIT" = "$DOCTOR_EXIT" ] \
  || { cat "$KNIP_CRASH_JSON" >&2; cat "$KNIP_CRASH_ERR" >&2; fail "knip rc=2 crash must preserve report-only exit policy (expected $DOCTOR_EXIT, got $KNIP_CRASH_EXIT)"; }
jq -e '
  .findings
  | any(
      .control == "sensor/knip"
      and (.messageId | test("crash"))
      and (.why | test("crashed|did not"))
    )
' "$KNIP_CRASH_JSON" >/dev/null \
  || { cat "$KNIP_CRASH_JSON" >&2; fail "knip rc=2 should emit a distinct sensor-crashed finding, not a report-only warn"; }
ok "knip rc=2 crash emits a distinct sensor-crashed finding"

# The two nonzero branches must be distinguishable to a consumer (messageId).
KNIP_FINDINGS_MID="$(jq -r '.findings[] | select(.control=="sensor/knip") | .messageId' "$KNIP_FINDINGS_JSON")"
KNIP_CRASH_MID="$(jq -r '.findings[] | select(.control=="sensor/knip") | .messageId' "$KNIP_CRASH_JSON")"
[ -n "$KNIP_FINDINGS_MID" ] && [ -n "$KNIP_CRASH_MID" ] && [ "$KNIP_FINDINGS_MID" != "$KNIP_CRASH_MID" ] \
  || fail "knip rc=1 and rc=2 must yield distinguishable messageIds (got '$KNIP_FINDINGS_MID' vs '$KNIP_CRASH_MID')"
ok "knip rc=1 and rc=2 produce distinguishable findings"
rm -f "$KNIP_FINDINGS_JSON" "$KNIP_FINDINGS_ERR" "$KNIP_CRASH_JSON" "$KNIP_CRASH_ERR"

# --- conflict-marker presentation through doctor ---------------------------
# Clone the live tree so the baseline can contain real conflict markers without
# mutating the caller's worktree. Overlay the current harness boundary (which
# may be uncommitted while this test drives TDD), share node_modules, and keep
# the unrelated doctor probes synthetic so this remains a focused integration.
MARKER_ROOT="$(mktemp -d)"
git clone -q --shared "$REPO_ROOT" "$MARKER_ROOT"
cp "$REPO_ROOT/scripts/harness-check.ts" "$MARKER_ROOT/scripts/harness-check.ts"
cp "$REPO_ROOT/scripts/harness/local-rule-config.ts" \
  "$MARKER_ROOT/scripts/harness/local-rule-config.ts"
cp "$REPO_ROOT/eslint-config/shared-policy.js" "$MARKER_ROOT/eslint-config/shared-policy.js"
ln -s "$REPO_ROOT/node_modules" "$MARKER_ROOT/node_modules"
cp -R "$FAST_ROOT/.devcontainer" "$MARKER_ROOT/.devcontainer"
cp "$FAST_ROOT/.env" "$MARKER_ROOT/.env"
cp "$FAST_ROOT/packages/client/.env" "$MARKER_ROOT/packages/client/.env"
for fake_script in worktree-db.sh suppression-register.sh eslint-disable-register.sh migration-safety-scan.sh; do
  cp "$FAST_ROOT/scripts/$fake_script" "$MARKER_ROOT/scripts/$fake_script"
done
for driver_check in check-lint-ratchet-merge-driver.sh check-knip-unused-exports-merge-driver.sh check-max-lines-exceptions-merge-driver.sh check-near-duplicates-merge-driver.sh; do
  cp "$FAST_ROOT/scripts/git/$driver_check" "$MARKER_ROOT/scripts/git/$driver_check"
done
printf '%s\n' \
  '<<<<<<< ours' \
  '{"version":2}' \
  '=======' \
  '{"version":2}' \
  '>>>>>>> theirs' \
  >"$MARKER_ROOT/eslint-config/max-lines-exceptions.baseline.json"

# Backticks are literal CLI guidance.
# shellcheck disable=SC2016
MARKER_MESSAGE='eslint-config/max-lines-exceptions.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:max-lines-exceptions:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then reconcile entries from both sides and normalize with `bun run lint:max-lines-exceptions:update`; never hand-merge conflict markers in this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.'
MARKER_PLAIN="$(mktemp)"
MARKER_PLAIN_EXIT=0
(
  cd "$MARKER_ROOT"
  CI=1 DOCTOR_JSON_RUN_REAL_HARNESS=1 REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash scripts/doctor.sh >"$MARKER_PLAIN" 2>&1
) || MARKER_PLAIN_EXIT=$?
[ "$MARKER_PLAIN_EXIT" -eq 1 ] \
  || fail "doctor with a conflict-marker baseline should exit 1, got $MARKER_PLAIN_EXIT"
grep -qF "$MARKER_MESSAGE" "$MARKER_PLAIN" \
  || { cat "$MARKER_PLAIN" >&2; fail "plain doctor omitted conflict-marker recovery"; }
if grep -qF 'SyntaxError' "$MARKER_PLAIN" || grep -qE '^[[:space:]]*at ' "$MARKER_PLAIN"; then
  cat "$MARKER_PLAIN" >&2
  fail "plain doctor leaked a raw stack for conflict markers"
fi
ok "plain doctor presents conflict-marker recovery without a stack"

MARKER_JSON="$(mktemp)"
MARKER_JSON_ERR="$(mktemp)"
MARKER_JSON_EXIT=0
(
  cd "$MARKER_ROOT"
  CI=1 DOCTOR_JSON_RUN_REAL_HARNESS=1 REAL_BUN="$REAL_BUN" PATH="$FAST_FAKE_BIN:$PATH" \
    bash scripts/doctor.sh --json >"$MARKER_JSON" 2>"$MARKER_JSON_ERR"
) || MARKER_JSON_EXIT=$?
[ "$MARKER_JSON_EXIT" -eq 1 ] \
  || fail "doctor --json with a conflict-marker baseline should exit 1, got $MARKER_JSON_EXIT"
jq -e --arg message "$MARKER_MESSAGE" '
  .findings
  | any(
      .messageId == "harness-check-failed"
      and (.why | contains($message))
      and (.why | contains("SyntaxError") | not)
      and (.why | test("(^|\\n)[[:space:]]*at ") | not)
    )
' "$MARKER_JSON" >/dev/null \
  || { cat "$MARKER_JSON" >&2; cat "$MARKER_JSON_ERR" >&2; fail "doctor --json did not cleanly present conflict-marker recovery"; }
if grep -qF 'SyntaxError' "$MARKER_JSON_ERR" || grep -qE '^[[:space:]]*at ' "$MARKER_JSON_ERR"; then
  cat "$MARKER_JSON_ERR" >&2
  fail "doctor --json leaked a raw stack to stderr for conflict markers"
fi
ok "doctor --json presents conflict-marker recovery without a stack"

# --- lint-tools missing-tool scenario ---------------------------------------
# Strip node_modules/.bin from PATH and omit the npm-tool stubs so the
# npm-managed lint tools are unresolvable. node-actionlint is npm-only, so it is
# guaranteed missing; assert doctor flips its row to a warn finding under
# doctor-check/lint-tools without crashing.
LINT_MISSING_BIN="$(mktemp -d)"
cp "$FAST_FAKE_BIN/bun" "$LINT_MISSING_BIN/bun"
cp "$FAST_FAKE_BIN/ss" "$LINT_MISSING_BIN/ss"
LINT_MISSING_CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'node_modules/.bin' | paste -sd: -)"
LINT_MISSING_JSON="$(mktemp)"
LINT_MISSING_ERR="$(mktemp)"
LINT_MISSING_EXIT=0
(
  cd "$FAST_ROOT"
  REAL_BUN="$REAL_BUN" PATH="$LINT_MISSING_BIN:$LINT_MISSING_CLEAN_PATH" \
    bash "$SCRIPT" --json >"$LINT_MISSING_JSON" 2>"$LINT_MISSING_ERR"
) || LINT_MISSING_EXIT=$?
{ [ "$LINT_MISSING_EXIT" -eq 0 ] || [ "$LINT_MISSING_EXIT" -eq 1 ]; } \
  || fail "lint-tools missing-tool doctor --json exit must be 0 or 1, got $LINT_MISSING_EXIT"
jq -e . <"$LINT_MISSING_JSON" >/dev/null \
  || { cat "$LINT_MISSING_JSON" >&2; cat "$LINT_MISSING_ERR" >&2; fail "missing-tool doctor --json did not parse"; }
jq -e '
  .findings
  | any(
      .control == "doctor-check/lint-tools"
      and .severity == "warn"
      and (.why | contains("node-actionlint"))
    )
' "$LINT_MISSING_JSON" >/dev/null \
  || { cat "$LINT_MISSING_JSON" >&2; cat "$LINT_MISSING_ERR" >&2; fail "missing node-actionlint should warn under doctor-check/lint-tools"; }
ok "missing lint tool emits a warn finding under doctor-check/lint-tools"
rm -rf "$LINT_MISSING_BIN"
rm -f "$LINT_MISSING_JSON" "$LINT_MISSING_ERR"

# --- lint-tools honors MUSI_*_BIN overrides (parity with lint-config-sensors) -
# lint-config-sensors.sh resolves MUSI_ACTIONLINT_BIN / MUSI_TAPLO_BIN /
# MUSI_HADOLINT_BIN ahead of node_modules/.bin and PATH (command_from_env_or_path),
# so the doctor inventory must mirror that or it falsely warns "missing" for a tool
# the lint lane will happily use. Strip node_modules/.bin and the npm-tool stubs so
# node-actionlint is otherwise unresolvable, point the override at a stub, and assert
# doctor reports the override path instead of warning.
LINT_OVERRIDE_BIN="$(mktemp -d)"
cp "$FAST_FAKE_BIN/bun" "$LINT_OVERRIDE_BIN/bun"
cp "$FAST_FAKE_BIN/ss" "$LINT_OVERRIDE_BIN/ss"
LINT_OVERRIDE_ACTIONLINT="$LINT_OVERRIDE_BIN/override-node-actionlint"
cat >"$LINT_OVERRIDE_ACTIONLINT" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$LINT_OVERRIDE_ACTIONLINT"
LINT_OVERRIDE_CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'node_modules/.bin' | paste -sd: -)"
LINT_OVERRIDE_OUT="$(mktemp)"
LINT_OVERRIDE_EXIT=0
(
  cd "$FAST_ROOT"
  REAL_BUN="$REAL_BUN" MUSI_ACTIONLINT_BIN="$LINT_OVERRIDE_ACTIONLINT" \
    PATH="$LINT_OVERRIDE_BIN:$LINT_OVERRIDE_CLEAN_PATH" \
    bash "$SCRIPT" >"$LINT_OVERRIDE_OUT" 2>&1
) || LINT_OVERRIDE_EXIT=$?
{ [ "$LINT_OVERRIDE_EXIT" -eq 0 ] || [ "$LINT_OVERRIDE_EXIT" -eq 1 ]; } \
  || fail "lint-tools override doctor exit must be 0 or 1, got $LINT_OVERRIDE_EXIT"
grep -qF "$LINT_OVERRIDE_ACTIONLINT" "$LINT_OVERRIDE_OUT" \
  || { head -c 2000 "$LINT_OVERRIDE_OUT" >&2; fail "doctor must resolve node-actionlint via the MUSI_ACTIONLINT_BIN override"; }
if grep -q 'node-actionlint not found' "$LINT_OVERRIDE_OUT"; then
  head -c 2000 "$LINT_OVERRIDE_OUT" >&2
  fail "override-resolved node-actionlint must not warn missing"
fi
ok "lint-tools inventory honors MUSI_ACTIONLINT_BIN override"
rm -rf "$LINT_OVERRIDE_BIN"
rm -f "$LINT_OVERRIDE_OUT"

# --- cleanup ----------------------------------------------------------------
rm -f "$DOCTOR_JSON" "$DOCTOR_STDERR" "$REGISTERED_CONTROLS" "$EMITTED_CONTROLS" "$SUBDIR_JSON" "$SUBDIR_ERR" "$DEFAULT_OUT" "$EMPTY_ENV" "$BLOCK_JSON" "$BLOCK_ERR" "$HARNESS_FAIL_JSON" "$HARNESS_FAIL_ERR" "$MARKER_PLAIN" "$MARKER_JSON" "$MARKER_JSON_ERR" /tmp/doctor-help.out /tmp/doctor-bad.out
rm -rf "$FAST_ROOT" "$FAST_FAKE_BIN" "$BLOCK_ROOT" "$BLOCK_FAKE_BIN" "$MARKER_ROOT"

printf '\n%d/%d tests passed\n' "$PASS" "$PASS"
