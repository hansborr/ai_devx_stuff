# Mutation-coverage backlog — closed (2026-06-21)

The 95-finding StrykerJS mutation-coverage pack (from the 2026-06-17→18 overnight
run; shared 77.9% / server 59.4% / scripts 54.1% mutation score) was implemented
on `feat/mutation-expand-shared-server` (71 commits, reviewed) and **merged into
`main`** (merge `051dc749`). A 2026-06-21 reconciliation sampled the landed work
and confirmed **94/95 findings closed**.

## Residual

Only **#75** (untested operational scripts with real logic —
`cacheKeyHashFor`/`usesEslintCache`, rule-source validators, `max-lines-policy`
throw branches, license classification) remains. Its full test directions are
inlined as a Tier-1 task in
`../in_progress/codex-drain-queue-2026-06-21.md`. The pack folder
(`docs/agent_notes/backlog/mutation-coverage-2026-06/`, index + report + 95 leaf
files) was removed; all leaf text is recoverable from git history.

Methodology, per-scope scores, and the 208-agent triage workflow are described in
the removed `00-report.md` (git history) and the `MEMORY` notes
`mutation-coverage-implemented-2026-06` / `mutation-overnight-run-2026-06-17`.
