# Codex drain queue — open residue (reconciled 2026-07-13)

The original 2026-06-21 queue was reconciled against current code and git
history. Landed entries were removed from this note; the following work is
still open or deliberately parked. Source leaves remain authoritative for
full acceptance criteria.

## Open, bounded items

- `testsuite-audit/32`: migrate the remaining scripts tests to the shared
  temporary-repository helper. Evidence: one `function writeRepo` remains in
  `scripts/drift-ai`; see `backlog/testsuite-audit/32-*`.
- `mutation-coverage-2026-06/75`: add the residual tests, including the still
  missing `scripts/lint-ratchet/max-lines-policy.test.ts`; see the archived
  source leaf referenced by the original queue.
- `lint-fix-dist-preflight-parity`: resolved — verified Done at the
  sequential-drain reconciliation and the note was removed at the 2026-07-19
  triage (git history).
- `harness-research-followups-2026-06/02`: token-aware design lint; proposal
  remains unimplemented. See `backlog/harness-research-followups-2026-06/02-*`.
- `harness-review-tasks/10`: character-live-state module-doc/facade follow-up
  remains parked. See `backlog/harness-review-tasks/10-*`.
- `harness-review-tasks/14`: skill-description “Use when” grammar remains
  parked. See `backlog/harness-review-tasks/14-*`.
- `harness-review-tasks/16`: guide-routing/config advisories and MODULE
  breadcrumbs remain parked. See `backlog/harness-review-tasks/16-*`.
- `harness-review-tasks/51`: thin spec/plan template remains parked. See
  `backlog/harness-review-tasks/51-*`.
- `harness-review-tasks/53`: `logs:audit --latest` graceful degradation remains
  parked. See `backlog/harness-review-tasks/53-*`.
- `codebase-audit/05`: human-facing per-worktree development documentation
  remains a proposal. See `backlog/codebase-audit/05-*`.
- `codebase-audit/20`: pages-directory orientation documentation remains a
  proposal. See `backlog/codebase-audit/20-*`.

## Deferred or human/design-dependent

The remaining research follow-ups (golden-task eval harness, secret scanning,
guardrail tripwire, PR-size warning, and related design work), plus the
original queue’s risky-defer and live-DB/live-browser items, remain parked in
their backlog packs and are not suitable for autonomous drain without fresh
design or environment verification.

## Reconciliation evidence

Landed examples include commits `00651922`, `1c8bd0e5`, `1f606ffd`,
`0929d55d`, `84e03cdc`, `c7c06108`, `40ee9a26`, `f6fd1c81`, `88092cfd`,
`d49d3ca9`, `3c302f89`, and the fast-commit implementation `72c64d8d`.
The ghost-file pair is present in `drift-ai.config.json`.
