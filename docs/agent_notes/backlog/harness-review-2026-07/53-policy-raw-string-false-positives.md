# 53. The bypass-guard in policy.sh matches raw command text, so read-only searches for forbidden literals are denied as hook bypasses

Status: Done — implemented; see 00-index.md row 53. Retained as a design record.
Lens: hooks · Area: hooks-policy · Severity: high · Size: M · Confidence: high
Theme: command-policy-precision · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`ai_policy_violation_reason`'s first check — the hook-bypass guard — greps the raw command string instead of using the segment-aware, executable-position matching (`ai_policy_has_command` + `AI_POLICY_CMD_START`) that every *other* git rule in the same file uses. Any read-only search whose PATTERN contains a forbidden literal is denied with "Hook bypass is not allowed", even though nothing is being bypassed. This bites exactly the people/agents maintaining the harness itself (searching for `--no-verify` usages, auditing HUSKY handling) and even blocks `rg "git commit" -n` — a search for the words "git commit" with line numbers. During this very review, a Bash tool call containing those literals as data was denied by the live hook.

## Evidence
- `scripts/ai-hooks/policy.sh:188` — `grep -qE -- '(^|[[:space:]])HUSKY=0([[:space:]]|$)|--no-verify|\bgit[[:space:]]+commit\b.*(^|[[:space:]])-[A-Za-z]*n[A-Za-z]*([[:space:]]|$)'` over the whole command text. (Codex's second opinion cited ~line 188; verified exact.)
- Probe against the sourced functions (run 2026-07-01):
  - `rg HUSKY=0 scripts/` → BLOCKED (unquoted pattern; quoted `rg "HUSKY=0" scripts/` is already allowed — the quote breaks the whitespace anchor).
  - `rg -- --no-verify` → BLOCKED; `rg "--no-verify" .husky/` → BLOCKED (bare substring, no anchors at all).
  - `rg "git commit" -n scripts/` → BLOCKED (the third alternation reads the `-n` *search flag* as commit's no-verify shorthand).
  - `git log --grep=--no-verify` → BLOCKED.
- Live confirmation: a compound read-only probe command containing these literals was denied by the PreToolUse hook in this review session.
- The precise machinery already exists in the same file: `AI_POLICY_CMD_START`/`AI_POLICY_ENV_PREFIX`/`ai_policy_has_command` (`policy.sh:24-52`) and `AI_POLICY_GIT_PRECOMMIT_OPTS` + the real-commit matcher (`policy.sh:34`, `:137-156`) — the bypass guard is the only raw-text grep among the git rules.
- Fixtures: `scripts/ai-hooks/test.sh:138-140` covers the blocking direction (`git commit -m test --no-verify`, `HUSKY=0 git commit -m test`, `git commit -nm test`); there are no allowed-direction fixtures for searches, so the false positives are untested.
- Call sites that inherit the false positives: `scripts/ai-hooks/no-direct-db.sh:16`, `.codex/hooks/pre-tool-use.sh:22`, `scripts/ai-hooks/git-commit-quiet.sh:51` (`ai_preflight_or_block`).

## Proposed direction
Make the three bypass patterns executable-position-aware, reusing the existing helpers:
- `HUSKY=0`: match only as an env-var prefix of a command segment (start-of-segment or after `env`/`bash -c`, i.e. via `ai_policy_command_re`-style anchoring). `HUSKY=0 git commit` and `HUSKY=0 bun run test` stay blocked; `rg HUSKY=0` (pattern operand position) passes.
- `--no-verify` / `-n` shorthand: require them inside a *real* `git commit` command segment (reuse `AI_POLICY_GIT_PRECOMMIT_OPTS` + segment bounds `[^;&|]*`, mirroring `ai_policy_has_git_commit_on_main`). Quoted pattern arguments to `rg`/`grep`/`git log --grep` pass; `git commit -nm x`, `git commit --no-verify`, `bash -c "git commit --no-verify"`, and `env HUSKY=0 git commit` all stay blocked.
Extend `scripts/ai-hooks/test.sh` with both directions: keep the three existing block fixtures, add the probe list above as allow fixtures, plus adversarial blocked forms (`echo ok && git commit --no-verify`, `git -c core.editor=true commit -n`).

## Scope / caveats
Keep the fail-closed bias — a false negative (real bypass slips through) is worse than a false positive here. Scope strictly to obvious read-only-search false positives; do not attempt full shell parsing, and where a form is ambiguous (e.g. `sh -c` with interpolated strings) leave it blocked. Note the `.claude/settings.json:10-12` permission-deny globs independently cover `git commit *--no-verify*`, so the hook change cannot open that path even if the regex regresses. One commit (policy.sh + test.sh).
