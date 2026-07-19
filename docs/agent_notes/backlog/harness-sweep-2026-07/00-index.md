# Harness Sweep 2026-07 — Task Pack

Status: Parked task index
Created: 2026-07-11
Source: a wide multi-model harness sweep run on 2026-07-11 (16 sources — 13
Claude Fable/Opus lens agents + 3 cross-CLI consults — deduped into 99
candidate clusters, then adversarially judged one judge per cluster). Full
sweep design and the 59-item kill list are in
[`00-sources-and-verdicts.md`](./00-sources-and-verdicts.md) — read that before
promoting any leaf.

These three leaves are the **surviving residue** of that sweep. Unlike a
freshly-explored pack, every leaf here already passed an adversarial judge at
filing time (40 accepted / 59 rejected); resolved leaves have been removed,
so there is **no "needs triage"
caveat** — the finding and its fix were argued against and survived. The judge
split was capacity-driven: 14 clusters judged by Claude Fable, 85 by Claude
Opus. Each leaf was drafted the day it was judged; its Evidence block is dated
`verified 2026-07-11`. Line numbers drift — **re-verify every citation at HEAD
before editing**, and treat each leaf as one commit unless its Size says
otherwise.

The sweep deliberately targeted surfaces newer than the earlier 2026-07 packs
(notably the merged `chore/lint-ratchet-audit-integration` work) and
deduplicated against everything already filed; adjacencies to sibling packs are
named inline in each leaf.

## Task List

Tracks: **T** tooling/config · **DOC** docs · **R** research-adoption (evaluate
before building). Grouped by theme; within a theme, ordered by priority.

| # | Task | Theme | Track | Size | Priority | Status |
|---|---|---|---|---|---|---|
| 22 | [eslint-rules @ts-check is ungated; shared-policy .d.ts can drift silently](./22-checkjs-gate-and-shared-policy-shim-parity.md) | Local lint rules | T | M | P3 | Split (re-triage 2026-07-12): 22a shim-parity Done · 22b scoped checkJs gate Done · 22c TSESTree migration Parked P4/L (see leaf) |
| 25 | Drain the 182-entry knip dead-export floor toward zero | Scripts-tree quality | T | M | P3 | Done — integrated on main (`4bb0b024`; knip unused-exports baseline count 0) |
| 45 | Make the commit guard layer worktree-aware (first-class lane commits) | Lane orchestration UX | T | M | P2 | Done (2026-07-16 via sd-1.5): item 1 already landed in 008029e2 (now pinned by lane commit-guard tests); item 3 tidy hook resolves the edited file's own worktree root; item 4 marker-vanish tripwire logs create/remove transitions |

## Recommended Order

1. **P2 implementation:** 25 remains pending integration; 45 is ready for
   promotion.
2. **P4 design follow-up:** 22c (the TSESTree migration) remains parked until
   the owner elects to absorb its larger implementation cost.

## Promotion Rules

1. Promote one leaf at a time; read its Evidence block and re-verify every
   citation at HEAD before editing.
2. Keep each leaf to one commit unless the leaf says otherwise; update this
   index's Status column in the same commit that finishes a leaf.
3. Track R leaves land their *finding* (a measurement or a go/no-go), not
   necessarily the sketched implementation.
