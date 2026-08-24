# 241. Share the repeated initiative-tracker participant test scenario

Status: Not started
Theme: Initiative-tracker tests clone the same participant scenario four times · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Four closely related initiative-tracker suites each build the same fully
populated Goblin participant over the shared structural fixture. Contract-field
or scenario-default changes therefore require four coordinated edits, and a
missed edit creates unexplained divergence within one component family.

The shared builder intentionally supplies neutral structural defaults; the
duplication is the initiative-tracker-specific scenario layered above it. That
scenario should have one local authority while individual cases continue to
state their meaningful deltas.

## Evidence

- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-row.test.tsx:29-44`
  — defines a Goblin participant scenario with eleven fixed fields followed by an
  override seam.
- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-row-info.test.tsx:41-56`
  — repeats the same builder, values, and override ordering.
- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-row-actions.test.tsx:24-39`
  — carries a third copy of the same scenario.
- `packages/client/src/components/campaign/combat/initiative-tracker/dm-participant-tools.test.tsx:16-31`
  — carries the fourth copy.
- `packages/client/src/test/fixtures-encounter.ts:32-44` — the existing
  `buildParticipant` supplies structural defaults and required-field typing,
  but does not own the initiative-tracker Goblin scenario.
- Measured at the pin: `rg -n '^function makeParticipant'
  packages/client/src/components/campaign/combat/initiative-tracker/*.test.tsx`
  returns exactly the four definitions cited above.

## Proposed direction

Add an initiative-tracker-local typed test helper, such as
`initiative-participant-scenarios.test-helper.ts`, that exposes the current
fully populated Goblin participant through `buildParticipant`. Accept
`Partial<EncounterParticipant>` overrides and spread them after the scenario
defaults so every existing case delta retains precedence.

Migrate the four private `makeParticipant` implementations to that helper.
Keep semantic fixture names, test-specific overrides, assertions, and render
helpers unchanged. The shared scenario must retain the current identity,
initiative, HP, AC, and challenge-rating values field for field.

Verify the refactor through the four focused suites with the registered
`bun run test -- <files>` path, passing the four explicit test filenames rather
than a directory selector.

## Scope / caveats

- Keep the helper under `initiative-tracker/` unless a concrete consumer outside
  that component family appears.
- This is a test-fixture refactor only; do not change production encounter
  contracts, component behavior, scenario values, or assertions.
- [058-vtt-spell-tests-copy-full.md](./058-vtt-spell-tests-copy-full.md) owns the
  separate VTT drawer spell-fixture conversion. Do not fold that work or its
  spell builder into this helper.
- Prior-pack
  [code-quality-2026-07-25/40-PLAN.md](../code-quality-2026-07-25/40-PLAN.md)
  (CQ25-13) schedules other concrete fixture slices, but none covers this
  client initiative-tracker scenario.
