# drift-triage-2026-07-13 — Fix/No-Fix Plan (workflow-ready)

**Status:** all ten FIX items implemented and cross-model reviewed on 2026-07-13.
Post-merge review findings (two P1 provenance-contract gaps + polish) are parked
in `REVIEW-FOLLOWUPS.md`.
**Inputs:** `AUDIT.md` + `verdict-collection.json` (306 swarm verdicts) + three `gpt-5.6-sol`
review consults (pack review: COMMIT-WITH-EDITS, disposition below reflects its demotions,
expansions, and promotions; two under-triage audits, all escalations orchestrator-verified).
**Bar applied:** an item ships only if the fix meaningfully improves the codebase. Each FIX is
its own conventional commit (batching was reviewed and rejected — per-logical-unit wins).

## Verdict summary

| # | Item | Verdict |
|---|---|---|
| 1 | `drift:triage` stale-advisory detection (scan provenance + resolvability fallback) | **FIX FIRST** (protects every future triage run) |
| 2 | Shared merge-CLI runner across all THREE baseline merge drivers | **FIX** |
| 3 | Shared locked HP-routing helper for `applyAttackDamage`/`applySpellDamage` | **FIX** (review promotion) |
| 4 | Shared attack-resolution schema core for `attackRollResultSchema`/`spellAttackResultSchema` | **FIX** (review promotion) |
| 5 | Shared `groupByType` + `TYPE_ORDER` in `inventory-constants.ts` | **FIX** |
| 6 | Shared `formatSpeed` + `NON_WALK_MODES` (VTT drawer ×2) | **FIX** |
| 7 | Centralize `SHARED_SCHEMA_PREFIX` (ESLint rule + codemod lib) | **FIX** |
| 8 | Dedup `parseArray` ×3 inside drift-ai report/verdict parsers | **FIX** |
| 9 | Shared `CLASSES`/`ClassCfg` config for the two SRD generators | **FIX** (review promotion) |
| 10 | Reuse `AdjustHpPayload` for `hp-adjuster.tsx`'s `AdjustHpInput` | **FIX** (review promotion, trivial) |
| — | Service-context types ×3 (`character-live-state`, `encounter-combat`, `inventory`) | **NO-FIX** (intentional per-service ownership; shared type adds coupling, not correctness) |
| — | `PAIRED_GUIDE` ×3 in tRPC ESLint rules | **NO-FIX** (`message-guidance.test.js` already enforces guide existence + pointer equality) |
| — | `PORTABLE_MANIFEST_PATH` ×2 | **NO-FIX** (both consumers fail loudly; a move already touches tests/smoke/path-policy) |
| — | `ViewControlSectionProps`/`MapToolbarViewControls` twin | **NO-FIX** (structural props checking already protects the call site) |
| — | `import-cycles-check.ts` ⇔ `layer-direction-check.ts` orchestration dup | **NO-FIX, revisit at a third consumer** |
| — | `DEFAULT_BACKLOG_DIR` ×2 | **NO-FIX** (divergence loud in practice) |
| — | Semgrep regex-DoS / timing-attack advisory noise (26 FP verdicts) | **NO-FIX as code; consider advisory-source pruning** when touching the semgrep candidate pipeline |
| — | All remaining accepted-drift clone/structure items | **NO-FIX** (parallel-by-design; recorded in `verdict-collection.json` to spare future runs) |

## Sequencing and item notes

1. **Item 1 (tooling integrity, do first).** Advisory prototypes
   (`semgrep-candidates.json`, `dolos-candidates.json`) should carry scan
   provenance (`gitHead`, dirty flag) and `drift:triage` should compare it
   against its own provenance as the PRIMARY check; range-resolvability
   against the tree at packet-generation time stays as a warning/disclosure
   fallback (it catches dirty-tree scans that provenance alone cannot).
   Evidence: `semgrep-candidates.json` cites `scripts/drift-triage.ts:234`;
   the expression exists at ancestor `8e82f209` (pre-split monolith) and the
   file is 174 lines at `ec2a7a22`; the code now lives in
   `drift-triage-options.ts`. Stale items must surface in packet
   `disclosures` and be routed to needs-human/regenerate — the observed
   failure mode was a lane confidently declaring false-positive because the
   cited line was beyond EOF. TDD; the triage-packet test files are the home.
2. **Item 2.** Parameterize one merge-CLI runner over the three existing
   merge callbacks. Preserve per-driver strategy (`max-lines` alone requests
   `"base-aware"`), the marker-before-baseline write order, per-driver usage
   text and failure labels, and atomic-write semantics
   (`scripts/lib/baseline/atomic-write.ts`). These are git merge-driver
   plumbing — read `docs/guides/lint-ratchet.md` first.
3. **Item 3.** Extract a shared locked damage-application helper taking the
   transaction, target identity (character vs. participant), and the
   already-computed damage; each caller keeps its attack/spell eligibility
   guard. Read `docs/CONCURRENCY.md` before touching — this expands a
   race-sensitive mutation helper surface deliberately. Reconcile the drifted
   guards (`targetCharacterId !== null` vs. truthy) while extracting.
4. **Item 4.** Introduce a shared attack-resolution core schema in
   `packages/shared` (e.g. base object `extend`ed by both
   `attackRollResultSchema` and `spellAttackResultSchema`) so the documented
   mirror becomes structural; `mapToSpellAttackResult` shrinks to the
   spell-specific fields. Wire-contract change in shape only — assert no
   runtime schema behavior change with existing schema tests.
5. **Items 5, 6, 9, 10 (each its own small commit).** Behavior-preserving
   extractions with obvious homes: `inventory-constants.ts` for 5; a VTT
   drawer shared util for 6 (input type: the common `Speed` shape); a shared
   generator config module under `packages/server/src/seed/` for 9; for 10,
   delete `AdjustHpInput` and import `AdjustHpPayload`.
6. **Items 7, 8.** For 7: the shared constant must be a plain-`.js`-importable
   module (ESLint rules load before any build step); a non-rule helper under
   `eslint-rules/` needs no `config-surface-manifest.json` registration — the
   registry test distinguishes helpers by export shape
   (`eslint-rules/local-plugin-registry.test.js`). For 8: one `parseArray` in
   a shared drift-ai parsing util, imported by all three input modules.

## Non-goals

- No abstraction of the accepted-drift clone families (form fields, panels,
  seed data shards, codemod twins) — reviewed and deliberately left parallel.
- No semgrep rule suppression inline in code; noise is a pipeline-selection
  concern, not a source annotation concern.
