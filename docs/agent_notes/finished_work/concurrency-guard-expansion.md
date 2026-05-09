# Concurrency Guard Expansion Plan

Status: Archived. Baseline codemod, ESLint rule, and guide updates landed;
remaining optional hardening moved to
`../backlog/concurrency-guard-followups.md`.

## Summary

Expand the concurrency guard without removing current functionality. Keep
`bun run codemod:concurrency-guard` as the manual/full-scan interface, add an
automatic lint sensor for low-noise core violations, and add non-blocking
advisory output for broader concurrency-policy review.

This follows the archived
`docs/agent_notes/finished_work/concurrency-codemod-feasibility.md`: checker
first, no general auto-fixer, and no verify/pre-commit blocker until a manual
run is clean or only has reviewed allowlisted findings.

Defaults chosen from discussion:

- Integration: `local/concurrency-guard` ESLint sensor, promoted gradually.
- Expansion: strengthen current checks now, add advisory broader-policy checks
  behind warnings.
- Severity: shape-only core violations may become lint errors after bake-in;
  ambiguous classification, provenance, and broader policy/inventory findings
  stay codemod WARN/manual review.

## Key Changes

- Add `local/concurrency-guard` to the local ESLint plugin and enable it for
  server source after the bake-in gate below. It should internally ignore
  generated files, tests, and `__type-tests__`.
- Keep the codemod command and its existing categories. Refactor only enough so
  the codemod and lint rule share guard data, not necessarily matcher code.
- Add a shared contract module at `scripts/concurrency-guard-contract.js` (plain
  ESM + JSDoc so both JS ESLint rules and TS codemods can import it). It should
  contain gated delegates, mutators, helper shape configs, suggestions, known
  cross-table helper order, and documented advisory allowlists.
- Make lint responsible only for shape-only, low-noise checks:
  - raw gated mutators inside `utils/*-mutations.ts` that fail a documented
    Pattern A/B/C or non-CAS helper shape;
  - raw delegate alias/destructuring inside helper files, because aliases make
    the guard intentionally unanalyzable;
  - direct gated delegate mutator calls outside helper files when visible
    syntactically, as better diagnostics and cast/escape detection beyond the
    restricted-delegate type error.
- Keep `RawTxClient` import checking in the existing restricted-import lint rule
  and in the codemod; do not add a duplicate lint error for the same import.
- Keep ambiguous classification, type/flow/provenance checks, and transaction
  order inventory in the codemod. They are useful review signals but too
  fragile for blocking lint.

## Activation Gate

1. Land the shared contract and ESLint rule with `local/concurrency-guard` as
   warn or manual-only.
2. Run `bun run codemod:concurrency-guard -- --check` and focused lint on the
   current tree; fix findings or add reviewed allowlist entries.
3. Flip only the clean, shape-only lint cases to error.
4. After a clean manual run, let normal `lint:changed` / `verify:changed`
   enforce the rule. Do not add a separate pre-commit command.

## Detection Improvements

- Fix `assertTurnLock` shape detection: require the DM branch to include
  `id,state,round`, and the non-DM branch to include
  `id,state,currentTurnIndex,round`. Do not infer the required shape from the
  candidate code. If this becomes normative lint behavior, document the branch
  shapes in `docs/CONCURRENCY.md` in lockstep with the helper doc-comment.
- Add value/provenance checks where the current code only checks property names.
  Treat these as codemod checks unless they can be expressed as local
  syntax-only matching:
  - Pattern A: require the CAS version value to come from the fresh row or
    `expectedVersion`, and require `version.increment`.
  - Pattern B: require the counter WHERE value and data mutation to match the
    helper's documented counter flow. Keep the per-function counter map in the
    shared contract as a deliberate forcing function for new gated counter
    helpers.
  - Non-CAS helpers: check exact reset/upsert/update semantics, not just field
    presence.
- Expand zero-count handling recognition to accept `result.count === 0`,
  `!result.count`, and destructured `count` forms when they throw the documented
  `TRPCError` code.
- Add codemod-only WARN findings for broader policy:
  - known helper-call order inside transaction callbacks when it appears to
    violate documented lock order;
  - suppress or downgrade documented row-disjoint exceptions such as the
    spell-casting monster path from `docs/CONCURRENCY.md`;
  - new raw helper mutators that need docs/test review even if they are not yet
    classifiable.

## Tests

- Add ESLint rule tests for valid current helper shapes and invalid cases:
  delegate aliasing, destructuring, missing CAS fields, missing version
  increment, missing zero-count handling, and the `assertTurnLock` non-DM
  regression.
- Add codemod fixtures mirroring the new lint cases plus WARN-only advisory
  output.
- Add a codemod fixture for the `assertTurnLock` non-DM regression, not only
  the lint side.
- Add a golden test that all current helpers pass both tools via the shared
  contract, so the refactor cannot silently relax checks.
- Add a boundary test proving `local/concurrency-guard` does not report
  `RawTxClient` imports; the existing restricted-import rule owns that.
- Run focused checks:
  - `bun run vitest run --project=eslint-rules eslint-rules/concurrency-guard.test.js`
  - `bun run vitest run --project=scripts scripts/codemods/concurrency-guard.test.ts`
  - `bun run lint:changed`
  - `bun run verify:changed`

## Docs And Assumptions

- Update `docs/ai-harness.md`: list `local/concurrency-guard` as the automatic
  sensor only after activation, and keep the codemod as manual/advisory.
- Update `docs/guides/add-race-sensitive-mutation.md`: include the new lint rule
  and clarify that passing structural checks does not prove CAS correctness;
  invariant concurrency tests remain required.
- Update `docs/CONCURRENCY.md` for any helper shape that lint treats as
  normative, especially `assertTurnLock` branch shapes and documented
  cross-table lock-order exceptions.
- Assumption: this plan does not add new concurrency policy or new gated tables.
  It improves enforcement and review signals around the existing Pattern A/B/C
  surface.
