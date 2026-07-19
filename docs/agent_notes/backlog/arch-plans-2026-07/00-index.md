# Arch Plans 2026-07 — Cross-Reviewed Intake Pack

Status: Drained 2026-07-19 — leaves 01, 02, 03, 05, 06 landed; leaf 04
remains Proposed behind its double trigger (6 leaves; one candidate not
adopted, folded into lint-arch leaf 07 as a rider)
Created: 2026-07-19
Source: seven plans drafted 2026-07-18/19 in the sibling checkout
(`/home/node/persist/clones/musi`) from its 2026-07-17 harness
architecture review and 2026-07-18 architecture review. Those review
conversations are not recorded in this repo; each leaf restates its own
motivation self-contained, and this index is the provenance record.

## Review record

Before intake, every plan was independently reviewed twice on
2026-07-19 against HEAD `7e4bd5df`: once by a Claude Fable 5 subagent
and once by a GPT-5 codex consult, each fact-checking premises against
the live tree and issuing a verdict with prioritized fixes. All
fourteen reviews returned high confidence. The leaves below are the
plans **with the surviving fixes applied** — stale facts corrected,
missed gate surfaces added, and scopes re-cut where both reviewers
narrowed them. Where the two models disagreed, the leaf records the
dissent rather than papering over it.

| Plan | Fable 5 | GPT-5 codex | Intake outcome |
|---|---|---|---|
| harness-atomic-write-completion | adopt-with-changes | adopt-with-changes | Leaf 01 — leaf-14 indirection added, one site dropped, semantics renamed |
| harness-cli-parse-spec | adopt-with-changes | adopt-with-changes | Leaf 02 — reconciled with the existing drift-ai `SubcommandSpec`; behavior matrix + characterization tests now S0 |
| harness-hook-shim-generation | adopt-with-changes | adopt-with-changes | Leaf 03 — filesystem-safety grammar, orphan reconciliation, kept manifest-body backstop; risk raised to medium |
| sensor-baseline-single-shape | adopt-with-changes | **reject** | Leaf 04 — kept, contested; doubly trigger-conditioned, dissent recorded in the leaf |
| verify-metadata-ts-analytical-core | adopt-with-changes | adopt-with-changes | Leaf 05 — narrowed to the run-meta JSON codec; marker/waiter ports and shell-suite shrink dropped |
| turn-movement-server-origin | adopt-with-changes | adopt-with-changes | Leaf 06 — owner rulings intact; four implementation gates added (write path, visibility, selector signature, commit coherence) |
| lint-coverage-map-spoke-fold | adopt-with-changes (as rider) | **reject** (as drafted) | Not a leaf — rewritten as a boundary-review rider inside `../lint-arch-review-2026-07/07-coverage-map-as-data.md` |

The coverage-map decision, briefly: both reviewers found the drafted
fold unsound as written (its predicted shrink came from a file the
plan keeps; a pre-selected deletion list would preserve row checks
leaf 07's rewrite makes obsolete; and the flat-family topology
question in `../scripts-flat-family-reorg.md` cuts the other way).
What survives is the reminder to run a spoke boundary review when
leaf 07 fires — recorded there, where it will actually be read.

## Task list

| # | Leaf | Priority | Size | Risk | Status |
|---|---|---|---|---|---|
| 01 | [Harness atomic-write completion](./01-harness-atomic-write-completion.md) | P2 | S-M | low-medium | Done — landed 2026-07-19 (`7583d55f`) |
| 02 | [Harness CLI parseCli(spec)](./02-harness-cli-parse-spec.md) | P2 | M-L | medium | Done — landed 2026-07-19 (`62285ebb`), all slices S0–S6 |
| 03 | [Harness hook-shim generation](./03-harness-hook-shim-generation.md) | P3 | M | medium | Done — landed 2026-07-19 (`3e9b28df`) |
| 04 | [Sensor baseline single shape](./04-sensor-baseline-single-shape.md) | P3 | S | low | Proposed — contested, doubly trigger-conditioned; deliberately NOT scheduled in the 2026-07-19 drain |
| 05 | [Verify-metadata run-meta JSON core](./05-verify-metadata-ts-analytical-core.md) | P3 | M | medium | Done — landed 2026-07-19 (`d8bd4704`) |
| 06 | [Turn movement server origin](./06-turn-movement-server-origin.md) | — | M | medium | Done — landed 2026-07-19 (`fb1bf8b5`) |

## Recommended order

1. **06** is the only owner-accepted design and the only product-facing
   item; it stands alone.
2. Among the harness leaves, **01** is the cheapest and unblocks
   nothing; **02** and **05** are independent after their S0/S1; **03**
   sequences after 01's S1 (same helper file). **04** must not be
   scheduled — it fires only on its recorded double trigger.

## Promotion rules

1. Promote one leaf at a time; re-verify seams with `rg` /
   `bun run code:intel` before editing — every count and `file:line`
   above was verified 2026-07-19 and paths drift.
2. Leaves 01–03 and 05 touch harness/gate surfaces: run
   `bun run harness:check` after manifest/hook/generated-surface
   changes, and respect the recorded prior rulings each leaf cites
   (lint-arch leaf 14, leaf 08, the substrate ruling).
3. Leaf 04's double trigger is load-bearing — bundled near-duplicates
   work *and* a settled `scripts-flat-family-reorg.md` decision.
4. When a leaf lands, mark its row Done here and update the backlog
   `README.md` line.
