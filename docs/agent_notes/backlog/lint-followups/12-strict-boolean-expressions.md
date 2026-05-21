# Leaf 12: strict-boolean-expressions

Status: Deferred after inventory
Sources:

- `docs/agent_notes/backlog/lint-hardening/09-ts-eslint-stricter-optins.md`
- `docs/agent_notes/in_progress/lint-hardening-leaf-9-pass-2-buckets.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Problem

`@typescript-eslint/strict-boolean-expressions` found 423 findings. Each
truthiness check may be a real bug or an intentional JavaScript guard, so a
global enablement pass would create broad semantic churn.

## Scope

Roll out package-by-package or module-by-module. The source note recommends
starting with shared, then e2e/scripts, then smaller server/client slices.

If the team wants to use the ratchet for this rule instead of pure scoped
adoption, promote `22-ratchet-third-party-type-aware-rules.md` first, then
`23-strict-boolean-ratchet-candidate.md`. The current ratchet runner only
supports `local/*` rules.

## Candidate Work

- Re-run inventory against the current branch and group findings by package
  and common pattern.
- Pick one package or module family.
- Fix ambiguous checks with explicit comparisons:
  - `value != null` for nullish presence,
  - `value !== ""` when empty string must be rejected,
  - `count > 0` or `count !== 0` for numeric branches,
  - `flag === true` or `flag !== true` depending on semantics.
- Add scoped disables only when deliberate truthiness is clearer than an
  explicit comparison, with a reason.
- Consider narrow rule configuration only after inventory proves the intended
  semantics.

## Exit Criteria

- One coherent slice is clean under the rule.
- The enabled scope grows, or the verdict records why that slice remains
  deferred.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- Targeted tests for production branches changed
- `bun run verify:changed`
