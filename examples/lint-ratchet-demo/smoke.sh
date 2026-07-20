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
#    its `scripts/git/*` + `scripts/lint-ratchet/*` dispatch paths to resolve.
cd "$WORK_DIR/demo"
git init -q
git add -A
git -c user.name="Lint Ratchet Demo Smoke" \
  -c user.email="lint-ratchet-demo@example.invalid" \
  commit -qm "seed pristine demo state"

# 4. Install the baseline merge driver and confirm Git recorded it clone-locally.
bun run lint:ratchet:install-merge-driver >/dev/null 2>&1 \
  || fail "install-merge-driver package script failed"
registered_driver="$(git config --get merge.lint-ratchet-baseline.driver 2>/dev/null || true)"
[ -n "$registered_driver" ] || fail "install-merge-driver did not register the Git driver"

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

# 8. Accepting the debt records a reasoned line in the append-only debt log.
bun run lint:ratchet:update --allow-worse \
  --reason "smoke: intentional debug ping" >/dev/null 2>&1 \
  || fail "--allow-worse update failed"
grep -q '"acceptanceReason":"smoke: intentional debug ping"' lint-ratchet.debt-log.jsonl \
  || fail "debt-log line not written"
bun scripts/lint-ratchet.ts >/dev/null 2>&1 || fail "gate not green after accepting the debt"

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

# The merged baseline matches the merged code. Force the full post-merge truth-up
# (a union merge needs no marker) and assert it verifies through the retained
# preflight wrapper + check-baseline.
truthup_out="$(LINT_RATCHET_POSTMERGE_FULL=1 \
  bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-merge 2>&1)"
grep -q 'verified truthful' <<<"$truthup_out" \
  || fail "post-merge truth-up did not verify the clean merged baseline: $truthup_out"

# 12. Stale case + marker lifecycle: a baseline that no longer matches the code
#     makes truth-up emit the 'run lint:ratchet:update' verdict and KEEP the
#     marker for a capable retry (consume-only-on-success). Add a finding without
#     updating the baseline, then stamp the marker as a merge would.
printf '\nexport function extraA2(): void {\n  console.log("a2");\n}\n' >>src/extra_a.ts
git add -A
git "${GIT_ID[@]}" commit -qm "smoke: add a finding without updating the baseline"
printf 'pre-merge-head=%s\n' "$(git rev-parse HEAD^1)" >"$marker"
stale_out="$(bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-commit 2>&1)"
grep -q 'stale ratchet baseline' <<<"$stale_out" \
  || fail "post-commit truth-up did not flag the stale baseline: $stale_out"
[ -f "$marker" ] || fail "truth-up consumed the marker on a stale baseline (must retain for retry)"

# 13. Resolving the staleness (accept the new finding into the baseline) lets a
#     retry verify and consume the marker.
bun run lint:ratchet:update --allow-worse --reason "smoke: accept the post-merge finding" \
  >/dev/null 2>&1 || fail "stale-baseline update failed"
resolved_out="$(bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh post-commit 2>&1)"
grep -q 'verified truthful' <<<"$resolved_out" \
  || fail "truth-up did not verify after the baseline was updated: $resolved_out"
[ ! -f "$marker" ] || fail "truth-up did not consume the marker after a verified retry"

printf 'smoke OK: isolated workspace adoption walk passed (merge driver + truth-up + propose)\n'
