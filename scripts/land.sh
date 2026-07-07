#!/usr/bin/env bash
# Land the current feature branch into the protected branch behind a FULL
# verify gate.
#
# Usage: bash scripts/land.sh   (run from the feature-branch worktree)
#
# Why this exists: pre-commit can run in fast-commit mode (skips the slow
# `test` / `scripts` slots — see scripts/verify/steps-lib.sh), which lets an
# autonomous workflow land many cheap commits on a feature branch. This script
# is the backstop: it runs the full, sequential `bun run verify` (which always
# runs every slot, fast-commit marker or not) before integrating, then merges
# with `--no-ff`. The merge deliberately skips the pre-commit hook (git does not
# run it for merge commits), so the heavy gate runs exactly once here.
#
# Not automatic: the push is left to a human. This script never pushes.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/gate-env.sh"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-metadata.sh"

branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ -z "$branch" ]; then
  echo "land: HEAD is detached — run from a feature branch." >&2
  exit 1
fi
case "$branch" in
  main | master)
    echo "land: already on $branch — run from a feature branch." >&2
    exit 1
    ;;
esac

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "land: uncommitted changes — commit or stash them first." >&2
  exit 1
fi

echo "land: running harness freshness gate on $branch …"
bun run harness:check

echo "land: running full verify on $branch …"
# Full (no-flag) verify is sequential and always runs test + scripts. Gate heap
# policy is sourced above and by verify.sh, so no inline NODE_OPTIONS is needed.
bun run verify

echo "land: verify passed — merging $branch into main (--no-ff; skips pre-commit by design)"

# Capture the verified branch-tip state before switching. The full verify above
# stamped full-verify evidence (success marker + wrapper.json) for THIS HEAD and
# worktree fingerprint. Re-compute that fingerprint now, while still on the
# branch, so we can re-stamp the evidence onto the merge commit below — but only
# when the merge introduces no new tree content.
verified_head="$(git rev-parse HEAD)"
verified_fingerprint="$(ai_worktree_fingerprint "$REPO_ROOT")"

# Single-worktree assumption: `git switch main` fails if main is checked out in
# a sibling worktree. Multi-worktree support is intentionally out of scope.
git switch main
git merge --no-ff "$branch"

merge_head="$(git rev-parse HEAD)"

# A `--no-ff` merge of a branch that already contains main records new parents
# but no new tree content: the merge commit's tree is byte-identical to the
# branch tip's. When that holds, the full verify that just passed on the branch
# tip covers exactly what pushing main would publish, so we re-stamp its
# provenance onto the merge commit instead of forcing a redundant (~10-minute)
# re-verify of an identical tree.
#
# When the trees DIFFER — a genuine 3-way merge where main had commits the
# branch lacked — the merge tree was never verified. We MUST NOT stamp it: the
# merge needs its own verify before it can be pushed. That refusal is the whole
# point of the pre-push gate and is never weakened here; we simply leave the
# evidence untouched and tell the human to re-verify.
if [ "$(git rev-parse "${verified_head}^{tree}")" = "$(git rev-parse "${merge_head}^{tree}")" ]; then
  merge_fingerprint="$(ai_worktree_fingerprint "$REPO_ROOT")"
  full_marker="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
  wrapper_json="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$REPO_ROOT")}/meta/wrapper.json"

  # Re-stamp only if the source marker is a FRESH, matching pass for the branch
  # tip we just verified (same HEAD + fingerprint, within the freshness window).
  # The marker was written by the `bun run verify` above that finished seconds
  # ago, so the standard success-marker freshness comfortably covers it; an aged
  # or drifted marker is refused rather than resurrected.
  if musi_restamp_verify_marker "$full_marker" "$verified_fingerprint" "$merge_head" \
       "$merge_fingerprint" "$verified_head" 120; then
    # Keep the wrapper.json fallback consistent with the re-stamped marker so no
    # evidence still points at the pre-merge HEAD. Best-effort: the marker above
    # already satisfies the pre-push gate on its own.
    musi_restamp_verify_wrapper "$wrapper_json" "$merge_head" "$merge_fingerprint" || true
    echo "land: merged $branch → main and re-stamped full-verify evidence onto the merge commit."
    echo "land: the merge tree matches the verified branch tip, so the push is ready:"
    echo "land:   git push origin main"
  else
    echo "land: SUCCESS — merged $branch → main; main now contains the branch." >&2
    echo "land: But the recorded full-verify marker was not a fresh matching pass, so" >&2
    echo "land: evidence was NOT re-stamped onto the merge commit. The merge itself is" >&2
    echo "land: fine — it just needs its own verify before the push gate will accept it." >&2
    echo "land: Do NOT re-run land (you are already on main). Instead run:" >&2
    echo "land:   bun run verify && git push origin main" >&2
    # Nonzero so a chained '… && git push' does not push an unverified merge.
    exit 1
  fi
else
  echo "land: SUCCESS — merged $branch → main; main now contains the branch." >&2
  echo "land: But this was a genuine 3-way merge (main had commits $branch lacked), so" >&2
  echo "land: the merge tree was never verified and evidence was left untouched. The" >&2
  echo "land: merge itself is fine — it just needs its own verify before the push gate" >&2
  echo "land: will accept it. Do NOT re-run land (you are already on main). Instead run:" >&2
  echo "land:   bun run verify && git push origin main" >&2
  # Nonzero so a chained '… && git push' does not push an unverified merge.
  exit 1
fi
