# 05 — Commit guard, codex skill, typecheck PATH (G1, K1, I1/I2)

> Proposals only — not implemented. Verified against current HEAD.

| ID | Issue | Status | Effort | Risk |
|----|-------|--------|--------|------|
| G1 | amend guard fires after the amend already ran | DONE | M | med |
| K1 | `tsc not on PATH` in `typecheck.sh` | DONE | S | low |
| I1 | codex `&` + `run_in_background` double-background | already addressed pre-pack (polish only) | S | low |
| I2 | codex review refuses to read files | already addressed pre-pack (polish only) | S | low |

---

## G1 — `git commit --amend` guard fires *after* the amend already executed

**Status: DONE — `git-commit-quiet.sh` now calls `ai_preflight_or_block`, the
amend regex was widened, and the deny globs were added.**

**Decision (2026-06-12) — fix first, on severity grounds.** Priority is driven by
*severity* (a silent local-history rewrite behind a "blocked" message), not
frequency (it only triggers when an agent attempts an amend, which is already
discouraged and deny-globbed). Resolved approach:

1. **Self-block, scoped to right before `bash -c`.** Put the
   `ai_policy_violation_reason "$CMD"` check *after* the `ai_is_git_commit_cmd`
   gate, immediately before the lock/exec — **not** before the gate. This hook
   only ever executes gate-passing commands, so checking what it is about to
   execute fully covers its execution surface. Placing the check before the gate
   would turn `git-commit-quiet.sh` into a second general policy enforcer
   (redundant with `no-direct-db.sh`, and it double-emits the block message).
2. **The `git -c … commit --amend` form is *not* an execution-ordering problem
   here.** It fails `ai_is_git_commit_cmd` (`policy.sh:261` requires adjacent
   `git commit`), so this hook exits at the passthrough without ever running
   `bash -c`. That form is closed entirely by step 3 (widen `policy.sh:157` +
   deny globs), which makes `no-direct-db.sh:16` block it before the harness runs
   it. The reorder and the regex-widening fix *different* forms; do both.
3. **The deny glob is not a backstop.** The reflog evidence means the hook's
   `bash -c` side effect lands even though `Bash(git commit *--amend*)` also
   matches — i.e. the executing hook beats permission evaluation. Treat the deny
   globs as belt-and-suspenders, not the guard.

**Durable option (preferred if taken now).** The root fragility is that an
output-*wrapping* hook also *executes* the command, so it must mirror all policy.
`bun-run-quiet.sh` has the same `bash -c` shape. Extract one
`ai_preflight_or_block "$CMD"` helper and call it as the first action of every
executing hook (`git-commit-quiet.sh`, `bun-run-quiet.sh`, any future wrapper) so
no executing hook can run a policy-violating command regardless of its own
narrower gate. This is the "remove the need to think about it" version of step 1.

`--amend` is blocked in two *pre-execution* places, both correct in principle:
1. Harness deny glob `.claude/settings.json:7` `"Bash(git commit *--amend*)"`.
2. Repo PreToolUse policy: `scripts/ai-hooks/policy.sh:157-160` emits
   `AI_POLICY_GIT_AMEND` (`policy.sh:10`), via `no-direct-db.sh:16` →
   `ai_emit_block` (`common.sh:50-53`).

**The bug:** a *third* PreToolUse Bash hook executes the amend as a side effect.
`.claude/settings.json:88-106` fires three Bash hooks in order — `no-direct-db.sh`,
**`git-commit-quiet.sh`**, `bun-run-quiet.sh`. `git-commit-quiet.sh` is not a
passive inspector: it *runs the commit itself* via `bash -c "$CMD"`
(`scripts/ai-hooks/git-commit-quiet.sh:74`), and although it `source`s `policy.sh`
(`:26`) it **never calls `ai_policy_violation_reason`** — there is no `--amend`
short-circuit before line 74. So on `git commit --amend`: `no-direct-db.sh`
returns the block message the agent sees, while `git-commit-quiet.sh` has
*already run the amend* (reflog shows `commit (amend)` at `HEAD@{0}`). The
suggested follow-up commit then fails "nothing to commit" because the amend
already absorbed the staged changes. (Not a husky or git post-hoc mechanism —
`.husky/pre-commit`/`commit-msg` have no amend logic.)

**Coverage gap:** the `git -c <cfg> commit --amend` form bypasses *both* guards —
the deny glob needs the literal `git commit ` prefix, and the policy regex
`git[[:space:]]+commit…--amend` needs `git`+`commit` adjacent.

**Root-cause fix.**
1. Make `git-commit-quiet.sh` policy-aware so it never executes a forbidden
   command. After `CMD=$(ai_payload_command …)` (`:33`) and the
   `ai_is_git_commit_cmd` gate (`:36`), before the lock/exec:
   ```sh
   if REASON=$(ai_policy_violation_reason "$CMD"); then
     ai_emit_block "$REASON"   # decision:block, never runs bash -c "$CMD"
   fi
   ```
   (`policy.sh` already sourced; `ai_emit_block` available.) This guarantees the
   executing hook self-blocks — defense in depth regardless of hook ordering.
   **Placement (resolved — keep the check scoped, after the gate):**
   `ai_is_git_commit_cmd` only matches an adjacent `git commit` (`policy.sh:261`),
   so a `git -c … commit --amend` *fails the gate and is never executed by this
   hook* — it exits at the passthrough above without reaching `bash -c`. So do
   **not** widen the gate or move the check before it to "cover" that form: this
   hook isn't the thing that runs it. Close the `git -c` form in step 3 (widen
   `policy.sh:157` + deny globs), which makes `no-direct-db.sh:16` block it before
   the harness executes it. The check here stays right before the lock/exec and
   only has to cover what this hook executes — the adjacent `git commit --amend`.
2. Fix the message (`AI_POLICY_GIT_AMEND`, `policy.sh:10`) to state the recovery
   clearly and (once #1 lands) truthfully: amend is not allowed; the amend did
   **not** apply; stage and create a **new** follow-up commit; ask the user if
   the previous commit genuinely must be amended.
3. Close the bypass: widen the policy regex to allow `git … -c … commit --amend`
   (anchor `git[[:space:]]+([^;&|]*[[:space:]])?commit[^;&|]*[[:space:]]--amend`)
   and add deny globs `"Bash(git -c * commit *--amend*)"` and
   `"Bash(git commit --amend*)"` (no-gap variant) at `.claude/settings.json:7-8`.
   Careful: don't false-match `git commit -c <commit>` (reuse-message), which is
   unrelated to `--amend`.

**Sanctioned "fold a review fix into the prior commit" path?** Recommend **not**
adding a conditional "amend allowed if unpushed + this-session" path — the guards
are pure command-string matchers with no commit-provenance access, so enforcing
that reliably is fragile and against the "agents never rewrite history" intent.
The friendly answer is the follow-up commit, which works cleanly once #1 makes
the block truly pre-execution; route genuine amend needs through the user (the #2
message says so).

**Why not doc-only.** This is a correctness bug (HEAD rewritten despite a
"blocked" message), not a guidance gap — and the I2 history shows guidance alone
doesn't hold.

**Effort:** M. **Risk:** med (`git-commit-quiet.sh` is on every commit's hot path;
place the policy check before the lock; test the `git -c … commit -c <commit>`
non-amend form against the widened regex).

---

## K1 — `tsc: command not found` in `scripts/typecheck.sh`

**Status: DONE — `typecheck.sh` resolves the binary via
`MUSI_TSC_BIN` → `node_modules/.bin/tsc` → bare `tsc`.**

`scripts/typecheck.sh:99` runs bare `tsc -b`; `:101` runs bare
`tsc -p tsconfig.scripts.json`; the exec is `"$@"` at `:82`. No PATH handling, no
`node_modules/.bin` prepend, no `MUSI_TSC_BIN` override. `tsc` is not on PATH in
the agent shell, but `node_modules/.bin/tsc` exists. `bun run typecheck`
(`package.json:70`) works only because Bun injects `node_modules/.bin`; invoking
`bash scripts/typecheck.sh` directly does not — hence the agent's
`PATH="$PWD/node_modules/.bin:$PATH"` workaround. This is inconsistent with
`scripts/vitest.sh:77-83`, which resolves its binary explicitly
(`MUSI_VITEST_BIN` → `node_modules/.bin/vitest` → bare `vitest`).

(Secondary: `typecheck:scripts` referenced in old packs does **not** exist; root
`typecheck` already covers `tsconfig.scripts.json` via `:101`. Stale — no fix
needed beyond not citing it.)

**Root-cause fix — mirror `vitest.sh`.** Near the top of `typecheck.sh` (after
`REPO_ROOT`/`cd`):
```sh
if [ -n "${MUSI_TSC_BIN:-}" ]; then
  TSC=("$MUSI_TSC_BIN")
elif [ -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  TSC=("$REPO_ROOT/node_modules/.bin/tsc")
else
  TSC=(tsc)
fi
```
Then `:99`/`:101` use `"${TSC[@]}" -b` / `"${TSC[@]}" -p tsconfig.scripts.json`
(labels can stay literal `"tsc -b"`). Falls back to bare `tsc`, so it cannot
regress environments where `tsc` is already on PATH. The `MUSI_TSC_BIN` override
also matches the repo's doctor/lint-tool override convention.

**Why not doc-only.** Documenting the `PATH=…` prefix is exactly the
documented-workaround the brief says to avoid, and diverges from the established
`vitest.sh` pattern.

**Effort:** S. **Risk:** low (additive).

---

## I1 / I2 — codex footguns (already fixed; optional polish)

**Status: already addressed pre-pack; optional polish open.** These logged pains
predate the current skill.
- I1: `.claude/skills/codex-cli/SKILL.md:38` and `:90` already warn "Do not
  combine `run_in_background=true` with a trailing shell `&`."
- I2: `SKILL.md:58-65` already blesses the review phrasing ("Do not run the test
  suite/build; reading files and git diff is fine") and `:65` warns "Do not say
  'do not run any commands'." This is the durable fix the I2 log asked for (the
  memory `feedback_codex_review_phrasing` was insufficient on its own).

**Optional polish (low value).**
- I1: append the *symptom* to `:90` so the rule is memorable: "appending `&` while
  `run_in_background=true` detaches the real codex child — the tool reports
  'completed (exit 0)' in under a second while codex is reaped after a couple of
  tool calls."
- I2: cross-reference the `:65` phrasing caveat from the `review`-subcommand
  section (`:70-84`) or hoist it into one shared "Prompt phrasing" note both
  sections point to.

**Effort:** S. **Risk:** low.

## Critical files
`scripts/ai-hooks/git-commit-quiet.sh`, `scripts/ai-hooks/policy.sh`,
`.claude/settings.json`, `scripts/typecheck.sh`, `scripts/vitest.sh` (pattern),
`.claude/skills/codex-cli/SKILL.md`.
