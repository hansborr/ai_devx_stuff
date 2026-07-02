# 74. Load-bearing workflow rules live in an opt-in output style that a fresh session or other contributor never loads

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: reference-fitness · Area: claude-config · Severity: med · Size: S · Confidence: high
Theme: always-loaded-vs-opt-in · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`.claude/output-styles/cadence.md` encodes workflow rules that must hold for the repo's commit-gate model to work: commit completed work without asking, branch off `main` before the first commit, ask before push/PR, integrate branches with `git merge --no-ff`, commit incrementally in small units, and treat the commit gate as the verification step instead of hand-running `verify`. But Claude Code output styles apply only when a user selects one, and no `outputStyle` key is set in `.claude/settings.json` or `settings.local.json` (verified) — so a fresh session, another contributor's clone, or any non-Claude agent (Codex never reads output styles) gets none of this. Some rules are backstopped by hooks; the rest simply vanish. The copyable lesson for a reference repo is the principle itself: **guidance that must always hold belongs in the always-loaded file (AGENTS.md); an output style is a tone/verbosity UX layer, not a policy store.**

## Evidence
- `/workspace/.claude/output-styles/cadence.md:7-24` — verified directives: commit-without-asking + branch off main + ask before push/PR (7-8); `--no-ff` integration, fast-forward only when asked (10-13); incremental per-unit commits (15-18); "the commit's changed-file gate is the verification step ... Don't run the full suite or the verify gate by hand" (20-24). Frontmatter `keep-coding-instructions: true` (line 4).
- No default selection: `rg outputStyle .claude/settings.json .claude/settings.local.json` → no matches.
- Hook backstops (partial overlap, so not everything is lost): `/workspace/scripts/ai-hooks/policy.sh:16` blocks commits on main (`AI_POLICY_GIT_COMMIT_ON_MAIN`; hard guard `ai_guard_commit_branch_or_die` lines 73-85), `:15` blocks push-to-main, `:281-299` blocks `gh pr create`/merge etc. Not hook-covered: commit-without-asking, incremental commits, `--no-ff` for ordinary integrations, trust-the-gate.
- AGENTS.md Workflow overlap (diffed): it has branches + conventional commits, "Commit your work, which runs tests for you automatically", and mentions `--no-ff` only inside the fast-commit/`land.sh` path. It lacks: commit-without-asking-first, ask-before-push/PR, incremental small commits, `--no-ff` as the general integration rule, and don't-hand-run-verify.
- Latent contradiction to resolve while merging: AGENTS.md Commands opens with "`bun run verify:changed` — default verification", while cadence.md:22-23 says not to run the verify gate by hand — the merged wording must reconcile these (e.g. "verify:changed is what the commit gate runs; invoke it directly only when not committing").

## Proposed direction
Move the always-true rules into AGENTS.md's Workflow section (the five gaps listed above), reconciling the verify:changed wording, and cut cadence.md down to genuine tone/verbosity/cadence UX (or delete it if nothing tone-only remains — its current content is ~100% policy). Add one sentence to `docs/ai-harness.md` (or the eventual "what to copy" doc, leaf 75) stating the placement principle explicitly, since that principle — not the specific rules — is what adopters should copy. Note AGENTS.md is a protected file (`scripts/ai-hooks/protected-files.sh` surface), so the edit is deliberately human-reviewed.

## Scope / caveats
One small commit: AGENTS.md wording + cadence.md trim + one principle sentence. Keep AGENTS.md tight per its own promotion rule (`docs/ai-harness.md:282-283`: don't add global instructions unless every agent needs them every session — these qualify; they govern every working session's commit behavior). Verify the commit-msg/body-length hooks and any docs referencing "Cadence" by name after the trim (`rg -i 'output-style|cadence'`).
