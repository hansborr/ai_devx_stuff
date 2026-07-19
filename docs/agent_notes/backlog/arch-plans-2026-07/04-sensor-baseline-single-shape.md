# 04 — One Baseline Shape per Sensor: Merge the Near-Duplicates Trio

Status: Proposed — contested at cross-review 2026-07-19 (Fable 5
adopt-with-changes, GPT-5 codex reject; both fact-checks agree the
mechanics are feasible — see `00-index.md` for the dissent). Doubly
trigger-conditioned: execute only bundled with the next substantive
near-duplicates change, and only after
`../scripts-flat-family-reorg.md` settles the flat-family topology
this family is named in. Do not schedule standalone.
Date: 2026-07-19
Source: 2026-07-17 harness architecture review, run in the sibling
checkout (rated Speculative there, and that rating holds). The prior
sequencing blocker — lint-arch-review leaf 02 package seam — landed
2026-07-18 (`6e685069`), so the kernel import paths are stable.
Priority: P3 · Size: S · Risk: low

## The dissent, honestly stated

No behavior changes and no bug class is killed — this is a consistency
cleanup that makes one sensor read like the other two. The
adopt-with-changes case: the line math genuinely holds, the repo's
public harness-reference goal makes "two shapes for the same role, no
signal which to copy" a real copyability defect, and the merge shrinks
the surface any identity-scheme revisit would touch. The reject case:
the three files are cohesive responsibility boundaries (codec /
repo-I/O / gate), the merged module lands at ~93% of the size cap so
future growth re-splits it, and the parked
`scripts-flat-family-reorg.md` decision (which names this family)
could resolve the readability problem by directory topology instead —
merging two companions pre-empts that. The double trigger above is the
reconciliation: if the flat-family decision sanctions one-module
sensors and near-duplicates work is happening anyway, the merge is
nearly free; otherwise it never fires.

## Problem

Three sensors sit on the kernel's `BaselineMetricSpec` surface, in two
shapes (population verified 2026-07-19; `sensor-blob-size.ts` is not in
scope — fixed thresholds + allowlist, no entry baseline):

- knip unused-exports —
  `scripts/sensor-knip-unused-exports-baseline.ts` (196 L, 166
  counted): one module holding the entry type, the spec, format/read,
  and summary/compare output. I/O lives in
  `sensor-knip-unused-exports-core.ts`.
- max-lines exceptions — `scripts/max-lines-exceptions-core.ts`
  (164 L): the same single-module shape.
- near-duplicates — three files, 312 L total:
  `scripts/sensor-near-duplicates-baseline.ts` (165 L: entry type,
  spec, format/read, admission-reason preservation),
  `sensor-near-duplicates-baseline-io.ts` (82 L: baseline file read,
  HEAD read via `git show`, merge truth-up marker validation), and
  `sensor-near-duplicates-baseline-gate.ts` (65 L: changed-file
  scoping, proposed-growth gate, merge-truth resolution + restore
  write).

The near-dup trio is size-cap sharding — three thin files so none
crosses the repo-wide 300-counted-line `local/max-lines` floor
(`eslint-config/shared-policy.js` `ratchetFloor`; counting skips
blanks and comments). Reading one sensor's baseline I/O + gating takes
three files and two extra import hops; the other two sensors read in
one.

Cap facts checked: no sensor file has an entry in
`eslint-config/max-lines-exceptions.baseline.json`, and the 500-line
engine-zone cap covers only `scripts/lint-ratchet/**`,
`scripts/lib/baseline/**`, and `tools/lint-ratchet/**` — not these
adapter files. The 300 floor is the binding constraint.

The merge is legal without any cap game, with less headroom than first
estimated: counted lines are 153 + 77 + 60 = 290; deduplicating the
sibling/kernel import blocks saves ~10–13 counted lines, landing the
merged module at **~277–280 counted** — under the 300 floor with ~20
lines of headroom. (The trio imports `entry-baseline.js`, `gate.js`,
and `atomic-write.js` from the kernel; `merge.js` is imported only by
the out-of-scope merge CLI.)

## Approach

Converge the near-duplicates sensor on the shape the other two already
have: one baseline module per sensor. Deletion test: the `-io`/`-gate`
shards vanish and the sensor's baseline logic reads in one file.

1. **Pure consumption — no kernel changes.** Same stance as leaf 01.
2. **Merge target is `sensor-near-duplicates-baseline.ts`.** Fold
   `-io` and `-gate` in; sole non-test importer to rewire is
   `sensor-near-duplicates-core.ts` (the merge CLI already imports
   only the spec from the surviving module).
3. **Honest delta from knip's shape:** knip's baseline module is pure
   (its file I/O is inlined in core). Near-dup's HEAD-read and
   truth-up-marker helpers are git-subprocess I/O and must live
   somewhere; core has no headroom (274 counted), so they merge into
   the baseline module.
4. **Strictly behavior-identical.** No signature, message, exit-code,
   or guard changes — in particular the repo-relative path-containment
   guard in the HEAD reader (`baseline-io.ts:28`) is executable path
   safety (it stops `git show` reading outside the repo) and **stays
   verbatim**. If the merged file cannot fit the 300 floor with all
   behavior intact, abandon the merge — no exceptions-baseline entry,
   no re-shard, no shedding of "least essential" lines.

## Slice plan (one commit per slice)

- **S1** — merge `-io` and `-gate` into
  `sensor-near-duplicates-baseline.ts`; rewire
  `sensor-near-duplicates-core.ts`; delete the two shards. In the
  same commit: update the family row in
  `docs/generated/lint-coverage-map.md:295` (8 files → 6 — the staged
  coverage-map check in changed verify fails the deletion otherwise)
  and demote `validateNearDuplicatesMergeTruthUp` to module-private
  (its only consumer was the sibling shard; left exported, the
  fail-closed knip unused-export floor trips). Existing coverage pins
  behavior: `scripts/drift-ai/near-duplicates.test.ts` drives
  `runNearDuplicatesCli` (HEAD-read, admission, truth-up paths),
  `scripts/lib/baseline/single-group-spec.test.ts` pins both sensors'
  specs, `sensor-near-duplicates-merge-cli.test.ts` pins the merge
  driver. Confirm the merged counted size (target ≤ ~280) in the
  commit body.
- **S2** — dropped. Do not write a "one baseline module per sensor"
  convention doc: current guidance already tells new sensors to follow
  the knip baseline + merge-driver pattern
  (`../lint-adoption-2026-07/00-index.md:57`), and a universal
  one-file rule would pre-empt the flat-family topology decision this
  item is conditioned on.

## Execution notes

- Branch `feat/sensor-baseline-single-shape` off `main` (or fold into
  the triggering near-duplicates branch); conventional commits.
- Prior-ruling check: the arch-review "no per-rule baseline sharding"
  ruling is about splitting the generated `lint-ratchet.baseline.json`
  to dodge merge collisions — it neither forbids nor mandates
  TypeScript module topology and is not cited as support here. The
  leaf 05 cap policy (zone caps in config, exceptions baseline for
  genuine outliers) is respected: no new entries.
- Baseline watch item, corrected: no baselined pair identity
  references the deleted shards, so the deletion strips nothing and
  prompts no `--update`. The one admitted pair involving this family
  (`readKnipUnusedExportsBaseline` ↔ `readNearDuplicatesBaseline`,
  `sensor-near-duplicates.baseline.json:224`) keys on the *surviving*
  file and persists unchanged. Run `--check-baseline` after the move
  to confirm relocated functions created no new path-dependent
  identities.
- The identity-scheme revisit this was once sequenced against
  (lint-review followup 03) is Done; its content-hash alternative
  survives only in git history, conditional on rename admissions
  becoming frequent. If that ever revives, run this merge first — it
  shrinks the surface that work would touch.
