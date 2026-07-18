# Lint Architecture Review 2026-07 — Task Pack

Status: Reconciled residue — 2026-07-18 (was 10 leaves + a slice plan; the
landed files were removed and are summarized in the landed record below;
leaves 05, 07 remain open, plus 12–14 filed 2026-07-18 from the post-move
architecture review + codex/opus consult)
Created: 2026-07-16

Source: the 2026-07-16 five-model architecture review of the lint system
(Claude Sonnet 5, Claude Opus 4.8, GPT/Codex, Grok 4.5, Gemini 3.5 Flash —
independent read-only reviews, synthesized and spot-verified by Claude
Fable 5). Full report artifact:
<https://claude.ai/code/artifact/423b110c-a697-47a4-8e27-7be44510995e>.

Overall verdict: the semantics are right (strict floor, item-keyed committed
baselines, symmetric gate, semantic-minimum merge, append-only debt log,
zero-as-lifecycle-event — all unanimous KEEPs); the packaging is wrong. Of
the two root causes, one is fixed — the ratchet engine migrated onto the
generic `scripts/lib/baseline/` kernel 2026-07-17 (leaf 01) — and one is
open: the "portable" surface is still a synchronized source-tree fork (copy
manifest + demo-sync harness) instead of a package boundary (leaf 02).

## Open leaves

| # | Task | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 02 | [Replace the copy manifest with a real package seam](./02-package-seam-replaces-copy-manifest.md) | P0 | L | DONE 2026-07-18 — S0–S5 landed on main (final merge 6e685069): engine in `tools/lint-ratchet` (`@musi/lint-ratchet`, layers 1–3) behind the context/binding seam, Musi adapter stays in `scripts/`, demo flipped to a workspace consumer with an end-to-end CI smoke, copy manifest + demo-sync harness deleted. Follow-up recorded in the leaf: debt-accounting needs a net-neutral-rename primitive |
| 05 | [Stop the engine fragmenting under its own rules](./05-engine-file-consolidation.md) | P1 | M | Partially landed — cap-policy ruling (item 2) landed as leaf 02's S0 (scoped ~500-line zone cap in config, no exemption, exceptions baseline stays the outlier escape hatch); consolidation (item 1) remains, scope sharpened 2026-07-18 against the post-move tree (merge list + keep list recorded in the leaf) |
| 07 | [Author the coverage map as data, render the Markdown](./07-coverage-map-as-data.md) | P1 | M | Proposed — trigger: next checker schema change (deliberately skipped in the 2026-07 drain per this trigger) |
| 12 | [Re-home engine-owned lint-ratchet tests into the package](./12-engine-test-rehoming.md) | P1 | M | Proposed 2026-07-18 — governance layer has zero in-package tests; ownership-by-assertion rule, not a file-count target; independent of leaf 05 |
| 13 | [CLI driver inside the package](./13-package-cli-driver.md) | P2 | M | Split 2026-07-18 — full driver stays rejected (consult; trigger: a third real adapter, and reopening leaf 02 dispatch ruling 2 needs an owner ruling); the neutral `runGate`/`runUpdate` application operations are promoted to Proposed on adoption-cost grounds (owner decision) — see the leaf's "In scope now" |
| 14 | [Enumerate the package's subpath exports](./14-enumerated-subpath-exports.md) | P2 | S | Proposed 2026-07-18 — needs owner ruling (wildcards were a deliberate leaf 02 decision); gated after 05 item 1 + 12 + 13's operations slice; exact reviewed subpath set, not a numeric cap |

## Landed record — 2026-07-16/17 (leaf files removed; full text in git history)

- **01 — one baseline kernel (P0/L)** and its approved slice plan: full
  kernel migration in five reviewed, individually-landed slices (S1 tolerance
  `a3a9109d`, S2 kernel `89a0714d`, S3a/b/c `ff202cd1`/`0f8fab03`/`08aa91a0`,
  S4 flip `a981e78c`, S5 deletion `15067711`); baseline now version 2,
  parallel stack deleted (net −1,700 LOC), debt log byte-untouched.
- **03 — metrics as strategies (P1/M)**: metric-strategy registry + single
  max-lines exceptions codec (landed with the 01 slices).
- **04 — one merge-driver shell body (P1/M)**: one keyed merge-driver body +
  one keyed truth-up body + awk→TS attributes rewriter. The leaf recorded an
  unpromoted follow-up idea: replace the shell truth-up state machine with a
  full TS implementation (in git history with the leaf).
- **06 — rule-source identity hashing (P2/S)**: fail-closed guard with
  literal- and regex-aware masking + regression tests for both fail-open
  categories.
- **08 — one validation and CLI idiom (P1/M)**: Zod-throughout ruling
  recorded; debt-log schema family on Zod; CLI on node:util parseArgs.
- **09 — docs split and portable doc hygiene (P2/M)**: lint-ratchet guide
  split (1,139→448 lines + `docs/guides/lint-ratchet-reference.md`); portable
  citations generalized; conflict recipes generated from the driver.
- **10 — trim report-only mode (P2/S)**: removed from types, filtering,
  validation, summaries, diagnostics kind, and guides (its item 3 belongs to
  leaf 02).
- **11 — kernel diagnostics parity (P2/S)**: item-conflict groups keep
  surviving items into failure-path validation; structural parse accumulates
  the full defect set again; formatted-group (normalized) equality in merge
  unchanged-detection ruled and pinned, with a per-field sensitivity suite
  guarding the invariant (`scripts/lint-ratchet/baseline-merge.test.ts`).

## Drain record — 2026-07-16/17

Phases 1 and 2 of this pack were drained by parallel worktree lanes and
landed on main via full-verify merges `fa8f74bb` (leaves 10, 03, 01-partial,
04, 06) and `0f3f8409` (leaves 08, 09). Every lane passed a codex review
plus an independent opus/grok/fable pre-land pass with confirm-then-fix on
all findings.

Phase 3 (2026-07-17) executed the leaf-01 remainder as its own mission per
the approved slice plan (removed with the leaf; in git history): two
independent designs (codex + claude) synthesized under owner rulings (minimal
v2 wire shape; debt log untouched), the plan adversarially reviewed by opus
before implementation, then five slices implemented by codex in a single
sequential lane — each independently landed through the full gate after
opus + grok reviews with confirm-then-fix (three findings fixed pre-land: a
failure-set parity gap in the kernel merge path, a time-bomb flip-equivalence
test comparing pinned history against the live working tree, and a
pin-honesty assert). Landed merges: `a3a9109d`, `89a0714d`, `ff202cd1`,
`0f8fab03`, `08aa91a0`, `a981e78c`, `15067711`.

Leaf 11 (the post-land diagnostics-parity follow-ups) was drained 2026-07-17
on `feat/backlog-kernel-diagnostics-parity`.

## What the review said to keep (do not "fix")

- The core semantics: strict floor + symmetric gate + item-keyed committed
  baselines + semantic-minimum merge + append-only debt log + zero-baseline
  lifecycle.
- Isolated per-rule generated ESLint configs (retrofit via an explicit
  adapter seam, not special cases in the config writer).
- The thin-shell / TS-semantics split for merge drivers (the duplication
  *within* the shell layer was the problem — leaf 04 fixed it — not the
  boundary).
- Suppression registers, ratchet-restricted disables, the `meta.docs` →
  generated rule catalog pipeline, and the structured agent-diagnostics
  envelope.

## Cross-pack overlaps

- Leaf 01 built on `arch-review-2026-07/12-baseline-framework-and-max-lines.md`
  (it built the framework; this pack migrated the ratchet onto it).
- Leaf 02 was adjudicated against
  `lint-deep-dive-2026-07/71-portable-engine-context.md` on 2026-07-16:
  71's copy-manifest mechanism is superseded by an internal workspace
  package; its engine-context design survives as the repo-adapter layer.
  Ruling recorded in leaf 02; 71 carries a matching addendum.
- Leaf 09 overlapped `lint-deep-dive-2026-07/70-ratchet-docs-accuracy-and-shape.md`
  item 3 (the guide split — executed 2026-07-17).
