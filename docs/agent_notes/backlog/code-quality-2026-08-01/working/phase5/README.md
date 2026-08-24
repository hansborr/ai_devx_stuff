# Phase 5 source ledger

Status: Phase 5 working artifact.

From the repository root, run:

```sh
bun docs/agent_notes/backlog/code-quality-2026-08-01/working/phase5/build-source-ledger.mjs
```

`--round N` selects the sampling round (default `1`). Round 1 rebuilds from the
banked inputs. A later round requires the existing ledger, preserves earlier
`samplingRounds`, and draws only from cuts last marked `not-sampled`. `--help`
prints the command synopsis. Ranking is deterministic and uses no RNG or clock.

Lineage statuses:

- `eligible`: a near-match needs human review; use its separate sampling disposition.
- `already-promoted`: a later finding or explicit banked finding owns the cut.
- `already-dismissed`: a later round or killed candidate resolved the material.
- `superseded-by-later-round`: a documented later-round revisit replaced the row.
- `duplicate-occurrence`: the same normalized source text occurred earlier.
- `meta-disposition`: an administrative coverage marker, not audit material.
- `sampled`: exhaustively audited, or selected from the eligible-cut population.
- `not-sampled`: eligible audit material deferred beyond the current round.

Partition caveats:

- Split B/C on `summary.perLane` and `sampling.disposition`, not raw cut counts.
- Resolve every `needsReview` row before treating its near-match as promoted.
- Bare cuts still have no evidence; B/C must reconstruct evidence from the tree.
- All kills and D claimants are exhaustive; do not sample either population again.
- Lane 06's 13 r1 cuts are one documented r2 revisit, including its dismissal.
- D uses the first corpus anchor as the primary document and retains alternates.
- `CONSTRAINTS.md` anchors are inherited from the corpus section-wide declaration.
- A source document is split only when a 20-ref or 30-claimant cap forces it.
- Record `priorPackReviewSha` before D and judge the live prior-pack documents.
