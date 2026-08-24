#!/usr/bin/env bash
# Fresh-install adoption smoke for the @musi/lint-ratchet demo.
#
# Proves the real adoption story in genuine isolation, OFF the Musi checkout:
# copy `tools/lint-ratchet` and this demo into a throwaway workspace, run a real
# `bun install` there (no symlink into any host node_modules), then git-init and
# install + exercise the baseline merge driver INSIDE the demo member. It walks
# the documented path — check-registry, a green gate, a regression, an
# accepted-debt update, a locked-in improvement, and a semantic baseline merge —
# asserting the demo's own result envelope and the debt-log record at each step.
# The source checkout is never mutated.
#
# Run from the demo directory: `bun run smoke` (or `bash smoke.sh`).
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$DEMO_DIR" rev-parse --show-toplevel)"
PKG_DIR="$REPO_ROOT/tools/lint-ratchet"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lint-ratchet-demo-smoke-XXXXXX")"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

fail() {
  printf 'smoke FAIL: %s\n' "$1" >&2
  exit 1
}

# Copy the tracked files of one source directory into a workspace member. git
# ls-files enumerates exactly what a clone would carry — no node_modules, no
# build output, no host symlinks.
copy_tracked() {
  local src="$1" dest="$2" rel
  while IFS= read -r rel; do
    mkdir -p "$dest/$(dirname "$rel")"
    cp "$src/$rel" "$dest/$rel"
  done < <(git -C "$src" ls-files .)
}

# 1. Assemble a throwaway Bun workspace with the package and the demo as members.
copy_tracked "$PKG_DIR" "$WORK_DIR/tools/lint-ratchet"
copy_tracked "$DEMO_DIR" "$WORK_DIR/demo"
cat >"$WORK_DIR/package.json" <<'JSON'
{
  "name": "lint-ratchet-demo-smoke-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["tools/lint-ratchet", "demo"]
}
JSON

# 2. A real install at the generated workspace root resolves the `workspace:*`
#    link to the copied package.
cd "$WORK_DIR"
bun install >/dev/null 2>&1 || fail "bun install at the generated workspace root failed"
[ ! -e "$WORK_DIR/node_modules/.bin/lint-ratchet-git-rail" ] \
  || fail "Bun unexpectedly linked the workspace package bin; simplify the demo scripts to use it"

# 2b. Explicit demo typecheck through the enumerated exports map (lint-arch
#     leaf 14): tsc resolves @musi/lint-ratchet via the fresh install's
#     workspace link and the package's exact `exports` keys — the same
#     fail-closed path the runtime uses, so an import of a private subpath
#     would break here, not silently typecheck. `tsc` is the package's own
#     pinned typescript dependency (bun installs member deps member-locally).
"$WORK_DIR/tools/lint-ratchet/node_modules/.bin/tsc" -p "$WORK_DIR/demo/tsconfig.json" \
  || fail "demo typecheck against the enumerated exports map failed"

# 3. Everything else runs INSIDE the demo member: the merge-driver installer
#    resolves the repo root via `git rev-parse`, so Git must live at demo/ for
#    its adapter path and package-owned git-rail entrypoint resolve there.
cd "$WORK_DIR/demo"
git init -q
git add -A
git -c user.name="Lint Ratchet Demo Smoke" \
  -c user.email="lint-ratchet-demo@example.invalid" \
  commit -qm "seed pristine demo state"

# 4. Seed the legacy shared attributes block an existing adopter can carry,
#    install the baseline merge driver, and prove migration preserves the other
#    driver families as loose rules while Git records the package rail locally.
mkdir -p .git/info
cat >.git/info/attributes <<'ATTRIBUTES'
unrelated/path merge=union
# BEGIN musi baseline merge attributes
/lint-ratchet.debt-log.jsonl merge=union
/lint-ratchet.baseline.json merge=lint-ratchet-baseline
/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline
/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline
# END musi baseline merge attributes
ATTRIBUTES
install_out="$(bun run lint:ratchet:install-merge-driver 2>&1)" \
  || fail "install-merge-driver package script failed"
grep -q 'install: WARN' <<<"$install_out" \
  && fail "install-merge-driver reported an advisory failure: $install_out"
registered_driver="$(git config --get merge.lint-ratchet-baseline.driver 2>/dev/null || true)"
[ -n "$registered_driver" ] || fail "install-merge-driver did not register the Git driver"
grep -qxF '# BEGIN musi baseline merge attributes' .git/info/attributes \
  && fail "install-merge-driver left the legacy shared attributes block in place"
grep -qxF '# BEGIN musi lint-ratchet baseline driver attributes' .git/info/attributes \
  || fail "install-merge-driver did not create the lint-ratchet managed block"
grep -qxF '/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline' \
  .git/info/attributes \
  || fail "legacy migration dropped the sibling knip merge attribute"
grep -qxF '/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline' \
  .git/info/attributes \
  || fail "legacy migration dropped the sibling max-lines merge attribute"
[ "$(git check-attr merge -- sensor-knip-unused-exports.baseline.json)" = \
  "sensor-knip-unused-exports.baseline.json: merge: knip-unused-exports-baseline" ] \
  || fail "migrated sibling knip attribute no longer resolves through Git"

# 5. The registry validates (structural, toolchain-independent) on the shipped files.
bun run lint:ratchet:check-registry >/dev/null 2>&1 \
  || fail "check-registry did not pass on a fresh install"

# 6. Baseline the freshly-resolved lint toolchain. The rule-source hash pins the
#    installed eslint/typescript-eslint versions, and this isolated workspace
#    carries no lockfile, so a copied-out adopter runs `update` once to baseline
#    their own toolchain (see README) — after which the gate is green and
#    check-baseline is clean.
bun run lint:ratchet:update >/dev/null 2>&1 \
  || fail "initial toolchain baseline (update) failed"
bun run lint:ratchet:check-baseline >/dev/null 2>&1 \
  || fail "check-baseline did not pass after baselining the toolchain"
green_out="$(bun scripts/lint-ratchet.ts)" || fail "gate did not pass against the baseline"
grep -q '"status":"ok"' <<<"$green_out" || fail "clean gate did not report status ok"

# 7. A new console.log call is a blocking regression (exit 1) whose envelope
#    names the recovery command.
cat >>src/app.ts <<'TS'

export function debugPing(): void {
  console.log("ping");
}
TS
git add -A
regression_out="$(bun scripts/lint-ratchet.ts 2>&1)" && fail "gate should have failed on a regression"
grep -q '"status":"regressed"' <<<"$regression_out" || fail "regression not reported in the envelope"
grep -q -- '--allow-worse --reason' <<<"$regression_out" || fail "recovery command missing from the envelope"
grep -Fq '"recovery":"bun run lint:ratchet:update -- --allow-worse --reason \"<why accepting this debt beats a rushed fix>\""' <<<"$regression_out" \
  || fail "regression recovery command changed from the demo adapter contract"

# 8. Accepting the debt records a reasoned line in the append-only debt log.
bun run lint:ratchet:update --allow-worse \
  --reason "smoke: intentional debug ping" >/dev/null 2>&1 \
  || fail "--allow-worse update failed"
grep -q '"acceptanceReason":"smoke: intentional debug ping"' lint-ratchet.debt-log.jsonl \
  || fail "debt-log line not written"
bun scripts/lint-ratchet.ts >/dev/null 2>&1 || fail "gate not green after accepting the debt"

# The vocabulary's trend command must name a real demo script and mode.
trend_out="$(bun run lint:ratchet:trend -- --max 1)" \
  || fail "trend command bound by the demo vocabulary is unavailable"
grep -q 'per-commit totals from committed baselines' <<<"$trend_out" \
  || fail "trend command did not render the trend report"

# 9. Removing the finding is an improvement; locking it in returns the gate to
#    green.
git checkout -q HEAD -- src/app.ts
improvement_out="$(bun scripts/lint-ratchet.ts 2>&1)" \
  && fail "gate should have failed on the restored improvement"
grep -q '"status":"improved"' <<<"$improvement_out" \
  || fail "restored improvement not reported in the envelope"
bun run lint:ratchet:update >/dev/null 2>&1 || fail "improvement update failed"
bun scripts/lint-ratchet.ts >/dev/null 2>&1 || fail "gate not green after locking in the improvement"

# 10. Preview a would-be baseline with --propose. The demo adapter supplies the
#     registry hint (S4's injected adapter concern), so the preview points a
#     reader at the demo's own registry file. Nothing is written.
propose_out="$(bun scripts/lint-ratchet.ts --propose local/no-console-log 'src/**/*.ts' 2>&1)" \
  || fail "propose failed"
grep -q 'would-be baseline' <<<"$propose_out" || fail "propose did not print a would-be baseline"
grep -q 'scripts/lint-ratchet/adapter.ts' <<<"$propose_out" \
  || fail "propose did not surface the demo's registry hint"

# 11. A REAL git merge dispatches the INSTALLED baseline merge driver on a
#     baseline conflict, and the post-merge truth-up verifies the merged result.
GIT_ID=(-c user.name="Lint Ratchet Demo Smoke" -c user.email="lint-ratchet-demo@example.invalid")
# Seed a deliberately stale base fingerprint. Each branch refreshes it while
# updating, then branch B gets a different valid fingerprint. The semantic
# merge must choose branch A's truthful lower fingerprint and stamp a truth-up
# marker because both branches changed the same equal-count item differently.
BASELINE_PATH="$PWD/lint-ratchet.baseline.json" bun -e '
  const baseline = await Bun.file(process.env.BASELINE_PATH).json();
  baseline.tests["ratchet/no-console-src"].items["src/app.ts"].messagesFingerprint =
    `sha256:${"f".repeat(64)}`;
  await Bun.write(process.env.BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
'
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: clean merge base"
base_branch="$(git rev-parse --abbrev-ref HEAD)"
git_dir="$(git rev-parse --git-dir)"
marker="$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"

# Branches A and B each accept debt on a DIFFERENT new file, so the semantic
# merge unions their floors and the merged baseline still matches the merged code.
# Branch A: src/extra_a.ts -> 1.
git checkout -q -b smoke-branch-a
printf 'export function extraA(): void {\n  console.log("a");\n}\n' >src/extra_a.ts
git add -A
bun run lint:ratchet:update --allow-worse --reason "smoke: branch A file" >/dev/null 2>&1 \
  || fail "branch A baseline update failed"
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: branch A adds a ratcheted file"

# Branch B from the base: src/extra_b.ts -> 1.
git checkout -q "$base_branch"
git checkout -q -b smoke-branch-b
printf 'export function extraB(): void {\n  console.log("b");\n}\n' >src/extra_b.ts
git add -A
bun run lint:ratchet:update --allow-worse --reason "smoke: branch B file" >/dev/null 2>&1 \
  || fail "branch B baseline update failed"
BASELINE_PATH="$PWD/lint-ratchet.baseline.json" bun -e '
  const baseline = await Bun.file(process.env.BASELINE_PATH).json();
  baseline.tests["ratchet/no-console-src"].items["src/app.ts"].messagesFingerprint =
    `sha256:${"e".repeat(64)}`;
  await Bun.write(process.env.BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
'
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: branch B adds a ratcheted file"

# Merge A into B: only lint-ratchet.baseline.json conflicts, so Git invokes the
# installed merge driver, which unions the two non-overlapping floors.
git "${GIT_ID[@]}" merge --no-edit smoke-branch-a >/dev/null 2>&1 || fail "git merge failed"
grep -q '<<<<<<<' lint-ratchet.baseline.json \
  && fail "merged baseline still has conflict markers — the driver did not run"
grep -q '"src/extra_a.ts"' lint-ratchet.baseline.json \
  || fail "merged baseline dropped branch A's src/extra_a.ts floor"
grep -q '"src/extra_b.ts"' lint-ratchet.baseline.json \
  || fail "merged baseline dropped branch B's src/extra_b.ts floor"
bun scripts/lint-ratchet.ts >/dev/null 2>&1 || fail "gate not green after the merge"
[ -s "$marker" ] || fail "semantic merge did not create its truth-up marker"
expected_marker="$(printf 'lint-ratchet baseline semantic merge requires post-merge truth-up\npre-merge-head=%s' "$(git rev-parse HEAD^1)")"
[ "$(cat "$marker")" = "$expected_marker" ] \
  || fail "semantic merge marker did not carry the pre-merge HEAD stamp"

# The merged baseline matches the merged code. Its driver-created marker forces
# the authoritative post-merge truth-up and is consumed only after verification.
truthup_out="$(bun run lint:ratchet:post-merge -- post-merge 2>&1)"
grep -q 'verified truthful' <<<"$truthup_out" \
  || fail "post-merge truth-up did not verify the clean merged baseline: $truthup_out"
[ ! -e "$marker" ] || fail "verified post-merge truth-up did not consume its marker"

# 12. Stale case + marker lifecycle: a baseline that no longer matches the code
#     makes truth-up emit the 'run lint:ratchet:update' verdict and KEEP the
#     marker for a capable retry (consume-only-on-success). Add a finding without
#     updating the baseline, then stamp the marker as a merge would.
printf '\nexport function extraA2(): void {\n  console.log("a2");\n}\n' >>src/extra_a.ts
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: add a finding without updating the baseline"
printf 'pre-merge-head=%s\n' "$(git rev-parse HEAD^1)" >"$marker"
stale_out="$(bun run lint:ratchet:post-merge -- post-commit 2>&1)"
grep -q 'stale ratchet baseline' <<<"$stale_out" \
  || fail "post-commit truth-up did not flag the stale baseline: $stale_out"
[ -f "$marker" ] || fail "truth-up consumed the marker on a stale baseline (must retain for retry)"

# 13. Resolving the staleness (accept the new finding into the baseline) lets a
#     retry verify and consume the marker.
bun run lint:ratchet:update --allow-worse --reason "smoke: accept the post-merge finding" \
  >/dev/null 2>&1 || fail "stale-baseline update failed"
resolved_out="$(bun run lint:ratchet:post-merge -- post-commit 2>&1)"
grep -q 'verified truthful' <<<"$resolved_out" \
  || fail "truth-up did not verify after the baseline was updated: $resolved_out"
[ ! -f "$marker" ] || fail "truth-up did not consume the marker after a verified retry"

# 14. Repeat the installed-driver walk from a linked worktree. The driver lives
#     in the shared Git common directory, but it must load the adapter from the
#     active worktree and place/consume the marker in that worktree's own Git
#     directory. This is the package's highest-risk path-resolution acceptance.
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: resolve truth-up retry"
BASELINE_PATH="$PWD/lint-ratchet.baseline.json" bun -e '
  const baseline = await Bun.file(process.env.BASELINE_PATH).json();
  baseline.tests["ratchet/no-console-src"].items["src/app.ts"].messagesFingerprint =
    `sha256:${"f".repeat(64)}`;
  await Bun.write(process.env.BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
'
git add lint-ratchet.baseline.json
git "${GIT_ID[@]}" commit -qm "smoke: seed linked-worktree merge base"
linked_base="$(git rev-parse HEAD)"
LINKED_DIR="$WORK_DIR/demo-linked"
git worktree add -q -b smoke-linked-target "$LINKED_DIR" "$linked_base"
# A secondary worktree needs its own dependency link just like a fresh clone.
# Add it to the throwaway workspace and install from the workspace root; this
# remains isolated from the source checkout and avoids borrowing host modules.
WORKSPACE_PACKAGE="$WORK_DIR/package.json" bun -e '
  const path = process.env.WORKSPACE_PACKAGE;
  const workspace = await Bun.file(path).json();
  workspace.workspaces.push("demo-linked");
  await Bun.write(path, `${JSON.stringify(workspace, null, 2)}\n`);
'
LINKED_PACKAGE="$LINKED_DIR/package.json" bun -e '
  const path = process.env.LINKED_PACKAGE;
  const workspace = await Bun.file(path).json();
  workspace.name = "lint-ratchet-demo-linked";
  await Bun.write(path, `${JSON.stringify(workspace, null, 2)}\n`);
'
linked_install_out="$(cd "$WORK_DIR" && bun install 2>&1)" \
  || fail "linked-worktree dependency install failed: $linked_install_out"
git -C "$LINKED_DIR" checkout -q -- package.json
git checkout -q -b smoke-linked-source
printf 'export function linkedA(): void {\n  console.log("linked-a");\n}\n' >src/linked_a.ts
git add src/linked_a.ts
bun run lint:ratchet:update --allow-worse --reason "smoke: linked source file" >/dev/null 2>&1 \
  || fail "linked source baseline update failed"
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: linked source adds a ratcheted file"

(
  cd "$LINKED_DIR"
  bun run lint:ratchet:merge-driver:check | grep -qF 'PASS:'
) || fail "linked worktree could not resolve the installed package driver and its own adapter"
printf 'export function linkedB(): void {\n  console.log("linked-b");\n}\n' >"$LINKED_DIR/src/linked_b.ts"
git -C "$LINKED_DIR" add src/linked_b.ts
(
  cd "$LINKED_DIR"
  bun run lint:ratchet:update --allow-worse --reason "smoke: linked target file" >/dev/null 2>&1
) || fail "linked target baseline update failed"
BASELINE_PATH="$LINKED_DIR/lint-ratchet.baseline.json" bun -e '
  const baseline = await Bun.file(process.env.BASELINE_PATH).json();
  baseline.tests["ratchet/no-console-src"].items["src/app.ts"].messagesFingerprint =
    `sha256:${"e".repeat(64)}`;
  await Bun.write(process.env.BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
'
git -C "$LINKED_DIR" add -A
git -C "$LINKED_DIR" "${GIT_ID[@]}" commit -qm "smoke: linked target adds a ratcheted file"
linked_git_dir="$(git -C "$LINKED_DIR" rev-parse --git-dir)"
case "$linked_git_dir" in /*) ;; *) linked_git_dir="$LINKED_DIR/$linked_git_dir" ;; esac
linked_common_dir="$(git -C "$LINKED_DIR" rev-parse --git-common-dir)"
case "$linked_common_dir" in /*) ;; *) linked_common_dir="$LINKED_DIR/$linked_common_dir" ;; esac
linked_marker="$linked_git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
shared_marker="$linked_common_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
[ "$linked_marker" != "$shared_marker" ] \
  || fail "linked-worktree fixture did not produce distinct Git and common directories"
rm -f "$linked_marker" "$shared_marker"
(
  cd "$LINKED_DIR"
  git "${GIT_ID[@]}" merge --no-edit smoke-linked-source >/dev/null 2>&1
) || fail "linked-worktree semantic merge failed"
grep -q '<<<<<<<' "$LINKED_DIR/lint-ratchet.baseline.json" \
  && fail "linked-worktree baseline retained conflict markers"
[ -s "$linked_marker" ] \
  || fail "linked-worktree merge did not place its marker in the worktree Git directory"
[ ! -e "$shared_marker" ] \
  || fail "linked-worktree merge incorrectly placed its marker in the shared Git directory"
grep -q '"src/linked_a.ts"' "$LINKED_DIR/lint-ratchet.baseline.json" \
  || fail "linked-worktree semantic merge dropped the source branch floor: $(cat "$LINKED_DIR/lint-ratchet.baseline.json")"
grep -q '"src/linked_b.ts"' "$LINKED_DIR/lint-ratchet.baseline.json" \
  || fail "linked-worktree semantic merge dropped the target branch floor"
# Refresh the deliberately divergent fingerprint before asking truth-up for its
# authoritative verdict. The driver-created marker must survive this repair.
(
  cd "$LINKED_DIR"
  bun run lint:ratchet:update >/dev/null 2>&1
) || fail "linked-worktree fingerprint truth-up update failed"
(
  cd "$LINKED_DIR"
  bun scripts/lint-ratchet.ts >/dev/null 2>&1
) || fail "linked-worktree gate was not green after semantic merge"
linked_truthup_out="$(cd "$LINKED_DIR" && bun run lint:ratchet:post-merge -- post-merge 2>&1)"
grep -q 'verified truthful' <<<"$linked_truthup_out" \
  || fail "linked-worktree truth-up did not verify the merged baseline: $linked_truthup_out"
[ ! -e "$linked_marker" ] \
  || fail "linked-worktree truth-up did not consume its worktree-local marker"
[ ! -e "$shared_marker" ] \
  || fail "linked-worktree truth-up touched the shared Git-directory marker"
git worktree remove --force "$LINKED_DIR"

printf 'smoke OK: isolated workspace adoption walk passed (merge driver + linked worktree + truth-up + propose)\n'
