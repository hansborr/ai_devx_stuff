# 52 — AI harness calls blocking suppression checks manual/report-only

Status: Done
Track: DOC (docs) · Priority: P2 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The stale rows were compared with the shell aggregator, package script, and generated consumer list. All four gate consumers enforce both suppression registers.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/ai-harness.md:283-284` — the ESLint register is described under doctor/smoke coverage and the TypeScript/Stryker register as report-only and manual.
- `scripts/lint-suppressions.sh:15-18` — the blocking aggregator runs both register families.
- `package.json:72` — `lint:suppressions` is a root command.
- `scripts/verify/steps.generated.sh:12-15` — full verify, changed verify, parallel verify, and pre-commit all consume the suppression slot.

Failure: An adopter studying the public map can treat prohibited suppressions as advisory until the commit gate unexpectedly blocks them.

## Do

Update both sensor rows to name `bun run lint:suppressions` and its four generated consumers. Prefer linking to generated controls inventory rather than duplicating lifecycle detail. This is post-implementation drift extending [lint-deep-dive leaf 50](../lint-deep-dive-2026-07/50-suppression-registers-into-commit-gate.md).

## Verify

```
bun run docs:harness-controls:check && bun run harness:check
```

## Acceptance

- Both suppression-register rows describe blocking gate behavior.
- Consumer details agree with the generated control inventory.
