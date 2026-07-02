# Lint Followups 2026-06 — Pack Summary

Status: Archive summary written at pack close-out (2026-06-20). The pack
folder `docs/agent_notes/backlog/lint-followups-2026-06/` was deleted after
all 16 workable leaves landed (merged via `integration/lint-followups-2026-06`,
`3b183b4a`, on `main`). The individual leaves, the carried-forward watchlist,
and the verdict register are available in git history before the folder was
removed.

## What the pack changed

Successor to `lint-review-2026-06`. The 16 workable leaves (01, 02, 03a–03g,
04–10) are all Done and landed:

- E2E selector debt drain (03a–03g): the pre-drain inventory of **172
  findings across 21 files** was fully drained, and the three selector
  ratchets (`local-e2e-prefer-role-selectors`, `playwright-no-nth-methods-e2e`,
  `playwright-prefer-native-locators-e2e`) were retired from
  `lint-ratchet.baseline.json` and promoted to unconditional `error`
  (leaf 03g, `b9445614`). That "172 findings" figure is now a historical
  pre-drain snapshot.
- Runtime import-cycle fix and gate decision (leaf 05, `d2219a45`); the
  `scripts/lint-import-cycles.sh` gate.
- ESLint plugin evaluations: the client testing-library debt was adopted and
  ratcheted (leaf 06); a server `strict-boolean-expressions` slice landed an
  encounter-combat ratchet (leaf 07, `ebda17c7`); `doctor` JSON output
  (leaf 09).

## Where the details live

- Leaves, the verdict register, and the e2e selector per-file plan: git
  history before the folder removal (this summary's landing commit is the
  deletion point).
- The watchlist candidates that still need a human promotion decision (the
  testing-library ratchet drain, server strict-boolean expansion, structural
  sensors) were evidence-gated and not promoted; they live in the same git
  history and in the live `lint-ratchet.baseline.json` floors.
