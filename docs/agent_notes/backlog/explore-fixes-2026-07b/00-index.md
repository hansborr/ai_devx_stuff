# Explore Fixes 2026-07b — Task Pack

Status: Parked task index
Created: 2026-07-03
Source: second dual-model exploration pass of 2026-07-03, run after the
first pack (`../explore-fixes-2026-07/`) landed: Codex investigation +
three independent Claude sweeps (docs drift, config/shell consistency,
product-code defects) + Codex adversarial triage + orchestrator
spot-checks of every load-bearing claim. Provenance, kill list, and the
verified-clean record: [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md)
— read that first.

Each leaf is one small commit unless it says otherwise. Every citation was
re-verified at HEAD on 2026-07-03; line numbers drift, so reconfirm seams
with `rg` / `bun run code:intel` before editing. Two themes this round:
**atomic/ordering hazards in the tooling** (cross-filesystem env writes,
a CI gate running the weaker checker variant) and **client cache-layer
correctness** (optimistic updates racing socket-driven refetches, missed
invalidation, a missing broadcast).

## Task List

Tracks: **T** tooling/config, **SV** server, **C** client, **DOC** docs.

| # | Task | Track | Size | Priority | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [Run coverage-map audit form in CI](./10-coverage-map-audit-in-ci.md) | T | XS | P1 | none | Done |
| 11 | [Worktree `.env` same-dir atomic writes](./11-worktree-env-atomic-writes.md) | T | S | P1 | none | Done |
| 12 | [Enforce commit scope in commitlint](./12-commitlint-scope-enforcement.md) | T | XS | P2 | none | Done |
| 13 | [Client tsconfig server project reference](./13-client-tsconfig-server-reference.md) | T | XS | P2 | none | Done |
| 14 | [MODULE-INDEX same-dir atomic write](./14-module-index-atomic-write.md) | T | XS | P2 | none | Done |
| 40 | [Broadcast campaign:updated after assign/unassign](./40-campaign-assign-broadcast.md) | SV | S | P1 | none | Done |
| 50 | [Await query cancellation in snapshotAndSet](./50-snapshot-and-set-cancel-queries.md) | C | S | P1 | none | Done |
| 51 | [Invalidate character.list after personality update](./51-personality-invalidate-character-list.md) | C | XS | P1 | none | Done |
| 52 | [Optimistically consume the slot in convertSlotToPoints](./52-convert-slot-optimistic-slot-patch.md) | C | S | P2 | 50 | Done |
| 70 | [Fix split-ESLint-config guide citations](./70-split-eslint-config-guide-citations.md) | DOC | XS | P2 | none | Done |
| 71 | [Refresh lint-ratchet portable-runtime docs](./71-lint-ratchet-portable-runtime-docs.md) | DOC | S | P2 | none | Done |
| 72 | [Add test:eslint-rules wrapper script + update guides](./72-test-eslint-rules-wrapper-script.md) | T | S | P2 | none | Done |

## Recommended Order

1. **P1 correctness first:** 10 (one-line CI gate fix) → 40 → 50 → 51 →
   11. Leaf 50 changes the shared optimistic helper, so it lands before
   any other optimistic-hook edit.
2. **Then 52** (builds on the post-50 async `onMutate` shape).
3. **P2 tooling/docs in any order:** 12, 13, 14, 70, 71, 72.

## Promotion Rules

1. Promote one leaf at a time; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first —
   especially the kill list, so dead candidates stay dead.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing.
3. When a leaf lands, mark its row Done here; durable context goes to
   `../../LOG.md` / `../finished_work/` only if the commit cannot carry it.
