# 53. `lint:agent:local-rules` and `docs:lint-guidance:check` are wired into no gate — decide and document each

Status: Done — implemented on 2026-07-04; review follow-up hard-enforced `harness:check` freshness.
Lens: pipeline · Area: gate wiring · Severity: low-med · Size: S · Confidence: high
Theme: gate-wiring · Source: Musi lint deep-dive 2026-07-04 (Explore verify-gate trace + Codex lane C)

## Problem
Two lint-family commands exist outside every gate:
- `lint:agent:local-rules` — intentionally advisory per the documented
  severity semantics (envelope for agents/hooks, not a merge gate), but that
  intent lives in `docs/guides/local-eslint-rules.md` prose, not next to the
  slot manifest where the next harness engineer will look.
- `docs:lint-guidance:check` — the generated local-rule catalog's drift
  check runs only inside `harness-check.ts`; the pre-commit generated-surface
  staleness WARN covers `verify:steps:check`, `harness:wiring:check`, and
  `docs:harness-controls:check`, but not lint-guidance. A rule-docs edit can
  land with a stale generated catalog until some later harness-check run.

## Evidence
- Explore trace 2026-07-04: both absent from all four consumers in `scripts/verify/steps.generated.sh:11-15`.
- `.husky/pre-commit:187-189` — staleness WARN trio without lint-guidance; `scripts/harness-check.ts:67` — the only checker invocation.
- `docs/guides/local-eslint-rules.md` "Severity Semantics" — the intentional-advisory rationale for lint-agent.

## Proposed direction
Decision:
- `lint:agent:local-rules` stays advisory and intentionally outside
  verify/pre-commit slots. The control manifest now records that decision next
  to the lint-agent entries, pointing future harness work back to
  `docs/guides/local-eslint-rules.md#severity-semantics`. Normal lint and the
  ratchet remain the merge gates; the agent envelope keeps its warning
  semantics for local repair guidance.
- `docs:lint-guidance:check` is wired as a WARN-level pre-commit freshness
  probe, matching the existing generated-surface checks. It now runs when
  harness generated surfaces are staged and when lint-guidance inputs are staged
  (`eslint-rules/`, `eslint-config/local-plugin.js`,
  `scripts/generate-lint-guidance.ts`, `scripts/lib/lint-rule-docs.ts`, or
  `docs/generated/local-lint-rules.md`). This is intentionally a cheap
  pre-commit advisory, not another full verify slot; `harness:check` runs the
  lint-guidance generator in `--check` mode, so CI hard-enforces the generated
  catalog through the harness gate.

- lint-agent: keep advisory; add one line to `harness.controls.json` metadata
  (or a comment in the generated steps header) recording "intentionally not
  a gate slot — see local-eslint-rules.md#severity-semantics" so the absence
  reads as a decision, not an omission.
- guidance check: add `docs:lint-guidance:check` to the pre-commit
  generated-surface WARN set (it is cheap), or to the full-verify scripts
  slot; pick WARN-level to match its siblings.

## Scope / caveats
- One small commit; no behavior change for lint-agent.
- Review follow-up made the decision text literal: `harness:check` now checks
  `docs/generated/local-lint-rules.md` freshness instead of only exempting the
  `docs:lint-guidance:check` package script from parity.
