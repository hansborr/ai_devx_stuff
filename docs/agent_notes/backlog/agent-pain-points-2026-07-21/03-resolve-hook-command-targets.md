# C8 Command-Target Correctness Rider

Status: Accepted after adversarial review — non-schedulable decision record
Date: 2026-07-21
Source: `pain_points.log` — hook command target misclassification
Implementation owner:
`../ready-2026-07/13-command-policy-ts-core.md` (C8)

## Decision

This leaf records binding correctness decisions for C8. It is not an
independent backlog task, must not be promoted or assigned, and owns no
implementation lane. The command-policy TypeScript core in
`../ready-2026-07/13-command-policy-ts-core.md` is the sole implementation
owner.

C8's differential corpus must not preserve the current Bash behavior where it
conflicts with this rider. Rows covered here are explicit correctness overrides,
not parity mismatches to normalize away.

## Problem

The hook command resolver has only a path-or-failure result, and callers treat
failure as if the guarded Git invocation had no explicit target: they silently
use the payload cwd or hook checkout. For example, any `$()` anywhere in a
command makes `ai_target_dir_from_cmd` return non-zero, so a literal
lane-targeted commit with a substitution only in its message is judged against
`/workspace`; a target such as `git -C "$LANE" commit` is likewise mis-keyed.
When the fallback checkout is on `main`, a valid lane commit gets a false
protected-branch block. The mistaken root can also key HEAD tracking, locks, and
cache state.

Separately, `git switch -c feat/x && git commit ...` is currently evaluated
against the branch before the command runs. From `main`, policy blocks the
commit even though `&&` guarantees that the commit runs only after that same
checkout has switched to the new feature branch.

## Evidence

- `scripts/ai-hooks/common.sh:191-203` documents a deliberately narrow leading
  form parser and fallback behavior. `scripts/ai-hooks/common.sh:214-218`
  rejects the entire command on any command or process substitution.
- `scripts/ai-hooks/common.sh:278-295` extracts one `git -C` target, while
  `scripts/ai-hooks/common.sh:315-339` collapses extraction failure and absence
  into payload-cwd / hook-root fallback. This cannot represent an explicitly
  targeted but indeterminate command.
- The resolver regression at `scripts/ai-hooks/test.sh:2504-2548` expects
  substitution to fall back to payload cwd. The worktree fixture at
  `scripts/ai-hooks/test.sh:2853-2882` covers only literal `cd` and `git -C`
  targets.
- `scripts/ai-hooks/policy.sh:607-632` detects a commit and then reads the
  checkout's current branch. It does not model a preceding same-command branch
  transition.
- Target resolution feeds `scripts/ai-hooks/bash-pre-tool-use.sh:28-50`,
  `scripts/ai-hooks/no-direct-db.sh:16-26`,
  `scripts/ai-hooks/git-commit-quiet.sh:49-64`, and
  `scripts/ai-hooks/bash-post-tool-use.sh:33-49`.

## Binding C8 contract

### S1 — tokenize and classify each guarded invocation

- Tokenize enough shell structure to associate each guarded Git invocation with
  its own command segment. A substitution in a commit message or unrelated
  segment must not erase a literal target on the guarded invocation.
- Give each guarded invocation a target classification of **resolved**,
  **implicit**, or **indeterminate**. Resolved means its effective checkout is
  statically known. Implicit means that invocation contains no target-bearing
  syntax and may therefore use the validated payload cwd. Indeterminate means
  target-bearing syntax exists but the effective checkout cannot be proved.
- Resolve quoted and escaped literal paths and repeated `git -C` options in
  Git's left-to-right order: a relative `-C` is relative to the effective path
  established by the previous `-C`, while an absolute `-C` resets it.
- Treat mixed checkout targets within one guarded compound as indeterminate.
  Also fail closed for malformed quoting, target-affecting substitutions or
  variables, unsupported wrappers, `--git-dir`, `--work-tree`, Git target
  environment assignments or `env` forms, an absent/invalid payload cwd, and
  any path that cannot be canonicalized to a valid checkout. None of these may
  collapse to implicit or the hook checkout.
- A bare `git commit` with no target-bearing syntax remains implicit. It may use
  payload cwd only after validation; the existing absent-payload hook-root
  compatibility fallback is allowed only when that fallback itself resolves
  and canonicalizes safely.

S1 is analytical and wired into nothing. It establishes tokenization,
per-invocation target results, and corrected differential-corpus expectations;
it does not prematurely duplicate result propagation across Bash adapters.

### S2 — model one provable branch transition

- For the Git policy authority flip, recognize only the exact, statically
  provable same-checkout form
  `git switch -c <literal-unprotected-branch> && git commit ...`.
- Both invocations must resolve to the same canonical checkout. The exception
  does not apply to `main`/`master`, dynamic branch names, `;`, `||`, pipes, an
  intervening command, mixed or indeterminate targets, or other branch-changing
  forms. Those retain the ordinary protected-branch verdict or fail-closed
  split-command guidance; the classifier never guesses future state.

### Later authority slices — propagate, do not reinterpret

As the relevant C8 domains flip, they must consume the S1 classification rather
than re-resolve the raw command. Branch policy and commit execution take it in
S2; protected-write target resolution takes it in S3; remaining classifier,
HEAD-before/after correlation, lock and cache keying, and Claude/Codex/Copilot
adapter paths adopt it with their owning later slice. An indeterminate guarded
invocation fails closed with concise literal-path or split-command guidance at
every consuming surface.

## Required acceptance rows for C8

- A literal lane target remains resolved when `$()` or backticks occur only in
  commit-message arguments or an unrelated command segment.
- Single-quoted, double-quoted, and escaped-space literal targets resolve, and
  repeated absolute/relative `git -C` options match Git's ordering.
- `cd "$LANE" && git commit`, `git -C "$(pwd)" commit`, mixed checkout
  targets, malformed target quoting, `--git-dir`, `--work-tree`, target
  environment forms, invalid cwd, and failed canonicalization are
  indeterminate. A guarded operation never falls back from one of those cases
  to payload cwd or hook root.
- A bare `git commit` with no explicit target is implicit and uses a validated
  payload cwd; the documented compatibility fallback is exercised separately.
- From `main`, exact same-target
  `git switch -c feat/example && git commit -m ...` is allowed, and the
  executing wrapper observes, locks, and reports the checkout where the commit
  lands. Every excluded transition shape remains blocked or receives
  split-command guidance.
- Focused TS tests, the corrected differential corpus, and live adapter fixtures
  prove identical target and branch verdicts for Claude, Codex, and Copilot,
  including pre/post HEAD-state correlation for commits.

## Boundaries

- Do not use `eval`, invoke a shell to discover a target, perform command
  substitution, expand the caller's environment generally, or build a
  general-purpose shell parser. The core analyzes syntax conservatively; it
  does not execute user text.
- Do not broaden authorization for stateful compounds. The exact same-target
  `switch -c ... && commit` form is the only prospective branch state modeled.
- Do not schedule this leaf separately or repair Bash as a prerequisite. C8 may
  repair a Bash path temporarily only when its own staged authority flip needs
  that compatibility bridge; the corrected TS contract and corpus remain the
  implementation objective.
