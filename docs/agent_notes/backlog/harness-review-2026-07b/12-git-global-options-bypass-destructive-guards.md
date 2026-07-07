# 12. Destructive git guards miss global options (`git -C . reset --hard` bypasses)

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: policy-guards · Area: hooks-policy · Severity: high · Size: S · Confidence: high
Theme: command-policy-precision · Source: Codex second opinion 2026-07-06 (Codex-original [P1] finding)

## Problem
The commit-specific policy checks handle git global options
(`git -c … commit`), but the destructive-operation checks do not:
`git -C . reset --hard`, `git -C . push --force`, `git -C . clean -fd`,
and `git -C . branch -D old` all slip the hook layer. The
`.claude/settings.json` deny globs are shape-based too and do not cover
the `-C <dir>` interposition for most of these, so for Claude the hook is
the only line of defense — and for Codex/Copilot (which have no
`permissions.deny` layer) it is the only defense, period.

## Evidence
- `scripts/ai-hooks/policy.sh:196` (reset --hard), `:397` (force-push),
  `:410` (clean -f), `:427` (branch -D) — none tolerate global options
  between `git` and the subcommand.
- Contrast: `scripts/ai-hooks/policy.sh:121` — `AI_POLICY_GIT_PRECOMMIT_OPTS`
  exists precisely to skip global options for the commit checks.
- Codex verification: this is one of Codex's own added [P1] findings.

## Proposed direction
Factor the commit checks' global-option tolerance
(`AI_POLICY_GIT_PRECOMMIT_OPTS`-style `(-[A-Za-z] …|--opt[=…])*` skipper)
into a shared fragment and apply it to every destructive git matcher in
`ai_policy_violation_reason`. Add blocked fixtures for each `-C .`/`-c k=v`
variant and allowed fixtures for benign global-option commands
(`git -C /tmp/x status`).

## Scope / caveats
Pure regex-precision work; no behavior change for currently-blocked
shapes. Coordinate with leaf 14 (grammar-position gaps) but do not block
on it — this is a strict subset fix. One commit (policy.sh + test.sh).
