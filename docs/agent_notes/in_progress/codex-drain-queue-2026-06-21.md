# Codex drain queue — open residue (reconciled 2026-08-30)

**Source-pack `Status:` headers are authoritative.** This file is a pointer, not
a second register of what is open. Where it and a pack header disagreed, the
header won and the entry was deleted. It stays in `in_progress/` — rather than
being deleted — because `../finished_work/mutation-coverage-2026-06.md` and
`../LOG.md` link to this path as history.

## Open, bounded items

- `mutation-coverage-2026-06/75` — untested operational scripts with real
  logic. Four of the archived leaf's five test directions landed in full; the
  fifth landed its classification and SPDX-OR-join half, and its remaining half
  is the residue: `licenseFromNearbyFile` in
  `scripts/audit-dependency-licenses.ts` is still module-private and has no
  LICENSE-text-sniffing test. Full context, including what has landed, is in
  [`../finished_work/mutation-coverage-2026-06.md`](../finished_work/mutation-coverage-2026-06.md);
  the archived leaf's full test directions are recoverable from git history
  (the pack folder was removed in `832345a9`).

## Resolved since the 2026-07-13 reconciliation

That pass left eleven bounded items. A 2026-08-30 re-check
(`code-quality-2026-08-01` leaf 083) found ten of them already resolved when
they were written, and narrowed the eleventh to the single residue above.

- Contradicted by their own source packs: `testsuite-audit/32` (index reads
  `Closed — all 55 findings landed`), `harness-research-followups-2026-06/02`
  (`Done — implemented 2026-06-22`), `harness-review-tasks/10`, `/14`, `/16`,
  `/51`, `/53` (index reads `Closed — every task row below is Done`), and
  `codebase-audit/05` and `/20` (both `Done`, with `docs/guides/per-worktree-dev.md`
  and `packages/client/src/pages/MODULE.md` on disk). Four of the
  `harness-review-tasks` leaves those entries pointed at were removed
  2026-07-19, so the pointers resolved to nothing.
- `lint-fix-dist-preflight-parity` — this file already recorded it as resolved
  while still listing it under open items.
- `mutation-coverage-2026-06/75` was carried as open on the strength of a path
  that had moved: `max-lines-policy` left `scripts/lint-ratchet/` for
  `scripts/lib/` and was tested there.

The deferred and human/design-dependent work the 2026-07-13 pass listed
separately (golden-task eval harness, secret scanning, guardrail tripwire,
PR-size warning, and the original queue's risky-defer and live-DB/live-browser
items) needs no entry here: it stays parked in its `backlog/` packs, which is
the default state `../README.md` already describes.
