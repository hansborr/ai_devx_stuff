# Restrict Agent Stash Commands to a Repository-Wide Allowlist

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P1
Size: S–M
Source: `pain_points.log` — foreign stash applied after failed stash creation

## Problem

Git's stash stack belongs to the shared Git directory, not to one worktree. A
bare `git stash pop` can therefore apply and remove a sibling branch's newest
stash from either the primary checkout or a linked worktree. The recorded
incident was made worse by `git stash push -- <paths>` rejecting an untracked
path: no new stash was created, so the following bare pop selected pre-existing
foreign WIP.

Target-scoping a denial to linked worktrees does not establish stash ownership.
The primary checkout can mutate the same shared ref, there is no reliable
repository-owned mapping from a stash entry to the agent or worktree allowed to
consume it, and forms such as `apply` mutate the selected worktree even when
they do not remove the ref. Agent policy therefore needs a small repository-wide
allowlist, independent of which checkout the command targets.

The current policy blocks only `git stash drop` and `git stash clear`
(`scripts/ai-hooks/policy.sh:565-578`). Its tests allow `list` and `show` but do
not cover the default form, option-led shorthand, most known subcommands, or
unknown future forms (`scripts/ai-hooks/test.sh:571-602`). Repository guidance
also recommends unsafe state changes without an ownership exception:
`scripts/land.sh:221-224` says to "commit or stash", changed-verification
guidance at `scripts/lib/verify-metadata.sh:617-620` says to "stash/restore",
and `.claude/skills/agent-cli/scripts/agent-run.sh:934-942` says to "commit or
stash first".

## Scope

- Replace the two-command denylist with an agent-facing allowlist for the
  `git stash` command family. Permit only explicit `list`, `show`, and `create`
  subcommands plus the exact help-only forms `git stash -h` and
  `git stash --help`. These inspect entries, create an unattached stash object,
  or display help without updating the shared stash ref or rewriting a
  worktree.
- Block repository-wide every other form: bare/default `git stash`; any form
  whose first stash argument is an option other than the exact help-only forms;
  known mutating subcommands including `push`, `save`, `pop`, `apply`, `branch`,
  `store`, `drop`, and `clear`; and any unknown or future subcommand.
- Once an allowed subcommand is identified, preserve its ordinary arguments
  and options (`git stash show -p`, for example). Do not treat a later argument
  that resembles a blocked subcommand as a second dispatch.
- Apply the same classification in primary and linked worktrees and through
  leading `cd`, `git -C`, payload-cwd, and wrapper shapes already recognized by
  the policy lexer. The verdict must not depend on resolving or classifying the
  target checkout; this leaf introduces no `--git-dir` / `--git-common-dir`
  lookup and no dependency on the command-target resolver.
- Give the denial one actionable repository-wide reason: stash ownership cannot
  be proven across agent work. Direct the agent to commit, inspect with
  `git diff` / `git show HEAD:<path>`, copy a file aside for an A/B comparison,
  or ask the user. Do not recommend a different stash spelling.
- Remove unconditional stash advice from `scripts/land.sh`,
  `scripts/lib/verify-metadata.sh`, and
  `.claude/skills/agent-cli/scripts/agent-run.sh`; update their exact-output
  tests in `scripts/tests/test-land.sh`,
  `scripts/tests/test-verify-metadata.sh`, and
  `scripts/tests/test-skill-dispatch-wrappers.sh`.
- Extend the shared policy and real Claude/Codex/Copilot adapter fixtures so the
  allowlist and denial text cannot diverge by hook surface.

## Acceptance

- In real primary-plus-linked-worktree fixtures, the default form, option-led
  forms, every currently known mutating subcommand, and representative unknown
  subcommands are blocked against both targets. Changing payload cwd or using a
  literal `cd` / `git -C` target never changes the verdict.
- Exact `list`, `show`, and `create` subcommands and the two help-only forms
  remain allowed in both checkouts, including representative safe options after
  an allowed subcommand. Tests begin with a stash entry containing work from
  another checkout and prove that every allowed command leaves the stash ref,
  index, and worktree unchanged.
- Parser cases distinguish `git stash`, `git stash -p`, `git stash -h`,
  `git stash --help`, `git stash push`, `git stash frobnicate`, and the three
  allowed subcommands. Unknown syntax fails closed rather than inheriting
  today's permissive behavior.
- Claude, Codex, and Copilot hook fixtures return the same decision and exact
  actionable reason. Existing global Git options and command wrappers retain
  their policy parser coverage without creating a target-resolution
  prerequisite for the stash rule.
- No repository-owned failure or dirty-work guidance tells an agent to stash.
  The land, verify-metadata, and agent-run regression suites pin replacement
  commit/inspect/ask guidance.
- `bash scripts/ai-hooks/test.sh`,
  `bash scripts/tests/test-verify-metadata.sh`,
  `bash scripts/tests/test-land.sh`, and
  `bash scripts/tests/test-skill-dispatch-wrappers.sh` pass.

## Boundaries and sequencing

- This is an agent safety policy, not a Git wrapper, stash ownership registry,
  per-worktree stash implementation, or named-stash convention. Do not
  automatically copy, commit, or recover dirty work.
- Do not permit mutating stash behavior in the primary checkout. Primary versus
  linked location does not prove ownership of the shared ref or selected entry.
- Do not ban the explicit allowlisted inspection/create/help forms merely
  because they mention stash. `create` may produce an object id for inspection
  but must not be followed automatically by `store`.
- Land this policy before the C8 command-policy authority flip in
  `../ready-2026-07/13-command-policy-ts-core.md`, and add the repository-wide
  allowlist cases to C8's frozen differential corpus so parity cannot restore
  today's permissive behavior.

## Implemented notes

- The allowlist normalizes option-bearing `git` prefixes before stripping an
  allowed stash command, so replacement capture indexes are independent of the
  global-option matcher. Help forms use the same shell-wrapper closers as
  `list`, `show`, and `create`, including `$()` and backticks.
- Accepted fail-closed limitation: the argument-tail regex is separator-aware
  but not fully shell-quote-aware. A quoted separator followed by text shaped
  like an executable stash mutation (for example,
  `git stash create 'checkpoint; git stash pop'`) is rejected. Distinguishing
  argument quote openers from outer `bash -c` wrapper closers would require
  stateful shell parsing; keeping that text visible avoids a false negative.
  Quoted prose that does not put a mutation at command position, such as
  `git stash create 'checkpoint; do not git stash pop'`, remains allowed.
