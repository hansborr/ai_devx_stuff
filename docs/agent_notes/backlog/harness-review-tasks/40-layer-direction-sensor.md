# 40 - Layer-direction report-only sensor

Status: Superseded -> drift-ai-next-items 22 (server layer-direction advisory, Done)
Track: A (architecture sensors)
Size: medium
Depends on: none
Blocks: 41

## Goal

Add a report-only architecture sensor for unambiguous server source layer
direction, starting with reverse-direction bans such as `utils` importing
`services` and `services` importing `routers`.

## Background

The current guidance explains package flow and service-layer taxonomy. Package
dependency policy already covers much of `shared -> server -> client`; the
uncovered gap from the review is within-package direction, especially
`routers -> services -> utils` assumptions that currently live mostly in prose.
Keep this as an advisory sensor until it has real run data and a low-noise
allowlist.

## Seams to touch

- `scripts/drift-ai/` or another existing report-only sensor home
- `scripts/drift-ai/README.md`, if implemented there
- Tests beside the chosen sensor
- `docs/ai-harness.md`

## What to do

1. Reconfirm existing import-boundary lint before building anything; do not
   duplicate a package dependency gate that already covers the same paths.
2. Add a report-only scan over TypeScript import edges for the first
   unambiguous reverse-direction bans:
   - `packages/server/src/utils/**` must not import `packages/server/src/services/**`;
   - `packages/server/src/services/**` must not import `packages/server/src/routers/**`.
3. Report file, imported specifier, resolved target layer, and repair hint.
4. Include a tiny explicit allowlist only for known legitimate exceptions.
5. Document that this is advisory and not a full architecture proof.

## Testing

- Add fixture tests for legal direction, reverse direction, type-only imports if
  relevant, relative paths, path aliases, and allowlisted exceptions.
- Run the focused test file and the sensor command against the repo.

## Out of scope

- Failing CI or pre-commit.
- Enforcing module facades; see task 41.
- General dependency-cycle detection.
