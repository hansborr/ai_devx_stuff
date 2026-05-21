# Leaf 38: Top-Level Script Project Lint Adoption

Status: Resolved 2026-05-20 - see `../../finished_work/lint-hardening-leaf-38-top-level-scripts.md`
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-19-scripts-top-level-non-scripts-tsconfig-deferral.md`
- `scripts/db-status.ts`
- `scripts/harness-emit-envelope.ts`
- `scripts/sensor-blob-size.ts`
- `scripts/sensor-blob-size.test.ts`

## Problem

Leaf 19 probed three under-ceiling top-level scripts but hit TypeScript parser
project errors before lint could run:

- `scripts/db-status.ts`
- `scripts/harness-emit-envelope.ts`
- `scripts/sensor-blob-size.test.ts`

The matching implementation file `scripts/sensor-blob-size.ts` is also a live
package script and should not be left as a separate straggler. These files are
standalone Bun scripts outside `tsconfig.scripts.json`. Adding lint coverage
therefore requires a project-shape decision before ordinary ESLint findings are
even visible.

## Scope

Adopt these top-level scripts into a TypeScript project or other
ratchet-compatible parser profile, then ratchet current findings before cleanup
or normal ESLint coverage. Do not use this leaf to pull every top-level script
into `tsconfig.scripts.json`; keep the first project-shape change small.

## Ratchet-First Enforcement

The first implementation step is not cleanup; it is making these files visible
to the ratchet runner. If project inclusion surfaces type errors, record them
and either fix the project-shape issue or add a separate parser profile that
can safely ratchet these standalone scripts. Once parseable, commit current
lint counts into `lint-ratchet.baseline.json`.

Do not treat "ratchet first" as a way around the parser failure. The ratchet
floor starts only after the leaf deliberately chooses a small project/parser
shape that lets ESLint load the files.

## Candidate Work

- Decide whether these files belong in `tsconfig.scripts.json` or in a
  separate non-type-aware / standalone-script lint profile.
- Prefer adding them to `tsconfig.scripts.json` if typecheck cost and module
  constraints are acceptable.
- Re-run lint after project inclusion and add ratchet coverage for newly
  surfaced findings.
- Address findings and add normal script lint unignores/parser blocks only
  after the ratchet floor exists.
- Ensure `harness-emit-envelope.ts` remains compatible with all shell callers.

## Exit Criteria

- The named files are parseable by the ratchet runner and protected by current
  baseline counts, or the leaf records a concrete project/parser blocker.
- The project/parser decision is explicit and narrow; it should not silently
  pull unrelated top-level scripts, fixtures, or generated output into the
  TypeScript project.
- New or higher finding counts fail `bun run lint:ratchet`.
- `tsconfig.scripts.json` changes do not accidentally include fixture
  directories or generated output.
- Shell smoke coverage selects the right tests when these files change.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if parser/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-harness-emit-envelope.sh`
- `bash scripts/test-sensor-blob-size.sh` if present, or the sensor smoke that
  covers blob-size behavior
- `bun run test:scripts:changed`
- `bun run verify:changed`
