# Lint Architecture Review 2026-07 — Task Pack

Status: Task index
Created: 2026-07-16

Source: the 2026-07-16 five-model architecture review of the lint system
(Claude Sonnet 5, Claude Opus 4.8, GPT/Codex, Grok 4.5, Gemini 3.5 Flash —
independent read-only reviews, synthesized and spot-verified by Claude
Fable 5). Full report artifact:
<https://claude.ai/code/artifact/423b110c-a697-47a4-8e27-7be44510995e>.

Overall verdict: the semantics are right (strict floor, item-keyed committed
baselines, symmetric gate, semantic-minimum merge, append-only debt log,
zero-as-lifecycle-event — all unanimous KEEPs); the packaging is wrong. Two
root causes drive most of the felt complexity: the ratchet engine never
migrated onto the generic `scripts/lib/baseline/` framework it spawned (the
core invariant is implemented twice), and the "portable" surface is a
synchronized source-tree fork (copy manifest + ~1,000-LOC demo-sync harness)
instead of a package boundary.

Verification: the review's headline claims were spot-verified during
synthesis; on 2026-07-16 every leaf's claims were additionally re-verified
against HEAD (bc12a371) by four parallel read-only agents, and corrections
were folded into the leaves — notably leaf 05 (the `no-barrel` violation
claim was wrong), leaf 06 (reshaped: the hazard is latent, not live), and
leaf 08 (the documented Zod ban is stale at HEAD). Counts stamped
"verified at HEAD 2026-07-16" in leaves are current as of that commit; the
tree still moves fast.

Sequencing (from the review): 01 → 03 → 02 are one program of work —
converge the baseline stacks first, design the package seam concurrently
(01's strategy interface is 02's kernel API), and only then draw the seam;
packaging the duplicated code would enshrine it. 04–10 are independent.

## Task List

| # | Task | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 01 | [Finish the extraction: one baseline kernel](./01-one-baseline-kernel.md) | P0 | L | In progress — 2026-07-17 drain: semantic-minimum item merge unified onto one shared core (leaves the nested document schema untouched); grouped-document migration + schema bump re-scoped to its own mission behind a dual-version-tolerant parser (blast radius recorded in the leaf) |
| 02 | [Replace the copy manifest with a real package seam](./02-package-seam-replaces-copy-manifest.md) | P0 | L | Approved — owner ruling 2026-07-16: internal workspace package, no external publication (amends lint-deep-dive 71); do after 01 — still blocked 2026-07-17: leaf 01 remainder re-scoped, stacks not yet converged |
| 03 | [Make metrics strategies, not switch statements](./03-metrics-as-strategies.md) | P1 | M | Done — 2026-07-17: metric-strategy registry + single max-lines exceptions codec (landed with the 01 slices) |
| 04 | [One shell driver body for the four merge drivers](./04-single-merge-driver-shell-body.md) | P1 | M | Done — 2026-07-16: one keyed merge-driver body + one keyed truth-up body + awk→TS attributes rewriter; full TS truth-up state machine recorded as follow-up in the leaf |
| 05 | [Stop the engine fragmenting under its own rules](./05-engine-file-consolidation.md) | P1 | M | Deferred — 2026-07-17: blocked on leaf 01 remainder (do not consolidate files the migration deletes) and item 2 needs an owner cap-policy ruling |
| 06 | [Harden rule-source identity hashing](./06-harden-rule-source-identity.md) | P2 | S | Done — 2026-07-16: fail-closed guard with literal- and regex-aware masking + regression tests for both fail-open categories |
| 07 | [Author the coverage map as data, render the Markdown](./07-coverage-map-as-data.md) | P1 | M | Proposed — trigger: next checker schema change (deliberately skipped in the 2026-07 drain per this trigger) |
| 08 | [Pick one validation idiom and one CLI idiom](./08-one-validation-and-cli-idiom.md) | P1 | M | Done — 2026-07-17: Zod-throughout ruling recorded; debt-log schema family on Zod; CLI on node:util parseArgs |
| 09 | [Docs: shrink the required path, strip internal references](./09-docs-split-and-portable-doc-hygiene.md) | P2 | M | Done — 2026-07-17: guide split executed (448-line guide + reference doc); portable citations generalized; conflict recipes generated from the driver |
| 10 | [Trim unused product surface (report-only mode)](./10-trim-report-only-mode.md) | P2 | S | Done — 2026-07-16: report-only mode removed from types, filtering, validation, summaries, diagnostics kind, and guides |

## Drain record — 2026-07-16/17

Phases 1 and 2 of this pack were drained by parallel worktree lanes and
landed on main via full-verify merges `fa8f74bb` (leaves 10, 03, 01-partial,
04, 06) and `0f3f8409` (leaves 08, 09). Every lane passed a codex review
plus an independent opus/grok/fable pre-land pass with confirm-then-fix on
all findings. Remaining open: leaf 01's grouped-document migration (re-scoped,
see leaf), leaf 02 (blocked on that remainder), leaf 05 (deferred), leaf 07
(trigger-gated).

## What the review said to keep (do not "fix")

- The core semantics: strict floor + symmetric gate + item-keyed committed
  baselines + semantic-minimum merge + append-only debt log + zero-baseline
  lifecycle.
- Isolated per-rule generated ESLint configs (retrofit via an explicit
  adapter seam, not special cases in the config writer).
- The thin-shell / TS-semantics split for merge drivers (the duplication
  *within* the shell layer is the problem — leaf 04 — not the boundary).
- Suppression registers, ratchet-restricted disables, the `meta.docs` →
  generated rule catalog pipeline, and the structured agent-diagnostics
  envelope.

## Cross-pack overlaps

- Leaf 01 builds on `arch-review-2026-07/12-baseline-framework-and-max-lines.md`
  (Done — it built the framework; this pack migrates the ratchet onto it).
- Leaf 02 was adjudicated against
  `lint-deep-dive-2026-07/71-portable-engine-context.md` on 2026-07-16:
  71's copy-manifest mechanism is superseded by an internal workspace
  package; its engine-context design survives as the repo-adapter layer.
  Ruling recorded in leaf 02; 71 carries a matching addendum.
- Leaf 09 overlaps `lint-deep-dive-2026-07/70-ratchet-docs-accuracy-and-shape.md`
  item 3 (guide split decision, design recorded, impl pending).
