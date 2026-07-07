# 13. Codex/Copilot lack the worktree-loss protections Claude gets from permissions.deny

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: policy-guards · Area: hooks-policy · Severity: high · Size: S-M · Confidence: high
Theme: enforcement-surface-parity · Source: Codex second opinion 2026-07-06 (Codex-original [P1] finding)

## Problem
Claude blocks uncommitted-work-destroying commands (`git checkout -- <path>`,
`git checkout .`, `git restore .`, `git restore --worktree`,
`git stash drop|clear`) only via `.claude/settings.json` `permissions.deny`
globs — `policy.sh` has no matching guards. Codex and Copilot wire their
Bash protection exclusively through the shared `policy.sh` aggregates, so
delegated `work codex` runs (the default implementation delegate per the
agent-cli skill) can silently discard uncommitted work that a Claude
session could not.

## Evidence
- `.codex/hooks.json:5`, `.github/hooks/copilot.json:7` — Bash surface =
  `bash-pre-tool-use.sh` → `policy.sh` only.
- `.claude/settings.json:62-79` — checkout/restore/stash-drop denies exist
  only at the Claude permission layer.
- `scripts/ai-hooks/policy.sh:386` region — destructive-git matchers cover
  reset/clean/branch/push/tag but not checkout/restore/stash forms.
- Codex verification: Codex's own added [P1] finding.

## Proposed direction
Add `policy.sh` guards for the worktree-loss family, mirroring the deny
globs' intent: `checkout`/`switch` with `-f/--force`, `checkout --
<path>`/`checkout .`, `restore` targeting the worktree (`--worktree`,
`-W`, bare `restore .`/`restore -- .`), `stash drop`/`stash clear`. Keep
`git checkout <branch>` and `git restore --staged` allowed. Fixtures in
both directions in `scripts/ai-hooks/test.sh`.

## Scope / caveats
False-positive care: `checkout -- <path>` legitimately appears in
mission text and docs — guards must use executable-position matching from
the start (build on leaf 11's helpers). Claude keeps double coverage;
that is fine (defense in depth). One commit (policy.sh + test.sh).
