#!/bin/bash

# Focused ai-hooks shell tests for the ratchet-regression-check hook. Extracted
# from scripts/ai-hooks/test.sh so this behavior family can be run on its own
# (`bash scripts/ai-hooks/test-ratchet-regression.sh`); the aggregate runner
# invokes it as one step. Shares the generic assertions in test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-ratchet-regression-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"

# --- ratchet-regression-check hook -------------------------------------------
# The hook is exercised with a fake `bun` on PATH that emits canned discovery /
# edit-check rows and logs every invocation. This isolates the hook's bash logic
# (path extraction, caps, content cache, throttle-before-lint, advisory output)
# from the real ratchet engine, which is covered by scripts/tests/test-lint-ratchet.sh.
RR_REPO="$TMP_ROOT/ratchet-regression-repo"
RR_FAKE_BIN="$TMP_ROOT/ratchet-regression-bin"
RR_BUN_LOG="$TMP_ROOT/ratchet-regression-bun.log"
RR_STATE_ROOT="$TMP_ROOT/ratchet-regression-state"
rm -rf "$RR_REPO" "$RR_FAKE_BIN" "$RR_STATE_ROOT"
mkdir -p "$RR_REPO/scripts/ai-hooks" "$RR_REPO/src" "$RR_FAKE_BIN"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/cache.sh" \
  "$REPO_ROOT/scripts/ai-hooks/output-filter.sh" \
  "$REPO_ROOT/scripts/ai-hooks/throttle-state.sh" \
  "$REPO_ROOT/scripts/ai-hooks/ratchet-regression-check.sh" \
  "$RR_REPO/scripts/ai-hooks/"
mkdir -p "$RR_REPO/scripts/lib"
# verify-metadata.sh resolves its run-meta codec beside itself, so the fixture
# gets the TS entrypoint too (keeps the copied chain matching production).
cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" \
  "$REPO_ROOT/scripts/lib/verify-metadata-core.ts" \
  "$RR_REPO/scripts/lib/"
git -C "$RR_REPO" init -q

cat > "$RR_FAKE_BIN/bun" <<'EOF'
#!/bin/bash
set -u
{
  printf 'bun'
  for arg in "$@"; do printf '\t%s' "$arg"; done
  printf '\n'
} >> "$RR_BUN_LOG"

mode=""
for arg in "$@"; do
  case "$arg" in
    --edit-check-targets) mode="targets" ;;
    --edit-check) mode="check" ;;
  esac
done

if [ "$mode" = "targets" ]; then
  [ "${RR_BUN_FAIL:-0}" = "1" ] && exit 3
  emit=0
  cache_identity="${RR_BUN_CACHE_IDENTITY:-cache-identity-v1}"
  for arg in "$@"; do
    if [ "$arg" = "--edit-check-targets" ]; then emit=1; continue; fi
    [ "$emit" = "1" ] || continue
    # RR_BUN_MULTI_TARGETS>0 emits that many DISTINCT (testId,ruleId) targets per
    # path so the per-edit cap can be exercised; default stays single-target so
    # the existing fixtures keep their canonical local/type-assertion-boundary id.
    multi="${RR_BUN_MULTI_TARGETS:-0}"
    if [ "$multi" -gt 0 ] 2>/dev/null; then
      i=0
      while [ "$i" -lt "$multi" ]; do
        printf 'target\t%s\tratchet/multi-%s\tlocal/multi-%s\t%s:%s\n' "$arg" "$i" "$i" "$cache_identity" "$i"
        i=$((i + 1))
      done
    else
      printf 'target\t%s\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\t%s\n' "$arg" "$cache_identity"
    fi
  done
  exit 0
fi

if [ "$mode" = "check" ]; then
  { [ "${RR_BUN_FAIL:-0}" = "1" ] || [ "${RR_BUN_FAIL_CHECK:-0}" = "1" ]; } && exit 3
  tf=""
  prev=""
  for arg in "$@"; do
    [ "$prev" = "--targets-file" ] && tf="$arg"
    prev="$arg"
  done
  [ -n "$tf" ] && [ -f "$tf" ] || exit 0
  while IFS=$'\t' read -r kind rel test rule _; do
    [ "$kind" = "target" ] || continue
    printf 'checked\t%s\n' "$rel"
    [ "${RR_BUN_NO_REGRESSION:-0}" = "1" ] && continue
    line_col="1"
    [ "${RR_BUN_EMPTY_LINE:-0}" = "1" ] && line_col=""
    # RR_BUN_REPAIR emits the 9-column row shape (trailing repair command);
    # default stays 8 columns so the hook's tolerance of older rows is pinned.
    if [ -n "${RR_BUN_REPAIR:-}" ]; then
      printf 'regression\t%s\t%s\t%s\tnew-path\t%s\t0\t1\t%s\n' "$rel" "$test" "$rule" "$line_col" "$RR_BUN_REPAIR"
    else
      printf 'regression\t%s\t%s\t%s\tnew-path\t%s\t0\t1\n' "$rel" "$test" "$rule" "$line_col"
    fi
  done < "$tf"
  exit 0
fi
exit 0
EOF
chmod +x "$RR_FAKE_BIN/bun"

run_ratchet_regression_hook() {
  local payload="$1"
  RR_BUN_LOG="$RR_BUN_LOG" \
    RR_BUN_FAIL="${RR_BUN_FAIL:-0}" \
    RR_BUN_FAIL_CHECK="${RR_BUN_FAIL_CHECK:-0}" \
    RR_BUN_NO_REGRESSION="${RR_BUN_NO_REGRESSION:-0}" \
    RR_BUN_EMPTY_LINE="${RR_BUN_EMPTY_LINE:-0}" \
    RR_BUN_REPAIR="${RR_BUN_REPAIR:-}" \
    RR_BUN_MULTI_TARGETS="${RR_BUN_MULTI_TARGETS:-0}" \
    RR_BUN_CACHE_IDENTITY="${RR_BUN_CACHE_IDENTITY:-cache-identity-v1}" \
    AI_STATE_ROOT="$RR_STATE_ROOT" \
    AI_THROTTLE_STATE_DIR="$RR_STATE_ROOT/throttle" \
    AI_RATCHET_REGRESSION_CONTENT_DIR="$RR_STATE_ROOT/content" \
    AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" \
    AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
    AI_RATCHET_REGRESSION_TTL="${AI_RATCHET_REGRESSION_TTL:-0}" \
    AI_RATCHET_REGRESSION_MAX="${AI_RATCHET_REGRESSION_MAX:-10}" \
    AI_RATCHET_REGRESSION_MAX_TARGETS="${AI_RATCHET_REGRESSION_MAX_TARGETS:-3}" \
    AI_FAKE_NOW="${AI_FAKE_NOW:-}" \
    PATH="$RR_FAKE_BIN:$PATH" \
    bash "$RR_REPO/scripts/ai-hooks/ratchet-regression-check.sh" <<< "$payload"
}

rr_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

rr_edit_payload() {
  jq -n --arg file "$1" --arg sid "$2" \
    '{session_id:$sid,tool_name:"Edit",tool_input:{file_path:$file}}'
}

rr_content_cache_path() {
  local relpath="$1"
  local repo_hash rel_hash
  repo_hash=$(printf '%s' "$RR_REPO" | sha1sum | awk '{print $1}')
  rel_hash=$(printf '%s' "$relpath" | sha1sum | awk '{print $1}')
  printf '%s/content/%s-%s' "$RR_STATE_ROOT" "$repo_hash" "$rel_hash"
}

# The ratchet hook owns its public throttle knobs and depends only on the neutral
# throttle helper, not lint-coverage wrapper state or environment bridges.
if grep -qF 'lint-coverage-state.sh' "$RR_REPO/scripts/ai-hooks/ratchet-regression-check.sh" \
  || grep -qF 'AI_LINT_COVERAGE_' "$RR_REPO/scripts/ai-hooks/ratchet-regression-check.sh"; then
  fail "ratchet-regression hook must not depend on lint-coverage throttle globals"
fi

# (1) Claude Edit path extraction + advisory warning naming file:line, rule, reason.
printf 'const raw: unknown = {};\nexport const value = raw as { value: number };\n' > "$RR_REPO/src/foo.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$(rr_edit_payload "src/foo.ts" "rr-1")") \
  || fail "ratchet-regression hook should not fail for a Claude Edit payload"
assert_hook_json "$RR_OUT"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "lint-ratchet (WARNING)"
assert_contains "$RR_CTX" "src/foo.ts:1 (local/type-assertion-boundary — new-path)"
assert_contains "$RR_CTX" "Full ratchet picture: bun run lint:ratchet"
assert_contains "$RR_CTX" "Structured selected-rule guidance: bun run lint:agent:local-rules:changed"
assert_not_contains "$RR_CTX" "For structured per-rule fix guidance"
assert_contains "$RR_CTX" "Type-aware ratchets are not checked"
# An 8-column row (no repair metadata) must not grow a repair suffix.
assert_not_contains "$RR_CTX" "repair:"
RR_DISCOVERY=$(grep -F -- '--edit-check-targets' "$RR_BUN_LOG" || true)
assert_contains "$RR_DISCOVERY" $'\tsrc/foo.ts'
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "first run should invoke the lint step: $(cat "$RR_BUN_LOG")"

# (1b) A regression row with an empty `line` field must parse without shifting
# baselineCount into the location (the [P2] tab-IFS-collapse bug). The bullet
# shows the bare path, never path:<count>.
printf 'const el: unknown = {};\nexport const e = el as { value: number };\n' > "$RR_REPO/src/el.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_EMPTY_LINE=1 AI_FAKE_NOW=110000 run_ratchet_regression_hook "$(rr_edit_payload "src/el.ts" "rr-el")") \
  || fail "ratchet-regression hook should not fail on an empty-line regression row"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "src/el.ts (local/type-assertion-boundary — new-path)"
assert_not_contains "$RR_CTX" "src/el.ts:"

# (1c) A 9-column regression row carrying a repair command names it inline in
# the bullet (the envelope↔hook bridge for codemod/autofix rules).
printf 'const rep: unknown = {};\nexport const r = rep as { value: number };\n' > "$RR_REPO/src/rep.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_REPAIR="bun run lint:fix" AI_FAKE_NOW=115000 run_ratchet_regression_hook "$(rr_edit_payload "src/rep.ts" "rr-rep")") \
  || fail "ratchet-regression hook should not fail on a repair-carrying regression row"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "src/rep.ts:1 (local/type-assertion-boundary — new-path) — repair: bun run lint:fix"

# (2) Codex apply_patch path extraction: Add/Update linted, Delete + node_modules skipped.
printf 'const added: unknown = {};\nexport const a = added as { value: number };\n' > "$RR_REPO/src/added.ts"
printf 'const updated: unknown = {};\nexport const u = updated as { value: number };\n' > "$RR_REPO/src/updated.ts"
RR_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: src/added.ts" \
  '+const added: unknown = {};' \
  "*** Update File: src/updated.ts" \
  '@@' \
  '-old' \
  '+new' \
  "*** Delete File: src/gone.ts" \
  "*** Update File: node_modules/pkg/index.ts" \
  '@@' \
  '-x' \
  '+y' \
  '*** End Patch')
RR_CODEX_PAYLOAD=$(jq -n --arg command "$RR_PATCH" --arg sid "rr-codex" \
  '{session_id:$sid,tool_name:"apply_patch",tool_input:{command:$command}}')
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$RR_CODEX_PAYLOAD") \
  || fail "ratchet-regression hook should not fail for a Codex apply_patch payload"
RR_DISCOVERY=$(grep -F -- '--edit-check-targets' "$RR_BUN_LOG" || true)
assert_contains "$RR_DISCOVERY" $'\tsrc/added.ts'
assert_contains "$RR_DISCOVERY" $'\tsrc/updated.ts'
assert_not_contains "$RR_DISCOVERY" "src/gone.ts"
assert_not_contains "$RR_DISCOVERY" "node_modules/pkg/index.ts"

# (3) A deleted/missing edited file is skipped before any engine call.
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$(rr_edit_payload "src/never-existed.ts" "rr-del")") \
  || fail "ratchet-regression hook should not fail for a missing file"
assert_hook_continue_json "$RR_OUT"
[ ! -s "$RR_BUN_LOG" ] || fail "missing file should not invoke the ratchet engine: $(cat "$RR_BUN_LOG")"

# (4) Content-identical re-saves skip ESLint entirely. TTL=0 disables throttle
# suppression, so a skipped second lint can only be the content-hash cache.
printf 'const cc: unknown = {};\nexport const c = cc as { value: number };\n' > "$RR_REPO/src/cc.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=200000 run_ratchet_regression_hook "$(rr_edit_payload "src/cc.ts" "rr-cc")") \
  || fail "ratchet-regression content-cache first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/cc.ts:1"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "first content-cache run should lint (invoke --edit-check): $(cat "$RR_BUN_LOG")"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=200000 run_ratchet_regression_hook "$(rr_edit_payload "src/cc.ts" "rr-cc")") \
  || fail "ratchet-regression content-cache second run failed"
assert_hook_continue_json "$RR_OUT"
grep -qF -- "--edit-check-targets" "$RR_BUN_LOG" || fail "second run should still run discovery"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "content-identical re-save must skip the lint step: $(cat "$RR_BUN_LOG")"
fi

# (4b) A content-identical re-save must re-lint when the ratchet engine reports
# a changed target cache identity. The fake target keeps the same file, test id,
# and rule id; only the discovery identity changes, modeling a baseline/config/
# rule-source hash change that the shell must not hide behind its content cache.
printf 'const ci: unknown = {};\nexport const ciValue = ci as { value: number };\n' > "$RR_REPO/src/ci.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_CACHE_IDENTITY=identity-v1 AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=210000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/ci.ts" "rr-ci")") \
  || fail "ratchet-regression cache-identity first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/ci.ts:1"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "first cache-identity run should lint (invoke --edit-check): $(cat "$RR_BUN_LOG")"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_CACHE_IDENTITY=identity-v2 AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=210000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/ci.ts" "rr-ci")") \
  || fail "ratchet-regression cache-identity second run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/ci.ts:1"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "changed ratchet cache identity must re-lint, not skip behind the old content cache: $(cat "$RR_BUN_LOG")"

# (5) Throttle-before-lint: after warning once, a CHANGED re-save of the same
# (file,rule) within TTL is dropped before the lint step (content cache misses,
# so the suppression is the per-(file,rule) throttle).
printf 'const th: unknown = {};\nexport const t = th as { value: number };\n' > "$RR_REPO/src/th.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/th.ts" "rr-th")") \
  || fail "ratchet-regression throttle first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/th.ts:1"
printf 'const th2: unknown = {};\nexport const t2 = th2 as { value: number };\n// changed\n' > "$RR_REPO/src/th.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/th.ts" "rr-th")") \
  || fail "ratchet-regression throttle second run failed"
assert_hook_continue_json "$RR_OUT"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "a throttle-suppressed target must be dropped before the lint step: $(cat "$RR_BUN_LOG")"
fi

# (5b) Suppressed ratchet detections still advance the throttle counter, so the
# hook re-lints and can warn again on the max-detection backstop without waiting
# for TTL. Each edit changes content so the content cache cannot explain the
# result.
printf 'const mx: unknown = {};\nexport const m = mx as { value: number };\n' > "$RR_REPO/src/max.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_RATCHET_REGRESSION_MAX=3 AI_FAKE_NOW=310000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/max.ts" "rr-max")") \
  || fail "ratchet-regression max first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/max.ts:1"
printf 'const mx2: unknown = {};\nexport const m2 = mx2 as { value: number };\n// changed once\n' > "$RR_REPO/src/max.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_RATCHET_REGRESSION_MAX=3 AI_FAKE_NOW=310000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/max.ts" "rr-max")") \
  || fail "ratchet-regression max second run failed"
assert_hook_continue_json "$RR_OUT"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "first max-backstop suppressed target must be dropped before lint: $(cat "$RR_BUN_LOG")"
fi
printf 'const mx3: unknown = {};\nexport const m3 = mx3 as { value: number };\n// changed twice\n' > "$RR_REPO/src/max.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_RATCHET_REGRESSION_MAX=3 AI_FAKE_NOW=310000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/max.ts" "rr-max")") \
  || fail "ratchet-regression max third run failed"
assert_hook_continue_json "$RR_OUT"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "second max-backstop suppressed target must be dropped before lint: $(cat "$RR_BUN_LOG")"
fi
printf 'const mx4: unknown = {};\nexport const m4 = mx4 as { value: number };\n// changed three times\n' > "$RR_REPO/src/max.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_RATCHET_REGRESSION_MAX=3 AI_FAKE_NOW=310000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/max.ts" "rr-max")") \
  || fail "ratchet-regression max fourth run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/max.ts:1"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "max-detection backstop must re-lint before TTL: $(cat "$RR_BUN_LOG")"

# (6) Per-file/per-rule tiering: a different file still warns while src/th.ts is
# suppressed in the same session/instant.
printf 'const ot: unknown = {};\nexport const o = ot as { value: number };\n' > "$RR_REPO/src/other.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/other.ts" "rr-th")") \
  || fail "ratchet-regression per-file run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/other.ts:1 (local/type-assertion-boundary — new-path)"

# (7) Advisory and exit-0 on engine failure (both discovery and lint failures).
printf 'const cf: unknown = {};\nexport const f = cf as { value: number };\n' > "$RR_REPO/src/cf.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_FAIL=1 AI_FAKE_NOW=400000 run_ratchet_regression_hook "$(rr_edit_payload "src/cf.ts" "rr-cf")") \
  || fail "ratchet-regression hook must exit 0 when discovery fails"
assert_hook_continue_json "$RR_OUT"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_FAIL_CHECK=1 AI_FAKE_NOW=400001 run_ratchet_regression_hook "$(rr_edit_payload "src/cf.ts" "rr-cf2")") \
  || fail "ratchet-regression hook must exit 0 when the lint step fails"
assert_hook_continue_json "$RR_OUT"

# (8) The .no-edit-lint kill switch disables the hook before any engine call.
touch "$RR_REPO/.no-edit-lint"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=500000 run_ratchet_regression_hook "$(rr_edit_payload "src/foo.ts" "rr-kill")") \
  || fail "ratchet-regression hook should not fail with the kill switch present"
assert_hook_continue_json "$RR_OUT"
[ ! -s "$RR_BUN_LOG" ] || fail "kill switch should skip the engine entirely: $(cat "$RR_BUN_LOG")"
rm -f "$RR_REPO/.no-edit-lint"

# (9) Per-edit cap partial check: a file matches MORE targets than the cap, so a
# slice is dropped. The hook must (a) emit an explicit partial-check advisory even
# when the checked subset finds no regression, (b) NOT write a content cache for
# the file (its full matched set was never linted), and (c) re-lint an identical
# later save instead of skipping behind a stale cache.
printf 'const cap: unknown = {};\nexport const cp = cap as { value: number };\n' > "$RR_REPO/src/cap.ts"
RR_CAP_CACHE=$(rr_content_cache_path "src/cap.ts")
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=4 RR_BUN_NO_REGRESSION=1 AI_RATCHET_REGRESSION_TTL=0 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=600000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/cap.ts" "rr-cap")") \
  || fail "ratchet-regression cap partial-check run failed"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "+1 more matching target(s) not checked this edit"
assert_contains "$RR_CTX" "bun run lint:ratchet"
assert_not_contains "$RR_CTX" "introduced or worsened"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "cap partial-check run should still lint the surviving subset: $(cat "$RR_BUN_LOG")"
[ ! -f "$RR_CAP_CACHE" ] \
  || fail "a capped (partially-checked) file must not write a content cache"
# Identical re-save: discovery again finds 4, caps to 3 — the dropped targets
# were never checked, so this must re-invoke --edit-check, not skip behind a cache.
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=4 RR_BUN_NO_REGRESSION=1 AI_RATCHET_REGRESSION_TTL=0 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=600000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/cap.ts" "rr-cap")") \
  || fail "ratchet-regression cap partial-check re-save failed"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "identical re-save of a capped file must re-lint, not skip behind a stale cache: $(cat "$RR_BUN_LOG")"

# (9b) Partial-check notes are throttle-gated independently from the lint work.
# A capped, clean file must still re-lint on an identical save because it cannot
# write a complete content cache, but the advisory note itself should not repeat
# every save within TTL.
printf 'const cn: unknown = {};\nexport const cnv = cn as { value: number };\n' > "$RR_REPO/src/capnote.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=4 RR_BUN_NO_REGRESSION=1 AI_RATCHET_REGRESSION_TTL=1800 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=620000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/capnote.ts" "rr-capnote")") \
  || fail "ratchet-regression throttled partial-note first run failed"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "lint-ratchet (note)"
assert_contains "$RR_CTX" "+1 more matching target(s) not checked this edit"
assert_not_contains "$RR_CTX" "For structured per-rule fix guidance"
assert_not_contains "$RR_CTX" "introduced or worsened"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=4 RR_BUN_NO_REGRESSION=1 AI_RATCHET_REGRESSION_TTL=1800 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=620000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/capnote.ts" "rr-capnote")") \
  || fail "ratchet-regression throttled partial-note re-save failed"
assert_hook_continue_json "$RR_OUT"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "a throttled partial-note re-save must still lint the surviving subset: $(cat "$RR_BUN_LOG")"

# (9c) Full matched set within the cap still content-caches an identical re-save,
# even though the multi-target fixture emits several distinct rule ids.
printf 'const fit: unknown = {};\nexport const ft = fit as { value: number };\n' > "$RR_REPO/src/fit.ts"
RR_FIT_CACHE=$(rr_content_cache_path "src/fit.ts")
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=3 AI_RATCHET_REGRESSION_TTL=0 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=610000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/fit.ts" "rr-fit")") \
  || fail "ratchet-regression within-cap first run failed"
[ -f "$RR_FIT_CACHE" ] \
  || fail "a fully-checked (within-cap) file must write a content cache"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=3 AI_RATCHET_REGRESSION_TTL=0 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=3 AI_FAKE_NOW=610000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/fit.ts" "rr-fit")") \
  || fail "ratchet-regression within-cap re-save failed"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "an identical re-save fully within the cap must skip the lint step: $(cat "$RR_BUN_LOG")"
fi

# (9d) Cap dropped a target but NOTHING survived to lint (the one in-cap target is
# throttle-suppressed). The hook must still emit the partial-check note once
# rather than fall silent, since the dropped targets were never checked; the same
# note is then throttled on a third run. Start with one matching target to burn
# the per-(file,rule) warning slot without also burning the partial-note tier.
printf 'const cd: unknown = {};\nexport const cdv = cd as { value: number };\n' > "$RR_REPO/src/capdrop.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=1 AI_RATCHET_REGRESSION_TTL=1800 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=1 AI_FAKE_NOW=700000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/capdrop.ts" "rr-capdrop")") \
  || fail "ratchet-regression cap-drop first run failed"
assert_contains "$(rr_context "$RR_OUT")" "introduced or worsened"
assert_not_contains "$(rr_context "$RR_OUT")" "+1 more matching target(s) not checked this edit"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=2 AI_RATCHET_REGRESSION_TTL=1800 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=1 AI_FAKE_NOW=700000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/capdrop.ts" "rr-capdrop")") \
  || fail "ratchet-regression cap-drop second run failed"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "lint-ratchet (note)"
assert_contains "$RR_CTX" "+1 more matching target(s) not checked this edit"
assert_not_contains "$RR_CTX" "introduced or worsened"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "a fully-suppressed surviving target must not invoke the lint step: $(cat "$RR_BUN_LOG")"
fi
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_MULTI_TARGETS=2 AI_RATCHET_REGRESSION_TTL=1800 \
  AI_RATCHET_REGRESSION_MAX_TARGETS=1 AI_FAKE_NOW=700000 \
  run_ratchet_regression_hook "$(rr_edit_payload "src/capdrop.ts" "rr-capdrop")") \
  || fail "ratchet-regression cap-drop third run failed"
assert_hook_continue_json "$RR_OUT"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "a fully-suppressed surviving target must not invoke the lint step: $(cat "$RR_BUN_LOG")"
fi

printf 'ai-hooks ratchet-regression tests passed\n'
