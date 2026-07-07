# 14. Decide: widen AI_POLICY_CMD_START grammar coverage or document the accepted residual risk

Status: Decided 2026-07-07 — option (a) with a documentation rider (see Decision below); implementation dispatched. Re-verify file:line before acting.
Lens: policy-guards · Area: hooks-policy · Severity: med · Size: M · Confidence: high
Theme: command-policy-precision · Source: harness review 2026-07-06 (Sonnet breadth + Codex PARTLY-confirmed)

## Problem
`AI_POLICY_CMD_START` recognizes start-of-string and `[;&|]` boundaries,
plus one level of `env`/`bash -c` prefix. Real Bash grammar admits more
executable positions, so these evade every structured git/gh guard:
`X=$(git commit --amend)`, `if true; then git reset --hard; fi`,
`for x in 1; do git push --force; done`, `ssh host 'git push --force'`,
and double-wrapped `bash -c "bash -c '…'"`. For Claude, the
`permissions.deny` globs backstop only the plain direct shapes; the
`$(…)`/keyword forms have no second line of defense. (Confirmed: short
`git commit -n` IS blocked — `policy.sh:271` — an earlier draft of this
finding was wrong about that.)

## Evidence
- `scripts/ai-hooks/policy.sh:117` (`AI_POLICY_CMD_START`), `:129-145`
  (`ai_policy_command_re` — one prefix level only).
- Codex verification: PARTLY — grammar gaps real; `-n` claim refuted.
- Mitigations already in place: protected-branch commits have a git-level
  backstop (`ai_guard_commit_branch_or_die`, `policy.sh:160-178` via
  `.husky/pre-commit`); hook-bypass flags are deny-globbed.

## Proposed direction
This is a decision leaf, not (yet) an implementation leaf. Options:
(a) extend the boundary set with `$(`, backtick, and the keywords
`then|do|else|elif|{|!` — cheap, catches the accidental cases;
(b) accept and document the residual risk in `policy.sh`'s header comment
so future audits stop re-flagging it (this pack is the second review to
find it). Full shell parsing is explicitly out of scope either way — an
LLM agent hits these shapes by accident, not adversarially, and the
prior pack's leaf 53 set the "no full parsing" precedent.

## Decision (2026-07-07)

Option (a) with a documentation rider: extend the boundary set with `$(`,
backtick, and the keywords `then|do|else|elif|{|!` (prefix handling stays at
one level), and document the deliberately-unhandled residual — ssh-wrapped
commands, double-wrapped `bash -c` — in `policy.sh`'s header comment so
future audits stop re-flagging it. Scope is hard-capped at one commit with
both-direction fixtures; no `policy.sh` refactors, no additional boundary
forms beyond those listed. The threat model remains accidental agent
commands, not adversarial evasion.

## Scope / caveats
If (a): fixtures for each new boundary in both directions; watch for new
false positives on prose containing `then git …`. Record the decision in
this leaf before implementing. One commit.
