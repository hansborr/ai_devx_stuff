# 43a - env and define evaluator calibration

Status: Parked
Track: P
Size: small-medium
Depends on: none
Blocks: 43

## Goal

Build and calibrate the provider-agnostic environment/define expression
inventory before attaching stale-branch rows to advisory output.

## Background

The stale-branch prototype is noisy because environment assumptions are
deployment-specific. The first slice should only answer: what env/define reads
can we detect, and under an explicit supplied matrix, which branches can be
classified deterministically?

## Seams to touch

- `scripts/drift-ai/parsed-source-cache.ts` if reusing AST walks
- new env/define inventory and evaluator helpers under `scripts/drift-ai/`
- `scripts/drift-ai/config.ts` and config parsing for optional env/define
  matrices, if config is needed before rendering
- focused tests under `scripts/drift-ai/`

## What to do

1. Inventory `process.env`, `import.meta.env`, `Bun.env`, and configured
   bundler-defined constants.
2. Accept an explicit env/define matrix at the helper/config level. Do not infer
   deployment environments.
3. Evaluate only simple deterministic branches first: equality/inequality,
   boolean negation, truthiness checks, and obvious conjunction/disjunction cases
   that can be represented without a broad interpreter.
4. Return raw evidence: condition text/range, variable or define key, assumed
   value source, predicted branch when known, and an "unknown" state when the
   matrix is insufficient.
5. Keep this library/test-only. Do not register a check id, subcommand, or
   advisory output in this task.

## Testing

- Fixtures for direct env checks, negated checks, unknown values, configured
  constants, boolean combinations, and unsupported expressions.
- Deterministic ordering tests.

## Out of scope

- User-facing output; use task 43.
- Calling hosted flag APIs.
- Provider-specific systems such as LaunchDarkly, Unleash, Piranha, or Harness
  cleanup metadata.
- Mutating source or deleting branches.
