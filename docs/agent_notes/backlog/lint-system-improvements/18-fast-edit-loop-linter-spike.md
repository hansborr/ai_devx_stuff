# Fast Edit-Loop Linter Spike

Status: Done
Order: 18 (promoted first by owner request)

## Context

The source review suggests considering oxlint or Biome for a fast,
approximate, post-edit tier covering mechanical rules that do not need type
information. ESLint would remain authoritative for pre-commit and CI.

Biome adapter guidance now lives in
`docs/guides/biome-lint-adoption.md`. That guide documents how a Biome adopter
could preserve custom repair guidance, the post-edit hook, and lint-ratchet
semantics; it does not replace this spike's measured latency and diff-churn
decision.

This is a measured spike because two lint tools can disagree and autofix churn
can fight Prettier or ESLint.

Re-evaluate the tool landscape at spike time. oxlint and Biome move quickly,
so do not rely on the rule parity or autofix behavior observed in the
2026-05-26 review.

## Scope

Install Biome and answer four questions with measured evidence:

1. **Compatibility:** Which of our ESLint rules does Biome cover? Which rules
   have no Biome equivalent or behave differently? Use `biome migrate eslint`
   as an inventory tool and spot-check the results.
2. **Performance:** How much faster is Biome than ESLint for single-file
   post-edit, changed-file, and full-project runs? Measure wall time on
   representative inputs.
3. **Implementation cost:** How much work is it to wire Biome into the lint
   pipeline (post-edit hook, ratchet adapter, CI)? Estimate scope, not just
   rule count.
4. **ESLint residual:** What must stay in ESLint? Custom local rules,
   type-aware rules, suggestion/codemod-backed repairs, and any rules where
   Biome's behavior diverges from current policy.

Also check for autofix conflicts: does Biome safe-fix churn against Prettier
or ESLint autofix on the same files?

The spike does not need to land a working Biome integration. If the answers
show Biome is not worth adopting (too much work, too many gaps, maintenance
burden), that is a valid outcome — update `docs/guides/biome-lint-adoption.md`
with the findings and record a reject decision.

If the answers are favorable, record an adopt or narrow decision and outline
the next implementation steps.

## Result

Completed on 2026-05-26 in `spike/biome-fast-edit-loop`. Outcome: narrow
non-adoption for production gates. Biome is fast enough to revisit as an
opt-in lint-only advisory tier, but ESLint remains authoritative for CI,
pre-commit, agent diagnostics, ratchets, custom rules, formatting ownership,
and import sorting.

Findings are recorded in `docs/guides/biome-lint-adoption.md` and
`docs/agent_notes/finished_work/biome-fast-edit-loop-spike.md`.

## Definition Of Done

The four questions above are answered with measured evidence. The adoption
guide is updated with findings regardless of the adopt/reject outcome.

## Verification

- Tool landscape note with audit date, exact versions, and commands tested
- Rule compatibility inventory (covered, missing, divergent)
- Latency measurements for representative runs
- Diff-churn comparison against Prettier and ESLint autofix
- Updated `docs/guides/biome-lint-adoption.md` with findings
- `bun run lint -- --max-warnings=0` still passes (no ESLint breakage)
