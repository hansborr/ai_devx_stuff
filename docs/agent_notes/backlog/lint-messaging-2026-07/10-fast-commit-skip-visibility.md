# 10. Fast-commit success summary must say what was skipped

Status: Done — implemented on lane/lint-msg-envelope-fix; commit success summaries append a fast-commit skipped-slot notice when the Git common-dir marker is present.
Lens: gates · Area: truthfulness · Severity: high · Size: S · Confidence: high
Theme: silent-skip · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
On a green fast-commit, the agent-facing tool result is replaced entirely by
the success summary (hash/subject/diffstat). The "fast-commit mode — skipping
test/scripts slot" notice is printed to pre-commit stderr outside the
Passed/Failed block and never reaches the tool result. Verified: neither
`commit-output.sh` nor `git-commit-quiet.sh` contains any fast-commit
awareness. An autonomous agent has no built-in reason to remember the marker
is set, so it reads a skipped-slot commit as fully verified. The pre-push
fast-commit backstop (harness-review leaf 57, Done) catches this at
publication time; commit time stays silent.

## Evidence
- `scripts/ai-hooks/git-commit-quiet.sh:174-178` — success path substitutes
  `ai_commit_success_summary` as the whole tool result (via
  `ai_claude_result_command`, `scripts/ai-hooks/common.sh:80-88`).
- `scripts/verify/steps-lib.sh:138` — the skip notice
  (`verify steps: fast-commit mode — skipping %s slot ...`) goes to stderr,
  outside the captured summary.
- Negative grep for `fast.commit|fast_commit` over
  `scripts/ai-hooks/commit-output.sh` and `git-commit-quiet.sh`: no hits
  (verified 2026-07-05).

## Proposed direction
When `musi_fast_commit_enabled` (or the equivalent marker check) is true at
summary-composition time, append one suffix line to
`ai_commit_success_summary`, e.g.:
`(fast-commit: test+scripts slots skipped — land via bash scripts/land.sh)`.
Keep it to a single line so the summary stays scannable.

## Scope / caveats
- Message-only change; do not alter which slots run.
- Check for tests/fixtures asserting the exact success-summary text
  (`scripts/lint-agent-envelope.test.ts` is unrelated; look for
  commit-output tests under `scripts/tests/`) and update them.
- The marker lives at `$(git rev-parse --git-common-dir)/musi-fast-commit`;
  read it the same way pre-commit does rather than re-deriving the path.
