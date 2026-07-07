# 23. prisma-generate.sh proceeds without mutual exclusion if lock acquisition fails

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: quiet-wrappers · Area: hooks-exec · Severity: low-med · Size: S · Confidence: med
Theme: orphan-process-safety · Source: harness review 2026-07-06 (Sonnet breadth + Codex PARTLY-confirmed)

## Problem
The debounce+lock pattern in `prisma-generate.sh` is sound
(double-checked locking around `flock`), but neither `exec 9<>"$LOCK"`
nor `flock 9` has a checked failure path. On FD exhaustion, an
unsupported filesystem, or a permissions problem, the script continues
as if it held the lock — two near-simultaneous schema edits could then
run `prisma generate` concurrently, racing on the same log/marker files.
Codex's caveat: the failure usually prints shell stderr, so it is
noisy-but-unenforced rather than fully silent.

## Evidence
- `scripts/ai-hooks/prisma-generate.sh:61-64` — unchecked `exec`/`flock`
  (double-check pattern at `:43-68`).
- Codex verification: PARTLY (proceeds without lock: confirmed;
  "silently": narrowed).

## Proposed direction
Fail closed: `exec 9<>"$LOCK" || ai_emit_additional_context …; exit 0`
equivalents on both lines (advisory + skip, or block, matching how the
hook already reports generation failure). A one-line
`flock 9 || { …; exit …; }` keeps the pattern intact. Add a test that
points `$LOCK` at an unwritable path and asserts the hook reports rather
than proceeding.

## Scope / caveats
Trivial hardening; keep the 30s debounce untouched. One commit.
