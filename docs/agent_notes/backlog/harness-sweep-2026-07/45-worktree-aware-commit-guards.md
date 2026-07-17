# 45 — Make the commit guard layer worktree-aware (first-class lane commits)

Status: Done (2026-07-16 via sequential-drain-2026-07 leaf 1.5). Item 1 was
already resolved by commit `008029e2` ("resolve work root in pre-hook policy
callers"), which wired `ai_resolve_target_dir` into `no-direct-db.sh` and
`bash-pre-tool-use.sh` — the same fix item 1 asked for; the re-verification note
below inspected the function signature but not that caller wiring. It is now
pinned by lane commit-guard tests in `scripts/ai-hooks/test.sh`. Item 3 (tidy
hook) and item 4 (marker tripwire) are implemented with tests. No lane-commit
workaround bullets were found in `docs/guides/per-worktree-dev.md` or
`docs/ai-harness.md` to delete (they live only in dispatch prompts / agent
memory, out of repo reach).
Track: T (tooling) · Priority: P2 · Size: M

## Re-verification (2026-07-15, against main)

Partially implemented since filing — do NOT re-do the done parts:

- **Item 2 (landing report): DONE.** `scripts/ai-hooks/git-commit-quiet.sh`
  now resolves the commit's target checkout from the command text and payload
  cwd (`ai_resolve_target_dir` → `WORK_ROOT`) and keys its locks and
  `HEAD_BEFORE`/`HEAD_AFTER` snapshots on it, so lane commits report real
  landings.
- **Queue contention (adjacent, not an original item): DONE.** The
  cross-worktree commit queue now waits in a bounded foreground poll with
  holder/waiter visibility instead of rejecting at invocation — the
  background-waiter workaround in lane prompts is obsolete.
- **Item 1 (PreToolUse policy matcher): OPEN.**
  `ai_policy_has_git_commit_on_main` (`scripts/ai-hooks/policy.sh:598-624`)
  still resolves the branch via `ai_current_branch "$work_root"` with the
  caller's checkout, not the command's target — a session parked on `main`
  committing into a feature-branch lane is still over-blocked.
- **Item 3 (tidy hook): OPEN.** `scripts/ai-hooks/tidy-edited-file.sh:7-8`
  still pins `REPO_ROOT` to the script's own checkout; lane-file edits
  classify `outside repository` (lines 129-130) and skip the formatter
  (reproduced 2026-07-15).
- **Item 4 (marker tripwire): OPEN.** The fast-commit provenance machinery in
  `scripts/lib/verify-metadata.sh:319-395` logs fast *commits* for the
  pre-push backstop; nothing logs creation/removal of the `musi-fast-commit`
  toggle itself, so a mid-session vanish is still unattributable.

## Evidence (verified 2026-07-12; re-verify before implementing)

- Field evidence: every multi-lane dispatch prompt (and the orchestrating
  agent's private memory) must carry a three-bullet workaround block to commit
  from a secondary worktree — `GIT_DIR=<common>/worktrees/<lane>
  GIT_WORK_TREE=<lane> git commit`, or commit via a bash script file, plus
  "run prettier yourself" and "a 'No commit landed' error may be a false
  negative". Observed across the 2026-06-20, 2026-07-07, and 2026-07-12 drain
  sessions; the workarounds are institutional knowledge, not documented UX.
- `scripts/ai-hooks/policy.sh:594-621` (`ai_policy_has_git_commit_on_main`) —
  the PreToolUse matcher string-matches a live `git commit`, then resolves the
  branch via `ai_current_branch "$work_root"` where `work_root` is the hook
  process's checkout (the session root, normally `/workspace`). A
  `cd <lane> && git commit` or `git -C <lane> commit` from a session parked on
  `main` is therefore blocked even though the commit's target is a feature
  branch. The comment at `policy.sh:196-200` concedes the split: the git-level
  husky guard is cwd-correct and "covers the `git -C <path>` /
  `cd <path> && git commit` forms that the PreToolUse string matcher … cannot
  resolve" — i.e. the outer layer over-blocks what the inner layer would
  correctly allow.
- The sanctioned escapes prove this is a matcher limitation, not policy: the
  same commit is allowed when spelled via `GIT_DIR`/`GIT_WORK_TREE` env vars
  or wrapped in a script file (real hooks still run on both routes), so the
  block adds no protection against a deliberate agent — it only taxes the
  cooperative one.
- `scripts/ai-hooks/commit-output.sh:113-121` (`ai_commit_no_landing_summary`)
  — "No commit landed. The command exited 0 but HEAD is still at
  \<head_before\>" is keyed on HEAD of the session checkout; a successful lane
  commit advances the *lane's* HEAD, so it is reported as a failure with
  misleading remediation advice ("re-issue the commit…"). Field-observed false
  negatives in both the 2026-07-07 and 2026-07-12 drains.
- `scripts/ai-hooks/tidy-edited-file.sh:7-8,130,152` — `REPO_ROOT` is pinned
  to the checkout containing the script; edited paths under sibling worktrees
  classify as `outside repository` and skip the formatter, so lane edits reach
  the format gate unformatted unless the lane agent is told to run prettier
  manually.
- Related but unexplained: nothing in production code removes the
  `musi-fast-commit` marker (only the test fixture at
  `scripts/ai-hooks/test.sh:1928` does), yet the marker has been observed to
  vanish mid-session (2026-06-20 drain), forcing "re-touch defensively before
  every commit" guidance in lane prompts.
- Harness caveat for the fix: whether each Bash call starts in the session
  root is harness-dependent (Claude Code resets cwd per call; other harnesses
  persist `cd`). The guard must resolve the commit's *target* checkout from
  the command text and hook cwd, not assume either convention.

Failure: multi-lane worktree orchestration is this repo's documented working
model (AGENTS.md, `docs/guides/per-worktree-dev.md`, the drain-lane recipe),
but the agent-facing guard layer assumes "the session checkout" and "the
checkout being committed to" are the same repo. Every lane orchestration pays
the tax three times — an over-blocking commit guard, a lying landing report,
and a silently skipped formatter — and the workarounds live only in dispatch
prompts and agent memory, where every new agent (or model) has to relearn
them.

## Do

Make the commit's target checkout a first-class concept in the ai-hooks
layer, one commit per surface if tests grow:

1. **PreToolUse commit matcher** (`policy.sh`): before resolving the branch,
   extract the target checkout from the command's own text — a leading
   `cd <path> && …` prefix and the `git -C <path>` form (conservative parse;
   quoted paths; first match wins). Resolve `ai_current_branch` against that
   path. Keep the current fail-safe: an unresolvable or ambiguous target
   falls back to today's session-root behavior; a lane parked on a protected
   branch still blocks.
2. **Landing report** (`commit-output.sh` + its caller): capture
   `head_before`/`head_after` from the same resolved target checkout, so lane
   commits report the real landing (and the "No commit landed" text stops
   advising re-issue when HEAD did advance in the lane).
3. **Per-file tidy hook** (`tidy-edited-file.sh`): resolve the repo root from
   the *edited file's* directory (`git -C <dir> rev-parse --show-toplevel`)
   instead of the script's checkout; format lane edits exactly like primary
   edits; keep the `outside repository` skip for paths in no worktree of this
   repo (compare against `git worktree list` or the common dir identity).
4. **Marker vanish tripwire** (small, optional if time-boxed out): log marker
   creation/removal (path + pid + timestamp) to the fast-commit provenance
   log so the next observed vanish is attributable instead of folklore.
5. Cover each in `scripts/ai-hooks/test.sh`: `cd <lane> && git commit` on a
   feature-branch lane passes the guard while the same form on a
   lane parked on `main` blocks; a lane commit reports landed with the lane's
   HEAD range; a lane-file edit gets formatted. Then delete the workaround
   bullets from the drain-lane docs/memory guidance they currently squat in.

## Verify

```
bash scripts/ai-hooks/test.sh
bun run harness:check
bun run verify:changed
```

## Acceptance

From a session parked on `main` in the primary checkout: (a)
`cd <lane> && git commit` on a feature-branch lane commits without
`GIT_DIR`/`GIT_WORK_TREE` spelling tricks, (b) the hook output reports the
commit as landed with the lane's HEAD advancement, (c) an edit to a lane file
is auto-formatted by the tidy hook, and (d) a commit targeting a lane that is
itself parked on `main` is still blocked. The ai-hooks suite pins all four,
and the lane-dispatch workaround block is deleted from the recipe docs it
currently lives in.

Sources: lane-orchestration friction, drain sessions 2026-06-20 / 2026-07-07 /
2026-07-12 (this session's agent-cli dispatch prompts)
