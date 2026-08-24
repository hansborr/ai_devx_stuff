# 218. Replace the coverage-cadence guide's deleted baseline pointer

Status: Not started
Theme: Coverage cadence points operators at deleted baseline records · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The coverage-cadence procedure names `LOG.md` as the location of its comparison
baseline even though that document contains neither the stated record IDs nor
the baseline date. The underlying snapshot remains recoverable from Git
history, but the guide omits both the deleted artifact's path and its commit.
Operators must reconstruct that provenance before they can apply the guide's
drift thresholds.

## Evidence

- `docs/guides/coverage-cadence.md:14-23` — the guide points to
  `AUD-COV-001` / `AUD-COV-002` entries in `docs/agent_notes/LOG.md`, then
  acknowledges that the original notes were deleted and recommends
  `git log -p` without naming a path or commit.
- `docs/agent_notes/LOG.md` — measurement: **0** matches for the stated record
  IDs or date, reproduced with
  `rg -n 'AUD-COV|2026-05-13' docs/agent_notes/LOG.md`.
- Historical recovery is reproducible with
  `git show 54f2eb910:docs/agent_notes/in_progress/codebase-audit/coverage.md`;
  the command returns the `AUD-COV-001` baseline recorded on 2026-05-13,
  including global and per-scope coverage tables.
- `package.json:43` — the guide's underlying `bun run test:coverage` command
  remains a defined root script.

## Proposed direction

Replace the false `LOG.md` pointer in
`docs/guides/coverage-cadence.md:14-23` with the exact historical provenance:

- baseline commit `54f2eb910`;
- historical path
  `docs/agent_notes/in_progress/codebase-audit/coverage.md`; and
- the reproducible retrieval command
  `git show 54f2eb910:docs/agent_notes/in_progress/codebase-audit/coverage.md`.

Keep the existing instruction to write the next fresh baseline to a current
tracked path and update the guide when that happens. Until then, direct
operators to the historical snapshot explicitly rather than asking them to
search unspecified history.

Validate the edit by running the documented `git show` command from the
repository root and confirming that the rewritten paragraph no longer claims
the baseline is present in `docs/agent_notes/LOG.md`. No coverage run or
baseline refresh is required for this pointer correction.

## Scope / caveats

- Do not describe the baseline as irrecoverable. Commit `54f2eb910` retains the
  complete historical note at the required path.
- Do not change coverage floors, drift thresholds, cadence, CI policy, or the
  `test:coverage` implementation. This leaf corrects provenance only.
- Restoring a current tracked summary is an acceptable alternative to the
  explicit historical pointer, but it must preserve the historical path and
  commit as provenance and must not invent fresh measurements.
- [083-sole-progress-queue-mostly-stale-view.md](./083-sole-progress-queue-mostly-stale-view.md)
  also discusses references in `LOG.md`, but its lines 72-81 concern an
  unrelated progress-queue artifact. It neither supplies nor repairs this
  coverage baseline pointer.
