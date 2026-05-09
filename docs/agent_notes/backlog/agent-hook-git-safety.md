# Agent Hook: Git Safety & Tool Discipline

Status: Implemented in working tree; rollout note in
`docs/agent_notes/in_progress/agent-hook-git-safety.md`
Date: 2026-05-08

Expand the shared `scripts/ai-hooks/policy.sh` blocklist so both Claude
and Codex are prevented from running history-rewriting Git commands,
force-pushes, branch destruction, dangerous GitHub CLI mutations, and
(for context hygiene) raw `grep`.

The existing policy already blocks Husky bypass (`HUSKY=0`,
`--no-verify`, `git commit -n`), direct Postgres/Redis/Docker CLI use,
and the placeholder DB password. This note plans the next layer.

## Motivation

Permissive mode lets agents take any shell action that is not explicitly
denied. Two behaviors keep recurring that the user wants stopped:

- Codex amends commits to "tidy up" instead of adding a follow-up
  commit, hiding the change history the user relies on.
- Both agents reach for `grep` from `bash`, which dumps thousands of
  lines from `node_modules`, build artifacts, etc. into context. The
  Claude `Grep` tool and `rg` already avoid most of that noise. This
  repo's Codex adapter currently exposes Bash hooks, not a documented
  Claude-style native code-search tool, so Codex block messages should
  prefer `rg`, `rg --files`, or `git grep` rather than naming a Codex
  tool that may not exist.

The remaining items are dangerous in principle even if they have not
fired yet — destructive Git/GitHub operations and force pushes — and
should be blocked before they cause an incident.

## Behaviors to Block

All matches happen on the literal `tool_input.command` string the agent
emitted, the same surface today's policy uses. Each rule needs:

- A specific regex tight enough to avoid false positives.
- A `block` reason string that names the safer alternative so the agent
  can self-correct without another round trip.
- A unit-style fixture in `scripts/ai-hooks/test.sh` (see Testing).

### 1. History rewrite (local)

| Command | Notes |
| --- | --- |
| `git commit --amend` | Single biggest Codex offender. |
| `git rebase` (any form) | Block all rebases — interactive, onto, autosquash, etc. Mid-rebase `git rebase --continue` / `--abort` / `--skip` / `--quit` MUST stay allowed; key off the verb after `rebase`. |
| `git reset --hard` | Discards working-tree and index changes. |
| `git reset --soft` | Rewrites history while preserving changes; user explicitly listed it. |
| `git reset --merge` / `--keep` | Same destructive class; block for consistency. |
| `git filter-branch` | Mass history rewrite. |
| `git filter-repo` | Mass history rewrite (third-party but worth blocking). |
| `git replace` | Object-graph rewrite. |
| `git update-ref` | Direct ref manipulation, allows arbitrary history edits. |
| `git reflog expire --expire=now --all` | Cleans up the safety net after a rewrite — block to keep recovery possible. |

`git reset` with no flag (= `--mixed` against `HEAD`) is non-destructive
to the working tree but clears staged changes. Default: allow it for now
because agents commonly use path-scoped unstage flows. Block unflagged
`git reset <ref>` because it can move `HEAD`; allow path-scoped forms
such as `git reset HEAD -- path`, `git reset -- path`, and
`git restore --staged path`.

### 2. Force push & remote destruction

| Command | Notes |
| --- | --- |
| `git push --force` / `-f` | Standard force push. |
| `git push --force-with-lease` | Safer variant, but still rewrites the remote and the user does not want agents doing it. |
| `git push --mirror` | Replaces all remote refs. |
| `git push <remote> +<refspec>` | Leading `+` on any refspec is a force push. |
| `git push <remote> :<branch>` | Empty-source refspec deletes the remote branch. |
| `git push --delete` / `-d` | Deletes a remote branch. |
| `git push` to `main` / `master` | Match either an explicit `main` / `master` argument, or detect that the current branch is `main` / `master` and the push has no explicit refspec. AGENTS.md already says "do not push to main"; this enforces it. |

Detecting "current branch is main" requires running `git symbolic-ref
--short HEAD` from the hook. That is cheap and `policy.sh` already
shells out for nothing similar — wrap it in a helper that no-ops if
not in a Git repo.

Do not block `git push origin HEAD` or
`git push --set-upstream origin feat/...` from feature branches. Do
block `git push origin HEAD:main`, `git push origin main`, and any
push where the explicit destination resolves to `refs/heads/main` or
`refs/heads/master`.

### 3. Local branch / tag destruction

| Command | Notes |
| --- | --- |
| `git branch -D` / `--delete --force` | Force-deletes branches even when unmerged. The non-force `git branch -d` already refuses to delete unmerged branches and stays allowed. |
| `git tag -d` / `--delete` | Tag deletion is rare from an agent and usually wrong. Block; allow if user explicitly invokes via `!`. |
| `git worktree remove --force` | Force-removes a worktree with uncommitted changes. (Note: the repo's `bun run worktree:drop` is the supported path.) |
| `git clean -f` / `-fd` / `-fdx` | Destroys untracked files; agents should never need it. |

### 4. GitHub CLI remote mutation / secrets

`gh` is useful for read-only inspection, but it can mutate repository,
PR, release, workflow, and auth state without a second prompt. Block
the destructive and privileged forms below. Keep read-only commands
allowed (`gh pr view`, `gh pr list`, `gh issue view`, `gh run view`,
`gh run list`, `gh repo view`, `gh release view`, `gh release list`,
`gh workflow view`, `gh auth status`).

| Command | Notes |
| --- | --- |
| `gh pr create` / `comment` | Publishes remote state. Block by default; if the user wants a PR or comment, they can run it. |
| `gh pr merge` | Includes `--admin`, `--auto`, `--disable-auto`, `--delete-branch`, and strategy flags. Agents should not merge or queue PRs. |
| `gh pr close` / `reopen` / `ready` / `edit` / `lock` / `unlock` | Changes PR state or metadata. |
| `gh pr review --approve` / `--request-changes` | Publishing reviews is a human action. `gh pr review --comment` is also remote write; default to blocking all `gh pr review`. |
| `gh issue create` / `comment` / `close` / `reopen` / `edit` / `delete` / `develop` / `lock` / `unlock` / `transfer` / `pin` / `unpin` | Changes issue state, metadata, comments, or linked branches. |
| `gh repo create` / `fork` / `delete` / `archive` / `rename` / `transfer` / `edit` | Repository-level remote mutation. |
| `gh repo sync` | Can update a local branch or a remote fork; `--force` hard-resets the destination branch. Use explicit `git fetch` + review instead. |
| `gh repo deploy-key add` / `delete` | Changes access to the repository. |
| `gh release create` / `edit` / `delete` / `delete-asset` / `upload` | Releases are public-facing state. Block `upload` too, especially with `--clobber`. |
| `gh workflow disable` / `enable` / `run` | Changes Actions state or starts remote work. |
| `gh run cancel` / `rerun` / `delete` | Mutates CI run state or spends CI capacity. |
| `gh cache delete` | Deletes Actions cache state; command availability varies by CLI version. |
| `gh secret set` / `delete` and `gh variable set` / `delete` | Mutates privileged configuration. `gh variable` may not exist in every installed CLI, but the regex can still cover it. |
| `gh auth token` / `login` / `logout` / `refresh` / `setup-git` | Token output and auth reconfiguration are not appropriate for agents. Allow only `gh auth status`. |
| `gh api` with `--method POST|PUT|PATCH|DELETE`, `-X POST|PUT|PATCH|DELETE`, REST field flags that imply POST, GraphQL `mutation`, or `--input` | `gh api` defaults to POST when fields are present. Allow default GET and explicit `--method GET` / `-X GET` REST reads. Allow read-only `gh api graphql ... query ...` only when the query text is visible in the command string and does not contain `mutation`; block opaque `--input` bodies. |
| `gh codespace create` / `delete` / `edit` / `rebuild` / `stop` | Mutates user-owned compute resources. |
| `gh gist create` / `edit` / `delete` | Publishes or mutates user-owned content outside the repo. |
| `gh gpg-key add` / `delete` and `gh ssh-key add` / `delete` | Mutates account-level trust and access keys. |
| `gh label create` / `edit` / `delete` / `clone` | Mutates repository taxonomy. |
| `gh repo set-default`, `gh alias set` / `delete`, `gh config set`, `gh extension install` / `remove` / `upgrade` | Mutates local CLI behavior or installs executable extension code. |

The block reason should say: "GitHub remote mutations are not allowed
from agents. Use read-only `gh ... view/list/status` commands, or ask
the user to perform the mutation."

### 5. Context-pollution: raw `grep`

Not destructive, but the user wants agents to use native search when it
exists or `rg` so context stays clean.

- Block bare `grep ` invocations from Bash.
- Allow `git grep`, `rg`, `ripgrep`. (`grep -V`, `grep --version` are
  fine to allow but not worth special-casing.)
- Allow `grep` inside pipes that already filter (e.g. `... | grep ...`
  on a small upstream like `bun run`)? Reject this — once we open the
  door, the agent will pipe `find /` through `grep`. The block reason
  should say: "Use Claude `Grep` when available; otherwise use `rg`,
  `rg --files`, or `git grep`."

`egrep` / `fgrep` are deprecated `grep` aliases; block them too.
Also block obvious wrapper forms such as `bash -lc 'grep ...'`,
`sh -c "grep ..."`, `find ... -exec grep`, and `xargs grep`. The
regex will not parse shell syntax perfectly; prefer a clear block on
common noisy shapes over a fragile shell parser.

## Implementation Strategy

The whole change lands in `scripts/ai-hooks/policy.sh`, which is the
single source of truth that both adapters call via
`ai_policy_violation_reason`. No changes to `.claude/hooks/` or
`.codex/hooks/` should be necessary for the block path.

### File changes

- `scripts/ai-hooks/policy.sh`
  - Add named reason constants (`AI_POLICY_GIT_AMEND`,
    `AI_POLICY_GIT_REBASE`, `AI_POLICY_GIT_RESET`,
    `AI_POLICY_GIT_HISTORY_REWRITE`, `AI_POLICY_GIT_FORCE_PUSH`,
    `AI_POLICY_GIT_PUSH_MAIN`, `AI_POLICY_GIT_BRANCH_FORCE_DELETE`,
    `AI_POLICY_GIT_CLEAN_FORCE`, `AI_POLICY_GH_REMOTE_MUTATION`,
    `AI_POLICY_GH_AUTH`, `AI_POLICY_GREP`).
  - Each reason ends with the safer alternative, in the same tone as
    the existing `AI_POLICY_DOCKER` / `AI_POLICY_POSTGRES` strings.
  - Add a shared command-position helper/prefix so `git`, `gh`, and
    `grep` checks all handle `cmd && git ...`, `cmd; gh ...`,
    `bash -lc '...'`, `sh -c "..."`, and simple `env VAR=x git ...`
    wrappers consistently.
  - Add a `ai_current_branch()` helper that returns the symbolic ref
    or empty string if detached / not a repo.
  - Extend `ai_policy_violation_reason` with the new branches. Order
    matters: keep the cheap regex checks first, run the
    `ai_current_branch` check only inside the push-detection branch,
    and report `AI_POLICY_GH_AUTH` before the broader `gh` mutation
    reason so token-leak messages stay specific.
- `scripts/ai-hooks/test.sh` — add policy fixtures in the existing
  smoke test harness. `scripts/test-ai-hooks.sh` already runs it, and
  `scripts/test-scripts.sh` already selects it when `policy.sh` or
  hook adapters change.
- `AGENTS.md` — append a short subsection under "Gotchas" (or
  "Workflow") that lists the new blocked operations and the supported
  alternatives, so a human reading the docs understands what the hook
  is enforcing and why. Mirror the wording in the block reasons.
- `docs/agent_notes/in_progress/<task>.md` (created when the work is
  promoted) — track open questions, edge cases discovered during
  rollout, and the test fixture catalog.

### Bypass policy

No env-var bypass. The user explicitly wants these blocked, and an
escape hatch (`ALLOW_GIT_REWRITE=1` etc.) defeats the purpose because
the agent will set it reflexively.

When a legitimate need arises (e.g. the user asks to rebase a feature
branch onto main), the block reason should instruct the agent to:

1. Stop and ask the user to confirm.
2. If confirmed, suggest the user run the command themselves via the
   `!` prefix in Claude or directly in their shell.

This matches the existing pattern used by `AI_POLICY_HOOK_BYPASS`.

### Edge cases & known false positives

- `git rebase --continue` / `--abort` / `--skip` / `--quit` — must
  stay allowed. Distinguish by the first non-flag arg after `rebase`.
- `git reset HEAD -- <path>` / `git reset -- <path>` — path-scoped
  unstage, must stay allowed.
- `git reset` without args (= `--mixed` against `HEAD`) — destructive
  to staging area but not the working tree. Default: allow; revisit if
  it gets misused.
- `git push origin HEAD` from a feature branch — allowed; only block
  when the target is `main` / `master`.
- `git push --set-upstream origin feat/...` — allowed.
- `gh pr view --json ...`, `gh api --method GET ...`, and
  `gh api -X GET ... -f q=...` — read-only inspection should stay
  allowed. Since `gh api -f` normally implies POST, tests must cover
  the explicit `GET` carve-out before blocking all field flags.
- `gh api graphql -f query='query { viewer { login } }'` — read-only
  GraphQL often uses POST under the hood. Allow only when the query is
  visible and does not contain `mutation`; block `--input` and any
  visible `mutation`.
- Multi-command lines (`git push --force && echo done`) — the current
  policy already greps the full command string, so leading-anchor
  regexes need `(^|[;&|][[:space:]]*)` in front, matching the existing
  Docker rule.
- Shell wrappers (`bash -lc 'git push --force'`) — either normalize the
  command string before policy checks or add wrapper-specific regex
  cases. Add fixtures for at least `bash -lc`, `sh -c`, and
  `env VAR=x git push --force`.
- Quoted strings inside other commands — e.g. a JS string literal
  containing the text `git push --force` passed to `node -e '...'`. The
  policy is regex-based and will false-positive here. This is the same
  trade-off as today's `--no-verify` rule. Document it; accept it.
- `grep` inside `man`, `apropos`, `compgen`, `which grep` — false
  positives. The regex should anchor to the command position, not the
  whole line.

### Phasing

1. **Land the policy block & tests** — pure addition, no behavior
   change for compliant flows. Ship behind a single commit so the
   block reasons are reviewable in isolation.
2. **Update AGENTS.md** — same PR; the docs and the enforcement should
   land together.
3. **Watch for false positives** — leave a checklist in the
   in-progress note for the first week of use; a missed legitimate
   command is the most likely regression.
4. **Optional follow-up: `grep` deprecation softening** — if the raw
   `grep` block fires too often on legitimate small pipelines, relax
   the rule to a `PostToolUse` warning instead of a `PreToolUse`
   block. Decide based on real friction, not speculation.

## Testing

Extend `scripts/ai-hooks/test.sh`, which is already wired through
`scripts/test-ai-hooks.sh`, `bun run test:scripts`, and changed-file
selection in `scripts/test-scripts.sh`. For each rule:

- One positive fixture per blocked variant (e.g. `git push --force`,
  `git push -f`, `git push origin +main`, `git push origin :feat/foo`,
  `gh pr merge --admin`, `gh repo delete owner/repo`, `gh api -X DELETE
  repos/{owner}/{repo}/issues/1`, `gh api graphql -f
  query='mutation { ... }'`, `gh auth token`).
- One negative fixture per intentional carve-out (e.g.
  `git rebase --continue`, `git reset HEAD -- file`,
  `git push origin feat/foo`, `git grep needle`, `git branch -d
  feat/foo`, `gh pr view --json number`, `gh api --method GET
  repos/{owner}/{repo}`, `gh api graphql -f
  query='query { viewer { login } }'`).
- One compound-command fixture (`X && git push --force`) per rule
  family to confirm the leading-anchor regex.
- One shell-wrapper fixture per family where agents commonly wrap
  commands (`bash -lc`, `sh -c`, `env VAR=value ...`).

The test harness is just bash: source `policy.sh`, call
`ai_policy_violation_reason "$cmd"`, assert exit code and reason string
or substring. Mirror the existing minimalist style in
`scripts/ai-hooks/test.sh`; do not add a second hook-test entrypoint
unless the file becomes unwieldy.

## Open Questions

- Should `git tag -d`, `git clean -f`, and the broad `gh` remote
  mutation set be in the first cut, or deferred until evidence of
  misuse? Default: include them; cost of false positive is low (ask
  the user to run it).
- Should the Stop hook also remind the agent to use the `Grep` tool
  when it has been seen reaching for `bash grep` repeatedly within a
  session? No, this is not needed.

## Related

- `scripts/ai-hooks/policy.sh` — destination file.
- `.claude/hooks/no-direct-db.sh`, `.codex/hooks/pre-tool-use.sh` —
  existing adapters that already call `ai_policy_violation_reason`; no
  edits needed.
- `AGENTS.md` "Workflow" / "Gotchas" sections — doc surface.
- `docs/agent_notes/finished_work/ai-harness-improvements.md` and
  `docs/agent_notes/backlog/ai-harness-followups.md` — broader context on the
  harness-engineering direction this fits into.
