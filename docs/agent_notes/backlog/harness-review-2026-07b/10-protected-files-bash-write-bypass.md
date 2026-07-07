# 10. protected-files deny tier is bypassable via Bash-tool writes

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: policy-guards · Area: hooks-policy · Severity: high · Size: M · Confidence: high
Theme: enforcement-surface-parity · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
The deny tier of `protected-files.sh` (ratchet baseline, suppression
registers, `docs/generated/*`, `scripts/verify/steps.generated.sh`,
`bun.lock`, `.husky/_/*`) fires only on the `Edit|Write` PreToolUse
matcher. No Bash-matcher hook does any path-based write check, so a Bash
one-liner (`sed -i`, `tee`, `cat >>`, `cp`) targeting the same paths
bypasses the deny tier entirely. `bun.lock` and the ratchet baseline are
exactly the files whose integrity the tier exists to protect.

## Evidence
- Deny table: `scripts/ai-hooks/protected-files.sh:87-130`; deny emit at
  `:231`.
- Wiring: `.claude/settings.json:126` (`Edit|Write` matcher only); the
  Bash matcher (`:105`) runs `no-direct-db.sh`, `git-commit-quiet.sh`,
  `bun-run-quiet.sh` — none path-based.
- Codex verification: CONFIRMED with the same citations.

## Proposed direction
Add a lightweight Bash-side PreToolUse check (alongside or inside
`no-direct-db.sh` via `policy.sh`) that scans the command for write-shaped
constructs (`>`, `>>`, `sed -i`, `tee`, `cp`/`install`/`mv` targets)
whose operand resolves into the deny table. Reuse
`ai_protected_file_deny_entry` — do not duplicate the path list. Advisory
tier can stay Edit|Write-only; only the deny tier needs Bash parity.
Extend `scripts/ai-hooks/test.sh` with blocked fixtures (each write shape
× one denied path) and allowed fixtures (reads of the same paths, writes
to non-denied paths).

## Scope / caveats
Text-matching a shell string is inherently approximate — keep the
fail-closed bias for clear write shapes but do not attempt full shell
parsing; `.allow-protected-edits` must downgrade this check exactly as it
does the Edit|Write tier. One commit (policy.sh or new body + wiring
regen + test.sh).
