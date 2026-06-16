# Lint Followups 2026-06 Task Pack

Status: Task index — see "Working This Pack" for how to pick and finish work
Created: 2026-06-12
Source: close-out review of `lint-review-2026-06` (all 23 ordered leaves
Done, merged via `feat/lint-improvements`, 1eb011d4) plus promotion of the
watchlist entries that became actionable when sub-leaf 03l landed. Every
fact below was verified against the working tree on 2026-06-12, not copied
from the prior pack.

## Verification Summary

Confirmed on 2026-06-12:

- `bun run lint:ratchet:summary`: 9 ratchets, 6 at zero findings. The only
  nonzero ratchets are the three e2e selector floors:
  `ratchet/local-e2e-prefer-role-selectors` (100 findings, 19 files),
  `ratchet/playwright-no-nth-methods-e2e` (38, 13 files), and
  `ratchet/playwright-prefer-native-locators-e2e` (34, 11 files) — 172
  findings across 21 distinct files. Per-file counts are in the 03 umbrella.
- `bun run drift:ai -- --scope current --check import-cycles`: 21 findings
  in ~1s. Exactly 2 are runtime cycles:
  `packages/client/src/pages/campaign-detail-page.tsx` <->
  `packages/client/src/routes/campaign-detail-route.ts`, and
  `scripts/codemods/structured-logging-fix-transforms.ts` <->
  `scripts/codemods/structured-logging-fix.ts`. The other 19 are type-only
  SCCs (reported as evidence, not defects).
- `docs/agent_notes/in_progress/lint-coverage-hook-throttle.md` is stale:
  its work landed in 006564e6 ("fix(lint-hooks): throttle partial ratchet
  notes"); the note's own closing line says to fold the durable bits into
  `LOG.md` and delete it.
- `worktrees/lint-review` is clean and checked out on the fully merged
  `chore/lint-review-2026-06` branch. `worktrees/exploration` is on the
  unmerged `chore/react-lints` branch — leave it alone.
- Agent note: `bun run lint:ratchet:report` formats a diagnostics envelope
  read from stdin; running it bare fails with a JSON EOF parse error. That
  is by design, not a bug.

## Working This Pack

1. Work exactly one leaf per run: resume the leaf marked `In Progress` if
   one exists, otherwise take the first leaf in Ordering whose `Status:` is
   not `Done`. The Ordering is a valid execution order — every dependency
   points at an earlier entry, so no dependency checking is needed beyond
   going top to bottom.
2. Each leaf records its own state in its `Status:` line. Vocabulary:
   `Parked` (not started), `In Progress` (optionally with a WIP note),
   `Blocked — <reason>`, `Done (<date>, <landing commit>)`. Nothing else
   tracks leaf state — there is no separate checklist.
3. When finishing a leaf, add short notes in the leaf (decisions, surprises,
   deferred bits) and commit the status edit with the code change. Each leaf
   gets its own `feat/`/`fix/` branch forked from the
   `integration/lint-followups-2026-06` tip and merges (`--no-ff`) back into
   that integration branch — not `main`. The whole pack is re-reviewed on the
   integration branch and merged to `main` only at the end (leaves 01-04
   landed on `main` before this convention; 05 onward collect on the
   integration branch).
4. Re-verify the file/line references in the leaf before editing; this pack
   was written on 2026-06-12 and the surfaces move quickly.
5. Rule/plugin/sensor evaluations record their verdict in
   `evaluation-verdicts.md` (this folder's register; the prior pack's
   register is archived with it).
6. Not workable: `00-index.md` (this file),
   `03-e2e-selector-drain-method.md` (shared context for the 03 sub-leaves),
   `evaluation-verdicts.md` (verdict register), and `watchlist.md`
   (evidence-gated candidates that need a human promotion decision; to act
   on one, write a new numbered leaf and add it to the Ordering).

## Ordering

Housekeeping first (01, 02), then the selector debt drain (03 sub-leaves,
largest files first so the debt curve bends early), then the runtime-cycle
fix and its gate decision (04, 05), then evaluations and promoted watchlist
items (06-10).

1. `01-close-out-lint-review-pack.md` — archive the completed
   `lint-review-2026-06` pack and delete the stale in-progress note.
2. `02-merged-branch-worktree-cleanup.md` — remove the leftover lint-review
   worktree and prune fully merged branches.
3. `03a-drain-character-sheet-po-selectors.md` — drain
   `character-sheet.po.ts` (37 findings).
4. `03b-drain-spells-panel-po-selectors.md` — drain `spells-panel.po.ts`
   (34 findings).
5. `03c-drain-campaign-po-family-selectors.md` — drain the six campaign
   page objects (31 findings).
6. `03d-drain-encounter-wizard-vtt-selectors.md` — drain `encounter.po.ts`,
   `character-wizard.po.ts`, `vtt-drawer.ts` (25 findings).
7. `03e-drain-entry-auth-selectors.md` — drain the auth/entry page objects
   and setup files (26 findings).
8. `03f-drain-spec-file-selectors.md` — drain the three spec files
   (19 findings).
9. `03g-promote-selector-rules-after-drain.md` — promote the three selector
   rules to unconditional `error` and retire the drained ratchets
   (terminal; requires 03a-03f).
10. `04-fix-runtime-import-cycles.md` — break the two runtime import
    cycles.
11. `05-runtime-import-cycle-gate-decision.md` — implement the
    runtime-cycle floor as a lane in the lint composite (placement
    pre-decided at pack review; after 04).
12. `06-client-test-quality-plugins.md` — evaluate
    `eslint-plugin-testing-library` + `eslint-plugin-jest-dom` for client
    component tests.
13. `07-strict-boolean-expressions-server-slice.md` — fresh server-package
    inventory; land the first slice or record a defer verdict.
14. `08-max-lines-policy-single-source.md` — single-source the max-lines
    policy (caps, ignores, reasons, lifecycle labels).
15. `09-lint-tool-doctor-parity.md` — make required lint tools and versions
    visible through doctor.
16. `10-semgrep-first-party-ai-footguns.md` — bootstrap the first-party
    ai-footguns semgrep pack with a calibration kill criterion.

## Dependencies And Coupling

- 03g is terminal for the 03 family: it must not run until 03a-03f have
  drained every file, and it retires the debt-file override sets the prior
  pack's leaf 04 introduced.
- Leaf 05 depends on 04 (a gate on runtime cycles only makes sense at zero
  findings) and follows the structural-sensor precedent recorded in the
  prior pack's Leaf 05 verdict: gate only after low-noise report-only
  output and repair text exist.
- The 03 drain leaves may need small client accessibility fixes (accessible
  names/roles) — that overlaps `docs/agent_notes/ux-audit-2026-06-06.md`
  P1-9; prefer fixing the component over reaching for `getByTestId`.
- Leaf 10 coordinates with `backlog/semgrep-drift-ai-implementation-plan.md`
  (the lane's plan and calibration history) — read it first.
- Related queues this pack deliberately does not duplicate:
  `backlog/drift-ai-next-items/` (diagnostics spine and prototype lenses),
  `backlog/drift-ai-current-findings.md` (duplicate-range and ghost-file
  follow-ups), `backlog/harness-review-tasks/` (docs/feedforward items),
  and `backlog/ux-audit-2026-06-p0/` (product blockers from the live-play
  audit).
