# Scripts Flat Family Reorg

Status: Parked
Date: 2026-07-03
Source: Deferred repo-audit finding from the docs/process staleness cleanup.

## Context

`scripts/README.md` says top-level companions should move under an owner
directory when they become a family. Three current flat families contradict
that contract:

- `lint-coverage-map-check*` - 9 files at `scripts/` top level.
- `client-test-isolation*` - 6 files at `scripts/` top level.
- `sensor-knip-unused-exports*` - 4 files at `scripts/` top level.

These may be worth moving into directories, or they may be intentional
exceptions because their top-level names make package scripts and path-policy
selection clearer. The important follow-up is to choose and document one
position.

Folded in from arch-review-2026-07 Tier 3 (2026-07-07): `scripts/harness-audit/`
is a hollow directory — fixtures only, while the logic lives in
`scripts/harness/harness-audit-report.ts`. Fold it into whichever position this
reorg picks (move the fixtures next to the logic, or document the split).

Resolved separately (2026-07-18): the `drift-triage*` flat family collapsed
into `scripts/drift-triage/` behind the flat `scripts/drift-triage.ts` entry
(the entry-plus-directory sibling idiom) via the drift-triage collapse (the
`drift-triage-collapse.md` note closed Done and was removed at the 2026-07-19
triage; git history). That idiom is the shape
this reorg can reuse for the remaining families.

## Scope

- Either move each family under an owner directory and leave only package-facing
  facades at top level, or record them as sanctioned exceptions in
  `scripts/README.md`.
- If moving, update imports, package scripts, harness controls, path-policy
  subjects, fixtures, and prose references in one slice per family.
- Run a reference sweep for old paths after each move.

## Verification

- Relevant focused script tests for any moved family.
- `bun run harness:check` if package scripts or harness controls change.
- `bun run test:scripts:changed` when path-policy selection changes.
