#!/usr/bin/env bash
# smoke-subjects: scripts/git/install-all-merge-drivers.sh
# smoke-subjects: scripts/git/run-baseline-truth-up.sh
# smoke-subjects: scripts/git/baseline-drivers.sh
# smoke-subjects: scripts/git/check-lint-ratchet-merge-driver.sh
# smoke-subjects: scripts/git/install-lint-ratchet-merge-driver.sh
# smoke-subjects: scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/check-knip-unused-exports-merge-driver.sh
# smoke-subjects: scripts/git/install-knip-unused-exports-merge-driver.sh
# smoke-subjects: scripts/git/knip-unused-exports-merge-driver-lib.sh
# smoke-subjects: scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/check-near-duplicates-merge-driver.sh
# smoke-subjects: scripts/git/install-near-duplicates-merge-driver.sh
# smoke-subjects: scripts/git/near-duplicates-merge-driver-lib.sh
# smoke-subjects: scripts/git/near-duplicates-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/check-max-lines-exceptions-merge-driver.sh
# smoke-subjects: scripts/git/install-max-lines-exceptions-merge-driver.sh
# smoke-subjects: scripts/git/max-lines-exceptions-merge-driver-lib.sh
# smoke-subjects: scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/baseline-merge-driver.sh
# smoke-subjects: scripts/git/baseline-merge-driver-lib.sh
# smoke-subjects: scripts/git/baseline-post-merge-truth-up.sh
# smoke-subjects: scripts/git/check-baseline-merge-driver.sh
# smoke-subjects: scripts/git/install-baseline-merge-driver.sh
# smoke-subjects: scripts/git/baseline-info-attributes.ts
# smoke-subjects: scripts/git/restore-generated-baseline-stage.sh
# smoke-subjects: scripts/sensor-knip-unused-exports-merge-cli.ts
# smoke-subjects: scripts/sensor-near-duplicates-merge-cli.ts
# smoke-subjects: scripts/max-lines-exceptions-merge-cli.ts
# smoke-subjects: tools/lint-ratchet/src/git-rail/
# smoke-subjects: .gitattributes
# smoke-subjects: .husky/post-merge
# smoke-subjects: .husky/post-checkout
# smoke-subjects: .husky/post-commit
# smoke-subjects: scripts/tests/test-merge-driver-dispatch.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
#
# Smoke test for the shared merge-driver install and baseline truth-up
# dispatchers factored out of the post-merge / post-checkout / post-commit
# hooks and the package.json `prepare` script.
#
# The four per-metric install and truth-up scripts are stubbed to log their
# invocation, so these tests assert dispatch composition and the post-checkout
# branch-flag gating without touching real Git config or baseline machinery.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree via the MUSI_VERIFY_META_CORE seam.
export MUSI_VERIFY_META_CORE="$REPO_ROOT/scripts/lib/verify-metadata-core.ts"

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/merge-driver-dispatch-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

METRICS=(lint-ratchet knip-unused-exports near-duplicates max-lines-exceptions)

PASS=0
ok() {
  PASS=$((PASS + 1))
  printf 'ok %d - %s\n' "$PASS" "$1"
}
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# Build a throwaway repo whose per-metric install and truth-up scripts are
# stubs that append their metric (and, for truth-up, the forwarded context
# arg) to a log file, while the shared dispatchers and hooks are the real
# committed copies.
make_repo() {
  local name="$1" m
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo/scripts/git" "$repo/scripts/lib" "$repo/.husky"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"

  cp "$REPO_ROOT/scripts/git/install-all-merge-drivers.sh" "$repo/scripts/git/"
  cp "$REPO_ROOT/scripts/git/run-baseline-truth-up.sh" "$repo/scripts/git/"
  # Both dispatchers (and the post-commit sweep) source the shared registry.
  cp "$REPO_ROOT/scripts/git/baseline-drivers.sh" "$repo/scripts/git/"

  for m in "${METRICS[@]}"; do
    cat >"$repo/scripts/git/install-$m-merge-driver.sh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "$m" >> "\$MD_INSTALL_LOG"
EOF
    cat >"$repo/scripts/git/$m-post-merge-baseline-truth-up.sh" <<EOF
#!/usr/bin/env bash
printf '%s ctx=[%s]\n' "$m" "\${1:-}" >> "\$MD_TRUTHUP_LOG"
EOF
  done

  # post-merge / post-checkout source the drift hook; stub it to a no-op.
  cat >"$repo/scripts/worktree-drift-hook.sh" <<'EOF'
#!/usr/bin/env bash
musi_worktree_drift_hook() { :; }
EOF

  printf '%s' "$repo"
}

install_log_lines() {
  [ -f "$1" ] || { printf '0'; return; }
  grep -c '' "$1"
}

# --- install dispatcher runs every installer once, in order ------------------
repo=$(make_repo install-dispatcher)
export MD_INSTALL_LOG="$repo/install.log"
: >"$MD_INSTALL_LOG"
( cd "$repo" && bash scripts/git/install-all-merge-drivers.sh )
expected_install=$'lint-ratchet\nknip-unused-exports\nnear-duplicates\nmax-lines-exceptions'
[ "$(cat "$MD_INSTALL_LOG")" = "$expected_install" ] \
  || fail "install dispatcher should run all four installers in order, got: $(cat "$MD_INSTALL_LOG")"
ok "install dispatcher runs every per-metric installer once, in order"
unset MD_INSTALL_LOG

# --- truth-up dispatcher forwards the optional context arg to each metric ----
repo=$(make_repo truthup-dispatcher)
export MD_TRUTHUP_LOG="$repo/truthup.log"

: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash scripts/git/run-baseline-truth-up.sh )
for m in "${METRICS[@]}"; do
  grep -qxF "$m ctx=[]" "$MD_TRUTHUP_LOG" \
    || fail "truth-up dispatcher (no context) should invoke $m with an empty context: $(cat "$MD_TRUTHUP_LOG")"
done
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 4 ] \
  || fail "truth-up dispatcher (no context) should invoke exactly four metrics"
ok "truth-up dispatcher invokes every metric with no context (post-merge shape)"

: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash scripts/git/run-baseline-truth-up.sh post-commit )
for m in "${METRICS[@]}"; do
  grep -qxF "$m ctx=[post-commit]" "$MD_TRUTHUP_LOG" \
    || fail "truth-up dispatcher should forward the post-commit context to $m: $(cat "$MD_TRUTHUP_LOG")"
done
ok "truth-up dispatcher forwards the post-commit context to every metric"
unset MD_TRUTHUP_LOG

# --- post-checkout gates the installers behind the branch-checkout flag ------
repo=$(make_repo post-checkout-gate)
cp "$REPO_ROOT/.husky/post-checkout" "$repo/.husky/post-checkout"
chmod +x "$repo/.husky/post-checkout"
export MD_INSTALL_LOG="$repo/post-checkout.log"

: >"$MD_INSTALL_LOG"
( cd "$repo" && bash .husky/post-checkout 1111111 1111111 0 )
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 0 ] \
  || fail "file checkout (flag 0) must not run any installer: $(cat "$MD_INSTALL_LOG")"
ok "post-checkout skips installers on a file checkout (branch flag 0)"

: >"$MD_INSTALL_LOG"
( cd "$repo" && bash .husky/post-checkout 1111111 2222222 1 )
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 4 ] \
  || fail "branch checkout (flag 1) must run all four installers: $(cat "$MD_INSTALL_LOG")"
ok "post-checkout runs the installer dispatch on a branch checkout (branch flag 1)"

: >"$MD_INSTALL_LOG"
( cd "$repo" && bash .husky/post-checkout )
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 4 ] \
  || fail "an absent branch flag must default to installing (self-heal): $(cat "$MD_INSTALL_LOG")"
ok "post-checkout defaults to installing when the branch flag is absent"
unset MD_INSTALL_LOG

# --- post-merge always installs; truth-up gated by the squash flag -----------
repo=$(make_repo post-merge)
cp "$REPO_ROOT/.husky/post-merge" "$repo/.husky/post-merge"
chmod +x "$repo/.husky/post-merge"
export MD_INSTALL_LOG="$repo/pm-install.log"
export MD_TRUTHUP_LOG="$repo/pm-truthup.log"

: >"$MD_INSTALL_LOG"
: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash .husky/post-merge )
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 4 ] \
  || fail "post-merge must install all four drivers: $(cat "$MD_INSTALL_LOG")"
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 4 ] \
  || fail "a non-squash merge must truth up all four baselines: $(cat "$MD_TRUTHUP_LOG")"
grep -qxF "lint-ratchet ctx=[]" "$MD_TRUTHUP_LOG" \
  || fail "post-merge truth-up must pass no context arg: $(cat "$MD_TRUTHUP_LOG")"
ok "post-merge installs all drivers and truths up every baseline on a normal merge"

: >"$MD_INSTALL_LOG"
: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash .husky/post-merge 1 )
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 4 ] \
  || fail "a squash merge must still install all four drivers: $(cat "$MD_INSTALL_LOG")"
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 0 ] \
  || fail "a squash merge (flag 1) must skip truth-up: $(cat "$MD_TRUTHUP_LOG")"
ok "post-merge skips truth-up on a squash merge but still installs drivers"
unset MD_INSTALL_LOG MD_TRUTHUP_LOG

# --- post-commit truths up through the shared dispatcher on a merge commit ---
repo=$(make_repo post-commit)
cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
cp "$REPO_ROOT/scripts/lib/verify-commit-queue.sh" "$repo/scripts/lib/verify-commit-queue.sh"
cp "$REPO_ROOT/scripts/lib/verify-fast-commit.sh" "$repo/scripts/lib/verify-fast-commit.sh"
cp "$REPO_ROOT/scripts/lib/verify-markers.sh" "$repo/scripts/lib/verify-markers.sh"
cp "$REPO_ROOT/scripts/lib/verify-path-policy.sh" "$repo/scripts/lib/verify-path-policy.sh"
cp "$REPO_ROOT/scripts/lib/verify-run-meta.sh" "$repo/scripts/lib/verify-run-meta.sh"
cp "$REPO_ROOT/scripts/lib/verify-state-paths.sh" "$repo/scripts/lib/verify-state-paths.sh"
cp "$REPO_ROOT/.husky/post-commit" "$repo/.husky/post-commit"
chmod +x "$repo/.husky/post-commit"
export MD_TRUTHUP_LOG="$repo/pc-truthup.log"

git -C "$repo" commit --allow-empty -qm "base commit for merge fixture"
git -C "$repo" checkout -q -b feature
git -C "$repo" commit --allow-empty -qm "feature commit for merge fixture"
git -C "$repo" checkout -q main
# A merge resolved with a plain commit runs post-commit but never post-merge;
# HEAD^2 then exists so post-commit dispatches the truth-up in post-commit ctx.
git -C "$repo" merge --no-ff -q feature -m "merge feature into main for fixture"

: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash .husky/post-commit )
for m in "${METRICS[@]}"; do
  grep -qxF "$m ctx=[post-commit]" "$MD_TRUTHUP_LOG" \
    || fail "post-commit on a merge commit must truth up $m via the shared dispatcher: $(cat "$MD_TRUTHUP_LOG")"
done
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 4 ] \
  || fail "post-commit merge truth-up should invoke exactly four metrics: $(cat "$MD_TRUTHUP_LOG")"
ok "post-commit truths up every baseline through the shared dispatcher on a merge commit"
unset MD_TRUTHUP_LOG

# --- dispatchers iterate the shared registry, not a hardcoded list -----------
# Replace the copied registry with a five-driver list (the four real drivers
# plus one synthetic) and provide matching install + truth-up stubs only for the
# synthetic driver. If either dispatcher still consumed a hardcoded four-name
# list, the synthetic driver would never be invoked. This pins the acceptance
# that adding a baseline driver is a one-registry-entry change.
repo=$(make_repo registry-consumption)
cat >"$repo/scripts/git/baseline-drivers.sh" <<'EOF'
MUSI_BASELINE_DRIVERS=(
  lint-ratchet
  knip-unused-exports
  near-duplicates
  max-lines-exceptions
  demo-synthetic
)
EOF
cat >"$repo/scripts/git/install-demo-synthetic-merge-driver.sh" <<'EOF'
#!/usr/bin/env bash
printf 'demo-synthetic\n' >> "$MD_INSTALL_LOG"
EOF
cat >"$repo/scripts/git/demo-synthetic-post-merge-baseline-truth-up.sh" <<'EOF'
#!/usr/bin/env bash
printf 'demo-synthetic ctx=[%s]\n' "${1:-}" >> "$MD_TRUTHUP_LOG"
EOF

export MD_INSTALL_LOG="$repo/reg-install.log"
: >"$MD_INSTALL_LOG"
( cd "$repo" && bash scripts/git/install-all-merge-drivers.sh )
grep -qxF 'demo-synthetic' "$MD_INSTALL_LOG" \
  || fail "install dispatcher must iterate the shared registry: $(cat "$MD_INSTALL_LOG")"
[ "$(install_log_lines "$MD_INSTALL_LOG")" -eq 5 ] \
  || fail "install dispatcher should run all five registry drivers: $(cat "$MD_INSTALL_LOG")"
unset MD_INSTALL_LOG

export MD_TRUTHUP_LOG="$repo/reg-truthup.log"
: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash scripts/git/run-baseline-truth-up.sh post-commit )
grep -qxF 'demo-synthetic ctx=[post-commit]' "$MD_TRUTHUP_LOG" \
  || fail "truth-up dispatcher must iterate the shared registry: $(cat "$MD_TRUTHUP_LOG")"
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 5 ] \
  || fail "truth-up dispatcher should run all five registry drivers: $(cat "$MD_TRUTHUP_LOG")"
unset MD_TRUTHUP_LOG
ok "install and truth-up dispatchers iterate the shared baseline-drivers registry"

# --- post-commit merge-marker sweep also consumes the registry ---------------
# On a non-merge commit, post-commit only dispatches the truth-up when it finds a
# pending baseline marker. Leave a marker for the synthetic driver only: if the
# sweep read a hardcoded list it would miss it and never dispatch. The shared
# truth-up dispatcher is stubbed per driver so a dispatch logs all five.
repo=$(make_repo post-commit-registry-sweep)
cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
cp "$REPO_ROOT/scripts/lib/verify-commit-queue.sh" "$repo/scripts/lib/verify-commit-queue.sh"
cp "$REPO_ROOT/scripts/lib/verify-fast-commit.sh" "$repo/scripts/lib/verify-fast-commit.sh"
cp "$REPO_ROOT/scripts/lib/verify-markers.sh" "$repo/scripts/lib/verify-markers.sh"
cp "$REPO_ROOT/scripts/lib/verify-path-policy.sh" "$repo/scripts/lib/verify-path-policy.sh"
cp "$REPO_ROOT/scripts/lib/verify-run-meta.sh" "$repo/scripts/lib/verify-run-meta.sh"
cp "$REPO_ROOT/scripts/lib/verify-state-paths.sh" "$repo/scripts/lib/verify-state-paths.sh"
cp "$REPO_ROOT/.husky/post-commit" "$repo/.husky/post-commit"
chmod +x "$repo/.husky/post-commit"
cat >"$repo/scripts/git/baseline-drivers.sh" <<'EOF'
MUSI_BASELINE_DRIVERS=(
  lint-ratchet
  knip-unused-exports
  near-duplicates
  max-lines-exceptions
  demo-synthetic
)
EOF
cat >"$repo/scripts/git/demo-synthetic-post-merge-baseline-truth-up.sh" <<'EOF'
#!/usr/bin/env bash
printf 'demo-synthetic ctx=[%s]\n' "${1:-}" >> "$MD_TRUTHUP_LOG"
EOF
git -C "$repo" commit --allow-empty -qm "ordinary non-merge commit for sweep fixture"
mkdir -p "$repo/.git/musi"
: >"$repo/.git/musi/demo-synthetic-baseline-postmerge-truth-up-required"
export MD_TRUTHUP_LOG="$repo/sweep-truthup.log"
: >"$MD_TRUTHUP_LOG"
( cd "$repo" && bash .husky/post-commit )
grep -qxF 'demo-synthetic ctx=[post-commit]' "$MD_TRUTHUP_LOG" \
  || fail "post-commit sweep must find a registry-declared driver marker and dispatch: $(cat "$MD_TRUTHUP_LOG")"
[ "$(install_log_lines "$MD_TRUTHUP_LOG")" -eq 5 ] \
  || fail "post-commit sweep dispatch should fan out to all five registry drivers: $(cat "$MD_TRUTHUP_LOG")"
unset MD_TRUTHUP_LOG
ok "post-commit merge-marker sweep consumes the shared baseline-drivers registry"

# --- near-duplicates truth-up error attribution (part 2) ---------------------
# The near-duplicates post-merge truth-up must classify the sensor's exit code:
# a genuine stale-baseline verdict (exit 3) earns the --restore-merge-truth
# recipe, while an environment failure (exit 2, the sensor ran but could
# not evaluate) must surface its real output and NOT recommend restore. The
# marker is consumed only on a clean (exit 0) result.
make_near_dup_truth_up_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo/scripts/git"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  cp "$REPO_ROOT/scripts/git/near-duplicates-post-merge-baseline-truth-up.sh" "$repo/scripts/git/"
  cp "$REPO_ROOT/scripts/git/baseline-post-merge-truth-up.sh" "$repo/scripts/git/"
  git -C "$repo" commit --allow-empty -qm "base commit for near-dup truth-up fixture"
  git -C "$repo" checkout -q -b feature
  git -C "$repo" commit --allow-empty -qm "feature commit for near-dup truth-up fixture"
  git -C "$repo" checkout -q main
  git -C "$repo" merge --no-ff -q feature -m "merge feature into main for near-dup fixture"
  mkdir -p "$repo/.git/musi"
  printf 'near-duplicates baseline semantic merge requires post-merge truth-up\npre-merge-head=%s\n' \
    "$(git -C "$repo" rev-parse HEAD^1)" \
    > "$repo/.git/musi/near-duplicates-baseline-postmerge-truth-up-required"
  printf '%s' "$repo"
}

# A bun stub whose `run sensor:near-duplicates -- --check-baseline` returns a
# controlled exit code and output, driven by env so the same stub covers every
# classification branch.
near_dup_bun_stub_dir="$TMP_ROOT/near-dup-bun-stub"
mkdir -p "$near_dup_bun_stub_dir"
cat >"$near_dup_bun_stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "sensor:near-duplicates" ]; then
  printf '%s\n' "${MUSI_TEST_NEARDUP_OUTPUT:-}"
  exit "${MUSI_TEST_NEARDUP_STATUS:-0}"
fi
exit 0
STUB
chmod +x "$near_dup_bun_stub_dir/bun"

near_dup_marker() {
  printf '%s/.git/musi/near-duplicates-baseline-postmerge-truth-up-required' "$1"
}

run_near_dup_truth_up() {
  local repo="$1" status="$2" output="$3"
  (
    cd "$repo" \
      && PATH="$near_dup_bun_stub_dir:$PATH" \
        MUSI_TEST_NEARDUP_STATUS="$status" \
        MUSI_TEST_NEARDUP_OUTPUT="$output" \
        bash scripts/git/near-duplicates-post-merge-baseline-truth-up.sh post-commit 2>&1
  )
}

repo=$(make_near_dup_truth_up_repo near-dup-stale)
output=$(run_near_dup_truth_up "$repo" 3 "presentation text is not the verdict contract")
grep -qF -- "--restore-merge-truth" <<<"$output" \
  || fail "a stale (exit 3) baseline should recommend --restore-merge-truth: $output"
grep -qF "is stale" <<<"$output" \
  || fail "a stale baseline should be reported as stale: $output"
[ -f "$(near_dup_marker "$repo")" ] \
  || fail "a stale baseline must keep the truth-up marker for retry"
ok "near-duplicates truth-up recommends restore only on a genuine stale verdict"

repo=$(make_near_dup_truth_up_repo near-dup-unreviewed-growth)
output=$(run_near_dup_truth_up "$repo" 6 "presentation text is not the verdict contract")
grep -qF "proposes unreviewed growth over HEAD" <<<"$output" \
  || fail "exit 6 should report unreviewed baseline growth as a verdict: $output"
grep -qF "environment failure" <<<"$output" \
  && fail "unreviewed baseline growth must not be reported as an environment failure: $output"
[ -f "$(near_dup_marker "$repo")" ] \
  || fail "unreviewed baseline growth must keep the truth-up marker for retry"
ok "near-duplicates truth-up classifies unreviewed growth by exit code"

repo=$(make_near_dup_truth_up_repo near-dup-env-fail)
output=$(run_near_dup_truth_up "$repo" 2 "ERROR: collectNearDuplicates failed: similarity-ts engine unavailable")
grep -qF "ERROR: collectNearDuplicates failed" <<<"$output" \
  || fail "an environment failure should surface the sensor's real output: $output"
grep -qF "environment failure" <<<"$output" \
  || fail "an environment failure should be labelled as such, not staleness: $output"
grep -qF -- "--restore-merge-truth" <<<"$output" \
  && fail "an environment failure must NOT recommend --restore-merge-truth: $output"
grep -qF "is stale" <<<"$output" \
  && fail "an environment failure must NOT be misreported as a stale baseline: $output"
[ -f "$(near_dup_marker "$repo")" ] \
  || fail "an environment failure must keep the truth-up marker for retry"
ok "near-duplicates truth-up surfaces environment failures instead of the restore recipe"

repo=$(make_near_dup_truth_up_repo near-dup-truthful)
output=$(run_near_dup_truth_up "$repo" 0 "OK: whole-repo near-duplicate baseline matches 7 identities")
grep -qF "verified truthful" <<<"$output" \
  || fail "a truthful (exit 0) baseline should be reported verified: $output"
[ ! -f "$(near_dup_marker "$repo")" ] \
  || fail "a truthful baseline should consume the truth-up marker"
ok "near-duplicates truth-up consumes the marker only on a truthful baseline"

# The three retained Musi shims over the package executable must keep forwarding
# the public command and adapter contract. The package behavior itself is
# exercised below by stage restore and in its Vitest project.
wrapper_repo="$TMP_ROOT/lint-ratchet-wrapper-forwarding"
wrapper_bin="$TMP_ROOT/lint-ratchet-wrapper-bin"
wrapper_log="$TMP_ROOT/lint-ratchet-wrapper.log"
wrapper_no_bun="$TMP_ROOT/lint-ratchet-wrapper-no-bun"
mkdir -p "$wrapper_repo" "$wrapper_bin" "$wrapper_no_bun"
git -C "$wrapper_repo" init -q
ln -s "$REPO_ROOT/scripts" "$wrapper_repo/scripts"
cat >"$wrapper_bin/bun" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$MUSI_WRAPPER_LOG"
EOF
chmod +x "$wrapper_bin/bun"
for tool in bash dirname; do
  ln -s "$(command -v "$tool")" "$wrapper_no_bun/$tool"
done
: >"$wrapper_log"
(
  cd "$wrapper_repo"
  PATH="$wrapper_bin:$PATH" MUSI_WRAPPER_LOG="$wrapper_log" \
    bash scripts/git/install-lint-ratchet-merge-driver.sh
  PATH="$wrapper_bin:$PATH" MUSI_WRAPPER_LOG="$wrapper_log" \
    bash scripts/git/check-lint-ratchet-merge-driver.sh
  PATH="$wrapper_bin:$PATH" MUSI_WRAPPER_LOG="$wrapper_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-commit
  PATH="$wrapper_bin:$PATH" MUSI_WRAPPER_LOG="$wrapper_log" \
    MUSI_RATCHET_POSTMERGE=full \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-merge
)
grep -qF -- "-- install --adapter scripts/lint-ratchet/engine-binding.ts" "$wrapper_log" \
  || fail "lint-ratchet installer shim should forward the package install contract"
grep -qF -- "-- check --adapter scripts/lint-ratchet/engine-binding.ts" "$wrapper_log" \
  || fail "lint-ratchet checker shim should forward the package check contract"
grep -qF -- "-- post-merge --adapter scripts/lint-ratchet/engine-binding.ts -- post-commit" "$wrapper_log" \
  || fail "lint-ratchet truth-up shim should forward post-commit context"
grep -qF -- "-- post-merge --adapter scripts/lint-ratchet/engine-binding.ts -- --full post-merge" "$wrapper_log" \
  || fail "lint-ratchet truth-up shim should forward forced-full mode"
ok "lint-ratchet root shims forward the package-owned executable contract"

set +e
wrapper_no_bun_out=$(cd "$wrapper_repo" && PATH="$wrapper_no_bun" \
  bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-commit 2>&1)
wrapper_no_bun_status=$?
set -e
[ "$wrapper_no_bun_status" -eq 0 ] \
  || fail "lint-ratchet truth-up shim should stay advisory without Bun, got $wrapper_no_bun_status: $wrapper_no_bun_out"
[ -z "$wrapper_no_bun_out" ] \
  || fail "lint-ratchet truth-up shim should stay quiet without Bun: $wrapper_no_bun_out"
ok "lint-ratchet truth-up shim preserves markers quietly when Bun is unavailable"

nobun_bin="$TMP_ROOT/lint-ratchet-wrapper-nobun-bin"
mkdir -p "$nobun_bin"
ln -s "$(command -v bash)" "$nobun_bin/bash"
output=$(cd "$wrapper_repo" && PATH="$nobun_bin" \
  "$nobun_bin/bash" scripts/git/install-lint-ratchet-merge-driver.sh 2>&1) \
  || fail "lint-ratchet installer should stay advisory when Bun is absent: $output"
[ -z "$output" ] \
  || fail "lint-ratchet installer should be silent when Bun is absent: $output"
ok "lint-ratchet installer stays advisory in Bun-less Git hook environments"

assert_generated_baseline_stage_restore() {
  local repo="$TMP_ROOT/generated-baseline-stage-restore"
  local output path status
  local -a baselines=(
    "lint-ratchet.baseline.json"
    "sensor-knip-unused-exports.baseline.json"
    "eslint-config/max-lines-exceptions.baseline.json"
  )

  grep -qF '"baseline:restore-stage": "bash scripts/git/restore-generated-baseline-stage.sh"' \
    package.json \
    || fail "package scripts should expose baseline:restore-stage"

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  mkdir -p "$repo/eslint-config" "$repo/nested/invoke"
  ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"

  for path in "${baselines[@]}"; do
    printf 'base:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" add .
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  for path in "${baselines[@]}"; do
    printf 'theirs:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" commit -qam theirs

  git -C "$repo" checkout -q main
  for path in "${baselines[@]}"; do
    printf 'ours:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" commit -qam ours

  set +e
  git -C "$repo" merge side >"$TMP_ROOT/generated-baseline-merge.out" 2>&1
  status=$?
  set -e
  [ "$status" -ne 0 ] \
    || fail "generated baseline fixture merge should conflict"

  for path in "${baselines[@]}"; do
    (cd "$repo/nested/invoke" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
      --ours "$path") \
      || fail "stage restore should restore stage 2 for $path"
    [ "$(cat "$repo/$path")" = "ours:$path" ] \
      || fail "--ours should write stage 2 for $path"

    (cd "$repo/nested/invoke" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
      --theirs "$path") \
      || fail "stage restore should restore stage 3 for $path"
    [ "$(cat "$repo/$path")" = "theirs:$path" ] \
      || fail "--theirs should write stage 3 for $path"
  done

  set +e
  output=$(cd "$repo/nested/invoke" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
    --ours docs/not-a-generated-baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 2 ] \
    || fail "stage restore should reject an unknown path with exit 2, got $status: $output"
  grep -qF "usage: bun run baseline:restore-stage -- --ours|--theirs <baseline>" <<<"$output" \
    || fail "stage restore unknown-path error should name its public usage: $output"
  grep -qF "configured generated baselines: lint-ratchet.baseline.json, sensor-knip-unused-exports.baseline.json, eslint-config/max-lines-exceptions.baseline.json" <<<"$output" \
    || fail "stage restore unknown-path error should name its narrow scope: $output"

  git -C "$repo" merge --abort
  set +e
  output=$(cd "$repo/nested/invoke" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
    --ours lint-ratchet.baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ] \
    || fail "stage restore should fail outside a conflict operation, got $status: $output"
  grep -qF "no merge, cherry-pick, or rebase conflict is in progress" <<<"$output" \
    || fail "stage restore should explain the missing conflict operation: $output"
  grep -qF "git show HEAD^:lint-ratchet.baseline.json > lint-ratchet.baseline.json" <<<"$output" \
    || fail "stage restore should retain the parent recovery hint: $output"
}

write_knip_merge_driver_baseline() {
  local file=$1
  shift
  local count=$#
  local index=0 symbol
  {
    printf '{\n'
    printf '  "version": 2,\n'
    printf '  "tool": "knip",\n'
    printf '  "metric": "unused-export-symbols",\n'
    printf '  "includeCategories": "exports,types,enumMembers,namespaceMembers,unlisted,dependencies",\n'
    printf '  "summary": {\n'
    printf '    "count": %s,\n' "$count"
    printf '    "categories": {\n'
    printf '      "exports": %s,\n' "$count"
    printf '      "types": 0,\n'
    printf '      "enumMembers": 0,\n'
    printf '      "namespaceMembers": 0\n'
    printf '    }\n'
    printf '  },\n'
    printf '  "entries": [\n'
    for symbol in "$@"; do
      index=$((index + 1))
      printf '    {\n'
      printf '      "key": "exports|src/a.ts|%s",\n' "$symbol"
      printf '      "path": "src/a.ts",\n'
      printf '      "category": "exports",\n'
      printf '      "symbol": "%s"\n' "$symbol"
      if [ "$index" -eq "$count" ]; then
        printf '    }\n'
      else
        printf '    },\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } >"$file"
}

write_max_lines_exceptions_merge_driver_baseline() {
  local file=$1
  shift
  local count=$#
  local cap=${MAX_LINES_EXCEPTION_CAP:-400}
  local index=0 path
  {
    printf '{\n'
    printf '  "version": 2,\n'
    printf '  "tool": "eslint-max-lines",\n'
    printf '  "metric": "file-line-cap-exceptions",\n'
    printf '  "summary": {\n'
    printf '    "count": %s\n' "$count"
    printf '  },\n'
    printf '  "entries": [\n'
    for path in "$@"; do
      index=$((index + 1))
      printf '    {\n'
      printf '      "path": "%s",\n' "$path"
      printf '      "cap": %s,\n' "$cap"
      printf '      "severity": "warn",\n'
      printf '      "reason": "legacy file pending split",\n'
      printf '      "lifecycle": "candidate-for-split",\n'
      printf '      "ratchetExcluded": true\n'
      if [ "$index" -eq "$count" ]; then
        printf '    }\n'
      else
        printf '    },\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } >"$file"
}

assert_knip_unused_exports_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/knip-merge-driver-real-semantic"
  local fake_bin="$TMP_ROOT/knip-merge-driver-truth-up-bin"
  local git_common_dir git_dir installed_driver marker_content marker_file output status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"

  (cd "$repo" && bash scripts/git/install-knip-unused-exports-merge-driver.sh) >/dev/null \
    || fail "knip semantic merge-driver install failed"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  [ -x "$installed_driver" ] \
    || fail "knip merge-driver installer should copy an executable driver into the git common dir"
  (
    cd "$repo"
    bash scripts/git/check-knip-unused-exports-merge-driver.sh
  ) >"$TMP_ROOT/knip-merge-driver-check.out"
  [ "$(cat "$TMP_ROOT/knip-merge-driver-check.out")" = "PASS: knip unused-exports merge driver is installed and current" ] \
    || fail "knip merge-driver health check should pass when current: $(cat "$TMP_ROOT/knip-merge-driver-check.out")"
  [ "$(git -C "$repo" check-attr merge -- sensor-knip-unused-exports.baseline.json)" = "sensor-knip-unused-exports.baseline.json: merge: knip-unused-exports-baseline" ] \
    || fail "knip merge-driver install should mirror the anchored baseline driver attribute"

  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
  esac

  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a c
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side >"$TMP_ROOT/knip-merge-driver-real.out" \
    2>"$TMP_ROOT/knip-merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real knip baseline git merge should succeed: $(cat "$TMP_ROOT/knip-merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- sensor-knip-unused-exports.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real knip baseline git merge should leave no unmerged stages"
  BASELINE="$repo/sensor-knip-unused-exports.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    if (parsed.summary.count !== parsed.entries.length) {
      assertionFailed(`summary ${parsed.summary.count} vs entries ${parsed.entries.length}`);
    }
    if (parsed.summary.count !== 1 || parsed.entries[0]?.symbol !== "c") {
      assertionFailed(`unexpected merged baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real knip baseline git merge should keep the shared drained-entry intersection"
  [ -s "$marker_file" ] \
    || fail "real knip baseline git merge should leave a post-merge truth-up marker"
  marker_content=$(cat "$marker_file")
  [ "$marker_content" = "$(printf 'knip unused-exports baseline semantic merge requires post-merge truth-up\npre-merge-head=%s' "$(git -C "$repo" rev-parse HEAD^1)")" ] \
    || fail "real knip baseline git merge should write a pre-merge-head marker while MERGE_HEAD is unavailable to the driver: $marker_content"

  mkdir -p "$fake_bin"
  cat >"$fake_bin/bun" <<'EOF'
#!/usr/bin/env bash
[ "$*" = "run sensor:knip-unused-exports" ] || exit 99
exit 0
EOF
  chmod +x "$fake_bin/bun"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh post-commit 2>&1) \
    || fail "knip truth-up should stay advisory after a real semantic merge"
  grep -qF "post-commit: merged knip unused-export baseline verified truthful" <<<"$output" \
    || fail "knip truth-up should verify the real semantic merge: $output"
  [ ! -e "$marker_file" ] \
    || fail "knip truth-up should consume the real merge marker after verification"
}

assert_knip_unused_exports_post_merge_truth_up() {
  assert_knip_unused_exports_merge_driver_real_semantic_merge
}

assert_max_lines_exceptions_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/max-lines-merge-driver-real-semantic"
  local git_common_dir installed_driver status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config"

  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines exceptions semantic merge-driver install failed"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  [ -x "$installed_driver" ] \
    || fail "max-lines exceptions merge-driver installer should copy an executable driver into the git common dir"
  (
    cd "$repo"
    bash scripts/git/check-max-lines-exceptions-merge-driver.sh
  ) >"$TMP_ROOT/max-lines-merge-driver-check.out"
  [ "$(cat "$TMP_ROOT/max-lines-merge-driver-check.out")" = "PASS: max-lines exceptions merge driver is installed and current" ] \
    || fail "max-lines exceptions merge-driver health check should pass when current: $(cat "$TMP_ROOT/max-lines-merge-driver-check.out")"
  [ "$(git -C "$repo" check-attr merge -- eslint-config/max-lines-exceptions.baseline.json)" = "eslint-config/max-lines-exceptions.baseline.json: merge: max-lines-exceptions-baseline" ] \
    || fail "max-lines exceptions merge-driver install should mirror the anchored nested baseline driver attribute"
  [ "$(git -C "$repo" check-attr merge -- nested/eslint-config/max-lines-exceptions.baseline.json)" = "nested/eslint-config/max-lines-exceptions.baseline.json: merge: unspecified" ] \
    || fail "max-lines exceptions baseline attribute should not match nested paths"

  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/b.ts src/c.ts
  git -C "$repo" add eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/b.ts src/c.ts
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/c.ts
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side >"$TMP_ROOT/max-lines-merge-driver-real.out" \
    2>"$TMP_ROOT/max-lines-merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real max-lines exceptions baseline git merge should succeed: $(cat "$TMP_ROOT/max-lines-merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- eslint-config/max-lines-exceptions.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real max-lines exceptions baseline git merge should leave no unmerged stages"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" REPO_ROOT="$REPO_ROOT" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const { checkMaxLinesExceptionsBaseline } = await import(`${process.env.REPO_ROOT}/scripts/max-lines-exceptions-core.ts`);
    const text = readFileSync(process.env.BASELINE, "utf8");
    const checked = checkMaxLinesExceptionsBaseline(text);
    if (!checked.ok) assertionFailed(checked.error);
    const parsed = JSON.parse(text);
    if (parsed.summary.count !== parsed.entries.length) {
      assertionFailed(`summary ${parsed.summary.count} vs entries ${parsed.entries.length}`);
    }
    if (parsed.summary.count !== 1 || parsed.entries[0]?.path !== "src/c.ts") {
      assertionFailed(`unexpected merged baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real max-lines exceptions baseline git merge should keep the shared drained-entry intersection and pass its hard-fail gate"
}

assert_max_lines_exceptions_merge_driver_real_truth_up_advisory() {
  local repo="$TMP_ROOT/max-lines-merge-driver-real-truth-up"
  local git_dir marker_file status

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config" "$repo/.githooks" "$repo/src"
  cp "$REPO_ROOT/.gitattributes" "$repo/.gitattributes"
  cat >"$repo/.githooks/post-merge" <<'SH'
#!/usr/bin/env bash
bash scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh
SH
  chmod +x "$repo/.githooks/post-merge"
  git -C "$repo" config core.hooksPath .githooks

  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines truth-up semantic merge-driver install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required" ;;
  esac

  yes '// source line' | head -n 425 >"$repo/src/a.ts" || true
  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" add .gitattributes .githooks/post-merge src/a.ts \
    eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam side-cap

  git -C "$repo" checkout -q main
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam main-cap

  set +e
  git -C "$repo" merge --no-ff -m semantic-cap-merge side \
    >"$TMP_ROOT/max-lines-merge-driver-truth-up.out" \
    2>"$TMP_ROOT/max-lines-merge-driver-truth-up.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real max-lines cap-conflict git merge should succeed: $(cat "$TMP_ROOT/max-lines-merge-driver-truth-up.err")"
  grep -qF "post-merge: max-lines exception merge needs truth-up" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "real max-lines cap-conflict merge should print a local truth-up advisory: $(cat "$TMP_ROOT/max-lines-merge-driver-truth-up.err")"
  grep -qF "bun run lint:max-lines-exceptions:update" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should include the update command"
  grep -qF "bun run lint:max-lines-exceptions" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should include the check command"
  grep -qF \
    "commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should lead with the follow-up commit option"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    if (parsed.summary.count !== 1 || parsed.entries[0]?.cap !== 420) {
      assertionFailed(`unexpected merged cap baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real max-lines cap-conflict merge should keep the strict minimum cap"
  [ ! -e "$marker_file" ] \
    || fail "max-lines post-merge hook should consume the matching truth-up marker"

  printf 'truth-up required\npre-merge-head=%s\n' "$(printf 'a%.0s' {1..40})" >"$marker_file"
  set +e
  output=$(cd "$repo" && bash scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] || fail "max-lines stale-marker cleanup should stay advisory"
  [ "$output" = "post-merge: ignoring stale max-lines exceptions truth-up marker" ] \
    || fail "max-lines stale marker should be reported and ignored: $output"
  [ ! -e "$marker_file" ] || fail "max-lines stale marker should be consumed"
}

write_near_duplicates_merge_driver_baseline() {
  local file=$1
  shift
  NEAR_DUPLICATES_BASELINE="$file" NEAR_DUPLICATES_NAMES="$*" REPO_ROOT="$REPO_ROOT" bun -e '
    const { formatNearDuplicatesBaseline } = await import(
      `${process.env.REPO_ROOT}/scripts/sensor-near-duplicates.js`
    );
    const entries = (process.env.NEAR_DUPLICATES_NAMES ?? "")
      .split(" ")
      .filter(Boolean)
      .map((name) => {
        const leftFile = `src/${name}-left.ts`;
        const rightFile = `src/${name}-right.ts`;
        const left = `${leftFile}#left`;
        const right = `${rightFile}#right`;
        return { key: `${left} <=> ${right}`, left, right, leftFile, rightFile, count: 1 };
      });
    await Bun.write(process.env.NEAR_DUPLICATES_BASELINE, formatNearDuplicatesBaseline(entries));
  '
}

assert_near_duplicates_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/near-duplicates-merge-driver-real-semantic"
  local git_dir marker_file status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"

  (cd "$repo" && bash scripts/git/install-near-duplicates-merge-driver.sh) >/dev/null \
    || fail "near-duplicates semantic merge-driver install failed"
  (cd "$repo" && bash scripts/git/check-near-duplicates-merge-driver.sh) \
    >"$TMP_ROOT/near-duplicates-merge-driver-check.out"
  grep -qxF "PASS: near-duplicates merge driver is installed and current" \
    "$TMP_ROOT/near-duplicates-merge-driver-check.out" \
    || fail "near-duplicates merge-driver health check should pass when current"

  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in /*) ;; *) git_dir="$repo/$git_dir" ;; esac
  marker_file="$git_dir/musi/near-duplicates-baseline-postmerge-truth-up-required"

  write_near_duplicates_merge_driver_baseline \
    "$repo/sensor-near-duplicates.baseline.json" shared current-drain other-drain
  git -C "$repo" add sensor-near-duplicates.baseline.json
  git -C "$repo" commit -qm base
  git -C "$repo" checkout -q -b side
  write_near_duplicates_merge_driver_baseline \
    "$repo/sensor-near-duplicates.baseline.json" shared current-drain
  git -C "$repo" commit -qam side
  git -C "$repo" checkout -q main
  write_near_duplicates_merge_driver_baseline \
    "$repo/sensor-near-duplicates.baseline.json" shared other-drain
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side \
    >"$TMP_ROOT/near-duplicates-merge-driver-real.out" \
    2>"$TMP_ROOT/near-duplicates-merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real near-duplicates baseline git merge should succeed: $(cat "$TMP_ROOT/near-duplicates-merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- sensor-near-duplicates.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real near-duplicates baseline git merge should leave no unmerged stages"
  BASELINE="$repo/sensor-near-duplicates.baseline.json" bun -e '
    const parsed = await Bun.file(process.env.BASELINE).json();
    if (parsed.entries.length !== 1 || !parsed.entries[0]?.key.includes("shared")) process.exit(1);
  ' || fail "real near-duplicates merge should keep only the shared reviewed debt"
  [ -s "$marker_file" ] \
    || fail "real near-duplicates baseline git merge should leave a truth-up marker"
}

assert_knip_driverless_merge_blocks_summary_drift() {
  local repo="$TMP_ROOT/knip-driverless-text-merge"
  local output status

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c d e
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base
  git -C "$repo" checkout -q -b side
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c d e
  git -C "$repo" commit -qam side-drain
  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c d
  git -C "$repo" commit -qam main-drain
  git -C "$repo" merge --no-ff -m driverless-text-merge side >/dev/null 2>&1 \
    || fail "driverless disjoint knip drains should merge textually"

  set +e
  output=$(FIXTURE_REPO="$repo" bun -e '
    import { runKnipUnusedExportsCli } from "./scripts/sensor-knip-unused-exports-core.ts";
    const reportJson = JSON.stringify({
      issues: [{ file: "src/a.ts", exports: [{ name: "b" }, { name: "c" }, { name: "d" }] }],
    });
    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: process.env.FIXTURE_REPO,
      runner: () => ({ ok: true, reportJson, exitCode: 1, stderr: "" }),
    });
    console.log(result.stdout);
    process.exitCode = result.exitCode;
  ' 2>&1)
  status=$?
  set -e
  [ "$status" -eq 4 ] \
    || fail "driverless knip summary drift should block with exit 4, got $status: $output"
  grep -qF 'baseline summary does not match the entries' <<<"$output" \
    || fail "driverless knip drift should identify the stale summary: $output"
  grep -qF 'bun scripts/sensor-knip-unused-exports.ts --update' <<<"$output" \
    || fail "driverless knip drift should print its update command: $output"
}

assert_max_lines_real_additions_merge() {
  local repo="$TMP_ROOT/max-lines-real-additions"
  local status

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config"
  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines additions driver install failed"
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/c.ts
  git -C "$repo" add eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base
  git -C "$repo" checkout -q -b side
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/b.ts src/c.ts
  git -C "$repo" commit -qam side-addition
  git -C "$repo" checkout -q main
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/c.ts
  git -C "$repo" commit -qam main-addition
  set +e
  git -C "$repo" merge --no-ff -m semantic-additions side >/dev/null 2>&1
  status=$?
  set -e
  [ "$status" -eq 0 ] || fail "max-lines additions semantic merge failed"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" bun -e '
    const baseline = await Bun.file(process.env.BASELINE).json();
    const paths = baseline.entries.map((entry) => entry.path);
    if (baseline.summary.count !== 3 || paths.join(",") !== "src/a.ts,src/b.ts,src/c.ts") {
      process.exit(1);
    }
  ' || fail "max-lines semantic merge should preserve disjoint additions from both branches"
}

assert_knip_stale_cherry_pick_marker_is_ignored() {
  local repo="$TMP_ROOT/knip-stale-cherry-marker"
  local fake_bin="$TMP_ROOT/knip-stale-cherry-bin"
  local git_dir marker output pre_pick_head

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  (cd "$repo" && bash scripts/git/install-knip-unused-exports-merge-driver.sh) >/dev/null \
    || fail "knip cherry-pick marker driver install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in /*) ;; *) git_dir="$repo/$git_dir" ;; esac
  marker="$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required"
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base
  git -C "$repo" checkout -q -b picked
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c
  printf 'picked\n' >"$repo/picked.txt"
  git -C "$repo" add sensor-knip-unused-exports.baseline.json picked.txt
  git -C "$repo" commit -qm picked
  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a c
  git -C "$repo" commit -qam main
  pre_pick_head=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" cherry-pick picked >"$TMP_ROOT/knip-cherry.out" 2>&1 \
    || fail "knip cherry-pick fixture should resolve semantically: $(cat "$TMP_ROOT/knip-cherry.out")"
  grep -qF "pre-merge-head=$pre_pick_head" "$marker" \
    || fail "knip cherry-pick should stamp its pre-pick HEAD"
  git -C "$repo" checkout -q -b unrelated
  printf 'unrelated\n' >"$repo/unrelated.txt"
  git -C "$repo" add unrelated.txt
  git -C "$repo" commit -qm unrelated
  git -C "$repo" checkout -q main
  git -C "$repo" merge -q --no-ff -m unrelated-merge unrelated
  mkdir -p "$fake_bin"
  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
exit 99
SH
  chmod +x "$fake_bin/bun"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip stale-marker cleanup should stay advisory"
  [ "$output" = "post-merge: ignoring stale knip unused-exports truth-up marker" ] \
    || fail "knip stale cherry-pick marker should be reported and ignored: $output"
  [ ! -e "$marker" ] || fail "knip stale cherry-pick marker should be consumed"
}

assert_retained_installers_serialize_first_install() {
  local repo="$TMP_ROOT/concurrent-retained-installers"
  local fake_bin="$TMP_ROOT/concurrent-retained-bin"
  local real_git knip_pid max_pid

  git -C "$TMP_ROOT" init -q -b main "$repo"
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$fake_bin"
  real_git=$(command -v git) || fail "concurrent installer smoke needs git"
  cat >"$fake_bin/git" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${1:-}" = config ] && [ "${2:-}" = --local ] && [ "${3:-}" != --get ]; then
  if mkdir "$CONFIG_WRITE_CLAIM" 2>/dev/null; then
    : >"$SIMULATED_CONFIG_LOCK"
    sleep 1
    rm -f "$SIMULATED_CONFIG_LOCK"
  fi
fi
exec "$REAL_GIT" "$@"
SH
  chmod +x "$fake_bin/git"
  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$TMP_ROOT/config-write-claim" \
      SIMULATED_CONFIG_LOCK="$repo/.git/config.lock" REAL_GIT="$real_git" \
      PATH="$fake_bin:$PATH" bash scripts/git/install-knip-unused-exports-merge-driver.sh
  ) >"$TMP_ROOT/concurrent-knip.out" 2>&1 &
  knip_pid=$!
  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$TMP_ROOT/config-write-claim" \
      SIMULATED_CONFIG_LOCK="$repo/.git/config.lock" REAL_GIT="$real_git" \
      PATH="$fake_bin:$PATH" bash scripts/git/install-max-lines-exceptions-merge-driver.sh
  ) >"$TMP_ROOT/concurrent-max.out" 2>&1 &
  max_pid=$!
  wait "$knip_pid" || fail "concurrent knip install failed: $(cat "$TMP_ROOT/concurrent-knip.out")"
  wait "$max_pid" || fail "concurrent max-lines install failed: $(cat "$TMP_ROOT/concurrent-max.out")"
  git -C "$repo" config --get merge.knip-unused-exports-baseline.driver >/dev/null \
    || fail "concurrent install lost knip Git config"
  git -C "$repo" config --get merge.max-lines-exceptions-baseline.driver >/dev/null \
    || fail "concurrent install lost max-lines Git config"
  grep -qxF '# BEGIN musi knip unused-exports baseline driver attributes' \
    "$repo/.git/info/attributes" || fail "concurrent install lost the knip attributes block"
  grep -qxF '# BEGIN musi max-lines exceptions baseline driver attributes' \
    "$repo/.git/info/attributes" || fail "concurrent install lost the max-lines attributes block"
}

assert_packaged_and_retained_installers_serialize_first_install() {
  local repo="$TMP_ROOT/concurrent-packaged-retained-installers"
  local fake_bin="$TMP_ROOT/concurrent-packaged-retained-bin"
  local real_git lint_pid knip_pid

  git -C "$TMP_ROOT" init -q -b main "$repo"
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"
  cat >"$repo/adapter.ts" <<'TS'
import type { LintRatchetGitRailAdapter } from "@musi/lint-ratchet/git-rail/executable-config.js";

const workflowVocabulary = {
  updateCommand: "ratchet update",
  regressionUpdateCommand: "ratchet accept",
  debtAcceptanceCommand: "ratchet accept",
  installMergeDriverCommand: "ratchet install",
  restoreBaselineOursCommand: (path: string) => `ratchet restore ${path}`,
  trendAllCommand: "ratchet trend",
};

export const lintRatchetGitRailAdapter: LintRatchetGitRailAdapter = {
  baselineFile: "lint-ratchet.baseline.json",
  debtLogFile: "lint-ratchet.debt-log.jsonl",
  executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
  checkBaselineCommand: ["true"],
  worseBaselineExitCode: 3,
  workflowVocabulary,
  binding: { repoRoot: process.cwd(), thirdPartyPluginAllowlist: [] },
  ratchets: [],
};
TS
  mkdir -p "$fake_bin"
  real_git=$(command -v git) || fail "concurrent packaged installer smoke needs git"
  cat >"$fake_bin/git" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${1:-}" = config ] && [ "${2:-}" = --local ] && [ "${3:-}" != --get ]; then
  if mkdir "$CONFIG_WRITE_CLAIM" 2>/dev/null; then
    : >"$SIMULATED_CONFIG_LOCK"
    sleep 1
    rm -f "$SIMULATED_CONFIG_LOCK"
  fi
fi
exec "$REAL_GIT" "$@"
SH
  chmod +x "$fake_bin/git"
  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$TMP_ROOT/packaged-config-write-claim" \
      SIMULATED_CONFIG_LOCK="$repo/.git/config.lock" REAL_GIT="$real_git" \
      PATH="$fake_bin:$PATH" bun -e \
        'import("@musi/lint-ratchet/git-rail/executable-cli.js").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' \
        -- install --adapter adapter.ts
  ) >"$TMP_ROOT/concurrent-lint.out" 2>&1 &
  lint_pid=$!
  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$TMP_ROOT/packaged-config-write-claim" \
      SIMULATED_CONFIG_LOCK="$repo/.git/config.lock" REAL_GIT="$real_git" \
      PATH="$fake_bin:$PATH" bash scripts/git/install-knip-unused-exports-merge-driver.sh
  ) >"$TMP_ROOT/concurrent-packaged-knip.out" 2>&1 &
  knip_pid=$!
  wait "$lint_pid" \
    || fail "concurrent packaged lint-ratchet install failed: $(cat "$TMP_ROOT/concurrent-lint.out")"
  wait "$knip_pid" \
    || fail "concurrent retained knip install failed: $(cat "$TMP_ROOT/concurrent-packaged-knip.out")"
  git -C "$repo" config --get merge.lint-ratchet-baseline.driver >/dev/null \
    || fail "concurrent install lost packaged lint-ratchet Git config: $(cat "$TMP_ROOT/concurrent-lint.out")"
  git -C "$repo" config --get merge.knip-unused-exports-baseline.driver >/dev/null \
    || fail "concurrent install lost retained knip Git config"
  grep -qxF '# BEGIN musi lint-ratchet baseline driver attributes' \
    "$repo/.git/info/attributes" || fail "concurrent install lost packaged attributes block"
  grep -qxF '# BEGIN musi knip unused-exports baseline driver attributes' \
    "$repo/.git/info/attributes" || fail "concurrent install lost retained attributes block"
}

assert_lint_ratchet_merge_recipe_docs_match_driver() {
  bun run scripts/generate-baseline-conflict-recipes.ts --check \
    || fail "baseline conflict recipe docs drifted from the driver"
}

assert_retired_lint_ratchet_driver_key_has_migration_hint() {
  local output status
  set +e
  output=$(bash scripts/git/baseline-merge-driver.sh lint-ratchet 2>&1)
  status=$?
  set -e
  [ "$status" -eq 2 ] \
    || fail "retired lint-ratchet driver key should stop with exit 2, got $status: $output"
  grep -qF 'bun run lint:ratchet:install-merge-driver' <<<"$output" \
    || fail "retired lint-ratchet driver key should name its migration repair: $output"
}

assert_max_lines_exceptions_fallback_recipe() {
  local driver=scripts/git/baseline-merge-driver.sh
  local guide=docs/guides/lint-ratchet-merges.md

  grep -qF 'git show :2:$path' "$driver" \
    || fail "max-lines fallback should show the kept stage-2 configuration"
  grep -qF 'git show :3:$path' "$driver" \
    || fail "max-lines fallback should show the other stage-3 configuration"
  grep -qF "Hand-edit the kept file's entries to incorporate the other side's intended cap changes" \
    "$driver" || fail "max-lines fallback should require reconciling other-side cap changes"
  grep -qF 'bun run lint:max-lines-exceptions:update' "$driver" \
    || fail "max-lines fallback should normalize the reconciled configuration"
  grep -qF 'bun run lint:max-lines-exceptions' "$driver" \
    || fail "max-lines fallback should validate the reconciled configuration"
  grep -qFx '  bun run lint' "$driver" \
    || fail "max-lines fallback should confirm caps suffice for merged source"
  grep -qF 'Max-lines fallback is different: its entries are human-chosen caps' "$guide" \
    || fail "merge guide should distinguish max-lines config reconciliation"
  grep -qF 'does not regenerate entries from the merged tree' "$guide" \
    || fail "merge guide should state the max-lines update limitation"
  grep -qF 'reconcile its entries from stages 2 and 3 before running the update' "$guide" \
    || fail "driverless max-lines recovery should reconcile both sides before update"
  grep -qF 'full-lint commit gate' "$guide" \
    || fail "merge guide should require a merged-source cap sufficiency check"
}

assert_entry_baseline_fallback_rebase_guidance() {
  local driver=scripts/git/baseline-merge-driver.sh
  local recipe body
  for recipe in knip-unused-exports max-lines-exceptions; do
    body=$(awk -v key="$recipe" '
      { line = $0; sub(/^[[:space:]]+/, "", line) }
      /print_conflict_recovery\(\)/ { in_fn = 1 }
      in_fn && line == key ")" { in_case = 1 }
      in_case && /cat >&2 <<EOF/ { in_body = 1; next }
      in_body && line == "EOF" { exit }
      in_body { print }
    ' "$driver")
    [ -n "$body" ] || fail "could not extract the $recipe recovery recipe"
    grep -qF "That is the current branch during git merge and git cherry-pick." <<<"$body" \
      || fail "$recipe recipe should identify the kept side"
    grep -qF "During git rebase the sides are swapped" <<<"$body" \
      || fail "$recipe recipe should explain the rebase side swap"
    grep -qF "base, not the branch being rebased." <<<"$body" \
      || fail "$recipe recipe should identify the kept rebase side"
  done
}

assert_policy_safe_recovery_docs() {
  if grep -R -n -E 'checkout --our[s]|checkout --their[s]' docs scripts; then
    fail "generated baseline recovery docs must not use policy-blocked checkout commands"
  fi
  grep -qF 'bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json' \
    docs/guides/lint-ratchet-merges.md \
    || fail "merge guide should use the policy-safe stage restore command"
  grep -qF 'During rebase Git swaps the sides' docs/guides/lint-ratchet-merges.md \
    || fail "merge guide should explain the rebase side swap"
  grep -qF 'stage 2 is the' docs/guides/lint-ratchet-merges.md \
    || fail "merge guide should identify stage 2 as the rebase upstream base"
  if grep -qF 'during rebase the sides swap, so use `--theirs`' \
      tools/lint-ratchet/src/kernel/entry-baseline.ts \
      tools/lint-ratchet/src/kernel/baseline-validation.ts \
      eslint-config/max-lines-policy.js docs/guides/lint-ratchet-merges.md; then
    fail "driverless recovery guidance must keep stage 2 during rebase"
  fi
  grep -qF 'A matching marker left by cherry-pick or rebase is actionable' \
    docs/guides/lint-ratchet-merges.md \
    || fail "merge guide should document actionable non-merge markers"
}

assert_post_commit_truth_up_dispatch_wiring() {
  local hook=.husky/post-commit
  local metric
  grep -qF 'scripts/git/run-baseline-truth-up.sh" post-commit' "$hook" \
    || fail "post-commit must dispatch baseline truth-up in post-commit context"
  grep -qF "git rev-parse --verify --quiet 'HEAD^2'" "$hook" \
    || fail "post-commit must gate truth-up on a merge parent or pending marker"
  for metric in lint-ratchet knip-unused-exports max-lines-exceptions near-duplicates; do
    grep -qF "$metric" scripts/git/baseline-drivers.sh \
      || fail "baseline registry must list $metric for post-commit truth-up"
  done
}

assert_truth_up_matrix_max_lines_post_commit() {
  local repo="$TMP_ROOT/truth-up-max-lines-post-commit"
  local err="$TMP_ROOT/truth-up-max-lines-post-commit.err"
  local git_dir marker

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config" "$repo/.githooks"
  cp "$REPO_ROOT/.gitattributes" "$repo/.gitattributes"
  cat >"$repo/.githooks/post-commit" <<'SH'
#!/usr/bin/env bash
bash scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh post-commit
SH
  chmod +x "$repo/.githooks/post-commit"
  git -C "$repo" config core.hooksPath .githooks
  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines post-commit matrix driver install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in /*) ;; *) git_dir="$repo/$git_dir" ;; esac
  marker="$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required"

  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" add .gitattributes eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm "seed max-lines post-commit matrix"
  git -C "$repo" checkout -q -b side
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam "side lowers max-lines cap"
  git -C "$repo" checkout -q main
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam "main lowers max-lines cap"

  git -C "$repo" merge --no-commit --no-ff side >/dev/null 2>&1 \
    || fail "max-lines no-commit semantic merge should succeed"
  [ -e "$marker" ] || fail "max-lines no-commit merge should stamp a marker"
  git -C "$repo" commit -qm "complete max-lines merge by hand" 2>"$err" \
    || fail "max-lines post-commit completion should succeed: $(cat "$err")"
  [ ! -e "$marker" ] || fail "max-lines post-commit should consume its marker"
  grep -qF 'post-commit: max-lines exception merge needs truth-up' "$err" \
    || fail "max-lines post-commit should print its repair advisory: $(cat "$err")"
  grep -qF 'verified truthful' "$err" \
    && fail "marker-only max-lines post-commit must not claim verification"
  return 0
}


assert_generated_baseline_stage_restore
ok "stage restore selects ordinary conflicted index stages from a nested directory"
assert_knip_unused_exports_post_merge_truth_up
ok "knip installer drives a real semantic Git merge and post-commit truth-up"
assert_max_lines_exceptions_merge_driver_real_semantic_merge
ok "max-lines installer drives a real semantic Git merge"
assert_max_lines_exceptions_merge_driver_real_truth_up_advisory
ok "max-lines real merge runs and consumes truth-up"
assert_near_duplicates_merge_driver_real_semantic_merge
ok "near-duplicates installer drives a real semantic Git merge"
assert_knip_driverless_merge_blocks_summary_drift
ok "driverless knip text merge remains blocked by summary validation"
assert_max_lines_real_additions_merge
ok "max-lines driver preserves disjoint additions through a real Git merge"
assert_knip_stale_cherry_pick_marker_is_ignored
ok "knip truth-up discards a stale cherry-pick marker after unrelated history advances"
assert_retained_installers_serialize_first_install
ok "retained installers serialize config and attributes as one transaction"
assert_packaged_and_retained_installers_serialize_first_install
ok "packaged and retained installers share one config and attributes transaction"
assert_lint_ratchet_merge_recipe_docs_match_driver
ok "generated merge recipes match their driver authority"
assert_retired_lint_ratchet_driver_key_has_migration_hint
ok "retired lint-ratchet generic driver key points to the packaged installer"
assert_max_lines_exceptions_fallback_recipe
ok "max-lines fallback keeps its hand-reconciliation safeguards"
assert_entry_baseline_fallback_rebase_guidance
ok "entry baseline fallback recipes explain rebase side swapping independently"
assert_policy_safe_recovery_docs
ok "recovery docs keep the repo-wide policy-safe stage contract"
assert_post_commit_truth_up_dispatch_wiring
ok "post-commit wiring consumes the shared driver registry"
assert_truth_up_matrix_max_lines_post_commit
ok "max-lines no-commit merge completes through post-commit truth-up"

printf 'PASS: merge-driver dispatch smoke (%d assertions)\n' "$PASS"
