# Leaf 16: Structural Sensors And Knip Gating

Status: Parked
Sources:

- `docs/agent_notes/backlog/lint-hardening/07-knip-unused-export-sensor.md`
- `docs/agent_notes/backlog/lint-hardening/18-structural-sensors.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Problem

Some repo-quality checks act like lint but are better expressed as scripts or
sensors. Current state:

- `knip` is clean but report-only through `doctor`.
- harness freshness and staged blob-size sensors landed.
- ASCII/smart-character hygiene was explicitly rejected for the earlier pass.
- spell-check and architecture-boundary sensors remain parked.

## Scope

Promote one sensor or gating decision at a time. Do not add broad hard gates
until report-only output is low-noise and repair paths are documented.

## Candidate Work

- Decide whether `bun run sensor:knip` should stay doctor-only or become a
  changed/full verification gate.
- Add a spell-check sensor for Markdown or user-facing copy with a small domain
  dictionary, starting report-only.
- Revisit staged blob-size gating only if report-only output stays low-noise
  and the allowlist remains small.
- Add architecture-boundary config checks only where ESLint import rules and
  existing local rules cannot express the policy.
- Do not revive ASCII/smart-character hygiene without a new user request or
  a concrete postmortem.

## Exit Criteria

- One sensor gets a clear report-only/gated/rejected decision.
- The decision is reflected in `doctor`, harness controls, generated docs, and
  the verdict register when applicable.

## Verification

- `bun run sensor:knip` if touching knip
- `bun run doctor`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run test:scripts:changed`
- `bun run verify:changed`
