#!/usr/bin/env bash
# smoke-order: 420
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-metadata-core.ts
# smoke-subjects: scripts/lib/fixtures/verify-metadata-core-corpus.json
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-verify-metadata.sh
# test-verify-metadata.sh — pure-shell smoke tests for scripts/lib/verify-metadata.sh.
#
# Exercises the pure helper functions (marker read/write/match, fingerprinting,
# changed-gate) directly, using small git fixture repos for the fingerprint and
# gate cases. Run via `bash scripts/tests/test-verify-metadata.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-verify-metadata.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

# shellcheck source=../lib/verify-metadata.sh
source "$VERIFY_METADATA"

# --- syntax check ------------------------------------------------------------
bash -n "$VERIFY_METADATA" || fail "verify-metadata.sh fails bash -n"
ok "verify-metadata.sh passes bash -n"

# --- valid marker constants ---------------------------------------------------
VALID_HASH="$(printf 'test' | sha256sum | awk '{print $1}')"
ZERO_HASH="0000000000000000000000000000000000000000000000000000000000000000"

# --- required fingerprints reject command and digest failures ----------------
fingerprint_ok() { printf '%s\n' "$VALID_HASH"; }
fingerprint_empty() { return 0; }
fingerprint_malformed() { printf 'not-a-digest\n'; }
fingerprint_failed() { return 87; }

required_fp=$(musi_require_fingerprint "test fingerprint" fingerprint_ok) \
  || fail "musi_require_fingerprint rejected a valid digest"
[ "$required_fp" = "$VALID_HASH" ] || fail "required fingerprint output changed"
for producer in fingerprint_empty fingerprint_malformed fingerprint_failed; do
  output_file="$SANDBOX/required-$producer.out"
  if musi_require_fingerprint "test fingerprint" "$producer" > "$output_file" 2>/dev/null; then
    fail "musi_require_fingerprint accepted $producer"
  fi
  [ ! -s "$output_file" ] || fail "musi_require_fingerprint emitted stdout for $producer"
done
ok "musi_require_fingerprint emits only successful 64-hex digests"

# =============================================================================
# musi_read_success_marker
# =============================================================================

# --- accepts valid marker with LAST_TS, LAST_HEAD, LAST_HASH -----------------
now=$(date +%s)
cat > "$SANDBOX/marker-ok" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
musi_read_success_marker "$SANDBOX/marker-ok" \
  || fail "musi_read_success_marker rejected valid marker"
[ "$MUSI_MARKER_LAST_TS" = "$now" ] || fail "LAST_TS mismatch: $MUSI_MARKER_LAST_TS"
[ "$MUSI_MARKER_LAST_HEAD" = "abc123" ] || fail "LAST_HEAD mismatch: $MUSI_MARKER_LAST_HEAD"
[ "$MUSI_MARKER_LAST_HASH" = "$VALID_HASH" ] || fail "LAST_HASH mismatch: $MUSI_MARKER_LAST_HASH"
ok "musi_read_success_marker accepts exactly LAST_TS, LAST_HEAD, LAST_HASH"

unset MUSI_MARKER_LAST_TS MUSI_MARKER_LAST_HEAD MUSI_MARKER_LAST_HASH

# --- rejects missing LAST_TS -------------------------------------------------
cat > "$SANDBOX/marker-no-ts" <<EOF
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-no-ts" 2>/dev/null; then
  fail "should reject marker missing LAST_TS"
fi
ok "musi_read_success_marker rejects missing LAST_TS"

# --- rejects missing LAST_HEAD ------------------------------------------------
cat > "$SANDBOX/marker-no-head" <<EOF
LAST_TS=$now
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-no-head" 2>/dev/null; then
  fail "should reject marker missing LAST_HEAD"
fi
ok "musi_read_success_marker rejects missing LAST_HEAD"

# --- rejects missing LAST_HASH ------------------------------------------------
cat > "$SANDBOX/marker-no-hash" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
EOF
if musi_read_success_marker "$SANDBOX/marker-no-hash" 2>/dev/null; then
  fail "should reject marker missing LAST_HASH"
fi
ok "musi_read_success_marker rejects missing LAST_HASH"

# --- rejects duplicate fields -------------------------------------------------
cat > "$SANDBOX/marker-dup-ts" <<EOF
LAST_TS=$now
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-dup-ts" 2>/dev/null; then
  fail "should reject marker with duplicate LAST_TS"
fi
ok "musi_read_success_marker rejects duplicate fields"

# --- rejects unknown keys -----------------------------------------------------
cat > "$SANDBOX/marker-unknown" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EXTRA=foo
EOF
if musi_read_success_marker "$SANDBOX/marker-unknown" 2>/dev/null; then
  fail "should reject marker with unknown key"
fi
ok "musi_read_success_marker rejects unknown keys"

# --- rejects malformed timestamp (non-numeric) --------------------------------
cat > "$SANDBOX/marker-bad-ts" <<EOF
LAST_TS=abc
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-bad-ts" 2>/dev/null; then
  fail "should reject non-numeric timestamp"
fi
ok "musi_read_success_marker rejects malformed timestamps"

# --- rejects zero timestamp ---------------------------------------------------
cat > "$SANDBOX/marker-zero-ts" <<EOF
LAST_TS=0
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-zero-ts" 2>/dev/null; then
  fail "should reject zero timestamp"
fi
ok "musi_read_success_marker rejects zero timestamp"

# --- rejects malformed hash (wrong length) ------------------------------------
cat > "$SANDBOX/marker-short-hash" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=abcdef0123456789
EOF
if musi_read_success_marker "$SANDBOX/marker-short-hash" 2>/dev/null; then
  fail "should reject hash with wrong length"
fi
ok "musi_read_success_marker rejects malformed hashes (wrong length)"

# --- rejects malformed hash (non-hex characters) ------------------------------
bad_hash="$(printf 'x%.0s' {1..64})"
cat > "$SANDBOX/marker-nonhex" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$bad_hash
EOF
if musi_read_success_marker "$SANDBOX/marker-nonhex" 2>/dev/null; then
  fail "should reject hash with non-hex characters"
fi
ok "musi_read_success_marker rejects malformed hashes (non-hex)"

# --- rejects nonexistent marker file ------------------------------------------
if musi_read_success_marker "$SANDBOX/marker-does-not-exist" 2>/dev/null; then
  fail "should reject nonexistent marker file"
fi
ok "musi_read_success_marker rejects nonexistent file"

# =============================================================================
# musi_success_marker_matches
# =============================================================================

now=$(date +%s)
cat > "$SANDBOX/marker-match" <<EOF
LAST_TS=$now
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF

# --- enforces head ------------------------------------------------------------
if musi_success_marker_matches "$SANDBOX/marker-match" "wrong-head" "$VALID_HASH" 120; then
  fail "should reject mismatched head"
fi
ok "musi_success_marker_matches enforces head"

# --- enforces hash ------------------------------------------------------------
if musi_success_marker_matches "$SANDBOX/marker-match" "correct-head" "$ZERO_HASH" 120; then
  fail "should reject mismatched hash"
fi
ok "musi_success_marker_matches enforces hash"

# --- enforces freshness (stale marker) ----------------------------------------
stale_ts=$((now - 200))
cat > "$SANDBOX/marker-stale" <<EOF
LAST_TS=$stale_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
if musi_success_marker_matches "$SANDBOX/marker-stale" "correct-head" "$VALID_HASH" 120; then
  fail "should reject stale marker beyond freshness window"
fi
ok "musi_success_marker_matches enforces freshness"

# --- accepts fresh matching marker --------------------------------------------
musi_success_marker_matches "$SANDBOX/marker-match" "correct-head" "$VALID_HASH" 120 \
  || fail "should accept fresh marker with matching head and hash"
ok "musi_success_marker_matches accepts fresh matching marker"

# --- rejects future timestamp (negative age) ----------------------------------
future_ts=$((now + 100))
cat > "$SANDBOX/marker-future" <<EOF
LAST_TS=$future_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
if musi_success_marker_matches "$SANDBOX/marker-future" "correct-head" "$VALID_HASH" 120; then
  fail "should reject marker with future timestamp"
fi
ok "musi_success_marker_matches rejects future timestamp (negative age)"

# =============================================================================
# Shared gate timing constants (leaf 3.3)
# =============================================================================

# --- constants expose the canonical budgets in one place ----------------------
[ "${MUSI_GATE_MARKER_FRESHNESS_SECONDS:-unset}" = "120" ] \
  || fail "MUSI_GATE_MARKER_FRESHNESS_SECONDS should be 120 (got '${MUSI_GATE_MARKER_FRESHNESS_SECONDS:-unset}')"
[ "${MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT:-unset}" = "1200" ] \
  || fail "MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT should be 1200 (got '${MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT:-unset}')"
[ "${MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS:-unset}" = "3600" ] \
  || fail "MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS should be 3600 (got '${MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS:-unset}')"
ok "shared gate timing constants expose the canonical 120/1200/3600 budgets"

# --- default freshness arg falls back to the shared constant ------------------
# With no 4th arg, musi_success_marker_matches must reuse
# MUSI_GATE_MARKER_FRESHNESS_SECONDS: a marker aged just inside the window is
# accepted and one just beyond it is rejected, pinning the default to the single
# source of truth rather than a re-typed literal.
inside_ts=$((now - (MUSI_GATE_MARKER_FRESHNESS_SECONDS - 5)))
cat > "$SANDBOX/marker-default-fresh" <<EOF
LAST_TS=$inside_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
musi_success_marker_matches "$SANDBOX/marker-default-fresh" "correct-head" "$VALID_HASH" \
  || fail "default freshness should accept a marker within the shared window"
ok "musi_success_marker_matches default freshness accepts within the shared window"

beyond_ts=$((now - (MUSI_GATE_MARKER_FRESHNESS_SECONDS + 5)))
cat > "$SANDBOX/marker-default-stale" <<EOF
LAST_TS=$beyond_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
if musi_success_marker_matches "$SANDBOX/marker-default-stale" "correct-head" "$VALID_HASH"; then
  fail "default freshness should reject a marker beyond the shared window"
fi
ok "musi_success_marker_matches default freshness rejects beyond the shared window"

# =============================================================================
# musi_write_success_marker
# =============================================================================

MARKER_WRITE="$SANDBOX/write-subdir/marker"
musi_write_success_marker "$MARKER_WRITE" "my-head" "$VALID_HASH" \
  || fail "musi_write_success_marker failed"
[ -f "$MARKER_WRITE" ] || fail "marker file not created"
grep -q '^LAST_TS=[0-9]\+$' "$MARKER_WRITE" || fail "marker missing valid LAST_TS line"
grep -q '^LAST_HEAD=my-head$' "$MARKER_WRITE" || fail "marker missing LAST_HEAD line"
grep -q "^LAST_HASH=${VALID_HASH}$" "$MARKER_WRITE" || fail "marker missing LAST_HASH line"
line_count=$(wc -l < "$MARKER_WRITE" | tr -d ' ')
[ "$line_count" -eq 3 ] || fail "marker should have exactly 3 lines, got $line_count"
musi_read_success_marker "$MARKER_WRITE" \
  || fail "written marker should pass musi_read_success_marker validation"
ok "musi_write_success_marker writes atomically shaped marker content"

INVALID_MARKER="$SANDBOX/write-subdir/invalid-marker"
if musi_write_success_marker "$INVALID_MARKER" "my-head" "" 2>/dev/null; then
  fail "musi_write_success_marker accepted an empty fingerprint"
fi
[ ! -e "$INVALID_MARKER" ] || fail "invalid success marker was written"
ok "musi_write_success_marker refuses invalid fingerprints"

# =============================================================================
# musi_restamp_verify_marker
# =============================================================================

MERGE_HASH="$(printf 'merge' | sha256sum | awk '{print $1}')"

# --- re-stamps a FRESH matching-fingerprint marker onto the merge HEAD --------
mkdir -p "$SANDBOX/restamp"
RESTAMP_MARKER="$SANDBOX/restamp/marker"
now=$(date +%s)
fresh=$((now - 5))
cat > "$RESTAMP_MARKER" <<EOF
LAST_TS=$fresh
LAST_HEAD=branch-tip
LAST_HASH=$VALID_HASH
EOF
musi_restamp_verify_marker "$RESTAMP_MARKER" "$VALID_HASH" "merge-head" "$MERGE_HASH" \
  "branch-tip" 120 \
  || fail "musi_restamp_verify_marker refused a fresh matching-fingerprint re-stamp"
musi_read_success_marker "$RESTAMP_MARKER" || fail "re-stamped marker is unreadable"
[ "$MUSI_MARKER_LAST_HEAD" = "merge-head" ] \
  || fail "re-stamp did not update LAST_HEAD: $MUSI_MARKER_LAST_HEAD"
[ "$MUSI_MARKER_LAST_HASH" = "$MERGE_HASH" ] \
  || fail "re-stamp did not update LAST_HASH: $MUSI_MARKER_LAST_HASH"
[ "$MUSI_MARKER_LAST_TS" -ge "$fresh" ] || fail "re-stamp did not refresh LAST_TS"
# The re-stamped marker must satisfy the pre-push marker check for the merge HEAD.
musi_success_marker_matches "$RESTAMP_MARKER" "merge-head" "$MERGE_HASH" 120 \
  || fail "re-stamped marker should satisfy musi_success_marker_matches for the merge HEAD"
ok "musi_restamp_verify_marker re-stamps a fresh matching-fingerprint marker onto the merge HEAD"

# --- refuses (and leaves untouched) a STALE marker aged beyond freshness ------
# Same HEAD + hash, but written outside the freshness window: an aged pass must
# be refused, not resurrected with a fresh timestamp.
RESTAMP_STALE="$SANDBOX/restamp/stale"
now=$(date +%s)
stale=$((now - 500))
cat > "$RESTAMP_STALE" <<EOF
LAST_TS=$stale
LAST_HEAD=branch-tip
LAST_HASH=$VALID_HASH
EOF
if musi_restamp_verify_marker "$RESTAMP_STALE" "$VALID_HASH" "merge-head" "$MERGE_HASH" \
     "branch-tip" 120 2>/dev/null; then
  fail "should refuse re-stamp when the source marker is stale beyond freshness"
fi
musi_read_success_marker "$RESTAMP_STALE" || fail "refused stale marker became unreadable"
[ "$MUSI_MARKER_LAST_HEAD" = "branch-tip" ] \
  || fail "refused re-stamp must leave LAST_HEAD untouched: $MUSI_MARKER_LAST_HEAD"
[ "$MUSI_MARKER_LAST_TS" = "$stale" ] \
  || fail "refused re-stamp must leave stale LAST_TS untouched: $MUSI_MARKER_LAST_TS"
ok "musi_restamp_verify_marker refuses a stale source marker and leaves it untouched"

# --- refuses when the verified HEAD does not match the marker -----------------
RESTAMP_HEAD="$SANDBOX/restamp/head"
now=$(date +%s)
fresh=$((now - 5))
cat > "$RESTAMP_HEAD" <<EOF
LAST_TS=$fresh
LAST_HEAD=branch-tip
LAST_HASH=$VALID_HASH
EOF
if musi_restamp_verify_marker "$RESTAMP_HEAD" "$VALID_HASH" "merge-head" "$MERGE_HASH" \
     "other-head" 120 2>/dev/null; then
  fail "should refuse re-stamp when the verified HEAD differs from the marker"
fi
musi_read_success_marker "$RESTAMP_HEAD" || fail "refused head-mismatch marker became unreadable"
[ "$MUSI_MARKER_LAST_HEAD" = "branch-tip" ] \
  || fail "head-mismatch refusal must leave LAST_HEAD untouched: $MUSI_MARKER_LAST_HEAD"
ok "musi_restamp_verify_marker refuses when the verified HEAD does not match the marker"

# --- refuses when the recorded fingerprint does not match ---------------------
RESTAMP_REFUSE="$SANDBOX/restamp/refuse"
now=$(date +%s)
fresh=$((now - 5))
cat > "$RESTAMP_REFUSE" <<EOF
LAST_TS=$fresh
LAST_HEAD=branch-tip
LAST_HASH=$VALID_HASH
EOF
if musi_restamp_verify_marker "$RESTAMP_REFUSE" "$ZERO_HASH" "merge-head" "$MERGE_HASH" \
     "branch-tip" 120 2>/dev/null; then
  fail "should refuse re-stamp when recorded fingerprint differs from expected"
fi
musi_read_success_marker "$RESTAMP_REFUSE" || fail "refused marker became unreadable"
[ "$MUSI_MARKER_LAST_HEAD" = "branch-tip" ] \
  || fail "refused re-stamp must leave LAST_HEAD untouched: $MUSI_MARKER_LAST_HEAD"
[ "$MUSI_MARKER_LAST_HASH" = "$VALID_HASH" ] \
  || fail "refused re-stamp must leave LAST_HASH untouched: $MUSI_MARKER_LAST_HASH"
ok "musi_restamp_verify_marker refuses a non-matching fingerprint and leaves the marker untouched"

# --- refuses when there is no prior full-verify marker ------------------------
if musi_restamp_verify_marker "$SANDBOX/restamp/none" "$VALID_HASH" "merge-head" "$MERGE_HASH" \
     "branch-tip" 120 2>/dev/null; then
  fail "should refuse re-stamp when no prior marker exists"
fi
ok "musi_restamp_verify_marker refuses when there is no prior full-verify marker"

# =============================================================================
# musi_restamp_verify_wrapper
# =============================================================================

mkdir -p "$SANDBOX/wrapper"
WRAP="$SANDBOX/wrapper/wrapper.json"
now=$(date +%s)
start_iso=$(date -d "@$((now - 300))" -Iseconds)
end_iso=$(date -d "@$((now - 60))" -Iseconds)

if musi_write_wrapper_meta "$WRAP" serial-verify "$((now - 300))" "$start_iso" \
  "$((now - 60))" "$end_iso" 0 "bun run verify" "branch-tip" "" 2>/dev/null; then
  fail "musi_write_wrapper_meta accepted an empty fingerprint"
fi
[ ! -e "$WRAP" ] || fail "invalid wrapper metadata was written"
ok "musi_write_wrapper_meta refuses invalid fingerprints"

# --- re-stamps head/fingerprint of a passing wrapper, keeping exit_code 0 -----
musi_write_wrapper_meta "$WRAP" serial-verify "$((now - 300))" "$start_iso" \
  "$((now - 60))" "$end_iso" 0 "bun run verify" "branch-tip" "$VALID_HASH"
musi_restamp_verify_wrapper "$WRAP" "merge-head" "$MERGE_HASH" \
  || fail "musi_restamp_verify_wrapper refused a passing wrapper"
wrap_json="$(sed -n '1p' "$WRAP")"
[ "$(musi_run_meta_json_string_field "$wrap_json" head)" = "merge-head" ] \
  || fail "wrapper re-stamp did not update head"
[ "$(musi_run_meta_json_string_field "$wrap_json" fingerprint)" = "$MERGE_HASH" ] \
  || fail "wrapper re-stamp did not update fingerprint"
[ "$(musi_run_meta_json_int_field "$wrap_json" exit_code)" = "0" ] \
  || fail "wrapper re-stamp must keep exit_code 0"
[ "$(musi_run_meta_json_string_field "$wrap_json" mode)" = "serial-verify" ] \
  || fail "wrapper re-stamp must preserve mode"
ok "musi_restamp_verify_wrapper re-stamps head/fingerprint and keeps a passing verdict"

# --- refuses to re-stamp a non-passing wrapper --------------------------------
musi_write_wrapper_meta "$WRAP" serial-verify "$((now - 300))" "$start_iso" \
  "$((now - 60))" "$end_iso" 1 "bun run verify" "branch-tip" "$VALID_HASH"
if musi_restamp_verify_wrapper "$WRAP" "merge-head" "$MERGE_HASH" 2>/dev/null; then
  fail "should refuse to re-stamp a non-passing (exit_code != 0) wrapper"
fi
wrap_json="$(sed -n '1p' "$WRAP")"
[ "$(musi_run_meta_json_string_field "$wrap_json" head)" = "branch-tip" ] \
  || fail "refused wrapper re-stamp must leave head untouched"
ok "musi_restamp_verify_wrapper refuses a non-passing wrapper and leaves it untouched"

# --- refuses when there is no wrapper file ------------------------------------
if musi_restamp_verify_wrapper "$SANDBOX/wrapper/absent.json" "merge-head" "$MERGE_HASH" 2>/dev/null; then
  fail "should refuse to re-stamp a missing wrapper file"
fi
ok "musi_restamp_verify_wrapper refuses when the wrapper file is missing"

# =============================================================================
# Run-meta codec shim seam (verify-metadata-core.ts)
# =============================================================================

# --- MUSI_VERIFY_META_CORE overrides the codec entrypoint resolution ----------
override_script=$(MUSI_VERIFY_META_CORE="$SANDBOX/custom-core.ts" musi_verify_meta_core_script)
[ "$override_script" = "$SANDBOX/custom-core.ts" ] \
  || fail "MUSI_VERIFY_META_CORE should override the codec path: $override_script"
default_script=$(musi_verify_meta_core_script)
[ "$default_script" = "$SCRIPT_DIR/../lib/verify-metadata-core.ts" ] \
  || case "$default_script" in
    */scripts/lib/verify-metadata-core.ts) ;;
    *) fail "default codec resolution should land in scripts/lib: $default_script" ;;
  esac
ok "musi_verify_meta_core_script honors the MUSI_VERIFY_META_CORE seam"

# --- writer shims fail closed when the codec spawn fails ----------------------
# A broken bun (or missing entrypoint) must never truncate or half-write a
# metadata file: writers return nonzero without touching the target, and the
# extractors fall back to the legacy empty-output/exit-0 no-match surface.
BROKEN_BUN="$SANDBOX/no-such-bun"
if MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_write_step_meta "$SANDBOX/broken/step.json" \
  s m 1 t1 2 t2 0 cmd 2>/dev/null; then
  fail "musi_write_step_meta should fail when the codec spawn fails"
fi
[ ! -e "$SANDBOX/broken/step.json" ] || fail "failed step-meta spawn must not write a file"
if MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_write_wrapper_meta "$SANDBOX/broken/wrapper.json" \
  serial-verify 1 t1 2 t2 0 cmd head "$VALID_HASH" 2>/dev/null; then
  fail "musi_write_wrapper_meta should fail when the codec spawn fails"
fi
[ ! -e "$SANDBOX/broken/wrapper.json" ] || fail "failed wrapper-meta spawn must not write a file"
ok "writer shims fail closed without writing when the codec spawn fails"

# --- restamp leaves the wrapper untouched when the codec spawn fails ----------
BROKEN_WRAP="$SANDBOX/wrapper/broken-restamp.json"
musi_write_wrapper_meta "$BROKEN_WRAP" serial-verify "$((now - 300))" "$start_iso" \
  "$((now - 60))" "$end_iso" 0 "bun run verify" "branch-tip" "$VALID_HASH"
before_restamp=$(cat "$BROKEN_WRAP")
if MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_restamp_verify_wrapper "$BROKEN_WRAP" \
  "merge-head" "$MERGE_HASH" 2>/dev/null; then
  fail "musi_restamp_verify_wrapper should fail when the codec spawn fails"
fi
[ "$(cat "$BROKEN_WRAP")" = "$before_restamp" ] \
  || fail "failed restamp spawn must leave the wrapper untouched"
ok "musi_restamp_verify_wrapper leaves the wrapper untouched on codec spawn failure"

# --- extractors keep the legacy empty/exit-0 surface on codec failure ---------
frag_out=$(MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_run_meta_wrapper_fragment '{"wrapper":{}}' 2>/dev/null) \
  || fail "musi_run_meta_wrapper_fragment must return 0 on codec failure"
[ -z "$frag_out" ] || fail "failed fragment spawn must emit nothing: $frag_out"
field_out=$(MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_run_meta_json_string_field '{"mode":"x"}' mode 2>/dev/null) \
  || fail "musi_run_meta_json_string_field must return 0 on codec failure"
[ -z "$field_out" ] || fail "failed string-field spawn must emit nothing: $field_out"
ok "extractor shims keep the legacy empty-output surface on codec failure"

# --- short-circuit recording stays non-fatal on codec failure -----------------
sc_broken_hist="$SANDBOX/shortcircuit-broken"
MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_record_precommit_shortcircuit \
  "$sc_broken_hist" precommit-marker head "$VALID_HASH" precommit-marker 2>/dev/null \
  || fail "musi_record_precommit_shortcircuit must stay non-fatal on codec failure"
[ -z "$(find "$sc_broken_hist" -maxdepth 1 -type f -name '*.json' 2>/dev/null)" ] \
  || fail "failed short-circuit spawn must not produce a history entry"
ok "musi_record_precommit_shortcircuit stays non-fatal on codec spawn failure"

# --- argv-only writers must not block on an inherited readable stdin ----------
# Regression guard: the codec once read stdin unconditionally, so writer shims
# that spawn it argv-only hung forever when the caller's stdin was a terminal
# or held-open pipe (interactive `git commit`, foreground verify). Both sides
# now defend — the codec skips stdin for argv-only subcommands and the shims
# redirect from /dev/null. Hold a pipe open on stdin and require completion.
stdin_guard_dir="$SANDBOX/stdin-guard"
mkdir -p "$stdin_guard_dir"
if ! timeout 15 bash -c '
  set -eu
  exec < <(sleep 60)
  source "$1"
  musi_write_step_meta "$2/step.json" guard-step serial-verify 100 t0 105 t1 0 "echo hi"
  musi_write_wrapper_meta "$2/wrapper.json" serial-verify 100 t0 105 t1 0 "bun run verify" \
    guard-head "$3"
  musi_record_precommit_shortcircuit "$2/hist" precommit-marker guard-head "$3" precommit-marker
  # Direct spawn (no shim redirect) exercises the codec-side lazy stdin read.
  musi_verify_meta_core step-meta guard-direct m 1 t0 2 t1 0 cmd > /dev/null
' _ "$VERIFY_METADATA" "$stdin_guard_dir" "$VALID_HASH"; then
  fail "argv-only writer shims must complete with stdin held open (stdin-hang regression)"
fi
grep -q '"name":"guard-step"' "$stdin_guard_dir/step.json" \
  || fail "stdin-guard run must still write step metadata"
grep -q '"fingerprint"' "$stdin_guard_dir/wrapper.json" \
  || fail "stdin-guard run must still write wrapper metadata"
[ -n "$(find "$stdin_guard_dir/hist" -maxdepth 1 -type f -name '*.json' 2>/dev/null)" ] \
  || fail "stdin-guard run must still record the short-circuit history entry"
ok "argv-only writer shims complete with stdin held open (no stdin hang)"

# --- combine removes stale output instead of leaving it on codec failure ------
combine_dir="$SANDBOX/combine-broken"
mkdir -p "$combine_dir/meta"
printf '%s\n' '{"name":"lint","exit_code":0}' > "$combine_dir/meta/lint.json"
printf '%s\n' '{"stale":true}' > "$combine_dir/run-meta.json"
MUSI_VERIFY_META_BUN="$BROKEN_BUN" musi_combine_run_meta \
  "$combine_dir" serial-verify "$combine_dir/meta/wrapper.json" 2>/dev/null \
  || fail "musi_combine_run_meta must stay non-fatal on codec failure"
[ ! -e "$combine_dir/run-meta.json" ] \
  || fail "failed combine spawn must remove the stale run-meta.json"
musi_combine_run_meta "$combine_dir" serial-verify "$combine_dir/meta/wrapper.json"
grep -q '"wrapper":null' "$combine_dir/run-meta.json" \
  || fail "combine without a wrapper fragment should record wrapper null"
grep -q '"name":"lint"' "$combine_dir/run-meta.json" \
  || fail "combine should embed the step fragment"
ok "musi_combine_run_meta fails closed on spawn failure and combines otherwise"

# --- persist accepts the pre-port multi-line run-meta shape -------------------
legacy_dir="$SANDBOX/legacy-run-meta"
legacy_hist="$SANDBOX/legacy-history"
mkdir -p "$legacy_dir"
printf '%s\n%s\n%s\n' \
  '{"version":1,"mode":"serial-verify","generated_at":"x","wrapper":{"name":"wrapper","mode":"serial-verify","start_time":"2026-07-19T10:00:00+00:00","end_time":"2026-07-19T10:05:00+00:00","elapsed_seconds":300,"exit_code":0,"head":"h","fingerprint":"'"$VALID_HASH"'","command":"bun run verify"}' \
  ',"steps":[{"name":"lint","exit_code":0}' \
  ']}' > "$legacy_dir/run-meta.json"
musi_persist_run_meta_history "$legacy_dir" "$legacy_hist" \
  || fail "musi_persist_run_meta_history should stay non-fatal"
legacy_entry=$(find "$legacy_hist" -maxdepth 1 -type f -name '*-serial-verify-0.json' | head -1)
[ -n "$legacy_entry" ] \
  || fail "pre-port multi-line run-meta should still persist a history entry"
ok "musi_persist_run_meta_history parses pre-port multi-line run-meta documents"

# =============================================================================
# Fingerprinting — git fixture repos
# =============================================================================

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo"
  git -C "$SANDBOX" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name Test
  printf 'initial\n' > "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm init
  printf '%s\n' "$repo"
}

# --- standard state paths are scoped per worktree -----------------------------
repo="$(new_repo state-path-primary)"
sibling="$SANDBOX/state-path-sibling"
git -C "$repo" worktree add -q -b state-path-sibling "$sibling" HEAD
for helper in \
  musi_standard_precommit_marker \
  musi_standard_verify_changed_marker \
  musi_standard_verify_full_marker \
  musi_standard_verify_log_dir \
  musi_standard_verify_history_dir \
  musi_standard_verify_lock \
  musi_standard_bun_log_dir \
  musi_standard_bun_lock \
  musi_standard_git_commit_lock
do
  primary_path=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" "$helper" "$repo")
  sibling_path=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" "$helper" "$sibling")
  [ -n "$primary_path" ] || fail "$helper returned an empty path for primary worktree"
  [ -n "$sibling_path" ] || fail "$helper returned an empty path for sibling worktree"
  [ "$primary_path" != "$sibling_path" ] \
    || fail "$helper should differ for same-HEAD sibling worktrees: $primary_path"
done
ok "standard verification state paths are worktree-scoped"

# --- commit queue state path is scoped per Git common dir ---------------------
primary_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$repo")
sibling_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$sibling")
[ -n "$primary_queue" ] || fail "musi_standard_commit_queue_lock returned an empty path for primary worktree"
[ "$primary_queue" = "$sibling_queue" ] \
  || fail "commit queue lock should match for sibling worktrees: $primary_queue != $sibling_queue"
case "$primary_queue" in
  "$SANDBOX/default-state"/musi-commit-queue.lock.*) ;;
  *) fail "commit queue lock should honor MUSI_VERIFY_STATE_ROOT: $primary_queue" ;;
esac

unrelated_repo="$(new_repo state-path-unrelated)"
unrelated_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$unrelated_repo")
[ "$primary_queue" != "$unrelated_queue" ] \
  || fail "commit queue lock should differ for unrelated repositories: $primary_queue"

override_queue=$(MUSI_STANDARD_COMMIT_QUEUE_LOCK="$SANDBOX/override/commit-queue.lock" musi_standard_commit_queue_lock "$repo")
[ "$override_queue" = "$SANDBOX/override/commit-queue.lock" ] \
  || fail "commit queue lock should honor MUSI_STANDARD_COMMIT_QUEUE_LOCK: $override_queue"
ok "commit queue state path is Git-common-dir scoped"

# --- ai_staged_fingerprint changes when staged content changes ----------------
repo="$(new_repo staged-fp-change)"
fp1=$(ai_staged_fingerprint "$repo")
printf 'modified\n' > "$repo/file.txt"
git -C "$repo" add file.txt
fp2=$(ai_staged_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "staged fingerprint should change after staging new content"
ok "ai_staged_fingerprint changes when staged content changes"

# --- ai_staged_fingerprint stable for unstaged unrelated edits ----------------
repo="$(new_repo staged-fp-unstaged)"
fp1=$(ai_staged_fingerprint "$repo")
printf 'unstaged edit\n' > "$repo/file.txt"
fp2=$(ai_staged_fingerprint "$repo")
[ "$fp1" = "$fp2" ] || fail "staged fingerprint should not change for unstaged edits"
ok "ai_staged_fingerprint does not change for unstaged unrelated edits"

# --- ai_worktree_fingerprint changes for tracked edits ------------------------
repo="$(new_repo worktree-fp-tracked)"
fp1=$(ai_worktree_fingerprint "$repo")
printf 'edited\n' > "$repo/file.txt"
fp2=$(ai_worktree_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "worktree fingerprint should change for tracked edits"
ok "ai_worktree_fingerprint changes for tracked edits"

# --- broken external diff cannot collapse a tracked edit to the clean hash ---
repo="$(new_repo worktree-fp-external-diff)"
clean_fp=$(ai_worktree_fingerprint "$repo")
printf 'edited behind broken external diff\n' > "$repo/file.txt"
cat > "$SANDBOX/failing-external-diff" <<'EOF'
#!/usr/bin/env bash
exit 86
EOF
chmod +x "$SANDBOX/failing-external-diff"
if ! dirty_fp=$(GIT_EXTERNAL_DIFF="$SANDBOX/failing-external-diff" ai_worktree_fingerprint "$repo"); then
  fail "worktree fingerprint should bypass configured external diff drivers"
fi
[ "$clean_fp" != "$dirty_fp" ] \
  || fail "broken external diff collapsed a tracked edit to the clean fingerprint"
ok "ai_worktree_fingerprint bypasses broken external diffs without a clean-hash collision"

# --- fingerprint functions fail closed when their git diff input fails -------
repo="$(new_repo fingerprint-diff-failure)"
if (
  git() {
    case " $* " in
      *" diff "*) return 87 ;;
      *) command git "$@" ;;
    esac
  }
  ai_worktree_fingerprint "$repo" >/dev/null
); then
  fail "worktree fingerprint should fail when git diff fails"
fi
if (
  git() {
    case " $* " in
      *" diff "*) return 87 ;;
      *) command git "$@" ;;
    esac
  }
  ai_staged_fingerprint "$repo" >/dev/null
); then
  fail "staged fingerprint should fail when git diff fails"
fi
if (
  git() {
    case " $* " in
      *" diff "*) return 87 ;;
      *) command git "$@" ;;
    esac
  }
  ai_precommit_fingerprint "$repo" >/dev/null
); then
  fail "precommit fingerprint should fail when git diff fails"
fi
ok "fingerprint functions fail closed when a git diff input fails"

# --- ai_worktree_fingerprint changes for untracked file contents --------------
repo="$(new_repo worktree-fp-untracked)"
fp1=$(ai_worktree_fingerprint "$repo")
printf 'new file\n' > "$repo/untracked.txt"
fp2=$(ai_worktree_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "worktree fingerprint should change for untracked files"
ok "ai_worktree_fingerprint changes for untracked file contents"

# --- worktree fingerprint fails closed when untracked hashing fails ----------
repo="$(new_repo worktree-fp-untracked-hash-failure)"
printf 'unhashable\n' > "$repo/untracked.txt"
mkdir -p "$SANDBOX/failing-hash-bin"
cat > "$SANDBOX/failing-hash-bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  *untracked.txt) exit 88 ;;
  *) exec /usr/bin/sha256sum "$@" ;;
esac
EOF
chmod +x "$SANDBOX/failing-hash-bin/sha256sum"
if (
  PATH="$SANDBOX/failing-hash-bin:$PATH"
  ai_worktree_fingerprint "$repo" >/dev/null
); then
  fail "worktree fingerprint should fail when untracked sha256sum fails"
fi
ok "ai_worktree_fingerprint fails closed when untracked hashing fails"

# --- ai_precommit_fingerprint includes staged diff ----------------------------
repo="$(new_repo precommit-staged)"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'staged change\n' > "$repo/file.txt"
git -C "$repo" add file.txt
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "precommit fingerprint should change for staged diffs"
ok "ai_precommit_fingerprint includes staged diff"

# --- ai_precommit_fingerprint includes relevant unstaged/untracked paths ------
repo="$(new_repo precommit-relevant)"
fp1=$(ai_precommit_fingerprint "$repo")
mkdir -p "$repo/scripts"
printf 'new script\n' > "$repo/scripts/helper.sh"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should change for relevant untracked paths (scripts/*)"
ok "ai_precommit_fingerprint includes relevant unstaged/untracked paths"

# --- ai_precommit_fingerprint preserves newline-containing paths --------------
repo="$(new_repo precommit-newline-paths)"
tracked_newline_path=$'packages/server/tracked\nsource.ts'
untracked_newline_path=$'packages/server/untracked\nsource.ts'
mkdir -p "$repo/packages/server"
printf 'tracked base\n' > "$repo/$tracked_newline_path"
git -C "$repo" add "$tracked_newline_path"
git -C "$repo" commit -qm "add newline source path"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'tracked edit\n' > "$repo/$tracked_newline_path"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should include a tracked newline-containing path"
fp1="$fp2"
printf 'untracked source\n' > "$repo/$untracked_newline_path"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should include an untracked newline-containing path"
ok "ai_precommit_fingerprint preserves tracked and untracked newline paths"

# --- ai_precommit_fingerprint includes tracked .codex/.claude extras ----------
repo="$(new_repo precommit-tracked-agent-extra)"
mkdir -p "$repo/.codex"
printf 'committed\n' > "$repo/.codex/local-note.md"
git -C "$repo" add .codex/local-note.md
git -C "$repo" commit -qm "add tracked codex note"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'tracked edit\n' > "$repo/.codex/local-note.md"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should include tracked .codex/.claude extra paths"
ok "ai_precommit_fingerprint includes tracked .codex/.claude extra paths"

# --- ai_precommit_fingerprint ignores irrelevant untracked paths --------------
repo="$(new_repo precommit-irrelevant)"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'random notes\n' > "$repo/notes.txt"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" = "$fp2" ] \
  || fail "precommit fingerprint should ignore irrelevant untracked paths (notes.txt)"
ok "ai_precommit_fingerprint ignores irrelevant untracked paths"

# --- ai_precommit_fingerprint diverges only when fast-commit marker present ---
# The fast-commit toggle skips slow pre-commit test slots. Folding its presence
# into the fingerprint stops a partial (fast) run's success marker from
# short-circuiting a later full pre-commit at the same HEAD/diff. The marker
# lives in the Git common dir so it is byte-identical to today when absent.
repo="$(new_repo precommit-fast-commit-toggle)"
fast_marker="$(musi_git_common_identity_path "$repo")/musi-fast-commit"
fp_off=$(ai_precommit_fingerprint "$repo")
: > "$fast_marker"
fp_on=$(ai_precommit_fingerprint "$repo")
[ "$fp_off" != "$fp_on" ] \
  || fail "precommit fingerprint should change when the fast-commit marker is present"
rm -f "$fast_marker"
fp_off_again=$(ai_precommit_fingerprint "$repo")
[ "$fp_off" = "$fp_off_again" ] \
  || fail "precommit fingerprint should match the legacy value once the marker is removed"
ok "ai_precommit_fingerprint diverges only when fast-commit marker is present"

# --- fast-commit marker tripwire logs create/remove transitions --------------
# The toggle is created/removed by hand, so a mid-session vanish is otherwise
# folklore. Each observation records presence; a flip appends a transition line
# (path + the observing process's pid + timestamp). The pid is the observer's,
# not the creator/remover's — the log labels it observed-by-pid= so nobody
# misreads it as attribution for who flipped the marker. The first observation
# is a silent baseline, and a repeated observation with no flip appends nothing.
repo="$(new_repo fast-commit-marker-tripwire)"
tw_marker="$(musi_git_common_identity_path "$repo")/musi-fast-commit"
tw_log="$(musi_fast_commit_marker_log_path "$repo")"
musi_fast_commit_marker_observe "$repo"
[ ! -s "$tw_log" ] || fail "first tripwire observation must not log a transition"
: > "$tw_marker"
musi_fast_commit_marker_observe "$repo"
[ "$(grep -c ' created ' "$tw_log" 2>/dev/null || echo 0)" -eq 1 ] \
  || fail "tripwire should log exactly one created transition"
grep -qF "$tw_marker" "$tw_log" || fail "tripwire line should record the marker path"
grep -qE "observed-by-pid=$$|observed-by-pid=[0-9]+" "$tw_log" \
  || fail "tripwire line should record the observing pid, honestly labelled observed-by-pid="
rm -f "$tw_marker"
musi_fast_commit_marker_observe "$repo"
[ "$(grep -c ' removed ' "$tw_log" 2>/dev/null || echo 0)" -eq 1 ] \
  || fail "tripwire should log exactly one removed transition"
tw_lines_before=$(wc -l < "$tw_log")
musi_fast_commit_marker_observe "$repo"
[ "$(wc -l < "$tw_log")" -eq "$tw_lines_before" ] \
  || fail "a repeated observation with no flip must not append a transition"
ok "musi_fast_commit_marker_observe logs create/remove transitions attributably"

# =============================================================================
# musi_changed_gate_fail_if_unstaged
# =============================================================================

# --- staged source detection preserves newline-containing paths --------------
repo="$(new_repo staged-newline-source)"
staged_newline_path=$'packages/server/staged\nsource.ts'
mkdir -p "$repo/packages/server"
printf 'staged source\n' > "$repo/$staged_newline_path"
git -C "$repo" add "$staged_newline_path"
(
  cd "$repo" || exit 2
  musi_staged_has_source_relevant_change
) || fail "staged source detection should preserve newline-containing paths"
ok "musi_staged_has_source_relevant_change preserves newline paths"

# --- reports source-relevant unstaged files -----------------------------------
repo="$(new_repo gate-relevant-unstaged)"
mkdir -p "$repo/scripts"
printf 'committed\n' > "$repo/scripts/test.sh"
git -C "$repo" add scripts/test.sh
git -C "$repo" commit -qm "add script"
printf 'staged\n' > "$repo/scripts/test.sh"
git -C "$repo" add scripts/test.sh
printf 'unstaged\n' > "$repo/scripts/test.sh"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "gate should reject unstaged source-relevant files"
grep -qF 'gate-test:   - scripts/test.sh' <<< "$output" \
  || fail "gate should report unstaged file: $output"
ok "musi_changed_gate_fail_if_unstaged reports source-relevant unstaged files"

# --- reports source-relevant untracked files ----------------------------------
repo="$(new_repo gate-relevant-untracked)"
mkdir -p "$repo/packages/server"
printf 'new file\n' > "$repo/packages/server/newfile.ts"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "gate should reject untracked source-relevant files"
grep -qF 'gate-test:   - packages/server/newfile.ts' <<< "$output" \
  || fail "gate should report untracked source-relevant file: $output"
ok "musi_changed_gate_fail_if_unstaged reports source-relevant untracked files"

# --- rejects newline-containing source-relevant untracked files ---------------
repo="$(new_repo gate-newline-untracked)"
newline_path=$'packages/server/newline\nsource.ts'
mkdir -p "$repo/packages/server"
printf 'new file\n' > "$repo/$newline_path"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] \
  || fail "gate should reject newline-containing source path (got $exit_code): $output"
grep -qF 'gate-test: source-relevant unstaged or untracked changes are present.' <<< "$output" \
  || fail "gate should report newline-containing source path: $output"
ok "musi_changed_gate_fail_if_unstaged preserves newline paths"

# --- rejects newline-containing source-relevant tracked edits ----------------
repo="$(new_repo gate-newline-tracked)"
newline_path=$'packages/server/tracked\nsource.ts'
mkdir -p "$repo/packages/server"
printf 'base\n' > "$repo/$newline_path"
git -C "$repo" add "$newline_path"
git -C "$repo" commit -qm "add tracked newline path"
printf 'unstaged edit\n' > "$repo/$newline_path"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] \
  || fail "gate should reject tracked newline-containing source path (got $exit_code): $output"
ok "musi_changed_gate_fail_if_unstaged preserves tracked newline paths"

# --- ignores irrelevant paths -------------------------------------------------
repo="$(new_repo gate-irrelevant)"
printf 'committed\n' > "$repo/notes.txt"
git -C "$repo" add notes.txt
git -C "$repo" commit -qm "add notes"
printf 'unstaged\n' > "$repo/notes.txt"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "gate should accept irrelevant unstaged files: $output"
ok "musi_changed_gate_fail_if_unstaged ignores irrelevant paths"

# --- staged script deletion classifier uses shared deletion policy ------------
repo="$(new_repo script-deletion-classifier)"
mkdir -p "$repo/scripts"
printf '#!/usr/bin/env bash\n' > "$repo/scripts/delete-me.sh"
git -C "$repo" add scripts/delete-me.sh
git -C "$repo" commit -qm "add script"
git -C "$repo" rm -q scripts/delete-me.sh
set +e
(
  cd "$repo" || exit 2
  musi_classify_staged_script_input
)
classifier_rc=$?
set -e
[ "$classifier_rc" -eq 1 ] \
  || fail "staged script deletion should request full script-smoke fallback, got $classifier_rc"
ok "musi_classify_staged_script_input detects script-smoke-sensitive deletions"

repo="$(new_repo script-newline-classifier)"
mkdir -p "$repo/scripts"
newline_script=$'scripts/new\nsmoke.sh'
printf '#!/usr/bin/env bash\n' > "$repo/$newline_script"
git -C "$repo" add "$newline_script"
set +e
(
  cd "$repo" || exit 2
  musi_classify_staged_script_input
)
classifier_rc=$?
set -e
[ "$classifier_rc" -eq 1 ] \
  || fail "newline-containing staged path should request full script-smoke fallback, got $classifier_rc"
ok "musi_classify_staged_script_input falls back for newline paths"

# =============================================================================
# Fast-commit provenance state (log/lock shared; pending per-worktree)
# =============================================================================

# --- log + lock are Git-common-dir scoped; pending is per-worktree ------------
fc_repo="$(new_repo fast-scope-primary)"
fc_sibling="$SANDBOX/fast-scope-sibling"
git -C "$fc_repo" worktree add -q -b fast-scope-sibling "$fc_sibling" HEAD
[ "$(musi_fast_commit_log_path "$fc_repo")" = "$(musi_fast_commit_log_path "$fc_sibling")" ] \
  || fail "fast-commit log should be shared across sibling worktrees"
[ "$(musi_fast_commit_log_lock "$fc_repo")" = "$(musi_fast_commit_log_lock "$fc_sibling")" ] \
  || fail "fast-commit log lock should be shared across sibling worktrees"
[ "$(musi_fast_commit_pending_marker "$fc_repo")" != "$(musi_fast_commit_pending_marker "$fc_sibling")" ] \
  || fail "fast-commit pending marker should differ for sibling worktrees"
fc_unrelated="$(new_repo fast-scope-unrelated)"
[ "$(musi_fast_commit_log_path "$fc_repo")" != "$(musi_fast_commit_log_path "$fc_unrelated")" ] \
  || fail "fast-commit log should differ for unrelated repositories"
ok "fast-commit log/lock are common-dir scoped and pending marker is per-worktree"

# --- append de-duplicates under the lock --------------------------------------
fc_repo="$(new_repo fast-append-dedup)"
musi_fast_commit_log_append "$fc_repo" sha1111
musi_fast_commit_log_append "$fc_repo" sha1111
musi_fast_commit_log_append "$fc_repo" sha2222
fc_log="$(musi_fast_commit_log_path "$fc_repo")"
[ "$(grep -c . "$fc_log")" -eq 2 ] \
  || fail "append should de-duplicate: $(cat "$fc_log")"
ok "musi_fast_commit_log_append de-duplicates repeated commits"

# --- clear replaces atomically beside the log, independent of TMPDIR -----------
# The temp is created as "$log.XXXXXX" (same dir/filesystem), so an unwritable or
# missing TMPDIR must not break the clear and the rename stays atomic.
fc_repo="$(new_repo fast-clear-tmpdir)"
fc_log="$(musi_fast_commit_log_path "$fc_repo")"
mkdir -p "$(dirname "$fc_log")"
printf 'keepme\ndropme\n' > "$fc_log"
TMPDIR=/nonexistent-musi-fast-clear musi_fast_commit_log_clear "$fc_repo" "dropme" \
  || fail "clear should succeed with an unwritable TMPDIR (temp lives beside the log)"
grep -qxF keepme "$fc_log" || fail "clear should keep unlisted commits: $(cat "$fc_log")"
if grep -qxF dropme "$fc_log"; then
  fail "clear should remove listed commits: $(cat "$fc_log")"
fi
ok "musi_fast_commit_log_clear replaces beside the log regardless of TMPDIR"

# --- append and clear serialize on the shared lock ----------------------------
# Hold the lock externally; an append must block until it is released rather than
# racing the holder. A gate file (not a fixed sleep) drives the release so the
# test cannot hang or depend on timing of the critical section.
fc_repo="$(new_repo fast-lock-serialize)"
fc_log="$(musi_fast_commit_log_path "$fc_repo")"
fc_lock="$(musi_fast_commit_log_lock "$fc_repo")"
mkdir -p "$(dirname "$fc_lock")"
fc_held="$SANDBOX/fast-lock-held"
fc_gate="$SANDBOX/fast-lock-gate"
rm -f "$fc_held"
: > "$fc_gate"
(
  flock 9
  : > "$fc_held"
  while [ -f "$fc_gate" ]; do sleep 0.05; done
) 9<>"$fc_lock" &
holder_pid=$!
for _ in $(seq 1 100); do [ -f "$fc_held" ] && break; sleep 0.05; done
[ -f "$fc_held" ] || fail "external lock holder never acquired the lock"
musi_fast_commit_log_append "$fc_repo" blocked-sha &
append_pid=$!
sleep 0.3
if [ -f "$fc_log" ] && grep -qxF blocked-sha "$fc_log"; then
  fail "append landed while the lock was held externally (no serialization)"
fi
rm -f "$fc_gate"
wait "$holder_pid" 2>/dev/null || true
wait "$append_pid" 2>/dev/null || true
grep -qxF blocked-sha "$fc_log" \
  || fail "append should land once the lock is released: $(cat "$fc_log" 2>/dev/null)"
ok "musi_fast_commit_log_append serializes on the shared lock"

# --- concurrent append and clear never lose the appended commit ---------------
# The race the lock closes: a clear that reads the log, then a concurrent append,
# then the clear's rename overwrites the just-appended line. Under the lock the
# outcome is deterministic ({incoming} only) every iteration; without it the
# appended commit is periodically dropped.
fc_repo="$(new_repo fast-log-race)"
fc_log="$(musi_fast_commit_log_path "$fc_repo")"
mkdir -p "$(dirname "$fc_log")"
race_ok=1
for _ in $(seq 1 60); do
  printf 'outgoing\n' > "$fc_log"
  musi_fast_commit_log_append "$fc_repo" incoming &
  ap=$!
  musi_fast_commit_log_clear "$fc_repo" "outgoing" &
  cp=$!
  wait "$ap" 2>/dev/null || true
  wait "$cp" 2>/dev/null || true
  if ! grep -qxF incoming "$fc_log"; then
    race_ok=0
    break
  fi
  if grep -qxF outgoing "$fc_log"; then
    race_ok=0
    break
  fi
done
[ "$race_ok" -eq 1 ] \
  || fail "concurrent append+clear dropped the appended commit or left a partial log"
ok "concurrent fast-commit append and clear never lose the appended commit"

# =============================================================================
# Short-circuit / bridge run-mode recording (leaf 3.10)
# =============================================================================

# --- records a minimal, greppable history entry without a wrapper.json --------
# The marker short-circuit and the verify bridge exit before any run-meta is
# produced, so this writes the audit entry straight to the history dir. It must
# never touch a meta/wrapper.json (the pre-push evidence fallback) — the function
# is only handed a history dir, so there is nothing else it can clobber.
sc_hist="$SANDBOX/shortcircuit-history"
musi_record_precommit_shortcircuit "$sc_hist" precommit-marker "sc-head" "$VALID_HASH" precommit-marker \
  || fail "musi_record_precommit_shortcircuit should record a marker short-circuit"
sc_file=$(find "$sc_hist" -maxdepth 1 -type f -name '*-precommit-marker-0.json' | head -1)
[ -n "$sc_file" ] || fail "expected a <epoch>-precommit-marker-0.json history entry"
sc_json=$(sed -n '1p' "$sc_file")
sc_wrapper=$(musi_run_meta_wrapper_fragment "$sc_json")
[ -n "$sc_wrapper" ] || fail "recorded entry should expose a parseable wrapper fragment"
[ "$(musi_run_meta_json_string_field "$sc_wrapper" mode)" = "precommit-marker" ] \
  || fail "recorded wrapper mode should be precommit-marker"
[ "$(musi_run_meta_json_string_field "$sc_wrapper" head)" = "sc-head" ] \
  || fail "recorded wrapper head should round-trip"
[ "$(musi_run_meta_json_string_field "$sc_wrapper" fingerprint)" = "$VALID_HASH" ] \
  || fail "recorded wrapper fingerprint should round-trip"
[ "$(musi_run_meta_json_string_field "$sc_wrapper" satisfied_marker)" = "precommit-marker" ] \
  || fail "recorded wrapper should note which marker satisfied the gate"
[ "$(musi_run_meta_json_int_field "$sc_wrapper" exit_code)" = "0" ] \
  || fail "a short-circuit that admitted the commit records exit_code 0"
[ ! -e "$sc_hist/wrapper.json" ] && [ ! -e "$sc_hist/meta" ] \
  || fail "recording must not create a wrapper.json / meta dir"
ok "musi_record_precommit_shortcircuit writes a greppable history entry, no wrapper.json"

# --- refuses to record an invalid fingerprint (best-effort, non-fatal) --------
sc_hist_bad="$SANDBOX/shortcircuit-history-bad"
musi_record_precommit_shortcircuit "$sc_hist_bad" precommit-bridged "sc-head" "not-a-fingerprint" verify \
  || fail "recording should stay non-fatal even when it refuses"
[ -z "$(find "$sc_hist_bad" -maxdepth 1 -type f -name '*.json' 2>/dev/null)" ] \
  || fail "an invalid fingerprint must not produce a history entry"
ok "musi_record_precommit_shortcircuit refuses an invalid fingerprint without failing"

# --- bridge exposes which marker satisfied the gate + its head/fingerprint -----
# The pre-commit hook needs head/fingerprint/which-marker to record a bridged
# commit, but the bridge helper's values are otherwise function-local. On a
# successful bridge it publishes them as globals (mirroring how
# musi_success_marker_matches sets MUSI_MARKER_MATCH_AGE).
br_repo="$(new_repo bridge-globals)"
br_head=$(git -C "$br_repo" rev-parse HEAD)
br_verify_hash=$(ai_worktree_fingerprint "$br_repo")
br_precommit_hash=$(ai_precommit_fingerprint "$br_repo")
br_verify_marker="$SANDBOX/bridge-verify-marker"
br_precommit_marker="$SANDBOX/bridge-precommit-marker"
cat > "$br_verify_marker" <<EOF
LAST_TS=$(date +%s)
LAST_HEAD=$br_head
LAST_HASH=$br_verify_hash
EOF
MUSI_VERIFY_BRIDGE_KIND=""
MUSI_VERIFY_BRIDGE_HEAD=""
MUSI_VERIFY_BRIDGE_FINGERPRINT=""
musi_try_single_verify_marker_bridge "$br_repo" "$br_precommit_marker" "$br_verify_marker" \
  verify 120 "$br_head" "$br_verify_hash" >/dev/null \
  || fail "a fresh matching verify marker should bridge the pre-commit"
[ "$MUSI_VERIFY_BRIDGE_KIND" = "verify" ] \
  || fail "bridge should publish which marker satisfied the gate (got '$MUSI_VERIFY_BRIDGE_KIND')"
[ "$MUSI_VERIFY_BRIDGE_HEAD" = "$br_head" ] \
  || fail "bridge should publish the bridged HEAD"
[ "$MUSI_VERIFY_BRIDGE_FINGERPRINT" = "$br_precommit_hash" ] \
  || fail "bridge should publish the pre-commit fingerprint it stamped"
ok "musi_try_single_verify_marker_bridge publishes bridge provenance globals"

printf 'verify-metadata tests passed (%d)\n' "$PASS"
