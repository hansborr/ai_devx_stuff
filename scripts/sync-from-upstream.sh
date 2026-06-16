#!/usr/bin/env bash
# Mirror the AI-devx surface of the upstream Musi repo into this stripped-down clone.
#
# Shared implementation behind both harness skills:
#   .claude/skills/sync-from-upstream/  (Claude)
#   .codex/skills/sync-from-upstream/   (Codex)
#
# Source of truth: the upstream repo's *git-tracked* file list. Using
# `git ls-files` (rather than walking the filesystem) means all upstream junk —
# node_modules, .husky/_/, settings.local.json, .env, *.tsbuildinfo, .vite,
# worktrees, tmp, reports, logs — is excluded for free, because it is gitignored
# upstream and never appears in `ls-files`.
#
# The mirror is: every upstream-tracked path EXCEPT the preserve set below.
#   - update  : tracked in both, content differs  -> overwrite from upstream
#   - add     : tracked upstream, absent here      -> copy in (refactor catch-up)
#   - delete  : tracked here, gone upstream         -> remove (rename/move orphan)
#
# It does NOT commit (the commit-msg hook fails in this partial clone). It mutates
# the working tree and prints a report; a human stages and commits.
set -uo pipefail

# ---- preserve set: never copied, never deleted -----------------------------
# These are intentionally divergent from upstream and must survive every sync.
#   packages/**          gutted stubs ("export type AppRouter = unknown") that keep
#                        the symbol surface without pulling in ~1300 app-code files.
#   README.md            this repo's "AI/Human DX, copied from a real project" doc
#                        (0 lines shared with upstream's Musi README).
#   sync-from-upstream   this skill's own files — the shared script plus the
#                        .claude/ and .codex/ skill wrappers. None exist upstream,
#                        so the delete pass must not remove them. Matched as a bare
#                        substring so every location is covered.
PRESERVE_REGEX='^(packages/|README\.md$)|sync-from-upstream'

# ---- args ------------------------------------------------------------------
UPSTREAM="/workspace"
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply)            APPLY=1 ;;
    --dry-run)          APPLY=0 ;;
    --upstream=*)       UPSTREAM="${arg#--upstream=}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

HERE="$(git rev-parse --show-toplevel)" || { echo "not inside a git repo" >&2; exit 1; }
cd "$HERE"

# Accept both a main repo (.git is a directory) and a linked worktree (.git is a
# gitdir-pointer file), so --upstream= can target /workspace/worktrees/<name>.
git -C "$UPSTREAM" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "upstream '$UPSTREAM' is not a git repo" >&2; exit 1; }

mode=$([ "$APPLY" = 1 ] && echo "APPLY" || echo "DRY-RUN (no changes written; pass --apply to mirror)")
echo "==> sync-from-upstream  [$mode]"
echo "    upstream: $UPSTREAM"
echo "    here:     $HERE"
echo

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git -C "$UPSTREAM" ls-files | grep -vE "$PRESERVE_REGEX" | sort > "$tmp/up"   || true
git -C "$HERE"     ls-files | grep -vE "$PRESERVE_REGEX" | sort > "$tmp/here" || true

comm -23 "$tmp/up" "$tmp/here" > "$tmp/adds"   # upstream-only -> add
comm -13 "$tmp/up" "$tmp/here" > "$tmp/dels"   # here-only     -> delete (orphan)
comm -12 "$tmp/up" "$tmp/here" > "$tmp/both"   # in both       -> maybe update

: > "$tmp/updates"
while IFS= read -r f; do
  [ -e "$UPSTREAM/$f" ] || continue
  cmp -s "$f" "$UPSTREAM/$f" || echo "$f" >> "$tmp/updates"
done < "$tmp/both"

n_add=$(wc -l < "$tmp/adds"); n_del=$(wc -l < "$tmp/dels"); n_upd=$(wc -l < "$tmp/updates")

echo "    update: $n_upd    add: $n_add    delete: $n_del"
echo "    preserved (untouched): packages/**, README.md, the sync-from-upstream skill"
echo

if [ "$n_del" -gt 0 ]; then
  echo "--- DELETE (orphaned here; renamed/removed upstream) ---"
  cat "$tmp/dels"; echo
fi
if [ "$n_add" -gt 0 ]; then
  echo "--- ADD (new upstream, grouped) ---"
  awk -F/ '{print $1"/"$2}' "$tmp/adds" | sort | uniq -c | sort -rn; echo
fi

if [ "$APPLY" != 1 ]; then
  echo "Dry run only. Re-run with --apply to write these changes, then review 'git status'."
  exit 0
fi

# ---- apply -----------------------------------------------------------------
copied=0
while IFS= read -r f; do
  [ -e "$UPSTREAM/$f" ] || { echo "  skip (vanished upstream): $f" >&2; continue; }
  mkdir -p "$(dirname "$f")"
  cp -p "$UPSTREAM/$f" "$f" && copied=$((copied+1))
done < <(cat "$tmp/adds" "$tmp/updates")

removed=0
while IFS= read -r f; do
  rm -f "$f" && removed=$((removed+1))
  # prune now-empty dirs left behind by the removal
  d="$(dirname "$f")"
  while [ "$d" != "." ] && [ -d "$d" ] && [ -z "$(ls -A "$d")" ]; do
    rmdir "$d"; d="$(dirname "$d")"
  done
done < "$tmp/dels"

echo
echo "==> applied: $copied copied, $removed removed."
echo "    Review with:  git status   and   git diff"
echo "    Restore any deletion you want to keep:  git checkout -- <path>"
echo "    Then stage and commit yourself (the commit-msg hook fails in this clone, so the agent will hand you a message)."
