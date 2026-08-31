# Mutation-coverage backlog — closed (2026-06-21)

The 95-finding StrykerJS mutation-coverage pack (from the 2026-06-17→18 overnight
run; shared 77.9% / server 59.4% / scripts 54.1% mutation score) was implemented
on `feat/mutation-expand-shared-server` (71 commits, reviewed) and **merged into
`main`** (merge `051dc749`). A 2026-06-21 reconciliation sampled the landed work
and confirmed **94/95 findings closed**.

## Residual

**#75** (untested operational scripts with real logic) is the pack's only
residual, and a 2026-08-30 re-check narrowed it to one item. Landed since:
`cacheKeyHashFor`/`usesEslintCache`
(`tools/lint-ratchet/src/kernel/eslint-config.test.ts`), the rule-source
validators (`tools/lint-ratchet/src/kernel/rule-source.test.ts`), the
`edit-check` soft-skip and drift guards
(`tools/lint-ratchet/src/governance/edit-check.test.ts`), the
`readMaxLinesPolicy` throw branches (`scripts/lib/max-lines-policy.test.ts` —
the module moved out of `scripts/lint-ratchet/` in `0b649d05`), and license
classification plus the SPDX `OR` join
(`scripts/audit-dependency-licenses-classification.test.ts`). Still open:
`licenseFromNearbyFile` in `scripts/audit-dependency-licenses.ts` is
module-private with no LICENSE-text-sniffing test.

The pack folder (`docs/agent_notes/backlog/mutation-coverage-2026-06/`, index +
report + 95 leaf files) was removed in `832345a9`; all leaf text — #75's full
test directions included — is recoverable from git history. They are **not**
inlined in `../in_progress/codex-drain-queue-2026-06-21.md`, which since the
2026-08-30 pass carries only a one-line pointer back here.

Methodology, per-scope scores, and the 208-agent triage workflow are described in
the removed `00-report.md` (git history) and the `MEMORY` notes
`mutation-coverage-implemented-2026-06` / `mutation-overnight-run-2026-06-17`.
