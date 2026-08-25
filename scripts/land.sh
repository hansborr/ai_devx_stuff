#!/usr/bin/env bash
# Land a feature branch into the protected branch behind a FULL verify gate.
#
# Usage:
#   bash scripts/land.sh                 (run from the feature-branch worktree)
#   bash scripts/land.sh --branch <name> (run from a clean worktree, e.g. main)
#
# Exit status contract (the final output line always repeats this state):
#   0 landed-verified — main contains the verified tree and is ready to push
#   1 not-landed — no merge commit was created; follow the reported recovery
#   2 verify-failed — locked dependency installation or verification failed before main moved; inspect, fix, re-run
#   3 merged-unverified — main moved but provenance could not be stamped; verify before push
# Trailer: land: exit: <code> (<status-token>) — <one-line action>
#
# Why this exists: pre-commit can run in fast-commit mode (skips the slow
# `test` / `scripts` slots — see scripts/verify/steps-lib.sh), which lets an
# autonomous workflow land many cheap commits on a feature branch. This script
# is the backstop: it runs the full, sequential `bun run verify` (which always
# runs every slot, fast-commit marker or not) before integrating, then merges
# with `--no-ff`. When main and the feature have diverged, it first builds and
# verifies a detached synthetic merge commit; main is moved only after that
# exact tree passes. A branch that already contains main keeps the one-verify
# tree-equality fast path. The merge deliberately skips the pre-commit hook
# (git does not run it for merge commits), so the heavy gate runs once.
# Before any tree is verified, its lockfile is installed frozen; every checkout
# restoration after that attempt is reconciled the same way so node_modules
# matches the tree left in the operator's worktree.
#
# --branch mode verifies a frozen snapshot of another branch in the CURRENT
# healthy worktree. The original branch may be checked out elsewhere; its tip
# is checked for movement before main is touched.
#
# Not automatic: the push is left to a human. This script never pushes.
#
# Runtime: the full sequential verify routinely exceeds ten minutes, which is
# longer than an agent harness's foreground shell call allows. Agents must run
# this script backgrounded and wait for the `land: exit:` trailer; a foreground
# call killed mid-verify (exit 143) leaves main untouched and the feature
# branch clean, so the recovery is simply to re-run it in the background.
set -euo pipefail

LAND_EXIT_CODE=1
LAND_STATUS_TOKEN="not-landed"
LAND_ACTION="inspect the failure above, then re-run land"
mode="current"
target_branch=""
integration_branch=""
landing_checkout=""
starting_checkout=""
preview_active=0
dependency_install_attempted=0

land_git_locked_retry() {
  local attempt=1
  local max_attempts=5
  local stderr_file
  local status
  local -a backoffs=(0.25 0.5 1 2)

  stderr_file=$(mktemp "${TMPDIR:-/tmp}/musi-land-git-stderr.XXXXXX")
  while true; do
    : > "$stderr_file"
    if "$@" 2>&1 1>&3 | tee "$stderr_file" >&2; then
      rm -f "$stderr_file"
      return 0
    else
      status="${PIPESTATUS[0]}"
    fi

    if [ "$attempt" -ge "$max_attempts" ] ||
      ! grep -q 'Unable to create.*index\.lock.*File exists' "$stderr_file"; then
      rm -f "$stderr_file"
      return "$status"
    fi

    echo "land: git index.lock contention; retrying (attempt $((attempt + 1))/$max_attempts) …" >&2
    sleep "${backoffs[$((attempt - 1))]}"
    attempt=$((attempt + 1))
  done 3>&1
}

land_install_locked_dependencies() {
  bun install --frozen-lockfile
}

land_reconcile_restored_dependencies() {
  if [ "$dependency_install_attempted" -eq 0 ]; then
    return 0
  fi

  echo "land: reconciling locked dependencies after checkout restoration …"
  if ! land_install_locked_dependencies; then
    echo "land: WARNING: failed to reconcile dependencies for the restored checkout; run 'bun install --frozen-lockfile' before using this worktree." >&2
  fi
}

land_exit() {
  LAND_EXIT_CODE="$1"
  LAND_STATUS_TOKEN="$2"
  LAND_ACTION="$3"
  exit "$LAND_EXIT_CODE"
}

land_on_exit() {
  trap - EXIT ERR
  if [ "$preview_active" -eq 1 ] && [ -n "${landing_checkout:-}" ]; then
    land_git_locked_retry git merge --abort >/dev/null 2>&1 || true
    if land_git_locked_retry git switch "$landing_checkout" >/dev/null 2>&1; then
      preview_active=0
      land_reconcile_restored_dependencies
    fi
  fi
  printf 'land: exit: %s (%s) — %s\n' "$LAND_EXIT_CODE" "$LAND_STATUS_TOKEN" "$LAND_ACTION" >&2
  exit "$LAND_EXIT_CODE"
}

land_on_error() {
  local command_status

  command_status=$?
  trap - ERR
  if [ "$LAND_EXIT_CODE" -eq 3 ]; then
    echo "land: unexpected command failure (exit $command_status) after main moved." >&2
    echo "land: the surviving merge has not been proven push-ready. Do not re-run land." >&2
    exit "$LAND_EXIT_CODE"
  fi
  if [ "$mode" = "branch" ] && [ -n "$integration_branch" ] &&
    [ "$(git symbolic-ref --short HEAD 2>/dev/null || true)" = "$integration_branch" ]; then
    echo "land: FAILED on integration branch $integration_branch (built from $target_branch)." >&2
    echo "land: you are still on $integration_branch — inspect the failure, then run" >&2
    echo "land:   git switch main && git branch -D $integration_branch" >&2
    echo "land: fix $target_branch and re-run 'bash scripts/land.sh --branch $target_branch'." >&2
  else
    echo "land: unexpected command failure (exit $command_status)." >&2
  fi
  LAND_EXIT_CODE=1
  LAND_STATUS_TOKEN="not-landed"
  LAND_ACTION="inspect the unexpected failure above, restore a clean worktree, then re-run land"
  exit 1
}

trap land_on_exit EXIT
trap land_on_error ERR

land_restore_preview() {
  if [ "$preview_active" -eq 1 ]; then
    land_git_locked_retry git merge --abort >/dev/null 2>&1 || true
    land_git_locked_retry git switch "$landing_checkout" >/dev/null
    preview_active=0
    land_reconcile_restored_dependencies
  fi
}

land_cleanup_integration() {
  if [ "$mode" = "branch" ] && [ -n "$integration_branch" ] &&
    git rev-parse --verify --quiet "refs/heads/$integration_branch" >/dev/null; then
    land_git_locked_retry git switch "$starting_checkout" >/dev/null
    land_reconcile_restored_dependencies
    land_git_locked_retry git branch -D "$integration_branch" >/dev/null
  fi
}

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/gate-env.sh"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-metadata.sh"

if [ "$#" -gt 0 ]; then
  case "$1" in
    --branch)
      mode="branch"
      if [ "$#" -ne 2 ] || [ -z "$2" ]; then
        echo "land: --branch requires a branch name. Usage: bash scripts/land.sh --branch <name>" >&2
        land_exit 1 "not-landed" "provide exactly one branch name and re-run land"
      fi
      target_branch="$2"
      ;;
    *)
      echo "land: unknown argument '$1'. Usage: bash scripts/land.sh [--branch <name>]" >&2
      land_exit 1 "not-landed" "use land with no arguments or with --branch <name>"
      ;;
  esac
fi

if [ "$mode" = "current" ]; then
  branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
  if [ -z "$branch" ]; then
    echo "land: HEAD is detached — run from a feature branch." >&2
    land_exit 1 "not-landed" "switch to the feature branch, then re-run land"
  fi
  case "$branch" in
    main | master)
      echo "land: already on $branch — run from a feature branch." >&2
      land_exit 1 "not-landed" "switch to the feature branch, then re-run land"
      ;;
  esac
  target_branch="$branch"
else
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
  starting_checkout="${current_branch:-$(git rev-parse HEAD)}"
  if ! git rev-parse --verify --quiet "refs/heads/$target_branch" >/dev/null; then
    echo "land: branch '$target_branch' does not exist." >&2
    land_exit 1 "not-landed" "provide an existing feature branch and re-run land"
  fi
  case "$target_branch" in
    main | master)
      echo "land: refusing to land '$target_branch' — it is a protected branch." >&2
      land_exit 1 "not-landed" "provide a non-protected feature branch"
      ;;
  esac
  if [ "$target_branch" = "$current_branch" ]; then
    echo "land: '$target_branch' is the current branch — use 'bash scripts/land.sh' (no --branch) to land it." >&2
    land_exit 1 "not-landed" "re-run land without --branch from the current feature branch"
  fi
  integration_branch="land/$target_branch"
  if git rev-parse --verify --quiet "refs/heads/$integration_branch" >/dev/null; then
    echo "land: integration branch '$integration_branch' already exists — a previous attempt left it behind." >&2
    echo "land: inspect it, then delete it with 'git branch -D $integration_branch' and re-run." >&2
    land_exit 1 "not-landed" "inspect and delete the stale integration branch, then re-run land"
  fi
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "land: uncommitted changes — inspect them with git diff, then commit them or ask the user how to preserve them." >&2
  land_exit 1 "not-landed" "inspect with git diff, then commit the worktree changes or ask the user how to preserve them before re-running land"
fi
if ! musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "land"; then
  land_exit 1 "not-landed" "commit or remove source-relevant untracked work, then re-run land"
fi

land_resolve_path() {
  (cd "$1" 2>/dev/null && pwd -P)
}

main_worktree=""
wt_path=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) wt_path="${line#worktree }" ;;
    "branch refs/heads/main") main_worktree="$wt_path" ;;
  esac
done < <(git worktree list --porcelain)

if [ -n "$main_worktree" ]; then
  if ! main_worktree_resolved="$(land_resolve_path "$main_worktree")"; then
    echo "land: the worktree entry holding main cannot be entered: $main_worktree" >&2
    echo "land: the entry looks stale, so this preflight cannot prove 'git switch main'" >&2
    echo "land: will succeed after the full verify — failing closed now instead. Inspect" >&2
    echo "land: it with 'git worktree list', then repair or remove it and re-run." >&2
    land_exit 1 "not-landed" "repair or prune the stale main worktree entry, then re-run land"
  fi
  if [ "$main_worktree_resolved" != "$(land_resolve_path "$REPO_ROOT")" ]; then
    echo "land: main is checked out in a sibling worktree: $main_worktree" >&2
    echo "land: 'git switch main' would fail here, so aborting before the full verify." >&2
    echo "land:   cd $main_worktree && bash scripts/land.sh --branch $target_branch" >&2
    land_exit 1 "not-landed" "run land --branch from the worktree that holds main"
  fi
fi

if ! git rev-parse --verify --quiet refs/heads/main >/dev/null; then
  echo "land: protected branch 'main' does not exist." >&2
  land_exit 1 "not-landed" "create or restore the main branch, then re-run land"
fi

target_head="$(git rev-parse "refs/heads/$target_branch")"
main_head="$(git rev-parse refs/heads/main)"

if git merge-base --is-ancestor "$target_head" "$main_head"; then
  echo "land: main already contains $target_branch; no merge is needed." >&2
  land_exit 1 "not-landed" "confirm the branch is already landed; do not re-run land"
fi

if [ "$mode" = "branch" ]; then
  echo "land: creating integration branch $integration_branch at the $target_branch tip …"
  land_git_locked_retry git switch -c "$integration_branch" "$target_head"
  landing_checkout="$integration_branch"
else
  landing_checkout="$target_branch"
fi

verify_kind="branch tip"
verified_commit="$target_head"

if ! git merge-base --is-ancestor "$main_head" "$target_head"; then
  verify_kind="merge tree"
  echo "land: $target_branch and main have diverged — building the merge tree before verification …"
  land_git_locked_retry git switch --detach "$main_head"
  preview_active=1
  if ! land_git_locked_retry git -c core.hooksPath=/dev/null merge --no-ff \
    -m "Merge branch '$target_branch'" "$target_head"; then
    echo "land: the prospective merge conflicts; main is untouched." >&2
    land_restore_preview
    land_cleanup_integration
    land_exit 1 "not-landed" "resolve the branch against current main, then re-run land"
  fi
  verified_commit="$(git rev-parse HEAD)"
fi

# Install exactly the dependency graph pinned by the settled landing tree.
# Frozen mode makes an inconsistent package.json/bun.lock merge fail closed
# before any harness or verify command can observe stale node_modules.
dependency_install_attempted=1
echo "land: installing locked dependencies for $target_branch ($verify_kind) …"
if ! land_install_locked_dependencies; then
  echo "land: locked dependency install failed on the $verify_kind; main is untouched." >&2
  land_restore_preview
  land_cleanup_integration
  land_exit 2 "verify-failed" "fix the locked dependency install failure above, then re-run land"
fi

echo "land: running harness freshness gate on $target_branch ($verify_kind) …"
if ! bun run harness:check; then
  land_restore_preview
  land_cleanup_integration
  land_exit 1 "not-landed" "regenerate the stale harness surfaces, commit them, then re-run land"
fi

# Prisma preflight: packages/server/src/generated/ is gitignored per-worktree
# state, so a client generated for another branch's schema makes the typecheck
# slot fail with misleading TS2345 errors at innocent mapper call sites and
# re-trips the test slot's schema-vs-client mtime guard after any checkout
# that rewrites schema.prisma. Regenerate UNCONDITIONALLY from the settled
# verify tree — after the prospective merge-tree construction above, so a
# diverged branch generates from the merged schema, not the branch tip.
# Generation is seconds against a 10-15 min verify and is deterministic from
# the checked-out schema; an mtime heuristic cannot prove schema-content
# identity. See docs/guides/add-prisma-migration.md ("Cross-worktree
# staleness"). Verify has not run yet, so failure here is 1 not-landed
# (matching the harness:check preflight), never 2 verify-failed.
echo "land: regenerating the Prisma client from the settled $verify_kind …"
if ! bun run --filter @musi/server prisma:generate; then
  echo "land: Prisma client generation failed on the $verify_kind; main is untouched." >&2
  land_restore_preview
  land_cleanup_integration
  land_exit 1 "not-landed" "fix the Prisma client generation failure above, then re-run land"
fi

# Resolved before verify runs so the exit-2 trailer (the final stderr line)
# can carry the failure-log breadcrumb: a truncated capture of a land run
# (`... 2>&1 | tail -N`) keeps only recovery boilerplate and the trailer, so
# the trailer itself must name where the per-slot verify logs live.
verify_log_dir="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$REPO_ROOT")}"

echo "land: running full verify on $target_branch ($verify_kind) …"
if ! FORCE_VERIFY=1 bun run verify; then
  # The client-staleness NOTE below applies only when the failure path
  # rewrites the checkout: a diverged preview restore (preview_active=1) or
  # branch mode's return to the starting checkout. On the current-mode fast
  # path both restores are no-ops and the worktree still holds the exact
  # tree the client was generated from, so warning there would be false.
  checkout_rewritten=0
  if [ "$preview_active" -eq 1 ] || [ "$mode" = "branch" ]; then
    checkout_rewritten=1
  fi
  land_restore_preview
  land_cleanup_integration
  if [ "$checkout_rewritten" -eq 1 ]; then
    # Accepted-because-guarded drift: the restore above rewrites
    # schema.prisma while src/generated/ still matches the abandoned verify
    # tree. The mtime guard forces regeneration on the next guarded run, but
    # unguarded consumers (dev server, editor typecheck) see the
    # ahead-of-schema client until then.
    echo "land: NOTE: the regenerated Prisma client still matches the abandoned verify tree; the next guarded run regenerates it, unguarded consumers see it stale until then." >&2
  fi
  if [ "$verify_kind" = "merge tree" ]; then
    echo "land: the prospective merge tree failed verification; main is untouched." >&2
    land_exit 2 "verify-failed" "inspect $verify_log_dir/<slot>.log, fix the merge-tree verification failure, then re-run land"
  fi
  echo "land: the branch tip failed verification; main is untouched." >&2
  land_exit 2 "verify-failed" "inspect $verify_log_dir/<slot>.log, fix the branch verification failure, then re-run land"
fi

if ! verified_fingerprint="$(musi_require_fingerprint \
  "land verified tree" ai_worktree_fingerprint "$REPO_ROOT")"; then
  echo "land: failed to fingerprint the tree that passed verify; refusing to merge." >&2
  land_restore_preview
  land_cleanup_integration
  land_exit 1 "not-landed" "repair the fingerprint input failure, then re-run land"
fi
verified_tree="$(git rev-parse "${verified_commit}^{tree}")"

land_restore_preview

current_tip="$(git rev-parse --verify --quiet "refs/heads/$target_branch" || true)"
if [ "$current_tip" != "$target_head" ]; then
  echo "land: $target_branch advanced during verification — refusing to merge unverified commits." >&2
  echo "land:   verified tip: $target_head" >&2
  echo "land:   current tip:  ${current_tip:-<branch deleted>}" >&2
  land_cleanup_integration
  land_exit 1 "not-landed" "re-run land on the new branch tip"
fi

if [ "$(git rev-parse refs/heads/main)" != "$main_head" ]; then
  echo "land: main advanced during verification — the verified merge inputs are stale." >&2
  land_cleanup_integration
  land_exit 1 "not-landed" "re-run land against current main"
fi

echo "land: verify passed — merging frozen tip $target_head into main (--no-ff)"
land_git_locked_retry git switch main
if ! land_git_locked_retry git merge --no-ff -m "Merge branch '$target_branch'" "$target_head"; then
  echo "land: the real merge unexpectedly failed after its tree was verified." >&2
  land_git_locked_retry git merge --abort >/dev/null 2>&1 || true
  land_reconcile_restored_dependencies
  land_exit 1 "not-landed" "inspect the merge failure on main, then re-run land from a clean worktree"
fi

LAND_EXIT_CODE=3
LAND_STATUS_TOKEN="merged-unverified"
LAND_ACTION="run bun run verify before pushing main"

# The real merge leaves main on the verified tree, but the intervening checkout
# restorations may have reconciled node_modules to a feature or pre-merge tree.
echo "land: reconciling locked dependencies for merged main …"
if ! land_install_locked_dependencies; then
  echo "land: CRITICAL — merged main but failed to reconcile its locked dependencies." >&2
  land_exit 3 "merged-unverified" "run bun install --frozen-lockfile and bun run verify before pushing main"
fi

merge_head="$(git rev-parse HEAD)"
merge_tree="$(git rev-parse "${merge_head}^{tree}")"

if [ "$mode" = "branch" ]; then
  land_git_locked_retry git branch -d "$integration_branch"
  post_merge_tip="$(git rev-parse --verify --quiet "refs/heads/$target_branch" || true)"
  if [ "$post_merge_tip" != "$target_head" ]; then
    echo "land: NOTE: $target_branch advanced after it was verified — only its verified tip" >&2
    echo "land: was merged, so main does NOT contain the newer commits." >&2
    echo "land:   merged (verified) tip: $target_head" >&2
    echo "land:   $target_branch now at:  ${post_merge_tip:-<branch deleted>}" >&2
    echo "land: The merge is push-safe. After pushing, land the newer commits separately." >&2
  fi
fi

if [ "$merge_tree" != "$verified_tree" ]; then
  echo "land: CRITICAL — the created merge tree differs from the tree that passed verify." >&2
  echo "land: main contains a merged-but-unverified commit. Do not push it." >&2
  land_exit 3 "merged-unverified" "run bun run verify before pushing main"
fi

if ! merge_fingerprint="$(musi_require_fingerprint \
  "land merge tree" ai_worktree_fingerprint "$REPO_ROOT")"; then
  echo "land: CRITICAL — the merged tree could not be fingerprinted for provenance stamping." >&2
  land_exit 3 "merged-unverified" "repair the fingerprint input failure and run bun run verify before pushing main"
fi
full_marker="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
wrapper_json="$verify_log_dir/meta/wrapper.json"

if musi_restamp_verify_marker "$full_marker" "$verified_fingerprint" "$merge_head" \
  "$merge_fingerprint" "$verified_commit" 120; then
  musi_restamp_verify_wrapper "$wrapper_json" "$merge_head" "$merge_fingerprint" || true
  echo "land: merged $target_branch → main and re-stamped full-verify evidence onto the merge commit."
  echo "land: the published merge tree is exactly the tree that passed verify."
  LAND_EXIT_CODE=0
  LAND_STATUS_TOKEN="landed-verified"
  LAND_ACTION="push main with: git push origin main"
  land_exit 0 "$LAND_STATUS_TOKEN" "$LAND_ACTION"
fi

echo "land: SUCCESS — merged $target_branch → main, but fresh matching verify evidence" >&2
echo "land: could not be re-stamped. Do not re-run land and do not push yet." >&2
land_exit 3 "merged-unverified" "run bun run verify before pushing main"
