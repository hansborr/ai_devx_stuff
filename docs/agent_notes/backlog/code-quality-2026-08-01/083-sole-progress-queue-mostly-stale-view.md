# 83. The repository's only in-progress queue lists eleven open items, and ten are already done, resolved in place, or point at deleted leaves

Status: Not started
Theme: active-work signal accuracy · Area: docs · Severity: high · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/agent_notes/in_progress/` is the designated active-work surface — the
folder README tells agents to promote work there only when it becomes active
again — and it contains exactly one file: a drain queue reconciled 2026-07-13.
That queue's "Open, bounded items" section lists eleven items, and ten of them
are contradicted by the Status headers of their own source packs, marked
resolved inside the queue itself, or reference leaf files that no longer exist.
Backlog drains are a routine agent workflow here, so the cost is concrete: an
agent (or human) who trusts the prominent active-work signal dispatches effort
at work that landed weeks ago, and anyone who has been burned once must
re-triage every source pack before trusting any entry — which defeats the
purpose of keeping a queue at all.

## Evidence

- `docs/agent_notes/in_progress/codex-drain-queue-2026-06-21.md` is the only
  file under `docs/agent_notes/in_progress/`; its `## Open, bounded items`
  section (:8-34) lists 11 items. Re-derived count: 10 of the 11 are stale —
  9 contradicted by source Status headers, 1 marked resolved in the queue
  itself; only 1 survives.
- Contradicted by source Status headers (9):
  - `testsuite-audit/32` (queue :10-12) — `docs/agent_notes/backlog/testsuite-audit/00-index.md:3`:
    "Status: Closed — all 55 findings landed". The `32-*` leaf the queue cites
    no longer exists in that directory.
  - `harness-research-followups-2026-06/02` (queue :19-20, "proposal remains
    unimplemented") — `docs/agent_notes/backlog/harness-research-followups-2026-06/02-design-token-lint.md:3`:
    "Status: Done — implemented 2026-06-22".
  - `harness-review-tasks/10`, `/14`, `/16`, `/51`, `/53` (queue :21-30) —
    `docs/agent_notes/backlog/harness-review-tasks/00-index.md:3`: "Status:
    Closed — every task row below is Done"; the five rows (index :31, :34,
    :36, :39, :41) each read Done. The leaf files for 10, 14, 16, and 53 were
    removed 2026-07-19, so four of the five "See
    `backlog/harness-review-tasks/NN-*`" pointers resolve to nothing (only
    `51-thin-spec-plan-template.md` remains on disk).
  - `codebase-audit/05` (queue :31-32) — `docs/agent_notes/backlog/codebase-audit/05-worktree-dev-flow-undocumented-for-humans.md:3`:
    "Status: Done"; the doc it says landed, `docs/guides/per-worktree-dev.md`,
    exists.
  - `codebase-audit/20` (queue :33-34) — `docs/agent_notes/backlog/codebase-audit/20-pages-dir-no-composition-root-doc.md:3`:
    "Status: Done"; the landed doc `packages/client/src/pages/MODULE.md` exists.
- Resolved inside the queue itself (1): `lint-fix-dist-preflight-parity`
  (queue :16-18) says "resolved — verified Done … and the note was removed at
  the 2026-07-19 triage", yet it still sits under "Open, bounded items".
- Genuinely open (1): `mutation-coverage-2026-06/75` (queue :13-15).
  `scripts/lint-ratchet/max-lines-policy.test.ts` still does not exist, and
  `docs/agent_notes/finished_work/mutation-coverage-2026-06.md:10-16` confirms
  #75 is the pack's sole residual.
- The one live item's pointer is circular:
  `finished_work/mutation-coverage-2026-06.md:13-15` says the item's "full test
  directions are inlined as a Tier-1 task" in the queue, but the queue's
  reconciled entry (:13-15) instead defers to "the archived source leaf
  referenced by the original queue" — and that pack folder was deleted, so the
  directions now live only in git history.
- `docs/agent_notes/README.md:34` — "Promote an item back into `in_progress/`
  only when it becomes active again": the folder is the lifecycle's
  active-work signal, which is why a mostly-backward view of it is expensive.

## Proposed direction

Retire or regenerate `docs/agent_notes/in_progress/codex-drain-queue-2026-06-21.md`
so it keeps only the still-open mutation-coverage residue item as a pointer to
its source leaf, states that source-pack Status headers are authoritative, and
drops every entry those headers contradict. One commit. Mechanics:

- Prefer regenerating in place over deleting the file:
  `finished_work/mutation-coverage-2026-06.md:15` links to this path, and
  `docs/agent_notes/LOG.md:51,60` reference it as history; rewriting keeps
  both pointers valid.
- The surviving `mutation-coverage-2026-06/75` entry should point at
  `docs/agent_notes/finished_work/mutation-coverage-2026-06.md` (which names
  the missing tests: `cacheKeyHashFor`/`usesEslintCache`, rule-source
  validators, `max-lines-policy` throw branches, license classification) and
  note that the full leaf text is recoverable from git history — breaking the
  current circular "see the queue" / "see the archived leaf" loop between the
  two files.
- Per the disposition, everything else goes: the ten stale bounded entries and
  the "Deferred or human/design-dependent" paragraph (:36-42), whose packs
  remain parked in `backlog/` — the default state `README.md:34` already
  describes, so nothing is lost.

## Scope / caveats

- Out of scope: re-litigating any source pack's Done status. The direction
  treats Status headers as authoritative; if someone believes an item (e.g.
  `testsuite-audit/32`) still has real residue, that is a new finding to file
  against the pack, not a reason to keep the queue entry.
- Out of scope: the structural check that every in-progress reference resolves
  and remains nonterminal. It was part of the original direction sketch, but
  it is new tooling, not part of this one-commit doc fix; propose it
  separately if wanted.
- Out of scope: implementing `mutation-coverage-2026-06/75` itself — the
  missing `max-lines-policy.test.ts` and friends stay open; this leaf only
  fixes how they are tracked.
- Do not delete `finished_work/mutation-coverage-2026-06.md`; it becomes the
  surviving entry's pointer target. Its ":15" claim that directions are
  "inlined" in the queue is already false after the 2026-07-13 reconciliation —
  update that sentence in the same commit if regenerating leaves it inaccurate.
- **Sequencing:** No hard ordering dependency with
  [084-backlog-simultaneously-action-queue-evidence.md](./084-backlog-simultaneously-action-queue-evidence.md),
  but if both land, whichever edits the backlog README last must reconcile its
  wording so the generated catalog, ready dispatch queue, and active-work queue
  remain distinct. Apart from that outcome-sensitive coordination, this leaf has
  no sequencing dependencies on other leaves in this pack.
