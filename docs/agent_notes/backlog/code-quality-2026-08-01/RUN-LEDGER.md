# Run Ledger — Code Quality Audit 2026-08-01

Status: provenance record; append-only.

This is the audit provenance archive extracted from `ORCHESTRATION.md`. Rows are append-only: never edit, reorder, or remove an existing row.

Audit evidence pin: `AUDIT_TARGET_SHA = ebf096580b31f604861fadb3d4cbd4079da4f017`.

To append a run, add one row at the end of the **Runs** table with columns in this exact order: `run | lane | status | dispatched at | answer path | session id | retry-of | notes`. Preserve failed attempts and give every retry a fresh row whose `retry-of` names the failed run.

### Runs

One row per dispatch **and per retry** (append, never overwrite). Status
flows `dispatched → answered → validated → banked`; a failed run keeps its
row with a note and gets a fresh row for the retry, with `retry-of` naming
the failed run. Prompt identity needs no hash — prompts and addenda are
committed, so a run row's notes record the pack commit current at dispatch.

| run | lane | status | dispatched at | answer path | session id | retry-of | notes |
|---|---|---|---|---|---|---|---|
| r01 | 00 | banked | 2026-08-01 | `<scratch>/cq-2026-08/lane-00.msg` | `019fc0f9-815e-7a93-b64a-237666045829` | — | consult codex, standalone prompt, worktree best-effort-clean; banked as `working/hotspots.md`; pack commit at dispatch `ebf096580` |
| r02 | 01 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-01.msg` | `019fc10b-10b7-7632-afdc-caa578aea5a7` | — | all nine wave-1 lanes dispatched in parallel; the container OOM'd and crashed before any produced an answer (r02–r10). Owner directive after the crash: max two concurrent lanes |
| r03 | 02 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-02.msg` | `019fc10b-1833-71f1-9191-e98d53ec3805` | — | lost in the parallel-dispatch OOM (see r02) |
| r04 | 03 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-03.msg` | `019fc10b-23c7-7ef1-9bb6-e23e6595f0e9` | — | lost in the parallel-dispatch OOM (see r02) |
| r05 | 04 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-04.msg` | `019fc10b-2c80-7292-8d9b-b9cc228135f1` | — | lost in the parallel-dispatch OOM (see r02) |
| r06 | 05 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-05.msg` | `019fc10b-37a3-7432-a298-bda2c3ff05d6` | — | lost in the parallel-dispatch OOM (see r02) |
| r07 | 06 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-06.msg` | `019fc10b-42e4-71a2-8cb3-2b169e4edbe8` | — | lost in the parallel-dispatch OOM (see r02) |
| r08 | 07 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-07.msg` | `019fc10b-4bdf-75d3-9c39-2832d4c945c8` | — | lost in the parallel-dispatch OOM (see r02) |
| r09 | 08 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-08.msg` | `019fc10b-56ba-7b11-ac31-e19e2bb84d3f` | — | lost in the parallel-dispatch OOM (see r02) |
| r10 | 09 | failed | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-09.msg` | `019fc10b-60ed-70b2-a4e5-8ef73ada43e6` | — | lost in the parallel-dispatch OOM (see r02) |
| r11 | 01 | banked | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-01-r2.msg` | `019fc12f-5b41-7a53-98f0-be0d24ceac41` | r02 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 29 dropped, 4 bugs, 4 pointers); banked as `working/wave-1/lane-01.json`; pack commit at dispatch `f3b53e922` |
| r12 | 02 | banked | 2026-08-01 | `<scratch>/cq-2026-08/wave1-lane-02-r2.msg` | `019fc140-b093-76b0-8bd5-3df633d31291` | r03 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 17 dropped, 14 bugs, 8 pointers); banked as `working/wave-1/lane-02.json`; pack commit at dispatch `f3b53e922` |
| r13 | 03 | failed | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-03-r2.msg` | `019fc151-442c-71d0-9f83-d4f337b68bd2` | r04 | dispatched as pair (03,04); the container OOM'd a second time ~11 min in — even two concurrent fan-out consults are too much. Owner directive: **one lane at a time** from here on |
| r14 | 04 | failed | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-04-r2.msg` | `019fc151-4ac2-7ec2-a845-a607af1dad16` | r05 | lost in the pair-2 OOM (see r13) |
| r15 | 03 | failed | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-03-r3.msg` | — | r13 | dispatch error, no session: run launched with cwd=scratchpad and codex refused ("Not inside a trusted directory"), backend-exit 1. Always dispatch from the repo root with absolute `-P`/`-o` paths |
| r16 | 03 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-03-r4.msg` | `019fc18e-c8e6-7ca3-b804-a3ba28a09187` | r15 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 36 dropped, 18 bugs, 9 pointers); banked as `working/wave-1/lane-03.json`; pack commit at dispatch `bf47aaa76`; note: severityHints are uniformly medium — flag for calibration during Phase-4 triage |
| r17 | 04 | failed | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-04-r3.msg` | `019fc1a2-197d-74e2-a88e-c44bfc65110e` | r14 | solo dispatch killed ~4 min in when the orchestrator session was interrupted; no answer produced. Owner then reported the high-memory root cause found and directed the remaining lanes to run in parallel again |
| r18 | 04 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-04-r4.msg` | `019fc1af-830b-7932-a6eb-251aa6e4a3ad` | r17 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 32 dropped, 11 bugs, 15 pointers); banked as `working/wave-1/lane-04.json`; pack commit at dispatch `346c7e91e`; evidence also cites server/client consumers of shared contracts (in charter) |
| r19 | 05 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-05-r3.msg` | `019fc1af-8a52-74d1-9cba-f295029106e6` | r06 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 21 dropped, 4 featureIdeas, 24 bugs, 14 pointers); banked as `working/wave-1/lane-05.json`; pack commit at dispatch `346c7e91e` |
| r20 | 06 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-06-r3.msg` | `019fc1af-93ac-7cd2-9bdc-a905e81a354e` | r07 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 34 dropped, 1 featureIdea, 22 bugs, 2 pointers); banked as `working/wave-1/lane-06.json`; pack commit at dispatch `346c7e91e` |
| r21 | 07 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-07-r3.msg` | `019fc1af-9ba5-7e70-9b48-889240d724c1` | r08 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 13 dropped, 1 featureIdea, 1 bug, 4 pointers); banked as `working/wave-1/lane-07.json`; pack commit at dispatch `346c7e91e` |
| r22 | 08 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-08-r3.msg` | `019fc1af-a52a-7480-af41-e2409e9553ff` | r09 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 22 dropped, 4 bugs, 8 pointers); banked as `working/wave-1/lane-08.json`; pack commit at dispatch `346c7e91e`; broad path scope per cross-cutting charter |
| r23 | 09 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave1-lane-09-r3.msg` | `019fc1af-aad3-7482-a0fd-d88a172ea353` | r10 | consult codex, worktree best-effort-clean; contract v1 PASS (20 findings, 24 dropped, 1 featureIdea, 9 bugs, 8 pointers); banked as `working/wave-1/lane-09.json`; pack commit at dispatch `346c7e91e` |
| r24 | 06 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-06-r1.msg` | `019fc1c9-f37d-77f2-a392-f699058598f4` | — | wave-2 top-up round 1 (18 routed pointers), consult codex, worktree best-effort-clean; contract v1 PASS (10 findings L06-101..110, 0 dropped, 4 bugs, 2 pointers); hit the ~10 soft cap and titled 13 further candidates in `coverage.cut` — round-2/critic input; banked as `working/wave-2/lane-06-topup.json`; pack commit at dispatch `e4b18389f` |
| r25 | 07 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-07-r1.msg` | `019fc1c9-f95e-7431-b7b3-00ee8c19dde3` | — | wave-2 top-up round 1 (29 routed pointers), consult codex, worktree best-effort-clean; contract v1 PASS (10 findings L07-101..110, 4 dropped, 0 bugs, 23 pointers); the 23 fresh outbound pointers are round-2 routing input; banked as `working/wave-2/lane-07-topup.json`; pack commit at dispatch `e4b18389f` |
| r26 | 08 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-08-r1.msg` | `019fc1ca-037c-7b52-bdd4-78eb1421dd04` | — | wave-2 top-up round 1 (32 routed items incl. all 9 wave-1 featureIdeas), consult codex, worktree best-effort-clean; contract v1 PASS (10 findings L08-101..110, 2 dropped, 2 bugs, 0 pointers); 6 findings promote routed feature ideas as `feature` category, dismissals reasoned in `coverage.cut` (5); banked as `working/wave-2/lane-08-topup.json`; pack commit at dispatch `e4b18389f` |
| r27 | 09 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-09-r1.msg` | `019fc1ca-08ff-7322-8596-7468b778e9da` | — | wave-2 top-up round 1 (1 routed pointer), consult codex, worktree best-effort-clean; contract v1 PASS (4 findings L09-101..104, 15 dropped, 1 bug, 1 pointer); banked as `working/wave-2/lane-09-topup.json`; pack commit at dispatch `e4b18389f` |
| r28 | 05 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-05-r2.msg` | `019fc1da-fc36-7e91-b89f-ddb53bf8cf41` | — | wave-2 round 2 FINAL (1 routed pointer + thin-scope revisit), consult codex, worktree best-effort-clean; contract v1 PASS (2 findings L05-101..102, 1 bug → 05-B25, 3 pointers, 7 reasoned cuts); banked as `working/wave-2/lane-05-topup-r2.json`; pack commit at dispatch `d47987f2b` |
| r29 | 06 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-06-r2-fixed.msg` | `019fc1db-03b8-78e2-a592-9aecc07782fa` | — | wave-2 round 2 FINAL (1 routed pointer + 13 round-1 cut promotions), consult codex, worktree best-effort-clean; first emission FAILed contract v1 (3 evidence entries with both line and measurement set); one in-session resume re-emitted, PASS (12 findings L06-111..122 — 12 cuts promoted, RollModeToggle-suite cut + eslint-rules pointer dismissed with reasons; 1 bug → 06-B27, 0 pointers); banked as `working/wave-2/lane-06-topup-r2.json`; pack commit at dispatch `d47987f2b` |
| r30 | 07 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-07-r2.msg` | `019fc1db-099f-7402-8a28-77bd377cff65` | — | wave-2 round 2 FINAL (2 routed pointers), consult codex, worktree best-effort-clean; contract v1 PASS (2 findings L07-111..112, 0 bugs, both pointers resolved in coverage notes); banked as `working/wave-2/lane-07-topup-r2.json`; pack commit at dispatch `d47987f2b` |
| r31 | critic | banked | 2026-08-02 | (Fable subagent, read-only) | — | — | completeness critic barrier over all 16 banked runs: **FAIL** — F1 three flat analyzer CLI entries never read (lane 02, ~611 lines), F2 `scripts/data/` allowlists uncovered (lane 01); unassigned-matrix check PASS; note + orchestrator disposition banked as `working/wave-2/critic-note.md`; the one extra top-up round is authorized as micro-reads of exactly the failure scope (r32–r33) |
| r32 | 02 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-02-micro.msg` | `019fc1f1-42e9-7de3-89b8-7ce423c76a1b` | — | critic-remediation micro top-up (F1: the three flat analyzer CLI entries, read fully), consult codex, worktree best-effort-clean; contract v1 PASS (2 findings L02-101..102, 2 bugs → 02-B15/02-B16); banked as `working/wave-2/lane-02-micro.json`; pack commit at dispatch `a00035084` |
| r33 | 01 | banked | 2026-08-02 | `<scratch>/cq-2026-08/wave2-lane-01-micro.msg` | `019fc1f1-475a-7140-84d0-115ddfb82690` | — | critic-remediation micro top-up (F2: both `scripts/data/` allowlists + consumer grep), consult codex, worktree best-effort-clean; contract v1 PASS (1 finding L01-101, 1 dropped vs CQ25-34, 0 bugs); banked as `working/wave-2/lane-01-micro.json`; pack commit at dispatch `a00035084`. **Critic barrier CLOSED — Phase 3 COMPLETE** |
| r34 | triage | banked | 2026-08-02 | `working/triage/batch1-*.json` | Fable workflow `wf_eda7cdca-c7e` | — | batch-1 triage workflow resumed after owner pause and COMPLETED (236 agents, 0 errors, ~4.4M subagent tokens). Resume-as-is decision: journal showed only 16 panels remained, 15 of them medium+/high, so the script-edit lever (skip low-severity directions) would have saved exactly one panel (C-031 low/S) — resumed unchanged. Output: 60 candidates (zero merges — lane scopes disjoint), 2 verify-refuted, 7 judge-rejected, 51 survivors (51 directions, 28 panels). All 60 verified and all 58 judged → NO batch-1 no-verdict agents to re-process in batch 2. Banked as `working/triage/batch1-{candidates,verify,judgments,directions,panels,rejected}.json`; pack commit at dispatch `51d0641f4` |
| r35 | triage | banked | 2026-08-02 | `working/triage/batch2-*.json` | Fable workflow `wf_ec1dccb5-385` | — | batch-2 judge-first workflow COMPLETED (40 agents, 0 errors, ~1.8M subagent tokens, 38 min). 173 rows normalized (all 15 lane files, zero loss) → 171 candidates (2 merges: D-010 = L04-010+L08-006 rules-helper over-demand; D-040 = L05-020+L08-007 homebrew entry-type registries) → all 171 judged, ZERO lost verdicts. 14 judge-rejected with recorded reasons (incl. D-122 subsumed by approved batch-1 C-021), 157 approved for codex verification: 11 high / 112 medium / 34 low; 78 S / 63 M / 16 L / 0 XL. All 78 low-or-S approved carry oneLineDisposition (no direction review needed). 10 approved lightVerify (L06-111..122 promotions). 2 approved batch1Overlaps, both `extends` (D-118→C-035, D-170→C-038) → both re-verified, verdict reuse not applicable. Banked as `working/triage/batch2-{candidates,judgments,rejected}.json` (rejected file also carries the approved list); pack commit at dispatch `b2509ed0d` |
| r36 | triage | banked | 2026-08-02 | `working/triage/batch2-verify.json` | 16 codex consults (session ids in the banked file's `consults[]`) | — | batch-2 codex verification over all 157 judge-approved candidates: 16 chunks of ≤10 (chunk-LV = the 10 lightVerify L06-111..122 promotions, re-confirmation only), 4 consults live at a time, zero failures/retries, 157/157 results with no missing/dup/extra ids. 7 REFUTED: 5 already-ruled-out by the live prior pack (D-033→CQ25-187/leaf 08 step 7, D-082→CQ25-64, D-115→CQ25-168/leaf 44 step 6, D-121→CQ25-115/SHARED-CLUSTER-PLAN S1, D-139→leaf 24 scope-caveats) + 2 evidence overreads (D-093 level-up rollback doc claim, D-094 backfill-runbook stale-pointer claim). 150 survivors; 38 carry minor evidence-defect notes (line drift, count corrections) for authoring to honor. Pack commit at dispatch `7d0607a4f` |
| r37 | triage | banked | 2026-08-02 | `working/triage/batch2-directions.json` | Fable workflows `wf_71e2071e-422` (79 agents, 0 errors, ~3.2M subagent tokens, 32 min) + `wf_1da3b75b-0db` (2-agent re-run) | — | batch-2 stage 2 COMPLETE: one effort-high refute-review agent over the 7 codex refutations — 5 ACCEPTED (D-033, D-082, D-093, D-094, D-139), 2 OVERRIDDEN and reinstated (D-115: CQ25-168/leaf 44 covers only the scripts/tools/server coordinate sweep, not the 24 shared-schema-test annotations; D-121: S1 closed only the move/ownership half — the weaker `{success: boolean}` redeclarations are live residue). Both reinstatements are disposition-path (low/S and medium/S); D-121's disposition AMENDED in the banked file (no relocation of successResponseSchema — converge weaker copies onto the existing canonical, per the S1 do-not-reopen ruling). 78/78 solo directions returned (no panel stage per the batch-2 levers); D-004 and D-147 returned placeholder direction fields on the first pass and were re-run to full directions via `wf_1da3b75b-0db`. 2 directionSummaries replaced (D-064, D-118 directionOk=false). Survivors after reconciliation: 157 − 7 + 2 = **152** (78 with directions, 74 on oneLineDispositions). Pack commit at dispatch `c30a5df9a` |
| r38 | authoring | banked | 2026-08-02 | pack leaves `001-*.md` … `203-*.md` + 3 `NNN-PLAN.md` | Fable workflow `wf_…` (partial, 143 leaves) + 15 codex consults (`au01`–`au15`, 60 leaves) | — | Phase-4 authoring COMPLETE: 203 leaves + 3 XL plan companions (107/108/109-PLAN.md) written from 203 per-leaf data packets (packet builder wires the D-121 amended disposition, the D-148 carried L09-004 lexer/regex-comment disposition, C-021 absorbing rejected D-122, and the cross-batch pairs D-118↔C-035 / D-170↔C-038 into one author). The Fable authoring workflow died 143/203 in when Fable 5 usage credits were exhausted; the completed 143 were banked (`7fc7aab51`) and the remaining 60 were re-dispatched as 15 codex consults of 4 (the C-035/D-118 pair forced into one chunk), 4 live at a time, zero failures (`77d6f1023`). Consults return delimited leaf blocks; the orchestrator writes them after a shape check (heading, `Status: Not started`, Theme/Source lines, all four sections, assignment membership) so no malformed answer lands. **All remaining phases are codex-only — no Fable 5 access.** |
| r39 | leafcheck | banked | 2026-08-02 | `working/leafcheck-results.json` | 21 codex consults (`ch01`–`ch21`) | — | existence-check + live prior-pack-reconciliation pass over all 206 pack files (203 leaves + 3 PLAN companions), 21 contiguous chunks of ≤10, 4 consults live at a time, zero failures/retries, 206/206 results, no dupes. Lens 1 (open every `path:line`, re-derive counts, verify every cited command exists in root/per-package scripts or `scripts/`, resolve intra-pack and prior-pack links) + lens 2 (reconcile against the LIVE 2026-07-25 pack: kill if fully landed/ruled out, narrow to the residual if partially landed). Verdicts: 115 clean / 91 needs-fix / **0 kill**. Defects found: 135 evidence, 1 command, 2 link. 200 corrections proposed, 199 applied by exact unique-match replacement; the 1 skip was a line-wrap mismatch in `137-knip-check-…` (stale knip 6.14.1 prose vs the pinned 6.26.0) and was applied by hand. Prior-pack status: 129 confirmed, 61 none, **14 partially-landed, 2 ruled-out** — all 16 adjudicated in place by the checker's corrections (no leaf died; the two `ruled-out` flags are scoped rulings — CQ25 leaf 45 step 4 and leaf 44 steps 6–9 — that kill only an incidental documentation-trimming slice of leaves 007/136, not their executable substance). Pack commit at dispatch `77d6f1023` |

| r40 | phase-5 design | banked | 2026-08-03 | `<scratch>/cq-phase5-plan-critique.msg` | `019fc8fe-c3c7-7052-9d1d-f1b0a3e21db8` | — | design consult (codex, effort high, read-only, worktree best-effort-clean): adversarial critique of the proposed Phase-5 funnel before any review consult was spent. Verdict: keep the reduced-artifact funnel ("better than a fanout in which no judge ever sees the full population"), with five mandatory changes — include the 3 PLAN companions (206 files, not 203), move the reject audits ahead of the freeze, join triage provenance into S0, replace flat `primaryTargets` with `targetOps` + `problemFingerprint`, and split hard precedence from coordination relations. All five adopted; S3 rescoped from per-pair to per-connected-component as over-engineered. Four of its concrete pack claims spot-checked and all real (`044`/`050`, `056`/`042`, `038:74` bare-number hazard, direction-path singleton weakness). **No review consult dispatched** — this run only revised the plan |
| r42 | phase-5 1a | banked | 2026-08-03 | `<scratch>/cq-phase5-step1a.msg` | `019fc98c-77e1-7e23-9327-c57c4ed159ba` | — | **step 1a COMPLETE** — codex `work` run (not a consult) built `working/phase5/build-source-ledger.mjs` (dependency-free ESM, `--round N` re-entry) + `source-ledger.json` + `README.md`, committed `bca72c7dc`. 526 rows extracted and asserted against the tree (248 cuts + 250 drops + 28 kills). Lineage: 216 eligible cuts after cleanup; 32 cuts resolved away — 13 `superseded-by-later-round` (all of lane 06's round-1 cuts, revisited by r29), 9 `already-dismissed` (7 lane-05 + 2 lane-06 round-2 dispositions), 6 `already-promoted` (1 rule, 5 fuzzy with scores 0.44–0.62 and clear margins), 2 `duplicate-occurrence` (exact dupes inside lane 07), 2 `meta-disposition`. Round-1 sample: **49 cuts** (plan estimated 50–55). D grouping resolves all 160 refs / 250 claimants into **9 chunks** within both caps; only `CONSTRAINTS.md` needed splitting (28 refs / 37 claimants → D-03 + D-08). Idempotency and `--round 2` re-entry verified by the delegate. **1 `needsReview` row adjudicated by the orchestrator → stays eligible**: `wave-1/lane-07.json::coverage.cut[14]` ("character creation is a 21-file feature without a local MODULE document") near-matched `L07-106` at 0.333 on generic vocabulary only — L07-106 is *misstated* MODULE docs, this cut is a *missing* one; distinct problems, and the row is already in the frame as `not-sampled` rank 20. Plan corrections the run found (fixed below): candidate files key members as `members`, not `memberFindingIds`; `batch2-verify.json` rows carry `refuted`/`evidenceHolds` and no `verdict`; corpus anchors are spelled `(file § heading)`, and the 38 constraint records inherit a section-wide anchor; D resolves **28** refs to `CONSTRAINTS.md`, not 26 |
| r41 | phase-5 design | banked | 2026-08-03 | `<scratch>/cq-phase5-step12-critique.msg` | `019fc966-106a-7040-8198-dc6f0d059904` | — | design consult (codex, effort high, read-only, worktree best-effort-clean): adversarial critique of nine proposed changes to Phase-5 steps 1–2, which r40 had left far thinner than S0–S3. Two proposals dropped as standalone mechanisms (a second wave-style coverage object → folded into the 1a ledger; a separate existence-check step → folded into 2b as authoring's acceptance gate); seven kept with reshaping; one structural addition adopted (**1c pooled adjudication**). Arithmetic corrections it found and this doc now carries: the pile is **526 raw, not 528** (the bucket table read r34's nine batch-1 rejections as "9 + 2" when the nine already comprise 2 verify + 7 judge), B/C is **248 + 28 = 276** (the 5 accepted refutations live in `batch2-directions.json`, not a rejection file), the old per-lane balancing figures were cuts + drops with the drops belonging to D, and 13 of lane 06's cuts were already resolved into `L06-111..122` by r29. Also flagged, and fixed here: the ledger's Phase-4 checkbox and "next action" text had gone stale against r38/r39. **No review consult dispatched** — this run only revised the plan |

| r43 | phase-5 1b/B | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-b.msg` | `019fc9d0-0f6a-7ea3-b03f-e03670d1be79` | — | **step 1b consult B COMPLETE** — codex consult (effort high, read-only, worktree best-effort-clean) over B's 38 items (11 structured kills + 27 sampled cuts, lanes 01/02/03/05). Fanned out to 4 internal subagents, one per lane. Contract PASS: 38/38 itemDispositions, no dupes/extras/unassigned, every promotion referenced by a disposition and carrying non-empty `origins`; mechanical existence check over all 68 located evidence entries → 0 defects. Result: **19 items promoted into 18 candidates** (items 20 and 22 share B-006), 19 upheld; severity hints 6 medium / 12 low, no high. Kill audit was discerning — 9 of 11 kills upheld with concrete reasons, 2 promoted as narrowed residuals (B-001 keeps the substrate ruling intact by proposing move-only Bash decomposition rather than the barred TS rewrite, recorded as a `do-not-reopen` overlap on CQ25-124 rather than an `overturnsRuling`; B-002 takes the rename residual the kill reason itself identified). B-001 also silently corrected the original wave finding's wrong path — `scripts/lib/verify-engine.sh` (991 lines), not `scripts/verify/lib/…`. Two candidates carry "looks fully covered by leaf NNN" hints (B-012→179, B-014→186) — retained as hints, not suppressed, per the 1c-holds-dedup rule. Pack commit at dispatch `d727772e9` |

| r44 | phase-5 1b/C | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-c.msg` | `019fc9dc-bbc9-7550-b36d-3742ed11dbac` | — | **step 1b consult C COMPLETE** — codex consult (effort high, read-only, worktree best-effort-clean) over C's 39 items (17 structured kills + 22 sampled cuts, lanes 04/06/07/08/09). Fanned out to 5 internal subagents, one per lane. Contract PASS: 39/39 itemDispositions; existence check over all 73 located evidence entries → 0 defects. Result: **20 promoted, 19 upheld**; severity hints 4 medium / 16 low, no high. Kills: 13 of 17 upheld, 4 promoted — C-001/C-002 split a conceded documentation residual out of two accepted refutations, C-004/C-005 keep a kill's conceded *problem* while dropping the remedy sketch it actually rejected. Five candidates set `overturnsRuling`; two of those (C-003 vs leaf 109, C-015 vs leaf 189) are self-declared **exact overlaps with authored leaves**, promoted only because dedup is 1c's ruling to make — 1c should expect to merge or reject them. One uphold noted the original finding cited two nonexistent filenames. Pack commit at dispatch `366d1ccd5` |

| r45 | phase-5 1b/D-01 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-01.msg` | `019fc9e8-c80f-7163-befe-7866e31b2134` | — | D chunk 1/9 (`SHARED-CLUSTER-PLAN.md` + `02-fastify-io-augmentation.md`, 30 claimants / 16 refs), 5 internal subagents. Contract PASS 30/30; 11/11 evidence entries exist. **28 full / 1 partial / 1 none → 2 promotions**, both narrow residuals that leave the recorded rulings intact: D-01-001 takes the aggregate-export review CQ25-115's landed S1 explicitly deferred (and flags its conflict with ADR-0005 rather than suppressing it); D-01-002 takes the `dateTimeField`-backed mapper boundaries CQ25-181's rejected-alternatives ruling never reached, explicitly excluding the bare-string homebrew/magic-item schemas the ruling did close. Pack commit at dispatch `85d2c0ac4` |

| r46 | phase-5 1b/D-02 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-02.msg` | `019fc9ef-633e-71a3-9519-2baf6fc9f817` | — | D chunk 2/9 (`HARNESS-CLUSTER-PLAN.md` + `38-eslint-rule-helpers.md`, 30 claimants / 18 refs), 2 internal subagents (one per document). Contract PASS 30/30; 3/3 evidence entries exist. **28 full / 1 partial / 1 none → 1 promotion** (two claimants converge on it). All 28 harness-cluster claims held. D-02-001 splits a conflation in CQ25-201: the live leaf rejects a *shared plain-data* mock registry (Vitest hoisting) but expressly records rule-load AST extraction as viable, unshipped, and needing its own promotion. Pack commit at dispatch `e8fb144fe` |

| r47 | phase-5 1b/D-03 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-03.msg` | `019fc9f4-7865-7032-b4fb-e7d7695736fe` | — | D chunk 3/9 (`CONSTRAINTS.md`, first of the two forced splits — 26 claimants / 20 refs), 4 internal subagents. Contract PASS 26/26. **26 full → 0 promotions.** Per the calibration rule a null chunk gets an orchestrator spot-check, so two dispositions were re-read against the live document: the CQ25-82 reasoning ("distinct user-facing messages + a recorded accept-with-reason") matches `code-quality-2026-07-25/CONSTRAINTS.md:17` in substance, and the consult separately flagged that CQ25-82's *lane* rationale (trust boundaries) diverges from the live ruling's while still being covered by it. Zero is a real result here: this chunk is entirely explicit standing refusals, the bucket least likely to hide residuals. Pack commit at dispatch `9f26719ae` |

| r48 | phase-5 1b/D-04 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-04.msg` | `019fc9f8-dff2-71c2-aad7-ccfec3597cfc` | — | D chunk 4/9 (`SERVER-COMMENTS-PLAN.md` + `40-PLAN.md` + `42-PLAN.md`, 30 claimants / 18 refs), 3 internal subagents. Contract PASS 30/30; 3/3 evidence entries exist. **29 full / 1 partial → 1 promotion.** D-04-001: the cited CQ25-68/S17 covers only the character-owner conversion, so the campaign and note caller shapes fall outside it — but the consult flagged that the residual is itself owned by the *open optional* S18/CQ25-69 and left that dedup call to 1c rather than claiming novelty. Also observed (no action needed): the prior pack's `CONSTRAINTS.md` still says leaf 42 owns the E2E split, which is stale against the later, more specific 42-PLAN ruling — already recorded as distillation note 11 in `working/dedup-corpus.md`. Pack commit at dispatch `870e1aa2d` |

| r49 | phase-5 1b/D-05 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-05.msg` | `019fc9fe-674f-7fa1-a2d3-e6e8c9d1f976` | — | D chunk 5/9 (`28-PLAN.md` + `31-harness-shared-helpers.md` + `50-nested-relation-concurrency-gate.md` + a fourth doc, 30 claimants / 20 refs), 4 internal subagents. Contract PASS 30/30; 7/7 evidence entries exist. **26 full / 3 partial / 1 none → 3 promotions.** The `none` deliberately yields *no* promotion and is the sharpest judgment in the chunk: CQ25-163 genuinely does not cover the dropped title, but automatic secondary ordering is refused by CQ25-18's owner ruling and player-facing ordering is closed-declined by CQ25-164, so a wrong ref did not make the material promotable — upheld under the no-evidence rule. **All three promotions self-flag as probably-covered elsewhere** (D-05-001/003 residuals are scheduled by sibling plan slices, D-05-002 "looks directly covered by authored leaf 157"), so this chunk's post-1c yield may well be zero; the hints are recorded rather than the promotions suppressed, per the 1c-holds-dedup rule. Pack commit at dispatch `01c836e5c` |

| r50 | phase-5 1b/D-06 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-06.msg` | `019fca05-4cc3-7fd0-995e-f9fa04de189b` | — | D chunk 6/9 (`CLIENT-CLUSTER-PLAN.md` + `34-PLAN.md`, 30 claimants / 19 refs), 2 internal subagents (one per document). Contract PASS 30/30; 3/3 evidence entries exist. **29 full / 1 partial → 1 promotion.** D-06-001: CQ25-155's live disposition drops only the drift-ai barrel-test half and says nothing about the monolithic lint-ratchet shell suite — but the consult recorded that the residual is already scheduled under CQ25-31 and sits next to authored leaf 068 (which scopes the 5,059-line shell suite out and points at CQ25-31), so this is another likely 1c merge rather than novel material. Two full dispositions carry useful reasoning for later stages: CQ25-193 holds despite a newer derived `SheetCampaignContext` type because the binding panel expressly forbade replacing prop threading with a context provider, and CQ25-199's branding refusal was checked against its *named* consumers rather than assumed blanket. Pack commit at dispatch `88feb233f` |

| r51 | phase-5 1b/D-07 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-07.msg` | `019fca09-ff1c-7cd0-b073-92b3eb8ee7e7` | — | D chunk 7/9 (`00-index.md` + `27-PLAN.md`, 29 claimants / 20 refs), 2 internal subagents. Contract PASS 29/29; 6/6 evidence entries exist. **26 full / 1 partial / 2 none → 2 promotions.** Both `none` verdicts are the strongest form of this bucket's finding — the cited record simply does not contain the material: CQ25-16's live leaf-46 inventory mentions neither `WeaponAttackResult` interface (the identifier appears nowhere in the prior pack), and CQ25-32's live slice 27.9 schedules widening and routing under the *same* singular `smokeTest` spelling, never the naming normalization that was dropped against it. The `partial` deliberately yields no promotion: the CQ25-140 command-prefix residual turned out to be consumer-facing package aliases vs implementation-facing shell subjects in deliberately different namespaces, so blanket normalization would be churn rather than a defect. Pack commit at dispatch `590a08b4d` |

| r52 | phase-5 1b/D-08 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-08.msg` | `019fca10-c246-77e2-bc03-2e17130c53d6` | — | D chunk 8/9 (`07-PLAN.md` + `41-PLAN.md` + `43-stryker-config-duplication.md` + two more, 30 claimants / 19 refs), 5 internal subagents. Contract PASS 30/30; 3/3 evidence entries exist. **29 full / 1 partial → 1 promotion.** D-08-001 is a compound claimant whose cited CQ25-24 covers the six-ability ASI expansion but not the test relocation half, which 07-PLAN assigns to the separate 07.5/CQ25-25 slice. The consult returned it anyway and said why: this step judges the claimant against *its named ref*, and cross-record dedup is 1c's ruling — the same discipline D-04 and D-06 applied. Pack commit at dispatch `d36294ea4` |

| r53 | phase-5 1b/D-09 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/reject-audit-d-09.msg` | `019fca15-113a-7bb0-9e73-db85b5c52a88` | — | D chunk 9/9 (ten single-leaf documents, 15 claimants / 10 refs), 5 internal subagents. Contract PASS 15/15. **15 full → 0 promotions.** Spot-checked per the null-result rule: the consult's CQ25-210 reasoning (the live leaf calls `remove` "not covered by this leaf's evidence" and records `togglePrepared`'s identical P2025 window as out of scope, rather than categorically declining both) matches `code-quality-2026-07-25/59-character-spell-add-unique-race.md:158,166`. It correctly noted that the lane's *drop prose* overstated that status while the dropped *title* stayed fully covered — a distinction that does not promote. Pack commit at dispatch `a7bd4aff4` |

| r54 | phase-5 1c | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1c-adjudication.msg` | `019fca40-fda6-7123-bd68-fb9d27f85164` | — | **step 1c COMPLETE** — one codex consult (effort high, read-only, worktree best-effort-clean) over the whole pooled promotion set: all 49 candidates at once against the 206 authored pack files. Input built by `working/phase5/build-1c-packet.mjs` (pooled candidates + a title/header index of every pack file). Contract PASS: 49 decisions, no dupes/extras, every augment target an existing filename, no merge chains, `worthIt:false ⇒ reject`. Result: **26 `new-leaf`, 3 `augment-existing-leaf`, 2 `merge-with-promotion`, 18 `reject`** — 29 accepted for authoring, authoritative severity 0 high / 22 medium / 27 low, size 33 S / 9 M / 4 L / 3 XL (no accepted candidate is XL, so **no new PLAN companions**). Dedup worked as designed: both self-declared exact overlaps died (C-003 vs leaf 109, C-015 vs leaf 189), 11 of the 18 rejects are current-leaf or prior-pack-slice coverage and 5 are below the churn bar; 12 of D's 14 promotions were rejected as covered, matching the promoters' own hints. Every ruling carries a `dedupBasis` with `path:line`. Banked as `working/phase5/adjudication.json`; pack commit at dispatch `0ddc640f9` |
| r55 | phase-5 2a | banked | 2026-08-03 | pack leaves `204-*.md` … `229-*.md` + 3 augmented leaves | 8 codex consults (`au2a-01`…`au2a-08`) | — | **step 2a COMPLETE** — 29 accepted rulings authored as 26 new leaves (204–229) and 3 in-place augmentations (025, 082, 182). `working/phase5/build-2a-packets.mjs` assigned numbers from 204, folded the 2 `merge-with-promotion` candidates into their targets' packets (B-015→B-017, C-017→C-016), emitted one author packet per promotion and `working/phase5/promotion-map.json`. Eight consults of ≤4, 4 live, zero failures/retries; every answer returned delimited blocks that passed the mechanical shape check (heading number, `Status: Not started`, Theme/Area/Severity/Size header, Source line, exactly the four required sections, and for augmentations no dropped section plus a size floor). Orchestrator wrote the files. Pack commit at dispatch `74c1e5f99` |
| r56 | phase-5 2b | banked | 2026-08-03 | `working/phase5/promotion-check.json` | 3 codex consults (`gate-01`…`gate-03`) | — | **step 2b COMPLETE** — the r39-equivalent acceptance gate over the 29 new/augmented files only, run by consults that did **not** author them, in chunks of ≤10, all 3 live, zero failures. Lenses: open every `path:line`, re-derive every measurement, verify every cited command exists, resolve intra-pack and prior-pack links, reconcile against the live prior pack at `priorPackReviewSha` (all three chunks re-confirmed it is unmoved), and check each leaf against its packet for dropped constraints. Verdicts: **12 clean / 17 needs-fix / 0 kill**; 33 defects (22 evidence, 4 prior-pack, 4 coherence, 3 packet-fidelity, **0 command, 0 link** — no fabricated commands this round). 30 corrections applied by exact unique-match replacement; **3 skipped by orchestrator ruling** (see below). `packetConstraintsHonored: true` on all 29, no dropped constraints. Pack commit at dispatch `9bdbdfdb9` |
| r57 | phase-5 1b-r2/B | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r2-b.msg` | `019fca6e-9b5a-7ae3-95ed-75e6af6439c7` | — | Round-2 consult B (lanes 01, 02, 03, 05 — 21 cuts the round-1 sampler left `not-sampled`; nothing here was audited before), internal subagents per lane. Contract PASS 21/21, no dupes/extras; 36/36 located evidence entries exist. **11 promote / 10 uphold** → `R2B-001..011` (5 medium / 6 low; 3 M / 8 S). Yield is well above round 1's 15% because the round-1 sample had already skimmed the highest-ranked rows; the sampler's rank ordering is doing real work in reverse. Three candidates carry self-declared 1c hints (leaves 107, 140, 215) and two argue explicitly *against* a near leaf (007 covers the in-transaction cascade, not these pre-delete reads; 001 covers cross-feature chat policy, not this intra-module coordinator bypass) — that reasoning is 1c's to weigh, not the promoter's. One candidate deliberately narrows a prior-pack refusal instead of re-proposing it: the homebrew validation-error promotion challenges CQ25-187's rejected 49-site form sweep and asks only for control association. Banked as `working/phase5/reject-audit-r2-b.json`; pack commit at dispatch `b04d06ab9` |
| r58 | phase-5 1b-r2/C | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r2-c.msg` | `019fca7c-2ddb-7201-adb5-00480845366b` | — | Round-2 consult C (lanes 04, 06, 07, 08, 09 — 20 unsampled cuts), internal subagents per lane. Contract PASS 20/20; 44/44 located evidence entries exist. **8 promote / 12 uphold** → `R2C-001..008` (3 medium / 5 low; 1 L / 2 M / 5 S). The consult re-confirmed that the branch differs from `AUDIT_TARGET_SHA` only in pack documentation (`git diff` over production, test, harness, workflow and config surfaces returned no paths) — an independent check of the pin assumption every citation rests on. Two dispositions are worth carrying forward: the dice-decoder cut was upheld *even though* its stated rationale was wrong (CQ25-179 does not govern that grammar) because both consumers decode the same validated contract, and the Unarmored Defense promotion keeps the player-choice gap alive by treating the computed-vs-persisted AC authority mismatch as a sequencing dependency rather than a suppressor. `R2C-008` reconstructs wave-2 retained finding L09-103 (expand-barrel transactionality) from a different direction, which 1c should see. Banked as `working/phase5/reject-audit-r2-c.json`; pack commit at dispatch `b04d06ab9` |
| r59 | phase-5 1b-r2/D-01 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r2-d01.msg` | `019fca86-ecca-7700-9064-1ca9f3e0b083` | — | Round-2 **second opinion** over D-01's 30 prior-pack drop claimants — the only D partition whose round-1 promotions survived adjudication, so the plan reopens it and nothing else. The consult was told not to read the round-1 D-01 answer first. Contract PASS 30/30; 25/25 located evidence entries exist. **4 promote / 26 uphold** → `R2D01-001..004` (2 medium / 2 low; 1 L / 3 S) versus round 1's 2 promotions from the same population — the second seat found more, not less, which is the argument for the re-open rule. It also re-verified the live prior-pack documents byte-identical to `priorPackReviewSha` by read-only `git diff`. Two of the four self-declare overlap with the leaves round 1 produced from this very partition (228, 229), so 1c will likely fold them; the two dead-code candidates (shared rule helpers, grid conversion helpers whose only consumers are their own tests) are new. Banked as `working/phase5/reject-audit-r2-d-01.json`; pack commit at dispatch `b04d06ab9` |
| r60 | phase-5 1c-r2 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1c-r2-adjudication.msg` | `019fca94-b809-7880-98e7-ac5b142c5d55` | — | **round-2 step 1c COMPLETE** — one codex consult (effort high, read-only, worktree best-effort-clean) over all 23 round-2 candidates at once against the now-**232**-file pack, so this round's dedup ruled against leaves 204–229 as well. Contract PASS: 23 decisions, no dupes/extras, both augment targets real filenames, no merges, `worthIt:false ⇒ reject`, summary counts self-consistent. Result: **16 `new-leaf`, 2 `augment-existing-leaf` (R2B-001→107, R2C-005→189), 0 merges, 5 `reject`** — 18 accepted, authoritative severity 0 high / 10 medium / 13 low, size 17 S / 4 M / 2 L / 0 XL (again **no new PLAN companions**). The headline result is the **D-01 second opinion: all four of its promotions rejected.** Two were fully covered by leaves 228 and 229 — the leaves round 1 authored from that same partition — and two (`R2D01-002`/`003`, dead shared rule and grid helpers) revive scope CQ25-115 *measured and deliberately cut*, with no valid overturn offered. That is the re-open rule working in both directions: the second seat did surface more raw material than the first (4 vs 2), and adjudication then killed all of it as already-owned. `R2C-008` was the one non-D reject, killed under the live D-167 churn ruling despite genuinely matching no authored leaf. Banked as `working/phase5/adjudication-r2.json`; pack commit at dispatch `3f631c2b3` |
| r61 | phase-5 2a-r2 | banked | 2026-08-03 | pack leaves `230-*.md` … `245-*.md` + 2 augmented leaves | 5 codex consults (`2a-r2-au2a-01`…`05`) | — | **round-2 step 2a COMPLETE** — 18 accepted rulings authored as 16 new leaves (**230–245**) and 2 in-place augmentations (107, 189). `working/phase5/build-2a-packets.mjs --round 2` derived the numbering base from the live pack (first free number 230, no `--start` needed) and wrote packets under `working/phase5/2a-r2/` so the round-1 packets survive as the record of what those authors were given. Five consults of ≤4, four live at once, zero failures/retries; every answer passed the mechanical shape check. Two loop-closing changes landed with this step: the augment packets now state in-line that the packet's Area/Severity/Size grade **the addition, not the host leaf**, and `apply-2a-blocks.mjs` fails an augmentation that rewrites the host's `Theme · Area · Severity · Size` line — the exact correction round 1's gate proposed three times and the orchestrator refused three times (r56). Both augmentations came back with their host headers intact. Pack commit at dispatch `638ee24d2` |
| r62 | phase-5 2b-r2 | banked | 2026-08-03 | `working/phase5/promotion-check-r2.json` | `019fcaad-9a50-7f70-8405-d99329a2ab67`, `019fcaad-a9a4-7790-a1c6-ab3202e042f6` | — | **round-2 step 2b COMPLETE** — the acceptance gate over the 18 round-2 files only, in two chunks of 9, run by consults that did **not** author them; both live, zero failures, both re-confirmed `priorPackReviewSha` unmoved. Verdicts: **10 clean / 8 needs-fix / 0 kill**; 18 defects (15 evidence, 1 command, 1 packet-fidelity, 1 coherence, **0 link**, **0 prior-pack**). 17 applied by exact unique match. `packetConstraintsHonored: true` on all 18, no dropped constraints, and **the round-1 header dispute did not recur** — round 2 put the ruling in the augment packets and enforced it in `apply-2a-blocks.mjs`, and neither consult proposed the rewrite. The one command defect is instructive: leaf 107 cited `git log --follow` for two churn counts, which exits 128 because `--follow` demands exactly one pathspec — a *plausible* command that does not run, which is the failure class one notch subtler than an invented one. Pack commit at dispatch `a7a850445` |
| r63 | phase-5 2b-r2 follow-up | banked | 2026-08-03 | `107-PLAN.md` | `019fcabd-9338-75b0-8e83-36b39db92d11` | — | The gate's only defect with **no local correction**: R2B-001's packet requires leaf 107's companion plan to move in lockstep with the augmentation, and `git diff HEAD~1 HEAD -- 107-PLAN.md` was empty. One authoring consult returned the complete revised plan; it folded native-projectable rule metadata, deny-array generation plus freshness checking, and explicit intentional non-projection (stash and every other rule whose contextual shared-policy reason native denial would preempt) into slices **S0** and **S1**, dropped no existing slice or heading, converted the bare leaf-number and prior-pack references to resolvable links, and propagated the gate's corrected counts (19 dispatcher branches, nine sibling `test-*.sh` suites plus the `test-support.sh` helper) so plan and leaf now agree. Shape-checked before writing: single block, zero stray text, no dropped headings, 78 → 96 lines. **Generalizable lesson for the remaining steps: an augmentation whose target leaf has a companion `NNN-PLAN.md` is a two-file edit, and the packet must say so up front** — the 2a author was never told the plan was in scope. |
| r64 | phase-5 1b-r3/B | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r3-b.msg` | `019fcac5-3d1b-7573-a22b-76fcc06e5082` | — | Round-3 consult B (18 unsampled cuts, lanes 01/02/03/05), internal subagents per lane. Contract PASS 18/18; 25/25 located evidence entries exist. **7 promote / 11 uphold** → `R3B-001..007` (1 medium / 6 low; 2 M / 5 S). Yield falls to 39% from round 2's 52% on the same lane set, the first sign of the cut pool thinning. The consult re-verified the pin by read-only `git diff` and enumerated one population exhaustively rather than sampling (15 homebrew checkbox occurrences in 10 files). One promotion (`R3B-005`) self-declares against **leaf 236**, authored days-old in round 2 — the first time a round has had to dedup against its immediate predecessor's output. Banked as `working/phase5/reject-audit-r3-b.json`; pack commit at dispatch `6d08eb702` |
| r65 | phase-5 1b-r3/C | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r3-c.msg` | `019fcace-3736-78e1-aa68-24928499c03f` | — | Round-3 consult C (20 unsampled cuts, lanes 04/06/07/08/09), internal subagents per lane. Contract PASS 20/20; 23/23 located evidence entries exist. **6 promote / 14 uphold** → 6 candidates (3 medium / 3 low; 3 M / 3 S). Every one arrives with an `existingLeafHints` entry naming a specific near leaf and an argument for the residual — 038, 053, 090, 111/102, 064/196, 160 — which is what a mature pack looks like from the promoter's seat and puts real weight on 1c. Three upholds record work worth keeping: the lane-04 direction-metadata cut was wrong on its own facts (four direction-bearing shared list contracts live, not the three its title claimed), the runtime/test-only export sweep enumerated every exported declaration in five modules against non-test consumers rather than sampling, and the dormant-campaign-settings cut died because no typed setting key or runtime consumer exists to strand. Banked as `working/phase5/reject-audit-r3-c.json`; pack commit at dispatch `6d08eb702` |
| r66 | phase-5 1c-r3 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1c-r3-adjudication.msg` | `019fcad7-09a2-71b0-81d7-3054548ee351` | — | **round-3 step 1c COMPLETE** — one codex consult (effort high, read-only, worktree best-effort-clean) over all 13 round-3 candidates against the **248**-file pack. Contract PASS: 13 decisions, no dupes/extras, all three augment targets real filenames, no merges, summary counts self-consistent. Result: **7 `new-leaf`, 3 `augment-existing-leaf` (R3B-003→184, R3C-101→053, R3C-271→090), 0 merges, 3 `reject`** — 10 accepted, 0 high / 4 medium / 9 low, 7 S / 6 M / **0 L, 0 XL**. The size distribution is itself a signal: the third pass over the same reject pile finds nothing structural left, only small and mid-sized work. Acceptance rate held at 77% even though **every one of the 13 candidates arrived self-declaring a near leaf** (rounds 1 and 2: 8 of 49 and 8 of 23) — the promoters' residual arguments mostly survived contact with the named leaves' scope sections, which is the pack behaving like a mature corpus rather than a thinning one. The seat also recorded three sequencing constraints for 2a (R3C-272 precedes leaf 111 and CQ25-44 slice 28.11; R3C-001 coordinates with 025 and 222; R3C-301 follows 064 and coordinates with 196) and restated that the owner's round-limit question is still open. Banked as `working/phase5/adjudication-r3.json`; pack commit at dispatch `2be569f5a` |
| r67 | phase-5 2a-r3 | banked | 2026-08-03 | pack leaves `246-*.md` … `252-*.md` + 3 augmented leaves | 3 codex consults (`2a-r3-au2a-01`…`03`) | — | **round-3 step 2a COMPLETE** — 10 accepted rulings authored as 7 new leaves (**246–252**) and 3 in-place augmentations (053, 090, 184). Three consults of ≤4, all live at once, zero failures; every answer passed the mechanical shape check, all three augmentations came back with their host headers intact, and no augmentation target had a companion plan so the new plan-in-scope constraint did not fire. The pack now holds **255 files**. One tooling defect found and fixed here rather than in a later round: `apply-2a-blocks.mjs` had hardcoded the round-2 chunk path when it was generalized, so `--round 3` silently shape-checked round-3 blocks against round-2's assignment and failed with a filename mismatch — loud, but for the wrong reason. Pack commit at dispatch `dd1902c75` |
| r68 | phase-5 2b-r3 | banked | 2026-08-03 | `working/phase5/promotion-check-r3.json` | `019fcae7-33f3-7820-9d38-cf419c590025`, `019fcae7-484a-7803-9abc-2935d6671d54` | — | **round-3 step 2b COMPLETE** — the acceptance gate over the 10 round-3 files, two chunks of 5, run by consults that did not author them; both live, zero failures, both re-confirmed `priorPackReviewSha` unmoved. Verdicts: **7 clean / 3 needs-fix / 0 kill**; **5 defects** (4 evidence, 1 coherence, **0 command, 0 link, 0 prior-pack, 0 packet-fidelity**), all 5 applied by exact unique match, nothing skipped, `packetConstraintsHonored: true` on all 10. The gate's defect density has fallen monotonically across the three rounds — 33 defects over 29 files, then 18 over 18, now 5 over 10 — which is what a stabilizing authoring pipeline looks like: the packet-side fixes made after each round (explicit augment-header ruling, plan-in-scope constraint, shape checks in `apply-2a-blocks.mjs`) removed whole defect classes rather than individual errors. Pack commit at dispatch `bb8d77002` |
| r69 | phase-5 1b-r4/B | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r4-b.msg` | `019fcaee-5859-71d1-a590-ff840ac2ec8d` | — | Round-4 consult B (24 unsampled cuts, lanes 01/02/03/05), internal subagents per lane. Contract PASS 24/24; **56/56** located evidence entries exist — the largest evidence set any single 1b consult has returned, on the deepest sample. **13 promote / 11 uphold** → `R4B-*` (3 medium / 10 low; 3 M / 10 S). The 54% yield reverses three rounds of decline, which is worth reading carefully rather than celebrating: this draw reached lane 05's long tail (57 raw cuts, the largest lane) for the first time, so the recovery is a sampling artifact of *which* rows were left, not evidence the pile is richer than round 3 found. Two candidates are the kind only a deep pass finds — a header comment that claims its transaction prevents concurrent over-attunement when it does not, and a startup boundary (`validateAuthConfig`) that validates nothing. Banked as `working/phase5/reject-audit-r4-b.json`; pack commit at dispatch `465328264` |
| r70 | phase-5 1b-r4/C | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r4-c.msg` | `019fcafa-6a65-7091-9e12-26249b3aed09` | — | Round-4 consult C (13 unsampled cuts, lanes 04/06/07/08/09), internal subagents per lane. Contract PASS 13/13; 21/21 located evidence entries exist. **5 promote / 8 uphold** → `R4C-001..005` (1 medium / 4 low; 1 M / 4 S). C's lanes are visibly exhausted — only 13 rows were left to draw at all, against B's 24 — and the surviving material has shifted away from code: two of the five are docs findings (an undocumented cross-worktree status mode, a missing human-facing contribution entrypoint) and one is a test-hygiene finding. `R4C-005` re-raises the expand-barrel export-graph duplication that round 2's `R2C-008` reached from a different direction and 1c rejected under the live D-167 churn ruling; adjudication should rule on the pair together, not re-derive the ruling from scratch. Banked as `working/phase5/reject-audit-r4-c.json`; pack commit at dispatch `465328264` |
| r71 | phase-5 1c-r4 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1c-r4-adjudication.msg` | `019fcb04-43ca-7142-a417-73cb5a75d491` | — | **round-4 step 1c COMPLETE** — one codex consult (effort high, read-only) over all 18 round-4 candidates against the **255**-file pack. Contract PASS: 18 decisions, no dupes/extras, all three augment targets real filenames, no merges. Result: **14 `new-leaf`, 3 `augment-existing-leaf` (R4B-031→004, R4B-032→033, R4C-004→189), 1 `reject`** — **17 accepted**, the highest acceptance rate of any round (94%), and **the first `high` severities in the entire phase**: both are false-comment findings where a header claims a transactional guarantee the code does not provide (starting-equipment persistence, attunement concurrency). Graded high because a wrong comment about concurrency actively misleads the next reader, which is exactly the rubric's high bar, and both are S. Still 0 L and 0 XL — three rounds running. The single reject is `R4C-005`, and the seat ruled it as instructed against its round-2 sibling rather than from scratch: the two-traversal framing genuinely narrows away from `R2C-008`'s bulk-mode remedy but does not defeat D-167's proportionality reasoning, since the map and symbol paths already call each other and no incorrect result is demonstrated. Banked as `working/phase5/adjudication-r4.json`; new leaves number **253–266**; pack commit at dispatch `b9eea0924` |
| r72 | phase-5 2a-r4 | banked | 2026-08-03 | pack leaves `253-*.md` … `266-*.md` + 3 augmented leaves | 5 codex consults (`2a-r4-au2a-01`…`05`) | — | **round-4 step 2a COMPLETE** — 17 accepted rulings authored as 14 new leaves (**253–266**) and 3 in-place augmentations (004, 033, 189). Four consults live at once plus one follow-on; zero failures, every answer passed the mechanical shape check, all three augmentations kept their host headers. Two firsts handled here: the phase's first `high`-severity leaves (the false transactional-guarantee comments, authored so the *misleading claim* is the finding — quote the comment, show what the code does, make the remedy reconcile them), and **the first leaf augmented twice** — 189 already carried round 2's `R2C-005` material, so the author was told explicitly to add alongside it rather than over it, and the applier's dropped-section and size-floor checks confirmed nothing was lost. The pack now holds **269 files**. Pack commit at dispatch `a0f588c3a` |
| r73 | phase-5 2b-r4 | banked | 2026-08-03 | `working/phase5/promotion-check-r4.json` | `019fcb16-2f56-76f0-aa7a-e64440cd9477`, `019fcb16-410b-7503-831a-c4d2e1c38b7a` | — | **round-4 step 2b COMPLETE** — the acceptance gate over the 17 round-4 files, two chunks, run by consults that did not author them; both live, zero failures, both re-confirmed `priorPackReviewSha` unmoved. Verdicts: **8 clean / 9 needs-fix / 0 kill**; 16 defects (12 evidence, 4 coherence, **0 command, 0 link, 0 prior-pack, 0 packet-fidelity** — the third consecutive round with no fabricated command and the second with no packet-fidelity defect), **all 16 applied**, nothing skipped, `packetConstraintsHonored: true` on all 17. Defect density rose from round 3 (5/10 → 16/17), which is what a 14-new-leaf round with two `high` findings should cost. **The two highs were verified rather than trusted:** the gate was told the whole finding rests on one comparison and to open the comment itself, and it did — leaf 033's quotation of `inventory-service.ts:33-36` is exact and the create/update paths at `:221-244`/`:270-279` use default callback transactions with no lock, conditional write or isolation option, so the promised exclusion really is absent; leaf 004's widened `DbClient \| TxClient` boundary is real. **Twice-augmented leaf 189 came back clean**, with round 2's `R2C-005` claims intact under round 4's addition. Pack commit at dispatch `21bf2aca8` |
| r74 | phase-5 1b-r5/B | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r5-b.msg` | `019fcb21-c2ca-74b1-b475-e3bd797005c0` | — | Round-5 consult B (26 unsampled cuts, lanes 01/02/03/05), internal subagents per lane. Contract PASS 26/26; 49/49 located evidence entries exist. **14 promote / 12 uphold**, and **every single candidate is S** — no M, no L, nothing structural, which is the clearest statement yet of what the bottom of this pile contains. Four of the fourteen are dead-weight findings of a kind only an exhaustive pass reaches: an unreachable `start` command in a CLI's vocabulary, an always-false `oversized` field in packet serialization, coldspot state nothing reads, and a legacy `DeathSaves` orphan with a stale test still exercising it. Twelve of the fourteen name a near leaf, four of them a leaf an earlier Phase-5 round authored (205, 207, 209, 232, 248). Banked as `working/phase5/reject-audit-r5-b.json`; pack commit at dispatch `88d365829` |
| r75 | phase-5 1b-r5/C | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1b-r5-c.msg` | `019fcb2c-5ed7-7af3-b2f6-a3e426d72556` | — | Round-5 consult C (10 unsampled cuts — all that were left in these lanes, lanes 04/06/07/08/09), internal subagents per lane. Contract PASS 10/10; 30/30 located evidence entries exist. **7 promote / 3 uphold**, all S. **`R5C-001` is a genuine cross-round duplicate**: it is the same cross-worktree status-mode documentation gap that round 4's `R4C-002` raised and that is already authored as leaf **265**. The promoter flagged it against 265 rather than suppressing it, exactly as the step's rules require — dedup is 1c's ruling — and it is the first time the funnel has re-surfaced material it authored one round earlier, which is precisely the signal that the pool is exhausted. Banked as `working/phase5/reject-audit-r5-c.json`; pack commit at dispatch `88d365829` |
| r76 | phase-5 1c-r5 | banked | 2026-08-03 | `<scratch>/cq-2026-08/phase5/1c-r5-adjudication.msg` | `019fcb37-8cdc-7552-8565-42b279c6874b` | — | **round-5 step 1c COMPLETE** — one codex consult (effort high, read-only) over all 21 round-5 candidates against the **269**-file pack. Contract PASS: 21 decisions, no dupes/extras, all 13 augment targets real filenames, both merges resolve to accepted targets with no chains. Result: **4 `new-leaf`, 13 `augment-existing-leaf`, 2 `merge-with-promotion`, 2 `reject`** — 17 accepted, 0 high / 7 medium / 14 low, and **every ruling S**. The shape is the story: with the pile down to small material, the seat consolidated rather than proliferated, **folding 13 findings into existing leaves and merging 2 more inside the pool instead of authoring 15 thin standalone leaves** — the single best judgment call any adjudication seat has made in this phase, and the reason the pack ends at 270 leaves rather than 281. It also killed the cross-round duplicate cleanly: **`R5C-001` rejected as fully covered by leaf 265** (same omission, same two command forms, same multi-lane insertion, same script-authority rule), and recorded that first exact resurfacing as a genuine exhaustion signal rather than noise. `R5C-007` was ruled on its own facts against the two earlier expand-barrel rejects as instructed. Banked as `working/phase5/adjudication-r5.json`; new leaves **267–270**; pack commit at dispatch `95b27c144` |
| r77 | phase-5 2a-r5 | banked | 2026-08-03 | 4 new leaves `267-*.md` … `270-*.md` + 13 augmented leaves | 5 codex consults (`2a-r5-au2a-01`…`05`) | — | **round-5 step 2a COMPLETE** — 17 accepted rulings authored as **4 new leaves (267–270) and 13 in-place augmentations** (009, 047, 057, 094, 133, 149, 152, 163, 203, 205, 209, 232, 248). Four consults live at once plus one follow-on; zero failures, every answer passed the shape check, every augmentation kept its host header and dropped no section. This inverts every earlier round's ratio and was the point: with the pile down to uniformly S material, folding beats proliferating. Four hosts (205, 209, 232, 248) are leaves earlier Phase-5 rounds authored days ago, so authors were told explicitly they are no more editable than a Phase-4 leaf. The pack now holds **273 files**. Pack commit at dispatch `58086cc23` |
| r78 | phase-5 2b-r5 | banked | 2026-08-03 | `working/phase5/promotion-check-r5.json` | `019fcb51-2dda-7251-b0d3-1089c783a9f4`, `019fcb51-3f8e-7c42-b51d-98e970474452` | — | **round-5 step 2b COMPLETE — the funnel's last gate.** Two chunks over the 17 round-5 files, run by consults that did not author them; both live, zero failures, `priorPackReviewSha` re-confirmed. Verdicts: **8 clean / 9 needs-fix / 0 kill**; 27 defects (19 evidence, 3 packet-fidelity, 3 coherence, 1 link, 1 prior-pack, **0 command** — the fourth consecutive round with no fabricated command), **26 applied, 1 skipped by orchestrator ruling**. Because 13 of 17 were augmentations, the gate's main lens was the `HEAD~1` predecessor comparison, and it earned its place: two of the three packet-fidelity defects are **dropped or falsified predecessor claims** that no citation check would have caught — leaf 047's replacement no-other-leaf claim was still false (leaf 105 edits the very `ToolHandler.onFinalize` comment 047's restructure removes), and leaf 152's augmentation had deleted the boundary requiring `smoke-test-files.ts` to stay the extracted engine's only local runtime dependency. The skip is the header ruling one field further along: the gate proposed downgrading leaf 149's `Source` line to `Confidence: medium` because the *addition* was adjudicated medium. Refused — the packet grades the addition, not the host, and downgrading would misrepresent every claim 149 already made. The gate read the written exception correctly; the exception text was too narrow, and a future augment packet should say **header *and* Source line**. Pack commit at dispatch `4bcbfbdea` |
| r79 | phase-5 S0 | banked | 2026-08-03 | `working/phase5/build-s0.mjs` + `s0-records.json` (commit `3ca8e99dd`) | `019fcb5e-f48c-71e0-a9e5-f165315ed4d6` (codex **work** run) | — | **step 3 (S0) COMPLETE** — mechanical extraction over the frozen 273-file pack, written as a script with a `--check` mode that re-derives and validates its own output, so the numbers below are reproducible rather than asserted. Extracted: **7,798 backticked path citations** (3,833 with line locations) each tagged by originating `##` section, **339 resolved and 68 deliberately ambiguous intra-pack references**, and the full header/Source field set per file. The `leaf NN` hazard was handled as specified — link targets resolved against current-pack filenames with exact three-digit basenames required, bare prose left `ambiguous` rather than guessed. **4 citations are irreducibly ambiguous at the pin** and are recorded, not repaired, because the pack is frozen: `010:80` `trpc.ts:2`, `052:68` `MODULE.md:62-67`, `052:79` `MODULE.md:65-67`, `131:98` `references/trailer-contract.md:4` — all bare basenames matching multiple files. Promotion provenance joined exactly for all 67 new leaves and 23 augmented hosts across the five rounds' `promotion-map*.json` (95 rows). **Two `joinGaps[]` recorded rather than fabricated** — see the S0 provenance note below. |
| r80 | phase-5 S1 | banked | 2026-08-04 | `working/phase5/s1-records.json` | 27 codex consults (`s1-01`…`s1-27`) | — | **step 4 (S1) COMPLETE** — record enrichment over all **270** leaves in 27 chunks of ten, each chunk reading only its own files. Dispatched as four sequential lanes rather than 27 separate calls, keeping four consults live throughout; zero failures, zero retries, every consult returned `best-effort-clean`. Mechanical validation passed with **zero errors**: 270 records with no missing, duplicate or extra file, every `problemFingerprint` complete (subject + mechanism + invariant), every `targetOps` non-empty and drawn from the closed `action`/`role` vocabularies, every relation target an existing pack filename, and every relation carrying the leaf sentence that warrants it. Totals: **2,103 `targetOps`** (55 records using `branch` to keep alternative remedies apart — the `097` failure mode the plan called out), **232 relations** of which 26 are honestly marked `ambiguous` rather than forced into crisp edges, **162 records carrying an `independenceClaim` as exact text plus strength**, 99 non-authoritative within-chunk near-miss pairs, and 39 `readerNotes`. **One scale surprise: the merged output is ~807 KB (≈200k tokens), 8× the plan's ~25k estimate** — the consults wrote far denser records than the estimate assumed. That does not fit comfortably in one S2 context alongside the candidate lists, so step 5 must emit a compact per-leaf digest as well as the pair channels (see below). |
| r81 | phase-5 S2 input | banked | 2026-08-04 | `working/phase5/build-s2-input.mjs` + `s2-channels.json` + `s2-digest.md` (commit `536f9daba`) | `019fcba5-55b3-7d50-a71c-ae22dca84f98` (codex **work** run) | — | **step 5 (candidate channels) COMPLETE** — all seven plan channels plus a tagged non-authoritative eighth, over 36,315 possible pairs → **2,648 deduplicated candidates**, each carrying every channel that nominated it *and* the specific evidence that did so. Per channel: c1 write×write 446, c2 write×dependency/truth-source 437, c3 evidence-path (low weight) 1,871, c4 lexical top-5 931, c5 resolved references 247, c6 provenance 43, c7 contradicted independence 214, c8 within-chunk near-misses 99. The plan's path-channel scale check held: restricted like-for-like to leaves 001–203 the script found **1,295 / 522 / 55** against the plan's predicted 1,204 / 469 / 60 — within ~8–11% on every band, which is a real validation of the extraction rather than a coincidence. **Channel 6's coverage is recorded explicitly, not left to look thin:** 43 pairs from 75 exact `promotionOrigins` covering leaves 204–270, and nothing for 001–203 because the Phase-4 join is unrecoverable (r79). The digest came in at 200 KB (≈50k tokens) — the compression that makes a single global S2 seat possible — via an indexed encoding (leaf/target index tables plus per-channel evidence-tuple schemas) that fits 2,648 fully-evidenced pairs into 270 KB. |
| r82 | phase-5 S2 | banked | 2026-08-04 | `working/phase5/s2-nominations.json` | `019fcbbd-ed42-7fb1-a418-4966d0364770` | — | **step 6 (S2) COMPLETE** — the one seat in the entire audit that sees all 270 leaves at once. Read the full digest and worked the 2,648 candidate pairs selectively; contract PASS with **zero errors** (every pair two distinct existing filenames, no repeats, `subsumer` set iff `subsumes` and drawn from the pair, every cluster id resolved, every nomination carrying a warrant). **61 nominations from 2,648 pairs (2.3%)** — 1 `duplicate`, 1 `subsumes`, **44 `collides`**, **15 `contradicts`**; 40 high / 17 medium / 4 low confidence; **12 named clusters**, each with a hub. The shape is informative: `collides` dominating means the pack's most common cross-leaf defect is not redundancy but **two leaves touching the same target with no declared relation between them** — an implementer following one would silently undo or conflict with the other. Calibration held on both controls: it flagged the two pre-seeded defects (`044`/`050`, `042`/`056`) and **explicitly labelled them as pre-seeded rather than presenting them as discoveries**, and it recorded honest `recallNotes` naming exactly where it is weakest — zero-path cross-batch duplication among 001–203, where the unrecoverable Phase-4 provenance means the lane-08 seam prior cannot be recreated no matter how carefully it compensated. It also named its strongest zero-path find (`142`↔`161`, `c4`-only), which is precisely the class the rest of the pipeline structurally cannot reach. Connected components of the nomination graph: **24 components over 77 files** (sizes 7,6,6,5,5,5,4,3×5,2×12), assigned to **15 S3 consults** — 12 component consults plus 3 batches of singleton pairs. |
| r83 | phase-5 S3 | banked | 2026-08-04 | `working/phase5/s3-adjudication.json` + `merge-s3.mjs` | 15 codex consults (`s3-c01`…`s3-c12`, `s3-p01`…`s3-p03`) — `019fcbcd-8a06-7aa3-8b26-e921bf5736e7`, `019fcbda-4e5d-7e03-9ea7-a0beafe2ded1`, `019fcbda-6139-7a81-a0e2-ec7b2b0ef133`, `019fcbda-7683-7501-8bc5-1e7d98d3a71b`, `019fcbd0-a7ce-76f0-930b-8aa8925989af`, `019fcbdd-cac3-7691-a2fe-af119ec5f6df`, `019fcbde-2529-7700-8814-e046a73fcdfb`, `019fcbdd-51e5-7450-a55e-6f3fe39f26eb`, `019fcbd5-2140-7ff0-8e9c-3c9bf17afbda`, `019fcbe3-7b8d-7c11-873a-9c2728cd7e83`, `019fcbe2-1bf1-7cf0-8b85-0482c6b62e93`, `019fcbdf-7f33-7560-a77f-25867bd5f211`, `019fcbd8-334d-7f80-bbb5-a4c05f3126a5`, `019fcbe6-bfc1-78b1-8948-2ccdf0a7bab3`, `019fcbe5-6f92-7c31-9814-5a30200fe5af` | — | **step 7 (S3) COMPLETE** — all 24 connected components over 77 files adjudicated, dispatched as four sequential lanes; zero failures, zero retries, every consult `best-effort-clean`. Contract validation passed with **zero errors and zero warnings**: one `components[]` entry per assigned component, every matrix covering *every* unordered pair in its component, `subsumer` set iff `subsumes` and drawn from the pair, `survivingFile`/`edges`/`narrowedFile`+`boundary` each present iff their remedy kind, and every edge naming two existing pack files plus the sentence to write. **114 pairs ruled**: 1 `duplicate`, 1 `subsumes`, 21 `collides`, 6 `contradicts`, 85 `distinct`. Remedies: **17 `add-relation`** (32 edges to record), **2 `merge`**, **5 `no-action`**, 0 `narrow-scope`. **The headline is the overturn rate: S3 overturned 36 of S2's 61 nominations (59%)** — 25 `collides` → `distinct` and 8 `contradicts` → `distinct`, i.e. S2 nominating on a digest systematically over-read shared targets as conflicts where the leaves, read in full, either already declared the relation or never actually touched. That is the two-seat design working as intended (nominate wide on cheap evidence, rule narrow on full text), not S2 failing — but it is the number to carry into any future audit that is tempted to act on nomination alone. Both **precision-channel** nominations survived intact: the `c4`-only zero-path `142`↔`161` duplicate (merge into `142-…`) and the lone `subsumes`. The two pre-seeded controls behaved correctly — `044`/`050` (in `s3-c07`) and `042`/`056` (in `s3-p01`) were ruled normally and treated as confirmation. **S3 also ruled the 53 pairs S2 never nominated** (the contract required the full matrix, not just the nominated pairs) and found **1 edge S2 missed**, which is the only recall evidence this pipeline can produce about its own nomination step. Two merges land: `096` → `198-worktree-provisioning-hard-wired.md` (`265` stays — S3 ruled it `distinct` from both), and `161` → `142-code-intelts-maintains-unused-pseudo-library.md`. |
| r84 | phase-5 S3 merges | banked | 2026-08-04 | commits `1fb0a0d66`, `cb17f11a9` | `019fcc94-0bb1-75c3-9c59-180365423d3b` (codex **work** run) | — | **step 8a — the two `merge` remedies applied. This is the sanctioned un-freeze**: the pack had been frozen at 270 leaves since step 3 so that S0, S1, S2 and S3 all read the same text. `096-per-worktree-guide-omits-mandatory.md` folded into `198-worktree-provisioning-hard-wired.md`; `161-drift-ai-executable-exposes-incoherent-23.md` folded into `142-code-intelts-maintains-unused-pseudo-library.md`. `265` was **not** merged despite sharing `096`'s component — S3 ruled it `distinct` from both, and only its outbound link was rewritten. **All seven inbound references repointed** (`082`, `198`, `265` → the `096` host; `086`, `142`, `147`, `208` → the `142` host); a fresh grep confirms **zero live references to either retired filename**. Two citations were judged redundant rather than carried (`.env.example:1-9` and a guide `:3-4` range, both subsumed by wider ranges already in the host) and that judgment is recorded rather than silent; no citation was dropped in the `161` merge. `142` was re-graded **Size M → L** because the survivor now carries two implementation slices plus six-test rewiring — the one case where absorbing a leaf genuinely changed the size of the combined work. **Pack: 270 → 268 leaves, with deliberate numbering holes at 096 and 161.** The holes stay: renumbering would invalidate every citation, ledger row and cross-reference in the pack. |
| r85 | phase-5 S3 edges | banked | 2026-08-04 | 17 commits `17de2c204`…`f80bf4204` | `019fcc99-3b8c-7c50-9cb8-9c0d3588ab10` (codex **work** run) | — | **step 8b — all 32 `add-relation` edges recorded**, one commit per component, across 27 leaves; every `# n.`, `Status:`, `Theme:` and `Source:` line verified unchanged by diff, since this step records relations and does not re-grade leaves. **The substantive result is not the 32 appends but the 12 contradicted independence claims removed**: leaves `064`, `054`, `179`, `111`, `044`, `010`, `131`, `002`, `056`, `017`, `134` and `065` each asserted they had no sequencing edges while carrying one. An edge applied as a blind append would have left the contradiction standing three lines above it and made the pack *worse*; the run was instructed that `remedy.detail` outranks the raw edge list for exactly this reason, and it replaced the claims rather than supplementing them. `080`'s claim was narrowed rather than replaced, to cover only its remaining soft adjacencies. `179` was edited although no edge named it — `s3-c05`'s component detail required the reciprocal relation, which is the component-level ruling working as designed. Two `s3-c04` sentences could not be applied byte-for-byte because S3 wrote a bare `004-….md` rather than a link; both were converted to the pack's link form with substance unchanged, and that deviation is reported rather than buried. The other 30 sentences are S3's verbatim. |
| r86 | phase-5 step 8 | banked | 2026-08-04 | `working/phase5/build-edge-graph.mjs` + `edge-graph.json`, `00-index.md`; commits `a27fbed31`, `21d5104dc`, `a9651f9c2`, `6ce692131` | `019fcca2-03b1-7472-bda0-a3aa69275ede` (codex **work** run) | — | **step 8 — the edge graph and the index.** `edge-graph.json` unions S3's adjudicated non-`distinct` rulings with the leaf-declared relations in `s1-records.json`, S3 winning where both cover a pair: **251 edges, 27 from S3 and 224 declared**, over the post-merge 268-leaf pack. `00-index.md` is regenerated from the graph inside `<!-- BEGIN/END GENERATED LEAF TABLES -->` markers, so the hand-written scheduling prose above them survives regeneration — the generator does a demarcated-region replacement rather than rewriting the file. **268 rows in eight Area sections** (Shared 22, Server 28, Client 48, Tests 16, E2E 3, Harness 88, Docs 33, Cross-cutting 30) with Theme demoted to a column, and every row carrying its sequencing edges — an index that omitted them would have been precisely the failure this step was scheduled to prevent. The Phase-0 skeleton's `Leaves: None yet` is finally gone and with it the `backlog:lint` warnings that have run since Phase 1. **No `Next up` priority call was invented**: the owner has not made one, and the index says so rather than guessing. |
| r87 | phase-5 step 9 | banked | 2026-08-04 | `working/phase5/fix-claims.md` (commit `d2b9a92c7`) | 5 codex consults — `019fccb0-929b-7b21-be9d-2bac19fe0f34` (merges), `019fccb3-db7a-7c43-a517-4814112caf98` (edges-a), `019fccb0-9298-7013-b4a4-69d4a756bb6e` (edges-b), `019fccb8-4dfa-7a51-90ff-14bb8462b577` (graph), `019fccb5-23fd-7940-89fb-0a6291d4321b` (index) | — | **step 9 — re-review of everything steps 8a/8b/8 changed**, five read-only seats over the merges, the 32 applied edges (split in two), the graph plus generator, and the index. Result: **1 P0 and 13 P1** — rr-merges **clean**, rr-edges-a 1 P1, rr-edges-b 1 P0, rr-graph 9 P1 plus a reciprocal `prefersBefore` **cycle**, rr-index 3 P1. **The seat that paid for itself is rr-graph**: it cross-checked every `independenceClaim` in `s1-records.json` against the *finished* 268-leaf graph and found **ten leaves still claiming no sequencing edges while the graph gave them one**. The step-8b apply pass structurally could not have seen these — it only touched leaves named in an edge it was applying, whereas the contradiction only exists once the declared relations are unioned in. The P0 is `119`, whose `## Proposed direction` still prescribed importing from a file that leaf `181` deletes. Also found: three **reversed** edge directions (`171`/`182`, `189`/`061`, `220`/`094`), a renderer emitting raw relation kinds (`prefersBefore [031] — prefersBefore: prefer after`) that a reader cannot resolve to a row-relative statement, and a false `requires` rule in the index prose. **The lesson for the design: a fix pass and a review pass see different populations, and the review's population is the whole artifact.** |
| r88 | phase-5 fix round | banked | 2026-08-04 | 13 commits `bbec220e9`…`5f027b685` | `019fccc2-d6f2-7d00-a3ff-165e828ddaee` (claims, codex **work**), `019fcccc-54fa-76e0-8dde-40f2ff1c3060` (graph/index, codex **work**) | — | **the step-9 fix round, split into two sequential work runs on disjoint surfaces** — leaves for one, generator plus graph plus index for the other — because both are `work` runs and serialize on the worktree lock anyway, and a split by surface makes the two independently reviewable. Run 1 (10 commits) fixed the ten contradicted independence claims, one commit per leaf, **narrowing rather than deleting** where a claim was partly true (`046`, `083` now name their graph peers explicitly) and adding a reciprocal note in `178` where the counterpart lacked one; all header, `Status:`, `Theme:` and `Source:` lines verified unchanged by diff. Run 2 (3 commits) corrected the three reversed directions, rewrote the renderer to emit complete row-relative statements (`Prefer [031] before this leaf` / `Prefer this leaf before [025]`) while preserving the `S3 …` prefixes and collapsing genuinely-agreeing reciprocal pairs, and rewrote the index's scheduling rules. **The banked S1 and S3 records were not edited** — they are historical consult records, and rewriting them to make today's output look right would destroy the audit's own evidence. Instead the generator carries a documented `DIRECTION_OVERRIDES` layer pinning each override's raw input, original direction, corrected direction and **deciding leaf `path:line`**, and `--check` fails if a pinned record drifts *or if an override stops being needed* — so the override layer cannot silently outlive its warrant. The graph settled at **250 edges** (the 171/182 reciprocal pair collapsing to one preference alongside its existing `coLand`), with **28 directional arcs and no cycles**. |
| r89 | phase-5 step 9 round 2 | banked | 2026-08-04 | commits `9feb6dc15`, `cf0d735d7` | 5 codex consults — `019fcce0-edbb-7302-8d8b-b42e46878db2` (merges), `019fccd9-923b-7a93-8df8-ac216386fb69` (edges-a), `019fccd4-b5d4-7141-828f-62b6ce35b57d` (edges-b), `019fccd4-c58b-7771-aed4-535fa7e1cd20` (graph), `019fccdb-458c-7ca1-8c66-5cf6f3589359` (index); fix run `019fccf3-c8e4-75a2-a0a3-3888fbbca5e8` (codex **work**) | — | **step 9 round 2 — the same five seats re-run against the post-fix tree, plus the round-2 fix.** Result: **no P0 and two distinct P1**; `rr-index` and `rr-edges-b` returned **clean**. Both findings are failures *of the fix round*, not of the analysis, which is the whole reason the stopping rule demands a clean round rather than a completed fix list. (1) **The round-1 `DIRECTION_OVERRIDES` corrupted the retirement accounting** — `build-edge-graph.mjs` recorded every override-induced endpoint change as a merge retirement, so the two live-leaf direction corrections `d-189-01` (061/189) and `d-220-02` (094/220) were falsely reported as repointed to a surviving merged host, inflating the summary to 11 retired-endpoint inputs and 5 repoints. **Two independent seats reported it** (`rr-merges` and `rr-graph`), which is the only cross-seat corroboration this phase produced. Fixed at the cause: retirement accounting now normalises raw endpoints *before* overrides apply and fires only for endpoints actually in `RETIREMENTS`. Correct totals: **9 retired-endpoint inputs, 3 repointed, 6 dropped-internal, 250 edges** — independently reproduced by `rr-graph` as 27 S3 plus 223 declared. (2) **`124-…:145` still claimed "independent — no ordering edges" while carrying seven soft edges** — a claim **round 1's sweep missed**, so the fix run re-ran the cross-check itself over all **162** non-null `independenceClaim` records and confirmed `124` was the only remaining one. The peer split was verified rather than trusted: `081`/`113`/`156` are `rebaseOn`, `112`/`122`/`178`/`188` are `serialize`. **`--check` had passed both defects, and that was treated as its own defect**: it now asserts every `retirementAction` names a genuinely retired endpoint and that the summary counts equal the recorded actions. A `--check` that byte-compares a regenerated artifact against itself proves determinism, not truth — the lesson to carry, since this was the second real defect it waved through. |
| r90 | phase-5 step 9 round 3 | banked | 2026-08-04 | commit `077d0e7d7` | 4 codex consults — `019fccfa-dc57-71d3-bd85-e67f6122fb4e` (graph), `019fcd03-1a3e-75d3-8151-6193459a8b44` (edges-a), `019fccfa-fc68-7503-9da9-8bfbf3df225d` (index), `019fccff-9aa8-7991-bccf-ccd64d23af80` (merges); fix run `019fcd0a-3cbe-7852-86ae-9627c304ca3c` (codex **work**) | — | **step 9 round 3 — scoped to the surfaces round 2's fix touched**, so `rr-edges-b` (clean in round 2, surface untouched) was not re-run. **Three of four seats returned clean.** `rr-graph` independently re-derived the whole artifact — **250 edges, 27 S3 plus 223 declared, no missing or spurious edge** — and an independent raw-input sweep matched all nine recorded retirement actions exactly, confirming the round-2 repair. It also re-swept all **162** `independenceClaim` records and found none contradicted. Its single P1 was about the **check, not the data**: the three retirement-summary invariants added in the round-2 fix were **tautologies** — each summary value is constructed from `retirementActions` and then compared against the identical expression, so they cannot fail and cannot detect an *omitted* action, while reading as independent coverage. This is the second-order version of the round-2 lesson: round 2 demanded invariants because `--check` had waved a real defect through, and the invariants that got written were inert. **The fix required negative proofs rather than a passing run**, since the broken version passed too: `--check` now derives the expected retirement set independently by walking raw `inputS3`/`inputDeclared` endpoints and asserts **exact set equality** on action IDs (not counts, so an omission and a spurious addition cannot cancel), and each new assertion was proven to fail by perturbation — dropping `d-147-03`, flipping its disposition, and skewing the total each produced the right named error. **A second tautology of the same shape was found and fixed** in the same pass (per-leaf sequencing coverage compared a directly-constructed object's length against `liveLeaves.length`; now a raw live-file membership check, proven by omitting leaf `001`). Neither `edge-graph.json` nor `00-index.md` changed — this was a check-only fix, exactly as predicted. |
| r91 | phase-5 step 9 round 4 | banked | 2026-08-04 | — (no changes; the round closed clean) | `019fcd10-26b1-7822-8040-b9596dcdfbde` (codex consult) | — | **step 9 round 4 — CLEAN. The stopping rule is satisfied and step 9 is closed.** Scoped to one seat over `--check` alone, because commit `077d0e7d7` changed only the generator's check code and `edge-graph.json` and `00-index.md` were byte-identical to what round 3 had already re-derived and confirmed; a full round would have re-read unchanged text. The seat verified the four things the round existed to ask: the expected retirement set is derived from raw `inputS3`/`inputDeclared` endpoints **without reading `retirementActions`** (`build-edge-graph.mjs:767-782`); **two-way** action-ID equality is enforced (`:784-805`) so missing, spurious, duplicate and wrong-disposition actions each reach a distinct failure and an omission cannot cancel against an addition; per-leaf sequencing is checked against the raw live-file set (`:925-929`); and a full sweep found **no remaining same-expression tautology**. It declined to perturb the tree and reasoned from the code instead, saying so explicitly — the prompt offered both and required the choice be stated. **Step 9 took four rounds: 1 P0 + 13 P1, then 2 P1, then 1 P1, then clean.** The shape is the finding worth carrying: after round 1, *every* defect found was in the repair of the round before it, and none in the analysis. A stopping rule of "fix the findings" would have stopped after round 1. Later review confirmed the P0 repair but caught a corrupted retirement summary, a missed independence claim, and two inert `--check` invariants introduced or missed during repair. The rule that ends on **a clean round** is what caught those repair defects. |
| r92 | phase-5 docs | banked | 2026-08-04 | commits `e3cfc0d38`, `4649513f2`, `5f10cc096` | `019fcd13-366f-72a3-83fa-fe8c0c49bbaa` (codex **work** run) | — | **`ORCHESTRATION.md` restructured on owner instruction** — it had reached ~172 KB / 1,600 lines and was the first document every agent loaded. Two sections were 62% of it: this **Runs** table (~81 KB) and a 427-line chronological `Last checkpoint` where each agent had appended its own paragraph, so a reader had to replay the whole audit to learn the current state. **Nothing was deleted.** The ledger, the closed-round result sections and the triage cursor moved **verbatim** into this file, proven by a sorted line-multiset comparison per region (115 / 50 / 40 / 75 / 431 lines, all equal); `Last checkpoint` was rewritten as a current-state section keeping the live material — pack shape and the never-renumber rule, the S0 provenance consequences, the 15 unread cuts, the next action, and the two open owner-facing questions — with its per-round narrative archived here instead. **ORCHESTRATION.md: 172 KB → 57 KB.** The run was told to **report contradictions rather than adjudicate them**, and reported four; the one that mattered was the Phases table still claiming 273 files, 270 leaves and "next action is step 7", fixed separately in `5f10cc096`. The rest are stale predictions inside the archived narrative, which is contemporaneous record and correctly left as written. **The harness lesson: a living plan that is also an append log stops being loadable.** Provenance and current state have different readers and belong in different files.
| r93 | finalization | banked | 2026-08-04 | commits `a9fa11b00`, `a5f693430`, `6fdf90c29`, `5e9d54347`, `5f3f6f01b` | `019fcd1f-8260-7233-b3e1-b5a342e3f7cc` (codex **work** run) | — | **Finalization — the pack's four reader-facing documents plus the `working/` prune.** `BUGS-HANDOFF.md` and `DEDUP-CORPUS.md` promoted out of `working/` (118 unverified suspicions, explicitly out of this pack's queue and input to a later `/code-review`; 223 frozen prior-pack exclusion records). `CONSTRAINTS.md` records what a future reader must not silently re-open: the **15 unread eligible cuts by `source-ledger.json` row id**, the deliberate scope exclusions as *skipped not clean*, bug hunting and security review as out of scope by decision, the two S3 merges and the 096/161 numbering holes with the never-renumber rule, and the two **open owner-facing questions** left unanswered. `AUDIT-SUMMARY.md` carries the coverage honesty: lenses and weighting, the scale arithmetic from 203 Phase-4 leaves plus 91 reject-audit promotions to 270 and then 268, the **S0 provenance loss** stated as a limit on the result, `collides` as the dominant cross-leaf defect rather than the redundancy the phase was designed to hunt, the **59% S3 overturn** (36 of 61), and the four-round step-9 stopping lesson. No priority call — the owner has made none. The prune dropped 25 files / 932 KB of superseded intermediates. **Reviewed in r94; the prune and one summary claim did not survive review.** |
| r94 | finalization review | banked | 2026-08-04 | — (read-only) | `019fcd2c-168c-7543-ac97-ac7e807a1a15` (codex consult) | — | **Finalization review — DEFECTS: 2 P0, 2 P1.** The seat was told these are the documents a future reader trusts the pack by and that nobody reviews them after it. **P0-1, dangling citation:** the prune's own claim that every cited artifact survived was **false** — `s0-records.json` carries **77** `pooledCandidateSource` references to four deleted `pooled-candidates.json` files (`1c`, `1c-r3`, `1c-r4`, `1c-r5`), so the surviving S0 provenance pointed at nothing. Found by grouping every `pooledCandidateSource` field and checking all 25 deleted paths, not by spot-checking the two the prompt flagged. **P0-2, false claim:** the four-round stopping lesson said round 1 shipped a **false P0 fix**; the P0 import-boundary repair (`21d43aa47`) was never overturned — what later rounds caught was the corrupted retirement summary, a missed independence claim, and the inert `--check` invariants. The wrong phrasing originated in the orchestrator's own finalization mission and propagated into two documents. **P1-1:** the `State ledger` and `Last checkpoint` still called Phase 5 open and finalization the next action, contradicting the index and summary. **P1-2:** `CONSTRAINTS.md` omitted three paths `working/ownership-closure.md` records as skipped (`LICENSE`, `NOTICE.md`, `docs/SRD_CC_v5.2.1.pdf`). The seat independently re-derived the scale arithmetic, the 268/270 leaf counts and the holes, the S2/S3 numbers, all 15 unread cut ids against `source-ledger.json`, the 118 handoff entries and the 223 dedup records before reporting — the checks it passed are as much the result as the four it failed. |
| r95 | finalization fix | banked | 2026-08-04 | commits `869d733c7`, `91a6de4a7`, `f64ed76c3`, `6d11525c7` | `019fcd37-2a79-75f3-a4ba-03ad2183a9de` (codex **work** run) | — | **All four r94 findings repaired, one commit each.** F1: the four `pooled-candidates.json` files restored from `5f3f6f01b^` with **blob hashes matching the pre-prune versions**, and every remaining pruned path re-checked against every surviving file — no other provenance target was missing. All **95** `pooledCandidateSource` references now resolve (the 77 dangling plus 18 that already pointed at a retained round-2 file). The prune's arithmetic was corrected wherever it appeared: **21 files / 652,527 bytes actually deleted**, 197 files / 12,825,300 bytes retained, 4 files / 279,113 bytes restored. Restoring rather than regenerating S0 was required by the pack's own rule that **banked consult records are never rewritten to make a later step look right**. F2: the false-P0-fix phrase removed from `AUDIT-SUMMARY.md` and both occurrences in this file, replaced with what the ledger actually records; the four-round lesson itself is unchanged and still true. F3: `State ledger` and `Last checkpoint` now say Phase 5 and finalization are complete with **owner approval before merge as the sole remaining action**, both owner-facing questions preserved unanswered. F4: the three skipped legal/source paths named with no cleanliness claim — plus `bun.lock`, which the run found covered only generically as "lockfiles" and named on its own initiative. `backlog:lint` held at the expected 327 report-only advisories before every commit. |
| r96 | finalization review round 2 | banked | 2026-08-04 | commit `e2d16e27a` (orchestrator fix) | `019fcd40-4111-7241-89f8-ae42d8619135` (codex consult) | — | **Re-review of the r95 repair — one P0, everything else clean and independently re-derived.** The seat re-derived the prune arithmetic from Git trees and the filesystem rather than from any document (218 files / 13,477,827 bytes before, 197 / 12,825,300 now, 25 removed / 931,640 bytes, 4 restored / 279,113, leaving **21 / 652,527** deleted), confirmed all four restored blobs hash identically to `5f3f6f01b^`, re-counted the 95 `pooledCandidateSource` references (31 / 18 / 10 / 17 / 19) with every target present, grepped all 25 prune paths across every surviving pack file, checked the repaired four-round account against rows r87–r91, confirmed both owner questions still unanswered with owner approval the sole remaining action, and verified **all protected `ORCHESTRATION.md` design sections byte-identical** with no leaf and no generated-region change. **Its P0:** `AUDIT-SUMMARY.md` claimed *every* cited artifact survived, but `working/hotspots.md` cites **14 links to 11 `/tmp/tmp.X3FfTqKPzV/*` scratch paths** that were never committed and died with the lane-00 session — including a closing claim that the raw Dolos report "remains available". Fixed in `e2d16e27a`, but **not by the remedy the review proposed**: rewriting those citations in place would have broken the file's own "lane-00 report verbatim below" guarantee, so the claim was scoped to *tracked* artifacts, the exception named, and the correction carried in a header note — the same never-rewrite-the-banked-record rule that forced the F1 restore. **The pattern held to the very end: this P0 was in the finalization repair's blind spot, not in the analysis, and it was found by mechanical re-derivation rather than by reading.** |
| r97 | finalization review round 3 | banked | 2026-08-04 | commit `9eb22d327` (orchestrator fix) | `019fcd46-6a1d-7d30-ba14-3defbce65e7f` (codex consult) | — | **Scoped to `e2d16e27a` alone.** It confirmed the narrowed retained-artifact claim is **true** rather than a defect disguised by narrowing (no tracked cited artifact is missing after the prune), counted exactly **14 links to 11 unique files**, verified the scratch blobs appear nowhere in `git rev-list --all --objects`, found no collateral change, and — asked directly whether the verbatim-preservation rationale was sound or a convenient excuse — **found it honest**, reading all nine lane addenda to confirm the durable conclusions do not require reopening the raw scratch files. **Its P0 was in the correction itself:** the note said the scratch root "was destroyed" and its paths "no longer resolve", but the directory and all eleven files **still exist** in the originating environment with their original 2026-08-01 mtimes. The correction layer had replaced a true statement with a false one — the same failure mode as the P0 it was correcting, one level up. Reworded in `9eb22d327` to what is checkable: session-local and untracked, holding only inside the originating environment, **not recoverable from Git**. |
| r98 | finalization review round 4 | banked | 2026-08-04 | — (no changes; the round closed clean) | `019fcd4b-c291-7f00-934c-7a31da37b81a` (codex consult) | — | **CLEAN. The finalization review is closed and the pack is complete.** Scoped to `9eb22d327`'s two paragraphs, since rounds 2 and 3 had settled everything else. Every assertion in the reworded note was checked against the filesystem and Git rather than against the other document: 14 links to 11 unique files, all present with 2026-08-01 mtimes; **none of the 11 blobs in the Git object database and no tracked scratch filename across all refs**, supporting both "never committed" and "not recoverable from Git"; the warning still explicit enough to qualify the verbatim report's closing "remains available" at `working/hotspots.md:126`; the two paragraphs consistent; `git diff-tree` showing only the two intended files. **Finalization took four review rounds — 2 P0 + 2 P1, then 1 P0, then 1 P0, then clean — echoing step 9 exactly: after the first round, every defect was in the repair of the round before it.** Both P0s in rounds 3 and 4's surface were in the orchestrator's own correction of the previous round's P0. The transferable rule is the one this pack has now proved twice: **a repair is not a stopping condition; a clean round is.** |
| r99 | phase-5 step 1b round 6 | banked | 2026-08-04 | commit `904ed44b3` (`working/phase5/1b-r6/seat-b6.json`, `seat-c6.json`) | `019fcd7e-275a-7201-981d-cb481de3b6a8` (B6), `019fcd7e-35c2-77e0-b244-deb7f0159ec9` (C6) — codex consults | — | **Round 6 exists because the owner asked for the 15 unread cuts to be read** rather than left as recorded unsampled scope. Two seats split by lane on the standing 1b contract: **B6** lane-01-harness-core (7 items), **C6** lane-05-client + lane-07-docs-dx (8). A `coverage.cut` is a bare one-line string with no path and no evidence, so each item had to be reconstructed from the tree first; the live tree was confirmed byte-identical to the pin for `packages/`, `scripts/`, `eslint-rules/` and `docs/guides/`. Every item got a record, promote or dismiss, so the round proves each row was read. **9 promoted, 6 dismissed.** The split by lane is the interesting part: **harness 5 of 7**, **docs/DX 4 of 4**, **client 0 of 4**. Both harness dismissals were evidenced, not deferential — `[9]`'s portability claim is already scoped correctly by `docs/ai-harness.md`, and `[29]`'s two sensors already share the import-safe CLI envelope. The client seat unbundled the three multi-observation titles and dismissed each part, and dismissed `[0]` as **the same direction already declined under `CQ25-191`** rather than quietly re-proposing a recorded refusal. C6 also re-derived a measurement its orientation had understated: 24 guide files, **20** in the advertised complete table, 22 referenced anywhere in `ai-harness.md`, 2 absent entirely. |
| r100 | phase-5 step 1c round 6 | banked | 2026-08-04 | commit `904ed44b3` (`working/phase5/1b-r6/1c-decisions.json`) | `019fcd85-9707-7e90-89bf-1f1e8511a7bc` (codex consult) | — | **Pooled adjudication over all 9 candidates — 1 new leaf, 4 augmentations, 4 rejections.** `evidenceVerified` came back **true for all nine**: every cited `path:line` was opened and every count re-derived, so nothing was rejected on taste. The seat was told explicitly that a `new-leaf` ruling re-opens authoring, the acceptance gate, S0, S2/S3, the graph, the index and a step-9 round, and that this cost belongs in the worth-it call. **Attrition 5 of 9 (56%), against 59% at S3 earlier in the pack** — the wide-then-narrow design reproducing its own calibration on an independent pool. Every rejection was a **dedup** call, not a merit call: `C6-01` and `C6-02` are the two explicit halves of leaf **099**, `C6-04` is an exact duplicate of leaf **266**, and `B6-03`'s structural count was confirmed correct but its DX impact unmeasured. The four augmentations all fold into leaves that already own the same target — **115** (verify-step freshness descriptor), **126** (`hookWiring` exact-key enforcement, same validator), **084** (`backlog:lint`'s 1,393-line note grammar, same parser), **094** (the guide-table inventory, whose single-index ruling also defeats C6-03's proposed local landing page). That is `collides` — this audit's dominant cross-leaf defect — **being caught at adjudication instead of after authoring**, which is the whole reason 1c is a separate seat. The one new leaf is **B6-04**, routing `verify:logs` wrapper-marker reads through the canonical marker codec, admitted because the two parsers' duplicate-field behaviour **has already diverged**. It would take number **271**; the 096/161 holes stay permanent. No dismissal from r99 was overturned. |
| r101 | phase-5 step 2a round 6 | banked | 2026-08-04 | commits `1d9c5d8db`, `f1d5d73c7`, `def5b5741`, `bdd814f91`, `e6425aab9` | `019fcdb7-477a-7641-9e61-ac8036d44b49` (codex **work** run) | — | **Authored the five surviving round-6 outcomes**, one commit each: new leaf **271** (route `verify:logs` wrapper-marker reads through the canonical marker codec, low/S) plus augmentations of **115**, **126**, **084** and **094**. The run **re-derived every number rather than copying the specification**: 9 `backlog-lint*.ts` production modules totalling **1,393** lines, **24** guide files, **18** live `hookWiring` controls, and 4 producer / 4 checker mappings against a 4-path preflight list. It also reproduced leaf 271's warrant directly — the viewer promoted a duplicate-`LAST_TS` marker to `OK*` and displayed it as fresh while `musi_read_success_marker` rejected the same marker — which is the entire basis for the leaf existing. It honoured 1c's constraint that leaf 094 has already settled `ai-harness.md` as the single guide-table owner, dropping C6-03's proposed local landing page and carrying only the corrected measurement. `backlog:lint` moved 327 → **329**, both advisories explained in advance: leaf 271 adds the pack-wide `Status: Not started` row plus an unlisted-leaf advisory pending index regeneration. |
| r102 | phase-5 step 2b round 6 | banked | 2026-08-04 | commits `029765f86`, `c1dd6d0e2` (fix); gate at `working/phase5/1b-r6/2b-gate.json` | `019fcdc1-845e-7f81-a41e-5e9f64d8a5f1` (gate consult), `019fcdc9-5e2d-7931-a04a-f7d0ea92fb79` (codex **work** fix) | — | **Acceptance gate — 2 P0 citation defects, everything else clean.** A different seat from the author, as the contract requires. It re-derived every count, confirmed every cited command exists, independently reproduced the marker divergence, and confirmed 1c's constraints were honoured and no leaf weakened. **P0-1:** leaf 084 cited `scripts/backlog-lint-metadata.ts:22-27` for an undelimited scan those lines do not show; the extraction loop is at `:86-102` and field parsing at `:46-61`. **P0-2:** leaf 094's guide-table figures were false — `code-intel.md` **is** present at `docs/ai-harness.md:396`. **The interesting part is that the gate and the author disagreed on the count**, which is this repository's recorded doc-versus-code inversion pattern, so the fix was required to settle it **mechanically** rather than by adopting either seat's numbers: enumerate `docs/guides/*.md` from the filesystem, extract the table region by its delimiters programmatically, and set-difference both ways. Result: **24 guide files, 21 unique guides across 20 table rows, 3 table omissions, 22 referenced anywhere, 2 absent entirely**. The two seats diverged because **one row names both ratchet guides**, so "guides in table" and "rows in table" are genuinely different numbers. The leaf now carries the raw extraction and both set-differences, so the next reader checks the derivation instead of re-deriving and inverting it again. |
| r103 | phase-5 S1 + regeneration round 6 | banked | 2026-08-04 | commits `7d999f58e`, `0531997e5`, `6592f9650`; records at `working/phase5/1b-r6/s1-round6.json` | `019fcdcd-7106-7b73-9033-d40f8b153079` (enrichment consult), `019fcdd4-8d65-74d1-9117-17f96c22f796` (codex **work** apply) | — | **Enrichment produced five records and exactly one new relation, `271 → 117 rebaseOn`.** The seat **declined the two relations the dispatch pointed it at** — 271→115 and 271→126 — on the grounds that neither leaf writes the viewer, the canonical codec or the focused shell tests, and that sharing a harness area and a closing command is not a scheduling relation; it rejected 271→141 on the same basis, and recorded 271's newly exposed write targets in `targetOps` so the derived collision channels could compare them **without fabricating leaf-declared relations**. That is the correct seam: `collides` is derived by comparison, `requires`/`serialize` are declared. The apply run then proved its own work rather than reporting a passing generator: **266 S1 records byte-identical**, four changed, one added, every pre-existing `sourceSentence` verbatim and `changedRelations` accounting for all seven kept relations; edges **250 → 251** accounted for solely by `d-271-01` with none removed; retirement accounting (3 repointed / 6 dropped-internal) and the 28 directional arcs **unchanged**; index 268 → **269** rows with 271 under Harness and the **096/161 holes intact**; `--check` at zero structural errors; lint 329 → **328** exactly as predicted. `EXPECTED_LIVE_LEAF_COUNT` and `EXPECTED_S1_LEAF_COUNT` moved to 269 and 271. |
| r104 | phase-5 S3 round 6 | banked | 2026-08-04 | `working/phase5/1b-r6/s3-round6.json` (no graph change) | `019fcddb-0b1f-7890-9ccc-cbbcfdab930d` (codex consult) | — | **The one collision candidate leaf 271 surfaced — `271 ↔ 141` on `scripts/tests/test-verify-metadata.sh` — ruled `no-edge`.** The applying run was required to *report* candidates without adjudicating them, because S2/S3 are separate seats; this is that ruling. The seat was told to defer neither to the channel nor to the S1 seat that had already rejected the pair, because the two questions differ: S1 ruled on **scheduling** (need these be ordered?) while `collides` asks whether following one leaf would **silently disturb** the other, and a pair can be schedule-independent and still collide. On the substance the channel had matched a shared **filename, not a shared seam**: leaf 271 never writes that file — it *consumes* the existing three-field acceptance and duplicate-rejection contract at `:68` and `:114`, and writes its regression in `scripts/tests/test-verify-logs.sh` — while 141 extends the state-path section at `:593`. The underlying seams are distinct too: state-path derivation at `scripts/lib/verify-metadata.sh:189` versus marker decoding at `:783`. `residualRisk: null`. |
| r105 | phase-5 step 9 + docs round 6 | banked | 2026-08-04 | commits `2f1059959`, `e72d74fe1`, `a61c4a1c2`, `6be1b07b4`, `ac9cba9da` | `019fcdde-3a5a-7302-81fe-6eee3160aa86` (step-9 consult), `019fcde6-a938-7062-8126-606cf3a618a0` (codex **work** docs) | — | **Step 9 clean on every substantive check; its only two findings were stale counts.** Scoped to changed components and neighbours plus global graph checks, it independently derived **251 edges (27 S3 + 224 declared)**, 269 index rows in 8 area groups, holes intact, 28 acyclic arcs, retirements unchanged; confirmed only five S1 records differ with no banked `sourceSentence` altered; confirmed both the declared relation and the no-edge ruling; and **re-derived the guide-table figures a third time to the same 24 / 21 / 20**, which is the inversion pattern finally converging. Its two P0s were `00-index.md`'s hand-written prose and the backlog README still saying 268 leaves and 15 unread cuts. The docs run fixed those and swept the pack for every claim round 6 falsified, re-deriving each number from artifacts: **96 accepted authoring outcomes across six rounds (68 new + 28 augmentations), 203 + 68 − 2 = 269 live leaves**, and **216 of 216 eligible cuts read — the pool is now exhausted**. It correctly declined to over-claim: three of the four 1c rejections are exact duplicates (099 twice, 266 once) but `B6-03` was evidence-verified and rejected as an **unmeasured optimization**, a merit call, so the documents do not describe all four as duplicates. It also **refused to record the owner questions as settled** — reading these 15 rows exhausted this pack's pool but is not a ruling on round-limit policy or on replacing the uninformative fixed ≥3 threshold, and both remain open. Banked artifacts, `RUN-LEDGER.md` history and the generated index region were left untouched; lint held at **328**. |

### Step 1b results (closed 2026-08-03)

Eleven consults, dispatched strictly serially on the owner's instruction.
**All 327 rows the ledger marked `sampled` received a disposition** — 77 B/C
items (49 sampled cuts + 28 structured kills) and all 250 D claimants — with
zero missing, duplicate, or unassigned entries across every contract check.
All 180 located evidence entries passed a mechanical existence check
(path exists, cited line in range); no fabricated paths, the failure mode
that has bitten delegate-authored work in this pack before.

| consult | items | promoting | upheld | candidates |
|---|---|---|---|---|
| B (lanes 01/02/03/05) | 38 | 19 | 19 | 18 |
| C (lanes 04/06/07/08/09) | 39 | 20 | 19 | 20 |
| D-01…D-09 (prior-pack drops) | 250 | 14 | 236 | 11 |
| **total** | **327** | **53** | **274** | **49** |

**49 promotion candidates: 0 high, 15 medium, 34 low; 34 S / 10 M / 3 L / 2 XL.**
Categories skew to `duplication` (12), `naming` (7), `dx` (6) and
`organization` (6).

**D's verdict split is 236 full / 9 partial / 5 none.** That is 14 bad
prior-pack coverage claims in 250 — 5.6%, against the 7.9% (16 of 203) r39
measured over the authored leaves by the same reconciliation. The two
populations agreeing to within a couple of points is the strongest available
evidence that this bucket was worth auditing and that neither pass is wildly
mis-calibrated. The five `none` verdicts are the cleanest finds: the cited
record does not contain the dropped material at all (e.g. `WeaponAttackResult`
appears nowhere in the prior pack, yet CQ25-16 was cited as covering it).

**What 1c must not re-derive.** These are hints from promoters, not rulings:

- **At least 8 candidates self-report as probably already covered** — C-003
  (leaf 109) and C-015 (leaf 189) declare *exact* overlap; D-05's three and
  D-06/D-08's residuals are scheduled under sibling prior-pack records rather
  than the ref they were dropped against. They were returned unsuppressed
  because dedup is 1c's ruling; expect a meaningful merge/reject rate.
- **Two null chunks (D-03, D-09) were spot-checked, not assumed.** Both hold.
- **The `overturnsRuling` field was used loosely by C** on two candidates where
  the "ruling" is a triage dedup kill rather than a recorded refusal. Read
  those as dedup hints.
- **Several promotions exist only because a kill conceded the problem and
  rejected the remedy** (C-004, C-005, B-001, B-002). Judge the problem, not
  the sketch the original triage threw out.

**2c threshold.** The stopping rule's "≥ 3 promotions" counts *accepted*
under-triage findings **after** 1c adjudication, not these 49 raw suggestions.
On raw count a second round looks certain, but that is not the test — the
decision is 2c's, after 1c has killed the duplicates and the not-worth-its.

### Steps 1c–2b results (closed 2026-08-03)

**1c (r54) — one consult, 49 candidates, global view.** Rulings: 26 `new-leaf`,
3 `augment-existing-leaf`, 2 `merge-with-promotion`, 18 `reject` → **29 accepted
for authoring**. Authoritative grading: 0 high / 22 medium / 27 low; 33 S / 9 M /
4 L / 3 XL, and **no accepted candidate is XL**, so the freeze population gains
no PLAN companions.

The seat earned its place. Both self-declared exact overlaps died (C-003 vs leaf
109, C-015 vs leaf 189, each rejected with the covering `path:line`), and 12 of
D's 14 promotions were rejected as already covered — the promoters' own
"probably covered elsewhere" hints proved right at close to the rate they
predicted. Of the 18 rejects, 11 are current-leaf or prior-pack-slice coverage
and 5 are below the churn bar; the remaining 2 are the merges. The two D
survivors are the ones whose residual nothing schedules: D-01-001 (shared export
guidance contradicting ADR-0005) and D-01-002 (`dateTimeField`-backed mapper
boundaries).

**2a (r55) — authoring.** New leaves are **204–229**; 001–203 were not
renumbered. The 2 merges were folded into their targets' packets rather than
given numbers (B-015→B-017/leaf 215, C-017→C-016/leaf 224). `promotion-map.json`
holds the `promotionId → leaf file` join S0 needs.

**2b (r56) — acceptance gate.** 12 clean / 17 needs-fix / **0 kill** over the 29
files; 33 defects — 22 evidence, 4 prior-pack, 4 coherence, 3 packet-fidelity,
and **zero command or link defects**, the first pass in this pack where no
delegate-authored file fabricated a command. 30 corrections applied by exact
unique-match replacement.

**Orchestrator ruling — the 3 skipped corrections.** All three are the same
defect class on the three `augment-existing-leaf` hosts (025, 082, 182): the
gate proposed replacing each host leaf's `Theme · Area · Severity · Size` header
with the promotion packet's adjudicated values. **Not applied.** Those values
grade the *added* material, not the host leaf, whose scope is broader — leaf 182
is a cross-cutting M about logging policy ownership and B-011 is a server-side S
addition to it. Retitling the host would misdescribe it and corrupt the S1
records the leaf feeds. Recorded in `promotion-check.json` under
`orchestratorRulings`. A future augmentation packet should say plainly that its
grading describes the addition.

### Triage cursor

**Batch 1 COMPLETE** (2026-08-02, run r34): workflow
`wf_eda7cdca-c7e` (cluster→verify→judge→direction over lanes 01–03,
60 findings) was resumed as-is after the owner pause — the journal
showed only 16 panels remained (15 medium+), so editing the script to
skip low-severity directions would have saved a single panel; not
worth the cache risk. Results banked as
`working/triage/batch1-{candidates,verify,judgments,directions,panels,rejected}.json`:
60 candidates, 51 survivors, 9 rejected (2 verify-refuted + 7
judge-not-worth-it), 28 panel syntheses. All 60 got verify verdicts
and all 58 verified got judgments — batch 2 has NO batch-1
no-verdict agents to re-process. (Original launch constraint: Fable
window closed at 03:00, so triage started before Phase 3 — a
recorded deviation from strict phase order.)

**Batch 2 SHAPE REVISED (owner decision 2026-08-02) to cut Fable
usage** — covers lanes 04–09 + all wave-2 findings (~173) but NOT as
a batch-1-style workflow. Adopted levers (1+2+4 of the options
presented; batching-per-agent and model downgrades were NOT adopted):

1. **Judge before verify.** A compact Fable workflow does clustering
   and the severity/size/worth-it judgment first; judge rejects never
   consume a verify agent.
2. **Verification moves to codex.** Only judge-approved candidates get
   an adversarial evidence check (path:line existence, measurement
   reproduction, claim-vs-pin truth), run as codex consults via
   agent-cli — zero Fable cost. Fable reviews the codex verify
   verdicts during reconciliation rather than re-running them.
3. **Directions only for medium+ survivors.** Low-severity or small
   survivors get a one-line disposition folded into their leaf, not a
   structural-direction proposal.

Cross-batch rules unchanged: reconcile clusters by path+problem, reuse
batch-1 verdicts for unchanged candidates, re-verify merged ones, and
re-process any batch-1 no-verdict agents (r34 confirmed there are
none). Wave-2 round-2 findings that promote already-analyzed round-1
cuts get the lightest verify pass (re-confirmation, not fresh
adversarial review). Authoring runs once, after reconciliation.

**Batch 2 judge stage COMPLETE** (2026-08-02, run r35): workflow
`wf_ec1dccb5-385` (scratchpad `cq-2026-08/cq-triage-batch2-judge.workflow.js`)
banked as `working/triage/batch2-{candidates,judgments,rejected}.json`.
171 candidates (D-001..D-171) from 173 rows; 157 judge-approved (11
high / 112 medium / 34 low), 14 rejected with reasons. Cross-batch:
2 approved overlaps, both `extends` (D-118→C-035 logging-policy
vocabulary, D-170→C-038 unused entrypoint pseudo-API) — both get
full re-verification and their leaves must be planned together with
the batch-1 counterparts; D-122 was judge-rejected as subsumed by
approved C-021. The cluster stage's near-miss/dependency-edge pairs
are recorded in clusterNotes inside `batch2-candidates.json` — the
authoring phase should honor those sequencing edges. **Batch 2 verification COMPLETE** (2026-08-02, run r36): 150 of 157
survived codex verification (`working/triage/batch2-verify.json`); 7
refutations recorded there with reasons, 5 of them
already-ruled-out overlaps the cluster/judge stages missed.
**Batch 2 triage COMPLETE** (2026-08-02, run r37): refute review +
directions banked as `working/triage/batch2-directions.json`. The
refute review accepted 5 refutations and overrode 2 — D-115 and
D-121 are reinstated, both on the disposition path, and **D-121's
oneLineDisposition is amended in the banked file** (the judge
version proposed relocating successResponseSchema to a new shared
module, which the override bars per the SHARED-CLUSTER-PLAN S1
do-not-reopen ruling; authoring must use the amended text). Final
batch-2 arithmetic: 171 candidates → 157 judge-approved → 150
verify-survivors → **152 survivors** after reinstatement (78 medium+
size-M+ with full structural directions, 74 low-or-S with
oneLineDispositions). Two directionSummaries were replaced by the
direction reviewers (D-064, D-118 directionOk=false — the direction
field is authoritative). D-118 and D-170 directions were written to
compose with batch-1 C-035/C-038 (joint leaf planning recorded in
their sequencing fields). Authoring (r38) and the
existence-check/prior-pack-reconciliation pass (r39) are now COMPLETE
— all 203 survivors are authored leaves in the pack. NEXT: Phase 5,
paused for the owner.

## Narrative archive

The former chronological checkpoint follows verbatim. Read it only when reconstructing why a round or step took a particular path; it is not required to continue the work.

### Last checkpoint

Wave-2 round 2 BANKED (2026-08-02, runs r28–r30) — wave 2 is CLOSED at
the two-round cap. Round 2 added 16 findings (L05-101..102,
L06-111..122, L07-111..112) and 2 bugs (05-B25, 06-B27; handoff now
116 total). Every routed round-2 item was addressed: lane-06 promoted
12 of its 13 round-1 cuts and dismissed the 13th plus its routed
pointer with reasons; lanes 05/07 resolved all their pointers. Wave
totals: 180 wave-1 + 34 round-1 + 16 round-2 = 230 findings. Phase-4
triage batch 1 (lanes 01–03, workflow `wf_eda7cdca-c7e`) still
running — see Triage cursor. **Phase 3 COMPLETE** (2026-08-02): the
critic's FAIL (r31) was remediated by the authorized micro round —
r32 lane-02 (2 findings, 2 bugs) and r33 lane-01 (1 finding) banked
in `working/wave-2/`; corpus now 233 findings, 118 handoff bugs.
Triage batch 1 COMPLETE and banked (2026-08-02, r34):
`working/triage/batch1-*.json` — 51 survivors, 9 rejected, 28
panels; no batch-1 no-verdict agents remain. Triage batch 2 judge
stage COMPLETE and banked (2026-08-02, r35):
`working/triage/batch2-*.json` — 157 approved of 171 candidates, all
verdicts present, 14 recorded rejections. Batch-2 verification COMPLETE and
banked (2026-08-02, r36): `working/triage/batch2-verify.json` — 150
of 157 survived, 7 refuted (5 already-ruled-out, 2 overreads), 38
survivors with minor evidence-defect notes. **Triage batch 2
COMPLETE and banked (2026-08-02, r37)**:
`working/triage/batch2-directions.json` — 5 refutations accepted, 2
overridden (D-115, D-121 reinstated on the disposition path; D-121's
disposition amended, see r37), 78/78 directions (D-004/D-147 re-run
after placeholder fields), final count 152 batch-2 survivors. Phase
4 triage is now COMPLETE for both batches: 51 + 152 = 203 leaves to
author. **Phase-4 authoring COMPLETE and banked (2026-08-02, r38)**:
203 leaves + 3 XL plan companions (`107/108/109-PLAN.md`) are in the
pack — 143 from the Fable workflow before Fable 5 credits ran out
(`7fc7aab51`), the remaining 60 from 15 codex consults
(`77d6f1023`). **Existence-check + live prior-pack reconciliation
COMPLETE and banked (2026-08-02, r39)**: 21 codex consults over all
206 files, `working/leafcheck-results.json` — 115 clean / 91
needs-fix / 0 kill, 199 of 200 corrections applied mechanically (the
1 skip fixed by hand), 138 defects total (135 evidence, 1 command, 2
link), and all 16 prior-pack-flagged leaves (14 partially-landed, 2
scope-ruled-out) narrowed in place rather than dropped, so the pack
still holds 203 leaves. **Fable 5 access is gone — every remaining
phase must be delegated to codex** (consults, subagent fanout
explicitly requested where useful); the orchestrator writes files
from returned blocks. Next actions are all Phase 5: final-review
consults (no cross-model panel — see Phase 5), then finalization
(`bugs-handoff.md`→`BUGS-HANDOFF.md`,
`dedup-corpus.md`→`DEDUP-CORPUS.md`, pack `CONSTRAINTS.md`,
`00-index.md`, `AUDIT-SUMMARY.md`), `working/` pruning, and the
merge discussion. OWNER
INSTRUCTION (2026-08-02): PAUSE at Phase 5 — after the authoring
output and its existence-check and prior-pack-reconciliation passes
are banked and committed, stop and report to the owner before
dispatching the final-review consults. (2026-08-03: the owner removed the
cross-model panel from Phase 5; the pause itself stands.)

**Phase-5 design revised 2026-08-03 (r40), nothing dispatched.** The
pack-level review is now a reduced-artifact funnel rather than one
whole-pack consult — see [Phase 5](#phase-5--final-review-and-stopping-rules)
for the full design, record shapes, and relation vocabulary. Four things a
resuming session must not re-derive: (1) the reject audits run **before**
the dedup/sequencing freeze, not after; (2) the population is **206 files**,
PLAN companions included; (3) S0 joins triage provenance from
`working/triage/batch{1,2}-*.json`, without which the batch-1 × batch-2
seam cannot be weighted; (4) two pack defects are already confirmed and are
pre-seeded S2 input, not findings to rediscover — `044`/`050` and
`056`/`042`, both contradicted independence claims.

**Step 1 rescoped 2026-08-03 (owner decision).** The pile was measured, not
taken from the plan's description: 248 `coverage.cut` + 250
`droppedAsPriorPackDuplicate` + 28 triage rejections/refutations = **526
raw items**, roughly twice what this document previously claimed. The 250
prior-pack drops had never been in reject-audit scope; they are now, as a
dedicated third consult D, because r39 found 16 bad prior-pack coverage
calls among the authored leaves and these 250 were never re-checked against
the live prior pack at all.

**Steps 1–2 specified 2026-08-03 (r41).** They had been a bucket table and a
one-line table row while S0–S3 carried record shapes, chunk sizes and hazard
lists. They now carry: a **1a source ledger** (script) that classifies every
raw record's lineage and holds the sampling budget — the raw 248 includes
rows triage already resolved, so it is not a sampling frame until 1a runs; a
**1c pooled adjudication** seat that is the only place the promotion pool is
globally visible and is where cross-consult duplicates die before they are
authored; and **2a/2b/2c** authoring, an acceptance gate run by a different
consult than authored the leaf, and an explicit second-round re-entry path.
Four things a resuming session must not re-derive: the pile is 526 raw and
B/C is 276 of it; promoters emit *hints* while 1c holds authority; new
leaves number from 204 and never renumber 001–203; and the S0 freeze
population is `206 + new leaves + new PLAN companions`, not `206 + N`.

**Owner decision 2026-08-03: codex does the remaining work, authoring
included.** Fable was originally reserved for judging, direction and
authoring (decisions 4 and 7), but Phase-4 orchestration exhausted the Fable
budget before authoring finished. Those clauses are formally superseded —
see the amendment under [Owner decisions](#owner-decisions-recorded-2026-08-01--do-not-re-litigate).
Role separation is preserved: promoter, judge, author and checker are always
distinct dispatches.

**Step 1a DONE 2026-08-03 (r42, commit `bca72c7dc`).** The ledger, its
generator and a README live in `working/phase5/`. What a resuming session
needs from it: the B/C workload is **77 items** (49 sampled cuts + 28
structured kills), not 276 — split **B = lanes 01/02/03/05**, **C = lanes
04/06/07/08/09**; D is **9 chunks** by resolved live source document, 4 live;
and the 166 `not-sampled` eligible cuts are the draw for any second round
(2c), never a re-read of the first sample.

**Step 1b DONE 2026-08-03 (r43–r53).** `priorPackReviewSha` is recorded in the
[Pins](#pins) table (`948169235`, commit `d727772e9`). Eleven consults ran
**strictly serially** on the owner's instruction — B, then C, then D-01…D-09,
each validated, existence-checked, banked and committed before the next
dispatched. No OOM, no retries, no failed runs; every run returned
`worktree: best-effort-clean`. Full results and the 1c handoff are in
[Step 1b results](#step-1b-results-closed-2026-08-03).

**Steps 1c, 2a and 2b DONE 2026-08-03 (r54–r56).** See
[Steps 1c–2b results](#steps-1c2b-results-closed-2026-08-03). The pack now holds
**232 files** — 229 leaves plus the 3 PLAN companions. Three things a resuming
session must not re-derive: no accepted promotion is XL, so the S0 freeze
population is `206 + 26 = 232` with no new PLAN companions; the merged
candidates B-015 and C-017 have no numbers of their own and live inside leaves
215 and 224; and the three augmented hosts (025, 082, 182) deliberately keep
their own headers against the gate's proposed rewrite.

**Round-2 step 1b DONE 2026-08-03 (r57–r59).** Three consults, dispatched
strictly serially: B (21 unsampled cuts, lanes 01/02/03/05), C (20 unsampled
cuts, lanes 04/06/07/08/09) and a fresh **second opinion** over D-01's 30
prior-pack drop claimants — the only D partition whose round-1 promotions
survived adjudication. Every contract passed (71/71 dispositions, no dupes,
no extras, no unreferenced candidates) and all 105 located evidence entries
passed the mechanical existence check. **23 promotion candidates**
(`R2B-001..011`, `R2C-001..008`, `R2D01-001..004`) — 10 medium / 13 low, sizes
2 L / 6 M / 15 S — banked as `working/phase5/reject-audit-r2-{b,c,d-01}.json`.

Two results a resuming session should not re-derive. First, the round-2 yield
(23 of 71, 32%) is *higher* than round 1's (49 of 327, 15%): the round-1
sampler's rank ordering skimmed the highest-ranked cuts first, so the residual
pool is not obviously thinner material — it is material nobody had looked at.
Second, the D-01 second seat returned **4** promotions where round 1 returned 2,
which is the empirical case for the re-open rule rather than an argument that
round 1 was sloppy; two of the four self-declare overlap with leaves 228/229,
authored from this same partition in round 1, so 1c will likely fold them.

**Round-2 step 1c DONE 2026-08-03 (r60).** 23 candidates adjudicated against
the 232-file pack: **18 accepted** (16 new leaves + augmentations of 107 and
189), 5 rejected, no merges, no XL. Banked as
`working/phase5/adjudication-r2.json`. The result worth carrying: **the D-01
second opinion produced four promotions and adjudication rejected all four** —
two as fully covered by leaves 228/229 (authored from that same partition in
round 1) and two as reviving scope CQ25-115 measured and deliberately cut. The
re-open rule earned its keep by proving the partition is now exhausted, not by
adding to it.

**Round-2 step 2a DONE 2026-08-03 (r61).** The 18 accepted rulings are authored:
16 new leaves **230–245** plus in-place augmentations of 107 and 189. The pack
now holds **248 files** — 245 leaves and the 3 PLAN companions. The round-1
header dispute is closed by construction rather than by ruling: augment packets
now say the packet grades the addition and not the host leaf, and
`apply-2a-blocks.mjs` rejects an augmentation that rewrites the host's
`Theme · Area · Severity · Size` line.

**Round-2 steps 2b and 2c DONE 2026-08-03 (r62–r63).** The gate cleared 10 of
18 files, fixed 8, killed none, and found no broken link and no prior-pack
defect; 17 of 18 defects applied mechanically and the 18th — a packet constraint
requiring `107-PLAN.md` to move in lockstep with leaf 107's augmentation — was
closed by a separate authoring consult. Banked as
`working/phase5/promotion-check-r2.json`. 2c then fired again: 18 accepted ≥ 3.

**Round-3 step 1b DONE 2026-08-03 (r64–r65).** Two serial consults over 38 more
unsampled cuts; **no D partition re-opened**, because round 2's D-01 second
opinion produced 4 promotions and 1c rejected all 4, leaving no partition with
an accepted promotion. Contracts passed (38/38) and all 48 located evidence
entries exist. **13 candidates** (`R3B-001..007`, six `R3C-*`) — 4 medium /
9 low, 5 M / 8 S — banked as `working/phase5/reject-audit-r3-{b,c}.json`. The
funnel is visibly thinning: B's yield fell to 39% from 52% on the same lanes,
and every one of C's six candidates arrives naming a specific near leaf it must
argue past. 88 eligible cuts remain unsampled.

**Round-3 step 1c DONE 2026-08-03 (r66).** 13 candidates adjudicated against the
248-file pack: **10 accepted** (7 new leaves + augmentations of 053, 090 and
184), 3 rejected, no merges, and — for the first time — **no L or XL at all**.
Banked as `working/phase5/adjudication-r3.json`. Acceptance held at 77% even
though every candidate arrived self-declaring a near leaf, so the pack's size is
making promoters argue residuals rather than suppressing them.

**Round-3 step 2a DONE 2026-08-03 (r67).** 7 new leaves **246–252** plus
augmentations of 053, 090 and 184; the pack holds **255 files**.

**Round-3 steps 2b and 2c DONE 2026-08-03 (r68).** 7 of 10 clean, 3 fixed, none
killed, 5 defects total and every one applied — the gate's defect density has
fallen monotonically across the three rounds (33 defects / 29 files → 18 / 18 →
5 / 10). Banked as `working/phase5/promotion-check-r3.json`. 2c fired a third
time: 10 accepted ≥ 3.

**Round-4 step 1b DONE 2026-08-03 (r69–r70).** Two serial consults over 37 more
unsampled cuts, no D partition re-opened. Contracts passed (37/37) and all 77
located evidence entries exist. **18 candidates** (13 from B, 5 from C) — 4
medium / 14 low, 4 M / 14 S — banked as
`working/phase5/reject-audit-r4-{b,c}.json`. **50 eligible cuts now remain
unsampled**, all of them in the lanes the sampler ranked lowest.

Read the yield honestly: B jumped back to 54% after three rounds of decline, but
that is because this draw finally reached lane 05's long tail (57 raw cuts, the
largest lane), not because the pile is richer than round 3 found. C is the
signal that matters — only 13 rows were left to draw there at all, and two of
its five promotions are docs findings rather than code.

**Round-4 step 1c DONE 2026-08-03 (r71).** **17 of 18 accepted** — 14 new leaves
**253–266** plus augmentations of 004, 033 and 189 — the highest acceptance rate
of any round, and the first two `high` severities of the whole phase. Both highs
are false-comment findings: a header claiming a transactional guarantee the code
does not provide. That is the depth-4 discovery worth noting — the deep pile
yields not structural work (0 L and 0 XL for three rounds running) but small,
sharp correctness-of-documentation defects that only a careful reader finds.

**Round-4 step 2a DONE 2026-08-03 (r72).** 14 new leaves **253–266** plus
augmentations of 004, 033 and 189; the pack holds **269 files**. Leaf 189 is now
the first leaf augmented twice (round 2's `R2C-005` and round 4's `R4C-004`).

**Round-4 steps 2b and 2c DONE 2026-08-03 (r73).** 8 of 17 clean, 9 fixed, none
killed, all 16 defects applied; no command, link, prior-pack or packet-fidelity
defect. Both `high` findings were verified by opening the quoted comments rather
than trusted, and twice-augmented leaf 189 came back clean. Banked as
`working/phase5/promotion-check-r4.json`. 2c fired a fourth time: 17 accepted.

**Round-5 step 1b DONE 2026-08-03 (r74–r75).** Two serial consults over the 36
remaining drawable cuts. Contracts passed (36/36) and all 79 located evidence
entries exist. **21 candidates**, and — for the first time — **every single one
is S**. Banked as `working/phase5/reject-audit-r5-{b,c}.json`. **15 eligible
cuts remain**, the tail the sampler ranked lowest.

Two exhaustion signals landed together. The material is now uniformly small
(dead CLI verbs, an always-false serialization field, state nothing reads, a
legacy orphan with a stale test), and `R5C-001` is the first **cross-round
duplicate** the funnel has produced: the same cross-worktree documentation gap
round 4 raised as `R4C-002` and already authored as leaf **265**. The promoter
flagged it and left the ruling to 1c, as the step requires.

**Round-5 step 1c DONE 2026-08-03 (r76).** 17 of 21 accepted, every ruling S,
none high. The seat **consolidated instead of proliferating** — 13 findings
folded into existing leaves, 2 merged inside the pool, only **4 new leaves
(267–270)** — which is why the pack ends near 270 rather than 281. `R5C-001` was
rejected as fully covered by leaf 265, and that first exact cross-round
resurfacing is recorded as an exhaustion signal. Banked as
`working/phase5/adjudication-r5.json`.

**Round-5 step 2a DONE 2026-08-03 (r77).** 4 new leaves **267–270** and 13
in-place augmentations; the pack holds **273 files**.

**Round-5 steps 2b and 2c DONE 2026-08-03 (r78) — the funnel is closed.** 8 of
17 clean, 9 fixed, none killed; 26 of 27 defects applied and 1 skipped by
orchestrator ruling. The augmentation-heavy shape made the `HEAD~1` predecessor
comparison the main lens and it caught two dropped-or-falsified predecessor
claims that no citation check would have found. Banked as
`working/phase5/promotion-check-r5.json`.

**2c closes the reject funnel.** Five rounds ran (29, 18, 10, 17, 17 accepted =
**91 accepted promotions**). It closes not on the numeric trigger — which fired
every time and, at a threshold of 3, always would have — but because **only 15
eligible cuts remain, below a drawable round**, and because round 5 produced
the funnel's first exact cross-round duplicate. The pool is exhausted.

**Final pack shape: 273 files** — 270 leaves (001–203 from Phase 4, 204–270 from
this funnel) plus the three PLAN companions. This is the **S0 freeze
population**.

**Step 3 (S0) DONE 2026-08-03 (r79).** `working/phase5/build-s0.mjs` +
`s0-records.json`, with a `--check` mode that proves its own output. 7,798 path
citations tagged by section, 339 resolved / 68 ambiguous intra-pack references,
4 irreducibly ambiguous citations recorded against the frozen pack.

#### S0 provenance note — the Phase-4 candidate join is unrecoverable

S0 recorded two `joinGaps[]` instead of guessing, and the first one has design
consequences the plan did not anticipate.

- **`phase4-candidate-to-leaf`.** The triage artifacts carry candidate and
  member-finding provenance, but **nothing in the repo maps a candidate to the
  leaf it became** for leaves 001–203. The Phase-4 per-leaf author packets
  (r38) were built in a scratchpad and never committed, so that mapping died
  with them. Two reconstruction routes were tested and both failed at the bar
  this pack holds itself to: **title similarity** (authors rewrote titles —
  only 5 of 203 leaves exceed 0.8 Jaccard against any candidate, 179 fall below
  0.5) and **evidence-path overlap** against the member findings' cited paths
  (only 34 of 203 clear a 0.5-overlap-with-0.2-margin bar). A 17% partial join
  was deliberately *not* used: it would bias S2 toward exactly the leaves that
  happen to be joinable. `origin` is null for 001–203 and says so.
- **`cluster-notes-to-expected-relations`.** `clusterNotes` is prose, not data.
  Distilling `triageExpectedRelations[]` from it needs judgment, so S0 carries
  the notes verbatim and leaves the distillation to a consult.

**Consequences, to apply and not re-derive:**

1. **S2's batch-1 × batch-2 seam weighting cannot run as designed** for
   001–203, and no amount of later work recovers it. S2 keeps every *channel*
   it had — shared paths, the lower-weight evidence-path index, and the S1
   `problemFingerprint`, which the plan already names as "the channel for
   duplicates that share zero paths" — but loses the seam *prior*. Expect
   slightly lower recall on cross-batch near-duplicates among the Phase-4
   leaves and say so in the final summary rather than implying full coverage.
   Leaves 204–270 are unaffected: their provenance is exact.
2. **`triageExpectedRelations[]` needs a small distillation consult** over the
   two `clusterNotes` strings before S2, or S2 proceeds without it. Either is
   acceptable; distilling is cheap and the notes name real near-miss pairs the
   cluster stage deliberately kept separate, so it is worth doing.
3. **Harness lesson for future packs (this repo is a public
   harness-engineering reference):** an authoring step's input packets are
   provenance. Commit them, or emit a `packet → output` map alongside the
   outputs. Everything else in this pack is reproducible from the repo; this
   one join is not, purely because an intermediate artifact was treated as
   disposable.

**Step 4 (S1) DONE 2026-08-04 (r80).** All 270 leaves enriched in 27 chunks,
zero validation errors, banked as `working/phase5/s1-records.json`.

**Amendment to step 5, forced by S1's size.** The plan estimated the merged S1
output at ~25k tokens and therefore assumed S2 could hold every record plus the
candidate lists in one context. **It is ~807 KB, roughly 200k tokens** — the
enrichment seats wrote much denser records than the estimate assumed, which is
good data and a bad fit. Step 5 therefore emits **two** artifacts, not one:

1. `s2-channels.json` — the candidate pairs, each tagged by originating channel
   and carrying the specific evidence that nominated it (the shared paths, the
   converging/deleting op pair, the contradicted independence claim), so a pair
   can be judged without re-reading both full records.
2. `s2-digest.md` — a compact block per leaf (title, header fields,
   `problemFingerprint`, a `targetOps` summary, declared relations) small enough
   that **all 270 fit one context alongside the pairs**. S2 reads the digest and
   the pairs globally, and opens the full S1 record or the leaf itself only for
   pairs it is actually ruling on.

This keeps S2's defining property — one seat seeing everything at once — which
chunking S2 would destroy.

**Also note for step 5:** channel 6 (`triageExpectedRelations` and
`batch1Overlap` from provenance) **cannot fire for leaves 001–203** and the
lane-08 × lanes-01/02/03 seam cannot be weighted, because the Phase-4
candidate→leaf join is unrecoverable (r79). Channel 6 still fires for 204–270.
The script should emit the channel with an explicit coverage note rather than
silently producing few pairs.

**Step 5 DONE 2026-08-04 (r81).** 2,648 fully-evidenced candidate pairs across
eight channels, plus a ~50k-token digest. The plan's path-channel scale
prediction held to within ~8–11% on every band.

**Step 6 (S2) DONE 2026-08-04 (r82).** **61 nominations from 2,648 pairs** — 1
duplicate, 1 subsumes, **44 collides**, 15 contradicts — over **24 connected
components covering 77 files**. Banked as `working/phase5/s2-nominations.json`;
the S3 assignment is built at `working/phase5/s3/assignments.json`.

The headline for the final summary: the pack's dominant cross-leaf defect is
**`collides`** — two leaves touching the same target with **no declared relation
between them**, so an implementer following one would silently conflict with the
other. That is a different failure from the redundancy this phase was designed
to hunt, and it is exactly what a many-authors-one-slice-each process produces.

**Step 8 is DONE (r86).** The S3 remedies are
applied (r84, r85): two merges landed, 32 relation edges recorded, and 12
contradicted independence claims removed. The pack stands at **268 leaves** with
deliberate holes at 096 and 161.

Step 8 builds `working/phase5/edge-graph.json` — the pack's relations *after*
fixes, unioning S3's adjudicated non-`distinct` rulings with the leaf-declared
relations in `s1-records.json`, S3 winning where both cover a pair — and then
regenerates `00-index.md` from it. That index is still the Phase-0 skeleton
reading "Leaves: None yet", which is what `backlog:lint` has been warning about
since Phase 1; step 8 is where those warnings should finally clear. The index is
a scheduling document in the 2026-07-25 format, not a file listing: 268 leaves
need grouping, and the table must carry each leaf's **sequencing edges**, since
an index that omits them is precisely the failure this step was scheduled to
prevent. No "Next up" priority call may be invented — the owner has not made one.

**Step 9 has run two rounds (r87, r89) and both fix rounds have landed (r88,
r89).** Round 1 found 1 P0 and 13 P1; round 2 found no P0 and two P1, **both of
them defects the round-1 fix pass introduced or missed** rather than defects in
the analysis. That is the pattern worth naming: at this stage the pack's
remaining risk is in the repairs, not in the findings.

**Step 9 is CLOSED (r87–r91).** Four rounds: 1 P0 + 13 P1, then 2 P1, then 1 P1,
then **clean**. After round 1, every defect found was in the *repair* of the
round before it and none in the analysis. Later review confirmed the P0 repair
but caught a corrupted retirement summary, a missed independence claim, and
two inert `--check` invariants introduced or missed during repair. Ending on a
clean round is what caught those repair defects. Say so in `AUDIT-SUMMARY.md`;
it is the most transferable thing this phase learned.

**Next action: finalization.** Nothing analytical remains. Promote
`bugs-handoff.md` → `BUGS-HANDOFF.md` and `dedup-corpus.md` → `DEDUP-CORPUS.md`,
write `CONSTRAINTS.md` and `AUDIT-SUMMARY.md`, and prune `working/` — keeping the
artifacts later readers need to check the audit's own claims, not everything.

**The 15 unread cuts should be recorded in `CONSTRAINTS.md` at finalization**,
with the ledger rows that name them, so the pack states plainly what it did not
read rather than implying exhaustive coverage.

*(Recorded when round 5 was dispatched:)* **round 5 runs the cut pool to
exhaustion.** Four rounds have
each fired the trigger (29, 18, 10, 17 accepted) and **50 eligible cuts remain
unsampled**, with no prior-pack partition qualifying for a re-open. Round 5
draws the bulk of the remainder and a small round 6 finishes it, after which the
stopping rule terminates for the only reason that is not a judgment call: there
is nothing left to draw. That is the shortest path to a defensible freeze, so it
is the one being taken; **stopping early is the option that would need the owner
first**, because it means recording material as knowingly unread.

**One observation for the owner, about the rule rather than this pack.** By
round 4 "the trigger fired again" had stopped carrying information: a threshold
of 3 *accepted* promotions cannot terminate a pool of 37 unread cuts, because a
draw that size will essentially always yield 3. The rule terminated here only
because the pool is finite. A future pack with a larger reject pile wants a rate
rather than a count — stop when accepted-per-cut-read falls below some level, or
when a round accepts fewer than N — and that is a cheap edit to make once, in
the plan template, rather than a decision to re-litigate per pack.

Everything downstream — S0 freeze, S1 enrichment, S2 nomination, S3, index
regeneration, finalization — is unblocked as soon as the cut pool is empty.

**The round-limit question still stands for the owner** (see below); it does not
block round 4, but it does decide whether there is a round 5 and whether the
remainder is recorded as knowingly unsampled.

**A question for the owner at round-3 2c, not for the next agent to settle
alone.** The rule as written re-fires on ≥ 3 accepted promotions, and on current
evidence round 3 will clear it. But the two exhaustion signals now point in
opposite directions: the *prior-pack* channel is done (a fresh second opinion
found nothing adjudication would accept), while the *cut* channel keeps
yielding because 88 rows have simply never been read by anyone. Mechanically
applied, the rule runs until the cut pool empties — roughly two more rounds. The
choice is whether that is the intent (the pool is finite and the yield is real)
or whether Phase 5 should stop at a fixed round count and leave the remainder
recorded as knowingly unsampled. **S0 does not freeze until this closes.**
