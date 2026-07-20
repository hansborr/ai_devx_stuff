# Harness Research Follow-ups (2026-06-15)

> **Status: largely landed (reconciled 2026-07-19). DL-1 and A11Y-1 are Done**
> — the token-aware Tailwind lint landed 2026-06-22 (`c7ed8c00`, hardened
> `ee5f0358`) and the axe-core e2e smoke landed 2026-06-22 (`d49d3ca9`); their
> leaf files stay as the cited design records. **PB-1's drain-leaf scope is
> Done** — fast-check infra + character-rules (`3c302f89`), spellcasting /
> armor-class / dice (`d10d67b9`, drain leaf 5.1); the `attack-damage.ts` /
> `xp.ts` residue is tracked in `../ready-2026-07/00-index.md`. EV-1 is the
> only untouched proposal; the three design-gated leaves stay gated.
> This pack is a second round of follow-ups from the harness-engineering
> research notes, created after cross-checking each top recommendation against
> what the repo already enforces. Sibling pack:
> `../harness-strictness-comprehension-2026-06/` (TS strictness ratchets + PR
> comprehension template).

## Source

`../../harness-engineering-research/` — primarily:

- `05-test-suite-architecture.md` (property + contract tests, mutation gate)
- `07-ui-design-systems-enforcement.md` (token lint, two-layer a11y)
- `14-security-and-supply-chain.md` (secret scanning, leash-locking)
- `15-evals-and-observability.md` (codebase-grounded eval suite)
- `17-team-process-and-org.md` (shrink the review unit)

## Already covered — not re-proposed here

The repo is already mature on the deterministic floor. These research
recommendations are **implemented** or **parked elsewhere**, so they are out of
scope for this pack:

- Mutation testing → `../mutation-testing-stryker.md` + scoped Stryker in
  `../harness-presentation-2026-06/`.
- TS strictness flags / PR comprehension → `../harness-strictness-comprehension-2026-06/`.
- Dead code (Knip), barrel ban, package boundaries, import cycles,
  `tsc --noEmit` gate → implemented (`knip.config.ts`, `eslint-rules/no-barrel.js`,
  `eslint-config/package-boundary-configs.js`, `scripts/lint-import-cycles.sh`,
  `scripts/typecheck.sh`).
- SAST (semgrep) → `../semgrep-drift-sensor-research.md` /
  `../semgrep-drift-ai-implementation-plan.md`.
- Storybook / component catalog → `../storybook-component-catalog.md`.
- Agent network sandbox, dependency cooldown → implemented
  (`.devcontainer/init-firewall.sh`, `bunfig.toml` `minimumReleaseAge`).
- Context-budget reporter → `../harness-presentation-2026-06/` (M2).

Several team/process recommendations are **N/A for a single-author repo**
(merge queue, "agent cannot approve its own PR", extended-DORA AI-vs-human
metrics, OIDC publishing) and are deliberately omitted.

## Items

### Ready to promote (concrete plans)

| ID | Item | Plan | Effort | Risk |
| --- | --- | --- | --- | --- |
| PB-1 | Property-based tests for the rules engine (fast-check) — **Done (drain-leaf scope)**: infra + character-rules (`3c302f89`), spellcasting/armor-class/dice (`d10d67b9`, 22 tests, drain leaf 5.1); `attack-damage.ts`/`xp.ts` candidates remain but were outside leaf 5.1's seed set | [01](01-property-based-testing-fast-check.md) | M | low |
| DL-1 | Token-aware design lint — **Done** (`eslint-rules/no-arbitrary-tailwind-value.js` + `ratchet/local-no-arbitrary-tailwind-value-client`, `c7ed8c00`/`ee5f0358`, 2026-06-22; leaf kept as the ratchet's cited principle doc) | [02](02-design-token-lint.md) | M | low |
| EV-1 | Codebase-grounded golden-task eval harness | [03](03-golden-task-eval-harness.md) | L | medium |
| A11Y-1 | Runtime a11y checks — **Done** (`e2e/a11y.spec.ts` + `@axe-core/playwright`, `d49d3ca9`, 2026-06-22) | [04](04-runtime-a11y-axe-e2e.md) | S-M | low |

### Design-gated — DO NOT IMPLEMENT YET

These three are real gaps, but how they should work in *this* repo (solo author,
existing pre-commit budget, existing ratchets) is unresolved. Each leaf carries
a do-not-implement banner and a list of open questions that must be answered
before any code. Do **not** promote these during routine backlog draining.

| ID | Item | Plan | Effort | Risk |
| --- | --- | --- | --- | --- |
| SEC-1 | Secret scanning (gitleaks/trufflehog) in pre-commit + CI | [05](05-secret-scanning.md) | S+ | design-gated |
| PR-1 | PR diff-size warning (~300-line soft warn) | [06](06-pr-size-warning.md) | S | design-gated |
| GC-1 | Guardrail-config change tripwire (solo-repo CODEOWNERS) | [07](07-guardrail-config-tripwire.md) | S-M | design-gated |

## Suggested sequencing

1. **PB-1** first — purely additive tests over existing pure functions, no
   behavior change, immediate defect-catching value, and it seeds a reusable
   property-testing pattern.
2. **A11Y-1** next — small, additive, complements the existing static
   `jsx-a11y` gate.
3. **DL-1** as a measured ratchet — author the rule, then drain the ~84
   arbitrary-value findings (do not block on the intentional canvas hex).
4. **EV-1** when there is appetite for measurement infrastructure; it is the
   heaviest and most open-ended.
5. The design-gated trio (**SEC-1 / PR-1 / GC-1**) only after their open
   questions are answered by a human decision.

## Non-Goals

- Do not add slow or noisy checks to `verify:changed` / pre-commit without a
  latency and repair-text review (the pre-commit budget is already ~260-300s).
- Do not implement the design-gated trio as part of normal backlog draining.
- Do not introduce a second design-token source of truth; `DESIGN.md` +
  `packages/client/src/app.css` `@theme` remain authoritative.
