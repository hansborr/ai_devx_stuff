# Reconcile Stale Source-Pack Statuses

Status: Done — reconciled 2026-07-15; all source-pack statuses in the "Do" list updated and `backlog:lint` index-leaf drift cleared for the touched packs.
Created: 2026-07-15
Size: S (docs only)

The 2026-07-15 verification pass ([`01-verification-record.md`](./01-verification-record.md))
found that many source-pack leaves and index rows still read "Open" /
"Proposed — NOT implemented" for work that landed between 2026-07-12 and
2026-07-15. Left as-is, every future backlog sweep re-proposes shipped work.

## Do

Update statuses (leaf `Status:` line and/or index row, whichever exists) to
Done with a one-line landed pointer, using the evidence table in
[`01-verification-record.md`](./01-verification-record.md):

1. `harness-review-2026-07/00-index.md` + leaf bodies: 10, 11, 12, 14, 15,
   16, 17, 19, 30, 31, 32, 33, 34, 50, 51, 54, 56, 57, 58. For 18, mark
   half (b) done and re-scope the leaf to half (a).
2. `lint-deep-dive-2026-07/00-index.md`: row for leaf 76 → Done
   (`d714f4ce`).
3. `drift-triage-2026-07-13/REVIEW-FOLLOWUPS.md`: item 2 → Done
   (`31ce6e49`).
4. `testsuite-audit`: #14 → Done; #32 → re-scope to finishing adoption
   (helper exists; delete the remaining local `writeRepo` copies).
5. `agent-friction-2026-06`: D1 → Done (`48ac51aa`, same work as
   harness-review 56).
6. `harness-research-followups-2026-06`: PB-1 → Partial (infra +
   character-rules landed via `3c302f89`).
7. `harness-strictness-comprehension-2026-06`: HC-1 → Done (`1fdea456`).
8. Standalone notes: `lint-fix-dist-preflight-parity.md` → Done;
   `merge-driver-field-exercise.md` → unblocked (prerequisite pack merged
   `b8fcdfbc`); `drift-ai-ghost-files-agent-noun-pairs.md` → Done.
9. `backlog/README.md`: update the affected pack summary lines (leaf counts
   / residue descriptions) so the index matches reality.
10. Drain the current `backlog:lint` Index/Leaf Drift list (20 advisory
    findings at pack-creation time), which overlaps the above and adds:
    `lint-adoption-2026-07` leaf bodies still saying "Proposed" under Done
    index rows, `harness-review-2026-07` rows 35/70, and
    `harness-review-2026-07b` row 14 (decision recorded in the leaf, row
    still Open).

## Verify

- `bun --cwd="$(git rev-parse --show-toplevel)" run backlog:lint` passes with
  no index-leaf drift findings for the touched packs.

## Acceptance

- No source pack claims open work for anything listed in the "Already
  landed" tables of the verification record.
