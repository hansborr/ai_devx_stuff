# Leaf 32: drift-ai Under-Ceiling Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-19-scripts-drift-ai-small-modules-adoption.md`
- `scripts/drift-ai/current-inventory.ts`
- `scripts/drift-ai/current-inventory.test.ts`
- `scripts/drift-ai/harness-freshness.test.ts`
- `scripts/drift-ai/comments.ts`

## Problem

Leaf 19 slice 5 adopted only the three `drift-ai` files that probed clean:
`errors.ts`, `scope.ts`, and `scope.test.ts`. Four more under-ceiling files
were carved out once the directory unignore exposed the real lint walk:

- `current-inventory.ts` and `current-inventory.test.ts`:
  `simple-import-sort/imports`.
- `harness-freshness.test.ts`: `@typescript-eslint/explicit-function-return-type`.
- `comments.ts`: complexity 21 plus
  `@typescript-eslint/restrict-template-expressions` and
  `regexp/no-unused-capturing-group`.

These files are small enough to drain early, but enforcement should still start
by ratcheting their current findings so new debt is blocked immediately.

## Scope

Adopt exactly the four files listed above. Do not include the 332+ line
`drift-ai` modules in this leaf; those are Leaf 33 / Leaf 34 work.

## Ratchet-First Enforcement

Before applying import-sort, return-type, complexity, template-expression, or
regexp fixes, add scoped ratchet coverage for the four files at their current
finding counts. If one of the needed rules is not supported by the ratchet
runner yet, extend the rule-source support first.

Coordinate ratchet IDs and file sets with Leaves 33 and 34. If Leaf 41 adds a
single broader `drift-ai` ratchet for the same rule, this leaf should drain that
shared baseline rather than adding overlapping sibling ratchets.

## Candidate Work

- Re-run the lint probe for the four files on the current branch.
- Add ratchet entries or a coherent ratchet scope for the four files with the
  current counts committed in `lint-ratchet.baseline.json`. For the same rule,
  avoid overlapping file membership with Leaves 33 and 34 unless one broader
  `drift-ai` ratchet intentionally owns the full file set.
- Apply import sort fixes in the current-inventory files.
- Add an explicit return type to the harness-freshness test helper.
- Refactor `comments.ts` so comment classification and candidate scoring stay
  under the complexity ceiling. Prefer extracted pure helpers with focused unit
  coverage over a rule override.
- Fix the template-expression and regexp findings directly.
- After the ratchet baseline reaches 0, add the four files to the `drift-ai`
  lint allowlist and script parser / `local/type-assertion-boundary` blocks.

## Exit Criteria

- The four files are protected by ratchets before cleanup starts.
- Ratchet ownership is clear: either this leaf owns disjoint file sets, or it
  drains a broader `drift-ai` ratchet established by Leaf 41.
- New or higher finding counts fail `bun run lint:ratchet`.
- Normal `bun run lint` adoption follows once the ratcheted findings are
  drained.
- Existing `drift-ai` CLI/report behavior is unchanged except for deliberate
  fixture updates.
- Leaf 19's `drift-ai` carve-out inventory is updated.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run drift:ai --scope current`
- `bun run drift:ai --scope current comments`
- Targeted `drift-ai` tests covering changed helpers
- `bun run test:scripts:changed`
- `bun run verify:changed`
