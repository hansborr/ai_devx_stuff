# 11 — Hook trios triplicated; merge-driver installers run on file checkouts

Status: Done — deduped 4 merge-driver installs (verification-record correction); `worktree-db.sh` wrappers deliberately left
Track: T (tooling) · Priority: P3 · Size: S

## Evidence (verified 2026-07-11; re-verified at 2026-07-11 adversarial triage; re-verify before implementing)

- `.husky/post-merge:2-4` and `.husky/post-checkout:2-4` — the three
  merge-driver install lines are verbatim in both hooks.
- `.husky/post-merge:6-8` and `.husky/post-commit:72-74` — the baseline
  truth-up dispatch trio invokes the same three scripts in both. Not verbatim:
  post-commit passes a `post-commit` context arg, and the two sites sit behind
  different guards (post-merge's squash check `[ "${1:-0}" != 1 ]` vs
  post-commit's merge-parent/pending-marker check in
  `musi_post_commit_truth_up`), so the shared helper needs a context parameter
  and the guards stay at the call sites.
- `package.json:141` — the `prepare` script is a fourth copy of the installer
  trio, spelled as the three `*:install-merge-driver` script names.
- `.husky/post-checkout` runs the three installers on *every* checkout,
  before the file-checkout fast path the drift hook already computes
  (`scripts/worktree-drift-hook.sh:42-43`, `branch_flag == 0`) — so even
  `git checkout -- <file>` spawns three bash installer processes, each doing
  rev-parses, file hashing, config reads, and attributes rendering.

## Do

Factor a shared install dispatcher and a shared truth-up dispatcher (sourced
lib or one script taking a context arg) used by all three hooks; the existing
per-site guards stay at the call sites. Gate the post-checkout installers
behind the same branch-checkout check the drift hook uses (`$3 == 1` — clone
and `git worktree add` still invoke post-checkout with flag 1, so self-heal
on fresh checkouts is preserved). Optionally point `prepare` at the same
install dispatcher so adding a fourth baseline artifact is a one-list change.

## Verify

```
bun run test:scripts:changed
bun run harness:check   # all three hooks are manifest-tracked surfaces (hook/post-{merge,checkout,commit})
bun run lint:ratchet:merge-driver:check
bun run sensor:knip-unused-exports:merge-driver:check
bun run lint:max-lines-exceptions:merge-driver:check
git checkout -- README.md   # no installer processes on a file checkout
```

## Acceptance

The installer and truth-up command lists each have one definition; file
checkouts skip the installers; branch checkouts, merges, fresh clones, and
new worktrees still install the drivers and `harness:check` stays green.
