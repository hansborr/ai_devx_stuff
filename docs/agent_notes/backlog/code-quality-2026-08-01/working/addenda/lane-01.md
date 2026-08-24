# Phase-1 hotspot addendum — lane 01 (harness-core)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- Your scope is the **strongest history-defined hotspot** in the repo.
  `harness.controls.json` has 49 revisions; major verification shell files
  have 26–30 each. The history lens reports 23 co-changes between the
  harness manifest and the generated freshness surface — weigh that
  generated-vs-hand-edited seam heavily. Thrash concentrates here: the
  generated harness surface has 6 fix/revert commits.
- Pinned-range churn (`883d48bf..ebf0965`): `scripts/harness` 28 file
  touches. Literal density is elevated in `scripts/harness`.
- Lane 00 found **no** stale TODO/FIXME markers, no ghost files, and no
  unused exports anywhere — do not spend budget hunting those.
- Deferred-literal pileups are a density signal in harness dirs; treat
  repeated argument-parser / config-literal families as candidate
  duplication findings, not noise.

Weighting: spend most depth on `harness.controls.json` internals, the
verify pipeline (`scripts/verify*`), and `scripts/harness/` — history says
that is where contributors keep having to return. The flat `scripts/`
facades and adapter trees (`.claude/`, `.codex/`, siblings) had little
lane-00 signal; sweep them with normal weight and say so in coverage.
