# Leaf 23: strict-boolean-expressions Ratchet Candidate

Status: Resolved 2026-05-19 — `ratchet/strict-boolean-expressions-shared`
landed for `packages/shared/src` and was drained to 0 current findings.
Sources:

- `docs/agent_notes/backlog/lint-followups/12-strict-boolean-expressions.md`
- `docs/agent_notes/backlog/lint-followups/22-ratchet-third-party-type-aware-rules.md`
- `docs/agent_notes/backlog/lint-hardening/09-ts-eslint-stricter-optins.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Problem

`@typescript-eslint/strict-boolean-expressions` was deferred after an inventory
found 423 findings. Leaf 23 used the new third-party/type-aware ratchet support
to land a scoped shared-package ratchet, then drained its baseline to 0 current
findings. This note remains provenance for the first scoped rollout.

The original blocker was not that the rule is low-value; it was that global
enablement would require broad semantic review. Leaf 23 proved the scoped
ratchet shape for `packages/shared/src`; future work should use fresh inventory
for any e2e/scripts/server/client rollout instead of reopening this completed
candidate.

## Historical Scope

Historical goal: evaluate `strict-boolean-expressions` as the first
third-party/type-aware ratchet. That scoped rollout landed; this is not
permission to enable the rule globally.

Start with the smallest useful ratcheted surface. The older inventory
recommended shared first, then e2e/scripts, then smaller server/client slices.
Re-run the inventory before choosing the actual scope.

## Historical Candidate Work

- Re-run the rule inventory on the current branch and group by package, module,
  and truthiness pattern.
- Decide whether the first ratchet scope should be:
  - `packages/shared/**/*.{ts,tsx}`,
  - e2e and linted scripts,
  - one server service/router family, or
  - one client module family.
- Pick rule options that match the intended semantics before creating a
  baseline; do not rely on default options without reviewing their treatment of
  nullable strings, nullable numbers, nullable booleans, and optional objects.
- Add a ratchet registry entry and manifest control only after Leaf 22 support
  exists.
- Generate a deterministic baseline and record the current count.
- Fix a small coherent slice if easy, then update the baseline improvement in
  the same change.
- Record any option or scope decision in the verdict register if the outcome is
  defer, reject, subset, or full adoption with caveats.

## Historical Exit Criteria

- New ambiguous truthiness checks cannot be added in the chosen ratcheted
  scope, or the leaf records why the ratchet shape is still not ready.
- Existing findings remain visible and drainable without blocking unrelated
  work outside the selected scope.
- The ratchet baseline, harness manifest, and generated docs agree.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint`
- `bun run typecheck`
- Targeted tests for any production branches changed
- `bun run verify:changed`
