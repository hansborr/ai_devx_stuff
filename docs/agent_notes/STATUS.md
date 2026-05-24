# Status

**Last updated**: 2026-05-24 — `fix/hook-output` local
Codex git-commit timeout/empty-output guidance follow-up implemented. Codex
post-hook git commit summaries now treat empty, signal, and timeout-shaped
responses as uncertain and point agents at `commit-timeout-status.sh`, which
checks whether HEAD moved, waits up to 240s for the pre-commit lock, and asks
the agent to rerun the status command if the lock is still held. Claude's
`git-commit-quiet.sh` timeout denial uses the same guidance.

## Active

Hook-output follow-up is implemented and tested: shared uncertain commit
summary helper, Codex post-hook timeout/empty-output detection, the
`commit-timeout-status.sh` retry/status helper, Claude timeout guidance, and
`test-ai-hooks` changed-file selection for `.claude/hooks/`.

Lint-hardening review follow-up Tier 2 remains the broader follow-up queue in
`backlog/lint-followups/00-index.md`. Broad-shallow Leaf 41 coverage is
**complete enough** after Leaf 41j; the next promoted hardening work should be
a named drain or deeper-rule leaf, not a broad-shallow re-audit.

## Verification

Scoped gates for the hook-output follow-up passed:

- `bash scripts/test-ai-hooks.sh`
- `MUSI_SCRIPTS_CHANGED_FILES=$'.claude/hooks/git-commit-quiet.sh\n.codex/hooks/post-tool-use.sh\nscripts/ai-hooks/commit-output.sh\nscripts/ai-hooks/test.sh\nscripts/test-scripts.sh' bash scripts/test-scripts.sh --changed`
- `bash scripts/test-test-scripts.sh`
- `bun run lint:shell`
- `git diff --check`

## Historical context

`LOG.md` is the curated chronological history. The lint-hardening backlog
index is `backlog/lint-hardening-cross-repo-review.md`, with the verdict
register at `backlog/lint-hardening/evaluation-verdicts.md`. Parked
in-progress lint context docs are provenance-only — open them only when a
human asks for re-triage.
