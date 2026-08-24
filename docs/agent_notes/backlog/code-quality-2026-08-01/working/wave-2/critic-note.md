# Completeness critic — code-quality-2026-08-01 (Phase 3 barrier)

Status: Working record — critic verdict + orchestrator disposition

Run 2026-08-02 by a read-only Fable subagent over all 16 banked lane runs
(wave-1 lanes 01–09, wave-2 round-1 lanes 06/07/08/09, wave-2 round-2
lanes 05/06/07), the ownership matrix, `working/ownership-closure.md`,
`working/hotspots.md`, and the on-disk tree at the pin.

**VERDICT: FAIL** — two universally-skipped scope items; no unassigned
matrix areas.

## Failures

**F1 — Flat analyzer CLI entry points (universally-skipped). Owner: lane 02.**
`scripts/drift-ai.ts` (149 lines), `scripts/drift-triage.ts` (183 lines),
`scripts/logs-audit.ts` (279 lines) — all exist at the pin, all assigned to
lane 02 by `working/ownership-closure.md` ruling R2 ("flat CLI entries of
analyzer dirs belong with their analyzer, not lane 01"). Lane 02's single
run reads the four directory trees plus only the two code-intel flat
entries; the drift-ai/drift-triage entries appear in no coverage array, and
`scripts/logs-audit.ts` is explicitly skipped with a justification ("flat
top-level files outside lane-02's owned production globs") that is false
against ruling R2. No other lane read them (lane 08 sampled filenames only;
lane 01 assigned analyzer trees away). Net: ~611 lines of owned production
code with no read claim across all 16 banked runs.

**F2 — `scripts/data/` (universally-skipped). Owner: lane 01.**
`scripts/data/eslint-disable-broad-allowlist.txt` and
`scripts/data/ts-nocheck-allowlist.txt` are named matrix scope for lane 01
(repeated in ownership-closure), yet no banked coverage array or hotspot
row mentions `scripts/data` or either filename.

**Unassigned-matrix-area check: PASS.** Every top-level tracked directory
(`packages`, `scripts`, `docs`, `tools`, `eslint-rules`, `eslint-config`,
`e2e`, `examples`, `.claude`, `.codex`, `.copilot`, `.cursor`,
`.playwright`, `.devcontainer`, `.husky`, `.github`) and all 45 tracked
root files reconcile against the matrix + ownership-closure; `packages/`
contains exactly the three assigned packages. No orphan paths on disk.

## Recognized exclusions (not failures)

- `packages/server/src/generated/` — generated Prisma client (plan; lanes
  03/08 record it skipped).
- `bun.lock`, build artifacts, `node_modules` — plan exclusion.
- `LICENSE`, `NOTICE.md`, `docs/SRD_CC_v5.2.1.pdf` — legal/SRD source
  (ruling R11); SRD content correctness excluded everywhere.
- Contents of `docs/agent_notes/` packs — records, not audit subjects;
  structure stayed with lane 07 (honored: headers/governance sampled).
- Drift packet outputs — gitignored, absent from `git ls-files`.
- Test/build/lint execution — prohibited by dispatch; recorded as skipped
  by every lane.
- Bug hunting → `/code-review` (116-entry `bugs-handoff.md`), security →
  `/security-review` — out-of-scope owners per plan.
- Unsampled generated class-feature/seed-JSON interiors — covered by lane
  03's stated sampling rule, recorded as sampled not clean.

## Coverage-claim anomalies (advisory; feed into Phase-4 triage)

- Lane 02's false skip justification for `scripts/logs-audit.ts` —
  verdict-affecting (part of F1).
- Lane 01 "51 lane-owned flat top-level shell scripts": only 40 flat `.sh`
  files exist directly under `scripts/` at the pin — inflated count, no
  specific masked area identified.
- Lane 01 "63 direct production TypeScript/ESM files": 77–84 exist
  depending on exclusion reading — count ambiguity rather than a masked
  skip (cut list shows engagement with the ambiguous families).
- `.github/hooks/copilot.json` + `.github/pull_request_template.md`:
  plausibly inside lane 01's adapter-tree claim; lane 08 sampled
  `.github/**`. Dispositioned below.
- `scripts/fixtures/` (9 files, ruling R3 → lane 06),
  `scripts/test-support/` (1 helper), `scripts/harness-audit/fixtures/**`:
  never named by lane 06, but plausibly inside its wave-2 "156 assigned
  test/support files inventoried" claim, and specific fixture families were
  demonstrably engaged via lanes 06/08/09 findings. Dispositioned below.
- All other spot-checks reconciled exactly (harness.controls.json line
  count, docs/guides, MODULE-doc count, shared partition closure, drift-ai
  module counts, e2e file count, lane-06 file arithmetic). No nonexistent
  paths in any sampled claim; overall claim quality is high.

## Aggregate summary

| Lane | Rounds | Coverage character |
|---|---|---|
| 01 harness-core | 1 | Deep on gates/manifest/adapters; gap: scripts/data (F2); count claims imprecise |
| 02 analyzers | 1 | Deep on all four trees; gap: 3 flat CLI entries (F1) |
| 03 server | 1 | Deep; seed data sampled by stated rule |
| 04 shared | 1 | Deep — full 72-file partition closure, verified |
| 05 client | 2 | Deep; r2 re-scanned all 389 production files |
| 06 tests | 3 | Deep on e2e/shared-rules/eslint tests; giant suites sampled by design |
| 07 docs-dx | 3 | Deep — full reads of guide/MODULE/config surfaces |
| 08 cross-cutting | 2 | Sampled-by-design across all 8 partitions; deep on routed pointers |
| 09 lint-machinery | 2 | Deep — near-complete readFully with counted line totals |

## Orchestrator disposition (2026-08-02)

- **F1 + F2: the one additional top-up round permitted on critic failure is
  AUTHORIZED, scoped as micro-reads of exactly the failure scope** — a
  lane-02 micro top-up over the three flat CLI entries and a lane-01 micro
  top-up over the two `scripts/data/` allowlists. No other scope may ride
  along. Banked as runs r32–r33; barrier closes when both bank.
- `.github/hooks/` residue: dispositioned as covered (lane 01 adapter-tree
  claim + lane 08 `.github/**` sample); recorded here, no dispatch.
- `scripts/fixtures/`, `scripts/test-support/`, harness-audit fixtures:
  dispositioned as covered-by-inventory (lane 06 wave-2 inventory claim +
  demonstrated engagement via findings in lanes 06/08/09); recorded here,
  no dispatch.
- Lane-01 count imprecision and lane-02's false skip justification are
  flagged to Phase-4 triage as calibration context, not re-dispatched.
