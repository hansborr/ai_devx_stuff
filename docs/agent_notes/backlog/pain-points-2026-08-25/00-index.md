# Musi Pain-Point Backlog — 2026-08-25

Status: Planning-complete pack
Date: 2026-08-25

Second reconciliation of the persisted Musi pain-point collection
(`/home/node/persist/musi/pain_points.log` and its thirteen topic notes)
against the live tree at HEAD and existing backlog ownership. The previous
pass is `../pain-points-2026-07-29/`; this pack does not reopen anything that
pack closed. Thirteen parallel reconciliation passes (one per note) checked
every observation, moved verified-fixed items into each note's `Resolved`
section with a live-tree citation, pointed still-open items at their owning
leaf so they are not re-proposed, and drafted a leaf only where a bounded S/M
change makes the pain point go away.

This is an orchestration surface, not a second ready queue. Fixed, duplicate,
external, too-large, insufficient-evidence, and owner-decision findings are in
[the disposition ledger](01-sources-and-verdicts.md).

## Disposition

| # | Item | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 01 | [Fix codex.md's false claim that review prompts compose with diff flags](agent-cli-01-fix-codex-review-prompt-composition-doc.md) | P2 | S | Implemented |
| 02 | [Document the self-edit hazard for agent-run.sh and agent-wait.sh](agent-cli-02-document-wrapper-self-edit-hazard.md) | P3 | S | Implemented |
| 03 | [Add `.husky/pre-commit` as a `test-harness-check` smoke subject](harness-registration-01-add-pre-commit-as-harness-check-subject.md) | P2 | S | Implemented |
| 04 | [Name the land-time hard failure in the generated-surface staleness warning](harness-registration-02-name-hard-failure-in-stale-surface-warning.md) | P2 | S | Implemented |
| 05 | [Add a "new workspace package" registration checklist](harness-registration-03-add-workspace-package-checklist.md) | P2 | S | Implemented |
| 06 | [Warn on redundant max-lines exception caps](lint-ratchet-01-warn-on-redundant-max-lines-caps.md) | P2 | S | Implemented |
| 07 | [Document that untracked files are invisible to lint-ratchet update](lint-ratchet-02-document-untracked-files-invisible-to-ratchet.md) | P3 | S | Implemented |
| 08 | [Port review-convergence working rules into the agent-cli skill](subagents-01-port-review-convergence-rules-to-skill.md) | P2 | M | Implemented |
| 09 | [Isolate `test-test-scripts.sh` from ambient `MUSI_SCRIPTS_CONCURRENCY`](test-fixtures-01-isolate-scripts-concurrency-self-test.md) | P2 | S | Implemented |
| 10 | [Document the ai-hooks-suite / git-commit-quiet chaining deadlock](test-fixtures-02-document-ai-hooks-commit-chaining-deadlock.md) | P2 | S | Implemented |

Six of the ten are documentation-only (01, 02, 05, 07, 08, 10); four change
hook, test, or tooling code (03, 04, 06, 09 — 04 edits `.husky/pre-commit`'s
warning text and adds a `test-dependency-freshness.sh` fixture case). All ten
are independent; there are no ordering edges.

## Suggested dispatch grouping

- **Skill/reference docs, one lane:** 01, 02, 08 all edit
  `.claude/skills/agent-cli/**` and end with `bun run harness:skills:refresh`;
  landing them together avoids three separate mirror regenerations.
- **Hook/test/tooling code, separate lanes:** 03, 04, 06, 09 each have a
  focused test suite named in their Verification section and no shared
  files (04 touches `.husky/pre-commit` and
  `scripts/tests/test-dependency-freshness.sh`, which 03's
  `test-harness-check.sh` header change does not).
- **Standalone docs:** 05, 07, 10.

## Owner decisions before dispatch

- Leaf 10 carries an open question: whether the guide's own recommended
  foreground `bun run verify && git commit` bridge shares the reproduced
  deadlock. The leaf deliberately does not rewrite that guidance; the owner
  should either reproduce it or accept the narrower rule as written.
- Leaf 08 ports seven review-conduct rules into the skill; the owner may want
  to trim the set before dispatch to keep skill-doc size in check.

## Residue not in this pack

The ledger lists the still-open items that did not become leaves. The two
most consequential, both owner decisions, are the whole-verify timeout from a
hung `test-skill-dispatch-wrappers` suite that does not reap its backgrounded
wrappers (no per-suite deadline exists in `scripts/test-scripts.sh`), and the
`eslint-rules/**` and `tools/lint-ratchet/src/**` coverage floors, which are
10–16 points under their committed thresholds across dozens of files.
