# Audit summary — lenses, results, and coverage limits

Status: Final audit record
Created: 2026-08-04

This pack is a reviewed proposal corpus and scheduling map at evidence pin
`ebf096580b31f604861fadb3d4cbd4079da4f017`. It is not an exhaustive proof that
unlisted code is clean, and it does not select an implementation priority.

## What the audit looked for

Readers applied maintainability, readability, organization/layout, idiom,
naming, duplication, layering, dead-weight, hack/unusual-construct,
new-contributor-friendliness, DX, and useful-feature-opportunity lenses.
Comment findings were limited to misleading or drifted comments; the prior
pack's stylistic comment archaeology was not repeated. Harness work also used
the stated copyability question: whether an outside repository could adopt the
piece with at most one file of Musi-specific coupling. These are the lenses in
[ORCHESTRATION.md § Deliverable](./ORCHESTRATION.md#deliverable), not categories
inferred from the resulting leaves.

Per owner decision 2, the re-sweep gave extra weight to areas the 2026-07-25
audit had not read: `scripts/drift-ai/` module bodies,
`scripts/codemods/` implementations, `harness.controls.json` internals, most of
`docs/`, and code changed since the prior audit pin. `drift:ai` supplied hotspot
signals but did not make its own implementation a privileged target. See
[ORCHESTRATION.md § Owner decisions](./ORCHESTRATION.md#owner-decisions-recorded-2026-08-01--do-not-re-litigate),
[hotspots.md](./working/hotspots.md), and the lane
[addenda](./working/addenda/).

## Scale and reduction

- Wave 1 used nine ownership lanes and banked 180 findings. The bounded Wave 2
  top-ups and completeness-critic remediation added 53, bringing the banked
  total to 233. The per-run counts are in
  [RUN-LEDGER.md r16–r33](./RUN-LEDGER.md#runs), and the phase totals are in
  [ORCHESTRATION.md § Phases](./ORCHESTRATION.md#phases).
- Phase 4 reduced those findings through separate cluster, verify, judge,
  direction, and author seats. Batch 1 produced 51 survivors; batch 2 produced
  152, yielding 203 leaves plus the three companions
  [107-PLAN.md](./107-PLAN.md), [108-PLAN.md](./108-PLAN.md), and
  [109-PLAN.md](./109-PLAN.md). See
  [RUN-LEDGER.md r34–r38](./RUN-LEDGER.md#runs).
- The first five Phase-5 reject-audit rounds produced 91 accepted authoring
  outcomes: **67 new leaves and 24 in-place augmentations**. Thus 203 + 67
  became the original S0/S1 freeze of 270 leaves. The round-by-round decisions
  and maps are retained in
  [adjudication.json](./working/phase5/adjudication.json),
  [adjudication-r2.json](./working/phase5/adjudication-r2.json),
  [adjudication-r3.json](./working/phase5/adjudication-r3.json),
  [adjudication-r4.json](./working/phase5/adjudication-r4.json),
  [adjudication-r5.json](./working/phase5/adjudication-r5.json), and the
  corresponding `promotion-map*.json` artifacts; the arithmetic is narrated in
  [RUN-LEDGER.md r54–r78](./RUN-LEDGER.md#runs).
- After the pack was declared complete, the owner requested a sixth round over
  the 15 remaining eligible cuts. Its 9 promoted candidates became **1 new
  leaf and 4 in-place augmentations**, with 4 rejected at pooled adjudication;
  the other 6 cuts were dismissed at the reading seats. Across all six rounds,
  the accepted authoring total is therefore **96 outcomes: 68 new leaves and
  28 augmentations**. See the [round-6 artifacts](./working/phase5/1b-r6/) and
  [RUN-LEDGER.md r99–r100](./RUN-LEDGER.md#runs).
- S3 merged 096 into 198 and 161 into 142, while round 6 added leaf 271. The
  complete arithmetic is therefore **203 + 68 - 2 = 269 live leaves**. The
  numbering holes are permanent. Round-6 enrichment also added the declared
  `271 → 117 rebaseOn` relation, taking the regenerated graph from **250 to 251
  edges**. See
  [s3-adjudication.json](./working/phase5/s3-adjudication.json) and
  [edge-graph.json](./working/phase5/edge-graph.json).

## Material limit: Phase-4 provenance was lost

The candidate-to-leaf join for leaves 001–203 is **unrecoverable**. Their
per-leaf author packets were never committed. Title similarity and
evidence-path overlap could reconstruct only a biased 17% partial join, below
the pack's acceptance bar, so S0 correctly recorded null origins instead of
inventing provenance. The prose `clusterNotes` also could not mechanically
yield `triageExpectedRelations`. The loss and failed reconstruction are
recorded in [s0-records.json](./working/phase5/s0-records.json) and
[ORCHESTRATION.md § S0 provenance note](./ORCHESTRATION.md#s0-provenance-note--the-phase-4-candidate-join-is-unrecoverable).

This limits the result: S2 ran without the intended batch-1 × batch-2 seam
prior for leaves 001–203. Shared-path, lower-weight evidence-path, lexical, and
`problemFingerprint` channels still operated, but recall is slightly lower for
zero-path cross-batch near-duplicates. Leaves 204–270 retain exact reject-audit
provenance through the promotion maps, and leaf 271 retains its exact round-6
provenance. The missing packets cannot be repaired by a later reader; future
audits should commit author packets or a packet-to-output map.

## What the global review found

S2 nominated 61 relations from 2,648 candidate pairs: 44 `collides`, 15
`contradicts`, one `duplicate`, and one `subsumes`. The dominant cross-leaf
defect was therefore **collision, not redundancy**: two leaves touched the same
target with different intent but declared no relation, so implementing one
could silently disturb the other. That is the characteristic failure of a
many-authors/one-slice-each process. See
[s2-nominations.json](./working/phase5/s2-nominations.json) and
[RUN-LEDGER.md r82](./RUN-LEDGER.md#runs).

S3 then read full text by connected component and overturned **36 of S2's 61
nominations (59%)**. This is the two-seat design working as intended: nominate
widely on cheap global evidence, then rule narrowly on full text. It is also a
hard warning for future audits: nomination alone is not an actionable ruling.
S3's final remedies were 17 add-relation components carrying 32 edges, two
merges, five no-actions, and no scope-narrowing remedy; it also found one edge
that S2 had not nominated. See
[s3-adjudication.json](./working/phase5/s3-adjudication.json) and
[RUN-LEDGER.md r83](./RUN-LEDGER.md#runs).

Round 6 is the only part of the audit independently re-run after the pack had
been declared complete. Its two reading seats reconstructed all 15 remaining
eligible cuts: 9 survived and all 9 returned `evidenceVerified: true` at pooled
adjudication. The material was mostly already covered. Four candidates folded
into leaves 084, 094, 115, and 126, which already owned their targets; two more
were explicit halves of leaf 099; and one exactly duplicated leaf 266. The
fourth formal rejection confirmed the structural count but declined an
unmeasured local subprocess optimization. No candidate was rejected because
its cited evidence failed. The sole new scheduling unit was leaf 271; S3 ruled
its only collision candidate with 141 a no-edge, while its explicit relation to
117 became the graph's 251st edge. See the
[round-6 seats, adjudication, enrichment, and S3 ruling](./working/phase5/1b-r6/)
and [RUN-LEDGER.md r99–r100](./RUN-LEDGER.md#runs).

## The clean-round stopping rule mattered

Step 9 took four rounds: **1 P0 + 13 P1, then 2 P1, then 1 P1, then clean**.
After round 1, every defect found was in the repair of the previous round, not
in the analysis. Later review confirmed the P0 repair but caught a corrupted
retirement summary, a missed independence claim, and two inert `--check`
invariants introduced or missed during repair. Requiring a clean review round
caught those repair defects. The claims and review sequence are retained in
[fix-claims.md](./working/phase5/fix-claims.md),
[build-edge-graph.mjs](./working/phase5/build-edge-graph.mjs), and
[RUN-LEDGER.md r87–r91](./RUN-LEDGER.md#runs).

This is the most transferable result of Phase 5: repairing a reviewed artifact
creates a new artifact, and that repair needs its own review. Deterministic
`--check` output establishes repeatability only when its invariants are
independently derived and capable of failing.

Round 6 repeated that pattern after reopening the closed pack. Its acceptance
gate found two P0 citation defects, both repaired before regeneration. The
subsequent step-9 re-review was clean on every substantive check and found only
the stale reader-facing counts corrected in this update.

## What was not covered

[CONSTRAINTS.md](./CONSTRAINTS.md) is the authoritative register. The finite
eligible cut pool is now exhausted: the source ledger records 216 total
eligible cuts and 201 read through round 5, and the round-6 seats substantively
read the remaining 15, for **216 of 216 read**. This is a real coverage
improvement, not permission to call the audit exhaustive.

The material limits that round 6 could not change remain. The Phase-4
candidate-to-leaf provenance loss still lowers recall for zero-path cross-batch
near-duplicates, and the deliberately excluded surfaces below remain skipped,
not clean. Bug and security review remain separate scopes, stable-numbering
rulings remain in force, and both owner-facing process questions remain open.

The banked lane records add these sampling limits:

- 62 lower-signal client component files were inventoried and pattern-scanned
  but not semantically opened beyond matches
  ([lane-06.json](./working/wave-1/lane-06.json)).
- Generated class-feature bodies and some seed JSON interiors were sampled,
  not read exhaustively; SRD/DMG numeric correctness was excluded
  ([lane-03.json](./working/wave-1/lane-03.json),
  [lane-04.json](./working/wave-1/lane-04.json)).
- Most migration SQL bodies were inventoried rather than read linearly, and
  large generated-doc, skill/reference, and shell-policy bodies were selected
  by targeted searches rather than exhaustively read
  ([lane-08.json](./working/wave-1/lane-08.json)).
- Sixty-nine codemod fixture source cases were not read; their descriptors were
  read and source bodies were sampled
  ([lane-09.json](./working/wave-1/lane-09.json)).
- Wave-2 work was routed top-up work, not another exhaustive sweep. Its lane
  records explicitly preserve the lower-signal and unrelated bodies that were
  not semantically reopened ([working/wave-2/](./working/wave-2/)).
- Audit lanes did not run tests, builds, formatters, or mutation suites; their
  dispatch was evidence-reading work. That limitation is repeated in the
  `coverage.skipped` arrays of the banked wave files.

Phase 5 itself was deliberately limited to cross-leaf duplication and
sequencing coherence. It did not re-grade severity/size consistency or repeat
copyability review across leaves; that cut is recorded in
[ORCHESTRATION.md § Phase 5](./ORCHESTRATION.md#phase-5--final-review-and-stopping-rules).

## Retained evidence and pruning

Finalization reduced `working/` from 13,477,827 bytes / 218 files to
12,825,300 bytes / 197 files. The modest reduction is deliberate: the run
ledger cites much of the large material directly, and the retained Phase-5
packets preserve the exact author provenance whose absence caused the S0 limit
for leaves 001–203.

Promoted, not discarded:

- `working/bugs-handoff.md` → [BUGS-HANDOFF.md](./BUGS-HANDOFF.md); and
- `working/dedup-corpus.md` → [DEDUP-CORPUS.md](./DEDUP-CORPUS.md).

Dropped (21 files, 652,527 bytes):

- `working/phase5/1b-r2/`, `1b-r3/`, `1b-r4/`, and `1b-r5/` — 13 derived
  `items-*.md` / `leaf-titles.md` dispatch bundles. The kept source ledger,
  reject-audit JSON, and adjudications carry both their inputs and conclusions.
- `working/phase5/1c/`, `1c-r3/`, `1c-r4/`, and `1c-r5/` — four derived
  `leaf-index.md` screening inputs. Their `pooled-candidates.json` companions
  survive because `s0-records.json` cites them as promotion provenance. Round
  2's corresponding pair remains because `adjudication-r2.json` and an author
  packet cite it directly.
- `working/phase5/s1/chunks.json` — an assignment manifest superseded by the
  complete kept `s1-records.json`.
- `working/phase5/s3-edges.md` — an application digest fully carried by the
  kept S3 adjudication, edited leaves, and edge graph.
- `working/phase5/build-reject-round-packets.mjs` — it regenerated only the
  dropped 1b dispatch bundles, so it has no retained output to support.
- `working/wave-2/routing.md` — a dispatch input fully carried by the banked
  Wave-2 lane outputs and completeness-critic note.

Kept, by checkable-evidence group:

- Phase-1 scope and weighting: `ownership-closure.md`, `hotspots.md`, and all
  nine `addenda/lane-NN.md` files.
- Banked reading and triage: all nine `wave-1/lane-NN.json` files; all nine
  Wave-2 lane/micro JSON files plus `critic-note.md`; all eleven
  `triage/batch{1,2}-*.json` files; and `leafcheck-results.json`.
- Reject-funnel provenance: `phase5/source-ledger.json`, every retained
  `reject-audit*.json`, all five `adjudication*.json`, all five
  `promotion-map*.json`, all five `promotion-check*.json`, every `2a*/chunks.json`
  and `2a*/packets/*.md`; all five `1c*/pooled-candidates.json` files; and
  `1c-r2/leaf-index.md`.
- Independent round-6 closure: all six JSON records under
  `phase5/1b-r6/`, covering both reading seats, pooled adjudication, acceptance
  gate, S1 enrichment, and S3 adjudication.
- Global review and stopping-rule evidence: `s0-records.json`,
  `s1-records.json`, `s2-channels.json`, `s2-digest.md`,
  `s2-nominations.json`, `s3/assignments.json`, `s3-adjudication.json`,
  `fix-claims.md`, and `edge-graph.json`.
- Regeneration/support code: `phase5/README.md`, `build-source-ledger.mjs`,
  `build-1c-packet.mjs`, `build-2a-packets.mjs`, `build-s0.mjs`,
  `build-s2-input.mjs`, `merge-s3.mjs`, and `build-edge-graph.mjs`. Each is
  cited by the ledger or regenerates a retained artifact.

Every tracked artifact cited by path from a ledger row or surviving pack
document was retained. All deletions are recoverable from Git history.

One class of citation is not covered by that claim and never could be:
`working/hotspots.md` cites session-local scratch paths under
`/tmp/tmp.X3FfTqKPzV/` that were never committed and are outside the durable
pack. They may still exist in the environment that ran lane 00, but they are
not recoverable from Git and no future reader can rely on them. They are a
record of what that lane consulted, not durable evidence; the ranked synthesis
in that file is the durable record. See the note at the head of
`working/hotspots.md`.
