# 208. Converge drift-ai command result and sentinel-error lifecycles

Status: Landed on fix/cq-208
Theme: Drift-ai command families redeclare one result and error lifecycle · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

The drift-ai CLI has one base command-result contract — an exit code and stdout
text — but represents it through family-local aliases and independently maps
the same two sentinel errors in the prototype, main-runner, config, hotspots,
and coldspots paths. Even prototype commands that delegate their lifecycle to
a shared wrapper redeclare that wrapper's result shape.

A change to the result fields or to the help/error exit policy consequently
requires coordinated edits across otherwise unrelated commands. The repeated
branches also obscure the intended invariant: `DriftAiHelp` is successful help,
`DriftAiError` is a usage/configuration failure, and every other exception must
propagate as an unexpected defect.

## Evidence

- `scripts/drift-ai/prototype-command.ts:14-21` — the prototype framework
  declares the common `exitCode`/`stdout` result and requires descriptor
  runners to return it.
- `scripts/drift-ai/prototype-command.ts:43-53` — the prototype wrapper catches
  `DriftAiHelp` and `DriftAiError` and maps them locally to exit codes 0 and 2.
- `scripts/drift-ai/class-construction-command.ts:39-50` — a representative
  prototype command redeclares the same two-field result before forwarding
  parse and run functions to `runPrototypeCommand`.
- `scripts/drift-ai/runner.ts:66-69` — the main runner declares the same base
  fields, plus its command-specific optional `report`.
- `scripts/drift-ai/runner.ts:106-135` — the main path owns another sentinel
  mapper and calls it from separate argument-parsing and run-preparation catch
  sites.
- `scripts/drift-ai/config-inspect-command.ts:47-87` — config inspection
  implements its own parse, execute, format, output, and two-catch lifecycle,
  ending in a third copy of the sentinel mapping.
- `scripts/drift-ai/hotspots.ts:64-88` — hotspots redeclares the base result and
  maps both sentinel errors during parsing; `:139-158` separately constructs
  the same exit-2 result for preparation errors.
- `scripts/drift-ai/coldspots.ts:65-91` — coldspots independently repeats the
  result and parse-error mapping; `:179-198` repeats the preparation-error
  conversion as well.

## Proposed direction

Add a neutral drift-ai command-result module that exports the shared
`exitCode`/`stdout` contract and one error-mapping helper. The helper should
return `{ exitCode: 0, stdout: err.message }` for `DriftAiHelp`,
`{ exitCode: 2, stdout: err.message }` for `DriftAiError`, and rethrow the
original value for every other error.

Converge the five lifecycle families on that module:

1. Make the prototype descriptor, wrapper, and finish helper return the neutral
   contract. Replace per-prototype structural result declarations with imports
   or compatibility aliases of that contract.
2. Define the main runner's result as the neutral contract plus its optional
   `DriftReport`, and replace `toExitResult` with the shared mapper at the
   existing catch sites.
3. Replace config inspection's structural alias and `toResult` implementation
   with the shared contract and mapper.
4. Replace hotspots' and coldspots' structural aliases and their hand-written
   parse/preparation sentinel branches with the shared contract and mapper.

Keep exported compatibility type names where an existing facade currently
exposes them, but make those names aliases rather than independent structural
declarations. Add focused tests for both sentinel mappings and for propagation
of an unexpected error, then retain the existing prototype, config, hotspots,
coldspots, and main-runner assertions for exit codes and stdout identity.

## Scope / caveats

- Keep command-specific parsing, help prose, execution, formatting, output
  writing, and full result assembly hand-owned. In particular, do not derive
  them from descriptors; that boundary is settled by
  [120-cli-option-models-remain-parallel-registries.md](./120-cli-option-models-remain-parallel-registries.md).
- Do not broaden catch boundaries while replacing their mapping branches.
  Unexpected errors must still escape, and commands must continue catching
  sentinel errors only at the phases they currently own.
- The main runner's optional `report` remains command-specific; the neutral
  contract must not force report fields onto subcommands.
- Sequence edits to `runner.ts` and facade-facing result exports with
  [142-code-intelts-maintains-unused-pseudo-library.md](./142-code-intelts-maintains-unused-pseudo-library.md).
  Its drift-ai slice owns executable-entrypoint cleanup; this proposal must not
  absorb its import rewiring, entrypoint guard, or export removal.
