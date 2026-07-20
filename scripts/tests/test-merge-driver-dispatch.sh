#!/usr/bin/env bash
# smoke-subjects: scripts/git/install-all-merge-drivers.sh
# smoke-subjects: scripts/git/run-baseline-truth-up.sh
# smoke-subjects: scripts/git/baseline-drivers.sh
# smoke-subjects: scripts/git/near-duplicates-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/baseline-post-merge-truth-up.sh
# smoke-subjects: .husky/post-merge
# smoke-subjects: .husky/post-checkout
# smoke-subjects: .husky/post-commit
# smoke-subjects: scripts/tests/test-merge-driver-dispatch.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
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
# a genuine stale-baseline verdict (exit 1 + FAIL) earns the --restore-merge-truth
# recipe, while an environment failure (exit 2 + ERROR, the sensor ran but could
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
output=$(run_near_dup_truth_up "$repo" 1 "FAIL: whole-repo near-duplicate baseline is stale after integration")
grep -qF -- "--restore-merge-truth" <<<"$output" \
  || fail "a stale (exit 1 FAIL) baseline should recommend --restore-merge-truth: $output"
grep -qF "is stale" <<<"$output" \
  || fail "a stale baseline should be reported as stale: $output"
[ -f "$(near_dup_marker "$repo")" ] \
  || fail "a stale baseline must keep the truth-up marker for retry"
ok "near-duplicates truth-up recommends restore only on a genuine stale verdict"

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

printf 'PASS: merge-driver dispatch smoke (%d assertions)\n' "$PASS"
