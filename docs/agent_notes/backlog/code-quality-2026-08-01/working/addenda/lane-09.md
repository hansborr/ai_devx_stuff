# Phase-1 hotspot addendum — lane 09 (lint-machinery)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- Your scope sits inside the repo's **strongest history-defined hotspot**.
  Pinned-range churn (`883d48bf..ebf0965`): `eslint-rules` **99 file
  touches**, the concurrency-guard codemod **60**, `scripts/path-policy`
  35, `scripts/lint-ratchet` 25.
- `lint-ratchet.baseline.json` has 34 revisions and **8 fix/revert
  commits** — the strongest thrash signal in the repo. Ask what about the
  baseline workflow makes commits bounce.
- The history lens shows repeated **coupling between the concurrency rule,
  its corpus, and its codemod** — a three-surface change for one logical
  edit; weigh whether that seam is well-factored.
- Literal density is elevated in `path-policy` and `lint-ratchet`.
- Dolos adds little for you: the eslint-rules top 40 is entirely test-only
  clone pairs (lane 06's; pointer, not finding).

Weighting: ratchet baseline workflow and the concurrency
rule/corpus/codemod seam first, `eslint-rules/` rule implementations and
`path-policy` second, `tools/lint-ratchet/` + demo + message-eval at
normal weight.
