# drift-triage-2026-07-13 — Post-merge review follow-ups

**Status:** P1 provenance contract v2 complete — items 1/3/4 landed
(`e2750f17`/`e9d00a48`/`a5f2dda5`, drain leaf 4.6); item 2 landed earlier
(`31ce6e49`). P2 items 5–8 landed 2026-07-19 (wave-1 ready-2026-07 drain);
evaluate-before-fixing items 9–10 remain.
**Source:** cross-model review of merge `ae1720d6` (the ten-item FIX batch from
`FIX-PLAN.md`) on 2026-07-13 — one Claude (Fable) inline review, one codex
(GPT) consult, one cursor (Grok) consult, all three verdicts "meaningful
improvement, not churn". These items are the surviving criticisms. The two P1s
are complementary halves of the same gap: the serialized scan-provenance
contract is weaker than the in-memory one, so staleness detection has both
false negatives (item 1) and false positives (item 2).

## P1 — provenance contract v2 (do as one unit)

1. **Serialize the repository-state fingerprint into `scanProvenance`.** _(DONE —
   `e2750f17`/`e9d00a48`/`a5f2dda5`, drain leaf 4.6.)_
   `capturePrototypeScanSnapshot` builds a `stateToken` (HEAD + porcelain
   status + sha256 of every dirty file) but uses it only to compare the
   before/after snapshots of a single scan; the serialized provenance keeps
   just `gitHead`/`gitDirty`/`changedDuringScan`
   (`scripts/drift-ai/prototype-command.ts`). Packet staleness
   (`scripts/drift-ai/triage-packet-staleness.ts`) therefore cannot detect a
   dirty→different-dirty transition at unchanged HEAD: both sides say
   `gitDirty: true` and, if the cited line ranges still resolve, no stale
   reason fires. Persist the content fingerprint (or a digest of it) in
   `PrototypeScanProvenance`, recompute it at packet-generation time, and add
   a `state-fingerprint-mismatch` reason. No current test covers
   dirty→different-dirty between scan and packet creation.
2. **Unify scan-side and packet-side dirty-probe exclusion sets.** _(DONE — `31ce6e49`: both sides now derive from the shared `triageGeneratedArtifactExclusions` helper.)_ The
   scanners exclude only the standard report trio plus their own `--output`
   (`dolos-candidates-command.ts`, `semgrep-candidates-command.ts`);
   `drift-triage.ts` additionally excludes every advisory input path and
   `--packet-dir`. A pre-existing `packets/` dir (or non-standard advisory
   filename) as the only dirt yields scan `gitDirty: true` vs. packet
   `gitDirty: false` → every advisory item is falsely routed
   `needs-human-regenerate`. Derive both sides from one shared
   exclusion-computation helper and add a test asserting the sets are
   identical for the same inputs.
3. **Run git probes from `repoRoot`, not process cwd.** _(DONE —
   `e2750f17`/`e9d00a48`/`a5f2dda5`, drain leaf 4.6.)_ The new pathspec
   helpers in `scripts/lib/git.ts` insert `"."`, but the runners execute in
   the invocation cwd (`prototype-command.ts`, `drift-triage-packet-io.ts`).
   Invoked from e.g. `packages/server`, the probes ignore dirt elsewhere in
   the repo and can stamp a false clean/fresh state. The `git.test.ts`
   coverage asserts only generated argv, never a subdirectory cwd.
4. **Degrade content-probe failure to unknown, not unchanged.** _(DONE —
   `e2750f17`/`e9d00a48`/`a5f2dda5`, drain leaf 4.6.)_ When
   `git diff`/`ls-files` fail, `dirtyContentToken` is `null` and
   `capturePrototypeScanSnapshot` falls back to the HEAD/status-only token,
   so equal status strings produce `changedDuringScan: false` — false
   assurance in exactly the same-status-edit case the hash exists to catch.
   The token should become `null` → `changedDuringScan: null`
   (`provenance-unavailable` downstream). One Dolos test whose git stub
   rejects both content probes explicitly expects `false` and pins the
   degradation (`prototype-subcommands.test.ts`).

## P2 — staleness/observability polish

5. **Surface `changedDuringScan` in the text advisory header.** _(DONE —
   landed 2026-07-19, wave-1 ready-2026-07 drain.)_
   `formatPrototypeHeader` prints HEAD and dirty state only; the strongest
   freshness signal is JSON-only today (`prototype-advisory.ts`). Tests for
   the feature inspect JSON exclusively.
6. **Column-aware range resolvability.** _(DONE — landed 2026-07-19, wave-1
   ready-2026-07 drain.)_ `rangeResolves` validates lines
   only; a Semgrep citation like `src/a.ts:1:500-1:700` passes on a
   ten-character line, letting stale evidence dodge regeneration
   (`triage-packet-staleness.ts`).

## P2 — product-code boundaries

7. **Restore the projection boundary in `mapToSpellAttackResult`.** _(DONE —
   landed 2026-07-19, wave-1 ready-2026-07 drain.)_ The rest
   spread forwards every runtime property except `attackName`/`attackerName`
   (`packages/server/src/services/spell-casting/resolve-spell.ts`). TS
   excess-property checks do not apply to spreads, so a structurally richer
   object (or a future attack-only base field) leaks into spell results and
   is persisted in combat-log JSON. Destructure/pick the shared resolution
   fields explicitly; the exact-value test uses no extra property, so it
   does not pin the boundary.
8. **Pin the damage-routing loader invariant.** _(DONE — landed 2026-07-19,
   wave-1 ready-2026-07 drain.)_ `applyDamageLocked` routes on
   `characterId !== null` alone, dropping the old `target.type` agreement
   check and the spell path's truthiness guard (empty-string → character path
   is now test-pinned). Fine while loaders only set `targetCharacterId` for
   character participants, but nothing asserts or documents that invariant.
   Add a loader-level test (or type-level encoding) that a non-character
   participant never carries a non-null `targetCharacterId`.

## Evaluate before fixing (may be NO-FIX)

9. **Remaining `formatSpeed` near-twins.** The shared drawer helper renders
   `30'`; `campaign/npcs/monster-detail-dialog.tsx`, `sheet/combat-stats.tsx`,
   and `character-create/steps/species-step.tsx` each reimplement speed
   formatting with different units/labels (`ft.` vs `'`, walk labeling,
   truthy vs `> 0`). Decide: parameterize one helper over display style, or
   record accepted drift in `verdict-collection.json` so future triage runs
   skip them.
10. **Second-order constant duplication.** `TYPE_ORDER` repeats the value
    ordering already in `ITEM_TYPES`
    (`packages/client/src/components/sheet/inventory-constants.ts` — derive
    one from the other); the new SRD generator config repeats class IDs/names
    held in `SRD_CLASSES` (`packages/server/src/seed/`). Both are
    single-file-adjacent now, so divergence is at least loud; fix
    opportunistically.

Full review texts were session-local consult outputs; the substance is
captured above. Items 1–4 protect every future triage run and should be one
TDD unit in the triage-packet/prototype-command test homes; read
`docs/guides/lint-ratchet.md` is not needed here, but re-read the staleness
tests in `scripts/drift-ai/triage-packets.test.ts` before starting.
