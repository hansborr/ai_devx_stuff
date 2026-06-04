# 39 - prototype advisory output contract

Status: Parked
Track: P
Size: small-medium
Depends on: none
Blocks: 41, 41c, 42b, 42c, 43, 44a, 44b, 45a, 45b, 46, 47, 48

## Goal

Define and implement the shared output contract prototype/heavy drift-ai lenses
use before they have evidence to become real checks.

## Background

`hotspots` and `coldspots` already solve the important trust problem: their JSON
top level is advisory-shaped, they do not expose a `findings` key, and text
output avoids `WARN`/`FIX`. Prototype tasks need the same brand firewall so noisy
candidate rows do not look like promoted `DriftFinding` warnings.

Prefer this advisory route over adding a `severity` or `lane` field to
`DriftFinding`. The main finding stream powers summaries, chunks, and
`--fail-on-findings`; mixing prototypes there would make noisy research output
look gateable before it has field data.

## Seams to touch

- `scripts/drift-ai/hotspots-format.ts`
- `scripts/drift-ai/coldspots-format.ts`
- `scripts/drift-ai/subcommand-args.ts`
- `scripts/drift-ai/runner.ts`
- `scripts/drift-ai/README.md`
- optional new shared prototype/advisory helper modules under `scripts/drift-ai/`

## What to do

1. Document the canonical prototype shape in the README and tests: `kind:
   "advisory"`, a requested lens/subcommand name, a "not defects" banner,
   sections, row provenance, caps/timeouts, prerequisites, and degradations.
2. Add a small shared helper or type only if it removes real duplication for
   future tasks. Do not force hotspots/coldspots through a generic abstraction
   unless the code becomes simpler.
3. Add a test fixture that proves prototype advisory JSON does not contain a
   top-level `findings` key and text output does not contain `WARN` or `FIX:`.
4. Define how future prototype subcommands should name candidate sections and
   disclose partial runs, including stopped-after counts and skipped prerequisites.
   The full-history details themselves belong to task 38, but this task owns the
   shared wording pattern so partial prototype runs do not read as complete.
5. Leave `DriftFinding` unchanged unless a later task is explicitly promoting a
   lens into a check.

## Testing

- Focused tests for the helper/contract if code is added.
- README/example-output assertions if the implementation adds generated docs or
  fixtures.
- Existing hotspots/coldspots tests should keep passing unchanged or with only
  intentional expectation updates.

## Out of scope

- Implementing any prototype lens.
- Adding a generic `prototype` super-command if separate subcommands stay simpler.
- Adding `severity`, `lane`, or `experimental` to `DriftFinding`.
