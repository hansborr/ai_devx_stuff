# 13. Write down the substrate ruling (bash vs TS)

Status: Done 2026-07-14 — owner sign-off recorded; the ruling remains in
`docs/ai-harness.md` ("Substrate Ruling (Bash Vs TS)" section)
Size: S · Severity: low-med (prevents future re-litigation)
Source: 00-report.md B1

## Problem

The bash/TS boundary in the harness is by-accident: `db-status.sh` *and*
`db-status.ts` both exist; the 831-line `doctor.sh` holds analysis logic in
bash; new tools pick a substrate by author preference.

## Scope

Record the ruling in `docs/ai-harness.md` (consistent with its existing
Portable Core section):

- Portable-skill surfaces stay single-file dependency-free bash.
- Repo-local gate orchestration stays bash but shares engine libs (leaf 10).
- Anything analytical lives in TS.
- A full Bun/TS rewrite of `agent-run.sh` was considered and **rejected**
  under the copyability lens — a `.sh` runs before `bun install` in a fresh
  worktree; the adapter-table leaf shrinks the bash instead. Record the
  rejection so future tools don't re-litigate it.

## Verification

- Docs-only; `bun run harness:check` unaffected. Owner sign-off on the ruling
  text is the done signal.
