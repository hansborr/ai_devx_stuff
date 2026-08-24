# Lane 02 — analyzers: drift-ai, drift-triage, logs-audit, code-intel

Status: Dispatch material — not a schedulable note

**Scope.** `scripts/drift-ai/` (all module bodies — the last audit sampled
only a handful of its ~344 modules), `scripts/drift-triage/`,
`scripts/logs-audit/`, `scripts/code-intel/` + `scripts/code-intel*.ts`.
Lint machinery, codemods, and path-policy are lane 09's; the rest of
`scripts/` is lane 01's.

**Emphasis.** Most of this lane's scope was *never read* by the previous
audit — expect a higher hit rate than other lanes. Look for: module layouts
that grew by accretion rather than design; internal contracts carried by
convention instead of types (the prior pack's drift-ai record/positional
params work covers some of this — find what it does *not* cover); analyzers
duplicating repo-model logic that `code:intel` already owns; dead or
superseded modules that were never deleted.

**Known context.** The dedup corpus carries records for prior-pack leaves 34
(drift-ai typing) and 35 (code-intel internals) — read those records and
dedup hard against them. Judge on public copyability (see ORCHESTRATION.md's
audit lenses) as well as internal quality.
