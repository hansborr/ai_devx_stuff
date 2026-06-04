# Doc-Length Hook Redesign

Status: Archived. Landed on `fix/lint-messaging-v2`. Supersedes the parked
`../backlog/harness-review-tasks/12-doc-length-phantom-files.md` (phantom-file
cleanup) and the planning note that was at
`../backlog/doc-length-hook-redesign-plan.md`.
Date: 2026-06-02

## What landed

- `scripts/doc-length-policy.sh` now tags each matched path with a surface
  (`MUSI_DOC_LENGTH_SURFACE`) and exposes `musi_doc_length_rule_surface`.
- `scripts/ai-hooks/doc-length.sh` (PostToolUse) emits only for `edit`-surface
  rules; everything else is left to the non-blocking pre-commit warning.
- Message reworded from the imperative `doc-length: ... Trim it now ...` to
  `doc-length advisory (not a blocker): ...`, and `threshold` → `budget`
  everywhere.
- Removed the stale `STATUS.md` / `NEXT.md` policy arms and the
  `DECISIONS_ARCHIVE.md` guidance (those files were intentionally removed in
  `744b9424`).

## Durable decisions (not recoverable from the diff)

- **Surface split.** `edit` = `AGENTS.md`, `CLAUDE.md` (loaded into every
  session, so trimming compounds). `commit` = agent_notes README/DECISIONS/
  decisions-*/in_progress. Edit-time interrupts only earn their keep for
  always-loaded context; everything else is a commit-time nudge.
- **`edit` rules fire twice, by design.** `AGENTS.md`/`CLAUDE.md` warn at both
  PostToolUse and pre-commit. Pre-commit deliberately does not filter by
  surface — do not "dedupe" the double signal away.
- **`in_progress/*.md` is commit-surface on purpose.** Long working notes are
  legitimate while work is active; the old edit-time nudge caused agents to
  churn-trim mid-task. Guidance now fires at wrap-up time.
- **Codex stays unwired.** No `.codex` doc-length hook. If one is ever added,
  keep it edit-surface only (`AGENTS.md`/`CLAUDE.md`). Harness metadata
  invocation is now `Claude PostToolUse / Husky pre-commit warning`.
- **Throttling deferred.** Narrowing the edit surface removed the noise; only
  add per-file/session throttling (`scripts/ai-hooks/throttle-state.sh`) if a
  realistic edit flow shows the same file emitting repeatedly.

## Tests

- `scripts/ai-hooks/test.sh` — edit-surface emits, commit-surface PostToolUse
  stays silent, stale STATUS/NEXT fixtures gone, message wording locked.
- `scripts/test-dependency-freshness.sh` — pre-commit warns non-blockingly for
  an over-budget commit-surface doc.
