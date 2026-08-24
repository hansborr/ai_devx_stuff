# Hotspot map — lane 00 output (Phase 1)

Status: Working state — not a schedulable note

Produced 2026-08-01 by the lane-00 codex consult (session
`019fc0f9-815e-7a93-b64a-237666045829`, worktree best-effort-clean) at pin
`ebf096580b31f604861fadb3d4cbd4079da4f017`. The `/tmp/tmp.X3FfTqKPzV` scratch
paths cited below were session-ephemeral raw evidence; the ranked synthesis
here is the durable record. Lane-00 report verbatim below.

**Those paths are session-local and untracked.** The scratch root was never
committed and is outside the durable pack, so all fourteen links below — to
eleven unique files — and the report's own closing statement that the raw
whole-tree Dolos output "remains available" hold only inside the originating
audit environment. They may still exist there; no future reader can rely on
them, and they cannot be recovered from Git. The report is left exactly as
written rather than corrected in place, because it is a contemporaneous record;
this note is the correction layer. Nothing in the audit's conclusions depends on
re-reading those files: the numbers the lane drew from them are stated inline
below.

---

# Lane 00 hotspot map

Scratch root: `/tmp/tmp.X3FfTqKPzV`

Primary evidence: [ranked triage](/tmp/tmp.X3FfTqKPzV/triage.txt), [literal-density rerun](/tmp/tmp.X3FfTqKPzV/triage-with-literals.txt), [history hotspots](/tmp/tmp.X3FfTqKPzV/hotspots.json), and [coldspots](/tmp/tmp.X3FfTqKPzV/coldspots.json).

The reducer produced 385 review items from 2,314 displayed rows. It deferred 1,862 rows, including 1,242 unranked repeated literals, 460 test-only literals, 48 test-only clones, and all 16 type-only cycles. These are ranking signals only, not defects.

## Ranked hotspots

1. **Wave 1 — `scripts/drift-ai/` and `scripts/drift-triage/`**

   This is the clearest multi-signal hotspot. `scripts/drift-ai` accounts for 334 location appearances in the default queue and is touched by 293 repeated-literal groups. Of the top 40 displayed script-root Dolos pairs, 64 of 80 endpoints are in `scripts/drift-ai`; all 40 pairs are non-test and 12 have fragments of at least 20 lines. Repeated families include argument parsers, check configurations, advisory runners, Knip adapters, and hotspot/coldspot formatters.

   Test size reinforces the maintenance surface: `scripts/drift-ai.test.ts` is 2,765 lines, triage tests are 1,144 lines, and several drift-ai suites exceed 800 lines. Git churn is less exceptional—37 file touches in the audit range—so history understates the structural concentration. Re-read [script Dolos candidates](/tmp/tmp.X3FfTqKPzV/dolos-scripts.json) and the top of [triage](/tmp/tmp.X3FfTqKPzV/triage.txt).

2. **Wave 1 — harness, lint, path-policy, and concurrency guardrails**

   Scope: `harness.controls.json`, `scripts/{harness,path-policy,tests,lint-ratchet}`, `eslint-rules/concurrency-guard*`, and `scripts/codemods/concurrency-guard/`.

   This is the strongest history-defined hotspot. `harness.controls.json` has 49 revisions; `lint-ratchet.baseline.json` has 34; major verification shell files have 26–30. The history lens reports 23 co-changes between the harness manifest and generated freshness surface, plus repeated coupling between the concurrency rule, corpus, and codemod. Thrash is also concentrated here: the lint baseline has 8 fix/revert commits and the generated harness surface has 6.

   The pinned-range metric agrees: `scripts/tests` had 134 file touches, `eslint-rules` 99, the concurrency codemod 60, path-policy 35, harness 28, and lint-ratchet 25. Literal density is also elevated in harness, path-policy, and lint-ratchet. Dolos disagrees: its eslint-rule top 40 are entirely test-only clone pairs, so clone evidence adds little beyond the history/coupling signal. See [history hotspots](/tmp/tmp.X3FfTqKPzV/hotspots.json) and [eslint-rule Dolos output](/tmp/tmp.X3FfTqKPzV/dolos-eslint-rules.json).

3. **Wave 1 — server router/service/utility/socket boundaries**

   Scope: `packages/server/src/{routers,services,utils,socket}`.

   These are the busiest application directories in the pinned range: routers 136 touches, utilities 109, services 66, and socket code 33. The reducer’s three review-first layer-direction rows all involve a utility test importing service-layer files. Clone evidence also lands in `map-layer.ts`, `npc.ts`, spell-casting, the campaign-room handler, and character/participant/spell-slot mutation helpers.

   The area contains several of the server’s longest hand-authored files: `routers/srd.ts` at 561 lines, `rest-service.ts` at 458, `routers/homebrew.ts` at 410, `participant-action.ts` at 346, and `broadcast-registry.ts` at 341. History additionally flags `utils/prisma-types.ts` and `routers/character-spell.ts` for fix/revert activity. Suppression-marker density is localized rather than pervasive, chiefly in intentional type tests, `trpc.ts`, and SRD narrowing helpers.

4. **Wave 1 — character sheet, VTT drawer, and map-canvas state**

   Scope: `packages/client/src/{components/sheet,pages/character-sheet,components/vtt/drawer,stores/map-canvas-store.ts}`.

   This cluster combines history, size, and clone signals. Sheet components had 79 pinned-range touches and character-sheet pages 64. `sheet-layout.tsx` has 18 revisions and 8 fix/revert commits; its test has 19 revisions. Drift evidence includes desktop/mobile layout duplication, sheet/VTT weapon and saving-throw parallels, and duplicated spell-tab behavior.

   The literal rerun found 161 literal groups touching sheet components, 73 touching the VTT drawer, and 64 touching its tabs. `map-canvas-store.ts` is the client’s longest hand-authored source at 626 lines, with an 808-line test; `rest-dialog.tsx` and `level-up-helpers.tsx` both exceed 330 lines.

5. **Wave 1 — campaign maps, combat, and encounters**

   Scope: `packages/client/src/components/campaign/{maps,combat,encounters}`.

   Several of the reducer’s first items are paired map/combat implementations: detail content, headers, editor dialogs, and map overlays. The pinned range records 24 touches each for maps and combat and 14 for encounters. Literal groups touch maps 65 times, combat 53, and encounters 49.

   Size adds pressure: `encounter-detail-view.tsx` is 384 lines and `add-participant-dialog.tsx` 348. Unlike the formulaic route clones below, these pairs sit on interaction-heavy map/combat behavior, so they deserve closer wave-1 comparison.

6. **Wave 2 — shared rules**

   Scope: `packages/shared/src/rules/`, especially spellcasting, weapons, and character rules.

   Shared rules had 55 pinned-range touches. `spellcasting.ts` is 380 lines and contains a surfaced 22-line same-file clone; `srd-weapons.ts` is 327 and `character-rules.ts` 260. Seventy literal groups touch this directory, and the spellcasting test is 676 lines.

   Dolos does not reinforce this hotspot because its shared-root top pairs are entirely concentrated in schemas. This ranking comes from code size, rule criticality, churn, and the focused drift rows rather than clone volume.

7. **Wave 2 — shared schemas and schema tests**

   Scope: `packages/shared/src/schemas/`.

   This area had 57 pinned-range touches, 65 default-queue location appearances, and 133 literal groups. It contains many of the shared package’s longest files: `srd.ts` 411 lines, `homebrew.ts` 363, `spell.ts` 347, and `encounter-inputs.ts` 329. Its largest tests include `homebrew.test.ts` at 1,228 lines and `encounter-inputs.test.ts` at 1,030.

   All 80 endpoints in the shared Dolos top 40 are schema files, but much of that is expected Zod/schema-shape boilerplate. The actionable sweep signal is therefore size and change density; Dolos should be used only to distinguish unexplained behavioral helpers from declarative schema repetition. See [shared Dolos output](/tmp/tmp.X3FfTqKPzV/dolos-packages_shared_src.json).

8. **Wave 2 — server seed generators, class-feature data, and cold SRD assets**

   Scope: `packages/server/src/seed/`, particularly `class-features`, `subclass-features`, parsers, and `seed/data`.

   Dolos is dominated by this cluster: 68 of 80 server-root endpoints are in `seed/class-features`, and 38 of the 40 displayed pairs have fragments of at least 20 lines. That is mostly structured feature-data repetition, so pair density matters more than individual pairs.

   The coldspot lens independently flags the 3,636-line magic-item JSON, the 932-line rules glossary, and `class-features-b.ts` as large files that are stale inside active neighborhoods. Conversely, pinned-range churn is moderate—30 seed touches and 12 class-feature touches. This disagreement makes the area a wave-2 consistency sweep rather than a refactoring priority. See [server Dolos output](/tmp/tmp.X3FfTqKPzV/dolos-packages_server_src.json) and [coldspots](/tmp/tmp.X3FfTqKPzV/coldspots.json).

9. **Wave 2 — homebrew forms and character creation**

   Scope: `packages/client/src/components/{homebrew,character-create}`.

   Drift finds parallel class/subclass form data and fields, repeated collection/entry dialogs, and overlaps with campaign settings. Character-create steps are touched by 77 literal groups. The monster form fields and data files are 478 and 441 lines, while magic-item fields are 336.

   History is less concentrated here than in sheet or campaign-map code, apart from 15 touches in homebrew shared components. Structural and size evidence therefore place it in wave 2.

10. **Lower-priority Dolos hotspot — client route shells**

    `packages/client/src/routes` occupies 62 of 80 endpoints in the client Dolos top 40, with 31 top pairs having fragments of at least 20 lines. These are mostly small, formulaic route declarations, and the area does not appear in the leading churn or large-file metrics. Treat it as a consistency/API-shape sweep, not as evidence of a design defect. See [client Dolos output](/tmp/tmp.X3FfTqKPzV/dolos-packages_client_src.json).

## Cross-signal disagreements

- Git history strongly prioritizes harness/lint/concurrency machinery, while structural clone evidence prioritizes drift-ai tooling and client route shells.
- Dolos strongly prioritizes server class-feature data and shared Zod schemas; cheap metrics show these are either cold/generated-like data or declarative boilerplate, reducing their urgency.
- Application churn points to server routers/utilities and client sheet code even though neither dominates Dolos.
- Semgrep density lands mostly in scripts that build regular expressions and in seed parsers. Inspection found controlled inputs or explicit escaping, so it did not raise any suspected bug.
- Suppression churn is concentrated in the ledger and intentional type-test machinery; production application files do not show a broad suppression hotspot.

## Signals tried that produced nothing

- `ghost-files`: 0 rows.
- `unused-exports`: 0 rows.
- Import cycles: all 16 were type-only and policy-deferred.
- Stale TODO/FIXME markers: none. Cheap searches found only detector fixtures/rule implementations, not real backlog markers.
- Coldspot stale-marker lens: no qualifying stale markers.
- Semgrep: no suspected bugs among the surfaced non-test candidates. The scan had six degradation records, including timeouts, so it is a density signal rather than complete coverage. Raw output: [semgrep.json](/tmp/tmp.X3FfTqKPzV/semgrep.json).
- The `suppressions` drift check was correctly skipped because `current` scope does not support it.

All five Dolos runs hit the 200-pair reporting cap; the cited top-40 outputs are partial density samples, not censuses. The raw whole-tree report remains available for row-specific follow-up at [drift-report.json](/tmp/tmp.X3FfTqKPzV/drift-report.json). The repository remained unchanged, and no tests or builds were run.