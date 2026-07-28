# drift:ai Swarm Triage — 2026-07-13

**Status:** triage + review complete 2026-07-13; all ten FIX items landed 2026-07-13 (`ae1720d6`, see FIX-PLAN.md).
**Run:** triage-2026-07-13 · 306 review items across 24 deterministic packets · swarm: 9 confirmed, 256 accepted-drift, 38 false-positive, 3 duplicate-of, zero medium/high · review pass: 4 swarm confirmations demoted, 4 swarm non-findings promoted, 1 meta-finding added.

> **Provenance (2026-07-13).** Inputs: `drift-all.json` (scope current, all
> checks), `semgrep-candidates.json`, `dolos-candidates.json`, post-processed
> by this branch's `bun run drift:triage --packet-dir` at commit `ec2a7a22` on
> `feat/drift-report-triage` (packets + manifest under the gitignored
> `reports/drift-ai/triage-2026-07-13/swarm-final/`). 1910 input rows were
> deferred by triage policy and are NOT reviewed here; the 306 review items
> are the census of what the policy surfaced. Triage: 9 parallel
> `gpt-5.6-luna` codex consults (medium effort), one detached worktree per
> lane at `ec2a7a22`, 2–6 packets per lane; all 24 packets returned complete
> contract-compliant verdicts (two lanes omitted the `canonicalItemId: null`
> key on non-duplicate verdicts; normalized mechanically before collection).
> Collection: `bun run drift:triage collect` — full machine-readable output in
> `verdict-collection.json` beside this file (306/306, `stale: false`).
> Review: three `gpt-5.6-sol` codex consults (high effort) — one on the pack
> draft + fix bar (verdict COMMIT-WITH-EDITS, folded in), two auditing
> disjoint halves of the non-confirmed verdicts for under-triage (product
> lanes; tooling/security lanes). Every confirmed finding and every
> escalation was re-verified against source at the cited lines by the
> orchestrator.

## Executive summary

1. **No high- or medium-severity drift surfaced, and independent review
   upheld the swarm's broad calibration** (14 of 15 weighted accepted-drift
   samples held; 17 of 26 semgrep false-positives re-checked and upheld).
   The review population is dominated by clone pairs that are
   parallel-by-design and semgrep pattern noise (fixed regexes flagged as
   regex-DoS, non-secret comparisons flagged as timing-sensitive).
2. **The highest-value fix is in the triage harness itself: `drift:triage`
   accepts stale advisory inputs silently.** `semgrep-candidates.json` cites
   `scripts/drift-triage.ts:234`, but the file is 174 lines at `ec2a7a22` —
   the flagged expression exists at ancestor `8e82f209`, before the monolith
   was split into `drift-triage-options.ts` et al. The scan ran against an
   older tree; the packet generator merged it without any provenance check,
   and the swarm lane then dismissed the item as false-positive *because the
   line was beyond EOF* — the worst failure mode: stale evidence should
   degrade to needs-human/regenerate, not to a confident dismissal.
3. **Review promoted two correctness-sensitive server/shared findings the
   swarm had accepted:** `applyAttackDamage` and `applySpellDamage` duplicate
   the entire locked character-vs-participant HP-routing body (guards already
   drifted: `!== null` vs. truthy), and `spellAttackResultSchema` is a
   documented field-for-field mirror of `attackRollResultSchema` kept in sync
   only by a hand-written projection (`mapToSpellAttackResult`) — the same
   silent-desync class as the 2026-07-06 pack's `ParsedSpell`/`SpellJson`
   finding. Also promoted: the byte-identical 12-entry `CLASSES` table in
   both SRD generators, and `AdjustHpInput` re-declaring `AdjustHpPayload`
   next to a module that documents itself as the single source of truth.
4. **Review demoted four swarm confirmations as churn:** the three
   domain-named service-context types (intentional ownership boundaries), the
   `PAIRED_GUIDE` literal (tests already enforce guide existence and pointer
   equality), the `PORTABLE_MANIFEST_PATH` literal (fails loudly on both
   sides), and the map-toolbar props twin (structural typing already
   protects the call site).

## Backlog findings (all low severity; every location re-verified)

### Tooling

- **`drift:triage` stale-advisory acceptance (meta, orchestrator-verified).**
  Advisory prototypes carry no scan provenance and the packet generator does
  no resolvability check, so swarm lanes inherit unverifiable items and
  mis-verdict them (evidence above; also flagged independently by the
  tooling-lane reviewer as its only P1).
- **`scripts/lint-ratchet/baseline-merge-cli.ts:1-59`,
  `scripts/max-lines-exceptions-merge-cli.ts:1-65`,
  `scripts/sensor-knip-unused-exports-merge-cli.ts`** — three merge-driver
  CLIs duplicate the argv validation, three-file read, merge-result error
  handling, truth-up marker write, atomic write, and `import.main` bootstrap;
  only the merge callback, strategy, and labels differ.
- **`scripts/drift-ai/triage-report-drift-input.ts:140`,
  `scripts/drift-ai/triage-report-input.ts:273`,
  `scripts/drift-ai/triage-verdict-input.ts:122`** — three identical generic
  `parseArray` parser primitives inside drift-ai.
- **`eslint-rules/trpc-shared-schema-import-collector.js:14` ⇔
  `scripts/codemods/lib/trpc-shared-schema-types.ts:7`** — two copies of
  `SHARED_SCHEMA_PREFIX = "@musi/shared/schemas/"`; the lint rule and the
  codemod that repairs its findings can silently disagree on the contract.
- **`packages/server/src/seed/generate-class-features.ts:27-40` ⇔
  `packages/server/src/seed/generate-subclasses.ts:27-40`** — byte-identical
  12-entry `CLASSES` config table (plus the `ClassCfg` shape) in the two SRD
  generators; a class-list change must be made twice or the generated seed
  shards silently diverge.

### Product

- **`packages/server/src/services/combat-actions/apply-damage.ts:19` ⇔
  `packages/server/src/services/spell-casting/apply-damage.ts:22`** — after
  their domain-specific hit/save guards, both duplicate the complete
  race-sensitive locked HP-routing body (`updateCharacterStatsLocked` /
  `updateParticipantStatsLocked` + `applyHpAdjustment`); the character-branch
  guards have already drifted (`targetCharacterId !== null` vs. truthy). A
  temp-HP or damage-side-effect fix would silently reach only attacks or only
  spells. (docs/CONCURRENCY.md Pattern A territory.)
- **`packages/shared/src/schemas/attack-roll-inputs.ts:117` ⇔
  `packages/shared/src/schemas/spell-action-inputs.ts:133`** —
  `spellAttackResultSchema` self-describes as "mirrors AttackRollResult with
  spell naming" and is kept aligned only by the hand-written
  `mapToSpellAttackResult` projection
  (`packages/server/src/services/spell-casting/resolve-spell.ts:109`); a new
  attack field never reaches the spell contract and no compiler error fires.
- **`packages/client/src/components/sheet/inventory-panel.tsx:33,43` ⇔
  `packages/client/src/components/vtt/drawer/tabs/inventory-tab.tsx:18,95`** —
  identical `groupByType` algorithm AND the seven-entry `TYPE_ORDER` table;
  both files already import `inventory-constants.ts`, the natural home.
- **`packages/client/src/components/vtt/drawer/monster-stat-block-header.tsx:105`
  ⇔ `packages/client/src/components/vtt/drawer/tabs/stats-tab-summary.tsx:53`**
  — identical `formatSpeed` (walk/hover/zero-fallback/join) plus
  `NON_WALK_MODES`, in the same drawer feature; `MonsterSpeed` is already an
  alias of the shared `Speed` schema shape.
- **`packages/client/src/components/sheet/hp-adjuster.tsx:6-10` ⇔
  `packages/client/src/components/sheet/sheet-props.ts:10-14`** —
  `AdjustHpInput` re-declares `AdjustHpPayload` field-for-field while
  `sheet-props.ts` documents itself as the sheet's single source of truth.

## Demoted and notable non-findings

- **Demoted swarm confirmations** (churn under the meaningfulness bar):
  service-context types ×3 (`character-live-state/types.ts:4`,
  `encounter-combat/types.ts:4`, `inventory-service.ts:57` — intentional
  per-service ownership); `PAIRED_GUIDE` ×3 (protected by
  `eslint-rules/message-guidance.test.js:196` existence + pointer-equality
  assertions); `PORTABLE_MANIFEST_PATH` ×2 (loud failure on both consumers);
  `ViewControlSectionProps`/`MapToolbarViewControls` (structural props
  checking already catches divergence at the call site).
- **Semgrep lane (34 items): 0 confirmed.** Every regex-DoS hit is a fixed
  pattern or an escaped glob translation; every timing-attack hit compares
  non-secret tokens. If these rules stay in the advisory set, expect the same
  noise every run — a candidate for advisory-source pruning rather than
  repeated re-triage.
- **Borderline, recorded not filed:** `import-cycles-check.ts` ⇔
  `layer-direction-check.ts` duplicate graph execution + failure/skip/trust
  policy (two consumers — revisit if a third checker appears);
  `DEFAULT_BACKLOG_DIR` duplicated across `backlog-lint-core.ts:29` /
  `backlog-lint.ts:46` (default divergence would be loud in practice).
- **Clone lanes:** seed data files, homebrew form fields, CRUD panels, delete
  dialogs, guard components, and codemod twins were consistently judged
  parallel-by-design, and the review pass upheld the weighted sample.
  `verdict-collection.json` records each with rationale, so a future run can
  diff against these instead of re-reviewing.

## Caveats

- Severity calibration was intentionally strict: lanes were instructed to
  reserve medium+ for fixes that meaningfully improve the codebase. Zero
  mediums across nine independent lanes is consistent with that bar, and the
  review pass validated the calibration — but note it also surfaced four
  promotions the swarm had waved through, all in contract- or
  concurrency-sensitive code. Future packet lanes for `packages/shared` and
  race-sensitive server services deserve a stricter prompt.
- The 1910 deferred rows (mostly duplicate-literals and below-threshold
  clones) were never seen by any lane. This pack is a census of the review
  tier only.
