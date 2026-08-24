# Session handoff — 2026-07-28 (closed 2026-07-30)

Status: **Historical — nothing here is in flight.** Every branch this note listed
as open has since landed on `main`, and every item it listed as decided-but-not-
started now has a home. Kept as the record of how that session ended; **not**
scheduling input. For what remains in the pack, read
[`00-index.md`](./00-index.md).

**Merge policy in force for this pack, and still in force:** a branch reaches
`main` only after passing a four-model review gate — Opus 5, Codex (with its own
internal subagents, multi-angle), Fable 5, and Grok 4.5 — with standing owner
authorisation for merge-on-green. A gate round that turns up findings is answered
on the branch and re-gated, not waived.

## What this note tracked, and where it went

| Then | Now |
|---|---|
| `feat/cq-common-language-ownership` (leaf 55) — landed | merge `137cd7991` |
| `fix/saving-throw-proficiency-identity` (leaf 61) — landed | merge `48474f8cb`; client half filed as [leaf 62](./62-client-ability-identity-adoption.md) |
| `feat/cq-client-followups` (client round three, Branch A) — **"do not merge as-is"** | Landed, merge `c5985d1da`, closing [leaf 54](./54-character-sheet-campaign-context.md). The five-item fix mission was completed; the `AddItemDialog` remount it was parked for is fixed by latching the dialog body's shape at open (`add-item-dialog.tsx`, `campaignMemberAtOpen`) |
| `fix/cq-server-postmerge` — complete, unreviewed, unmerged | Landed, merge `7f0c4a793` |
| Branch B (socket association freshness) — "no leaf file yet" | Filed as [leaf 63](./63-character-assignment-cross-client-freshness.md), which carries both the multi-tab assignment case and the campaign-deletion cascade under the `character:associationChanged` design |
| Leaf 60's design-panel decision | Recorded in [`60-nested-write-runtime-guard.md`](./60-nested-write-runtime-guard.md), `## Decided — design panel, 2026-07-28`, which supersedes that leaf's `## Steps` |
| The wider `InventoryPanel` owner-gate gap — "no leaf file yet" | Filed 2026-07-30 as [leaf 66](./66-sheet-owner-capability-gate.md), re-verified against the live tree and re-scoped: the whole sheet, not only inventory, and an affordance defect rather than an authorization hole |
| `concurrency-guard` false positive, deliberately kept | A corpus case plus a disclosure in the rule JSDoc and `docs/CONCURRENCY.md` |
| The `connect`-writes-a-gated-FK question | Recorded against [leaf 60](./60-nested-write-runtime-guard.md), whose v1 treats it as an explicit non-goal |

**The `fix/cq-server-postmerge` findings are not summarised here any more.** Each
one is recorded where it is enforced rather than where it was discovered — the
long-rest/`CharacterStats` barrier and the generalised snapshot rule in
[`docs/CONCURRENCY.md`](../../../CONCURRENCY.md), the toggle race's
wait-for-a-peer-to-commit gate and its `retries === 1` assertion in
`packages/server/src/utils/prepared-spell-toggle.test.ts`, the real-program drive
in `packages/server/src/utils/serializable-isolation.test.ts`, and the durable
rulings in [`CONSTRAINTS.md`](./CONSTRAINTS.md) and ADR-0001. **Do not re-derive
them from this note.**

## Operational note — corrected 2026-07-30

Two concurrent full `verify` runs correlated with timing failures on a branch
that had passed a solo verify: a 30-second resolved-config guard expired, then
the dependency-freshness fixture exceeded its coarse outer elapsed assertion.
That fixture used private memory-state and queue paths; its one-second admission
deadline and lock-release checks passed. The observations therefore show host
scheduling correlation, not shared-lock interference or proof that the verifies
failed each other. They do not require cross-worktree verify serialization.

Before attributing a timing-shaped failure to a branch or sibling lane, inspect
the host for active gates and orphan load, then check the seam's actual
correctness contract rather than treating elapsed time alone as the cause.

Separately, the client lane reported the parallel pre-commit gate failing
reproducibly on its branch (`restricted-syntax-and-globals-config.test.js` and
`actionlint` timing out under concurrent full-suite load, both passing in
isolation) and landed via the sequential verify marker bridge at ~23–28 minutes
per run. Both observations are about *concurrent* gates; this pack is now worked
one lane at a time, which is the condition under which neither was seen.
