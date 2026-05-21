# Leaf 17: Generated Lint Guidance Decision

Status: Closed — kept and already expanded (2026-05-19)
Sources:

- `docs/agent_notes/backlog/lint-hardening/23-llm-core-generated-lint-guidance-spike.md`
- `docs/agent_notes/backlog/lint-hardening/25-diagnostic-rule-metadata.md`
- `docs/agent_notes/finished_work/lint-hardening-review-followup-pr-1-rule-contract.md`
- `docs/agent_notes/finished_work/lint-hardening-review-followup-pr-2-harness-manifest.md`

## Decision (2026-05-19)

**Keep and expand — already done.** Auditing the current state shows the
"spike" shape has already been folded into the durable rule-docs contract:

- `scripts/generate-lint-guidance.ts` iterates *every* `local/*` rule via
  `loadLintRuleDocs` (`scripts/lint-rule-docs.ts`), not the original
  three-rule slice. As of 2026-05-19 it emits 18 rule entries covering all
  rules under `eslint-rules/*.js`.
- `docs/generated/local-lint-rules.md` is regenerated from each rule's
  `meta.docs` contract that landed in PR 1.
- Freshness is enforced in CI: `bun run docs:lint-guidance:check` runs
  after Lint in `.github/workflows/ci.yml:71` (added in `944779fc`).
  `scripts/harness-check.ts:43` explicitly **exempts** the `:check`
  variant from manifest-parity validation — only the writer entry
  (`docs:lint-guidance`) is registered in `harness.controls.json` under
  the `doc-generator/lint-guidance` control. Behavior is also exercised
  by the script smoke `scripts/test-generate-lint-guidance.sh`, which is
  wired into `scripts/test-scripts.sh` (smoke runner + changed manifest).
- `docs/ai-harness.md` already names this doc as the local-rule reference
  (lines 71-72), so the agent-facing entry point is single-sourced.
- The generated harness controls manifest references the lint-rules doc by
  path (`scripts/fixtures/generate-harness-controls/expected.md:8`), which
  keeps the two outputs orthogonal (manifest = enumeration; lint-rules =
  per-rule principle + repair kind).

No further code work is required. The "decision pending" status on this
leaf was stale — recording the verdict here, in
`docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`, and in the
backlog index closes the loop.

## Why This Wasn't Folded or Deleted

- The harness controls manifest enumerates *controls*; the lint guidance
  doc enumerates *rule semantics + repair affordance*. Two different agent
  reading paths.
- Removing the doc would break the `docs/ai-harness.md` link without
  replacing the per-rule principle/repair surface that an agent uses to
  recover from a diagnostic.
- Generation cost is negligible (the generator is 140 lines and runs in
  well under a second under the script smoke harness).

## Exit Criteria

All previously-listed criteria are met:

- Decision is recorded (this file + verdict register + index).
- CI freshness check is in place (`docs:lint-guidance:check`).
- `docs/ai-harness.md` links only the durable generated doc — no spike
  notes remain.

## Verification (preserved for future audits)

- `bun run docs:lint-guidance:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-generate-lint-guidance.sh`
- `bun run test:scripts:changed`
- `git diff --check`
