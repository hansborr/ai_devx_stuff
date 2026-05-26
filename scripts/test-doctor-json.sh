#!/usr/bin/env bash
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
# Run via `bash scripts/test-doctor-json.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./test-git-env.sh
. "$SCRIPT_DIR/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
SCRIPT="$SCRIPT_DIR/doctor.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MANIFEST="$REPO_ROOT/harness.controls.json"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

command -v jq >/dev/null 2>&1 || fail "jq is required for these tests"

REAL_BUN="$(command -v bun)"
FAST_ROOT="$(mktemp -d)"
FAST_FAKE_BIN="$(mktemp -d)"

setup_fast_doctor_fixture() {
  git -C "$FAST_ROOT" init -q
  mkdir -p \
    "$FAST_ROOT/.devcontainer" \
    "$FAST_ROOT/node_modules/.bin" \
    "$FAST_ROOT/packages/client" \
    "$FAST_ROOT/scripts"
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

  for fake_script in worktree-db.sh db-status.sh suppression-register.sh; do
    cat >"$FAST_ROOT/scripts/$fake_script" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic clean check\n'
SH
    chmod +x "$FAST_ROOT/scripts/$fake_script"
  done

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
      exit 0
      ;;
    sensor:blob-size)
      printf 'PASS: synthetic blob-size clean\n'
      exit 0
      ;;
    harness:check)
      if [ "${DOCTOR_JSON_FORCE_HARNESS_FAIL:-0}" = "1" ]; then
        printf 'forced harness check stdout\n'
        printf 'forced harness check stderr\n' >&2
        exit 1
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
mkdir -p "$BLOCK_ROOT/.devcontainer" "$BLOCK_ROOT/node_modules/.bin" "$BLOCK_ROOT/scripts"
printf 'JWT_SECRET=synthetic-doctor-json-secret\n' >"$BLOCK_ROOT/.devcontainer/.env"
touch "$BLOCK_ROOT/bun.lock"
touch "$BLOCK_ROOT/node_modules/.bin"

for fake_script in worktree-db.sh db-status.sh eslint-disable-register.sh suppression-register.sh; do
  cat >"$BLOCK_ROOT/scripts/$fake_script" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PASS: synthetic clean check\n'
SH
  chmod +x "$BLOCK_ROOT/scripts/$fake_script"
done

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
    harness:check)
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

# --- cleanup ----------------------------------------------------------------
rm -f "$DOCTOR_JSON" "$DOCTOR_STDERR" "$REGISTERED_CONTROLS" "$EMITTED_CONTROLS" "$DEFAULT_OUT" "$EMPTY_ENV" "$BLOCK_JSON" "$BLOCK_ERR" "$HARNESS_FAIL_JSON" "$HARNESS_FAIL_ERR" /tmp/doctor-help.out /tmp/doctor-bad.out
rm -rf "$FAST_ROOT" "$FAST_FAKE_BIN" "$BLOCK_ROOT" "$BLOCK_FAKE_BIN"

printf '\n%d/%d tests passed\n' "$PASS" "$PASS"
