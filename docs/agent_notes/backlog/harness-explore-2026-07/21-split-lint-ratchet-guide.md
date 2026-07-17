# 21 — Split the merge-conflict runbook out of lint-ratchet.md

Status: Done — merge runbook split out with compatibility anchor and parity guards repointed
Track: DOC (docs) · Priority: P3 · Size: S

## Evidence (verified 2026-07-11; re-verified 2026-07-16 before implementation)

- `docs/guides/lint-ratchet.md` was 1464 lines and conflated "first ratchet in
  10 minutes", the full command reference, and the three baselines'
  merge-driver mechanics. The 2026-05 harness review
  (`docs/agent_notes/harness-review-2026-05/01-current-state-and-audit.md`)
  already flagged the guide's size when it was 921 lines.
- Lines 671-995 (`## Merge Conflicts`, up to `## Zero-Baseline Lifecycle`)
  read as an operational runbook — conflict recipes, driver fallback
  semantics, recovery mechanics — rather than guide material.
- The section is load-bearing for two doc-parity guards in
  `scripts/tests/test-lint-ratchet.sh`, both hard-coded to
  `docs/guides/lint-ratchet.md`:
  - the conflict-recipe sync check (~line 784) compares the
    `<!-- lint-ratchet-baseline-conflict-recipe:start/end -->` block in the
    guide against the heredoc in
    `scripts/git/lint-ratchet-baseline-merge-driver.sh`;
  - `assert_max_lines_exceptions_fallback_recipe` (~line 815) greps the guide
    for the max-lines merge-handling sentences.
  The test's `# smoke-subjects:` header (~line 51) also lists the guide, and
  the guide appears in the generated
  `scripts/path-policy/path-policy-smoke-subjects-data.ts`.
- Inbound anchors to the section: `docs/guides/lint-ratchet-adoption.md:93`
  linked the old `merge-conflicts` anchor; `docs/guides/lint-overview.md:122`
  routes "merge conflicts" readers to the guide.
- `harness.controls.json` / rule `meta.docs` `pairedGuide` entries point at
  the main guide file, not the section — they stay valid after a split.
- Note: `scripts/doc-length-policy.sh` does NOT apply here — it is a sourced
  function library (running it directly is a no-op) and its policy explicitly
  covers only AGENTS.md/CLAUDE.md/DECISIONS.md/agent_notes files, with no
  budget on `docs/guides/`. It is not a valid verify step for this task.

## Do

Split the merge-conflict/merge-driver runbook (lines 644-937) into its own
doc (e.g. `docs/guides/lint-ratchet-merges.md`), cross-link both ways, and:

- Move the `lint-ratchet-baseline-conflict-recipe` marker block intact and
  repoint the recipe-sync check in `scripts/tests/test-lint-ratchet.sh` (and
  the `guide=` path in `assert_max_lines_exceptions_fallback_recipe`) at the
  new doc.
- Update the test's `# smoke-subjects:` header to include the new doc and
  regenerate the smoke-subjects data/fixture (`bun run test:scripts:subjects`;
  commit the two generated files).
- Update inbound anchors: `docs/guides/lint-ratchet-adoption.md:93`
  (the old `merge-conflicts` link) and the `lint-overview.md` routing-table row.
- Sanity-check `pairedGuide` references and regenerate docs if needed
  (`bun run docs:harness-controls:check`); they should be unaffected since
  they target the main guide file.

## Verify

```
bun run test:scripts:file -- scripts/tests/test-lint-ratchet.sh
bun run harness:check
bun run docs:harness-controls:check
```

## Acceptance

The main guide fits a single read and stays task-oriented; merge mechanics
live in a linked runbook; the recipe-sync and max-lines doc-parity guards
pass against the new doc; smoke-subjects data is regenerated; no dangling
guide references or anchors.
