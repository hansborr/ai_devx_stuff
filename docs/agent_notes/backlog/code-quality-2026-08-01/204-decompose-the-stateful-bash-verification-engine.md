# 204. Decompose the stateful Bash verification engine behind its existing facade

Status: Landed on fix/cq-204
Theme: The verification engine remains a framework-sized stateful Bash module · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/lib/verify-engine.sh` couples process cleanup, policy validation, slot
execution, evidence publication, and reporting through ambient mutable state
and string-named contracts. Changes to any one concern therefore require
reasoning across the complete gate lifecycle, including failure and rollback
paths unrelated to the edit.

Bash remains the appropriate substrate for this process-oriented work. The
maintenance cost comes from keeping several cohesive Bash subsystems in one
framework-sized module, not from the language itself.

## Evidence

- `scripts/lib/verify-engine.sh:166-183` — adjacent mutable globals track exit
  dispatch, cleanup, child processes, evidence backup and swap state,
  registration capture, and starting-load reporting.
- `scripts/lib/verify-engine.sh:329-391` — policy validation receives an
  associative array by name, validates a string list of allowed and required
  fields, and resolves callback fields through string-named functions.
- `scripts/lib/verify-engine.sh:555-653` — live-evidence backup and restoration
  implement staging, displacement, rollback, registration preservation, and
  final cleanup as one stateful transaction.
- `scripts/lib/verify-engine.sh:1-17` — the file is the shared facade for
  `verify.sh` and pre-commit and deliberately resolves its dependent helper
  names at call time.
- `scripts/lib/verify-engine.sh` — 991 lines and 30 top-level brace-bodied
  function definitions, re-measured with
  `wc -l < scripts/lib/verify-engine.sh` and
  `grep -Ec '^[[:alnum:]_]+\(\) \{' scripts/lib/verify-engine.sh`.

## Proposed direction

Keep `scripts/lib/verify-engine.sh` as the sole public sourcing facade and keep
the gate's process orchestration in Bash. Extract internal Bash libraries in
behavior-preserving slices:

1. Move policy-schema and callback validation into a policy-validation
   library.
2. Move evidence backup, staging, rollback, restoration, and publication into
   an evidence-transaction library.
3. Move exit dispatch, child-process cleanup, watchdog ownership, and related
   lifecycle state into a lifecycle/cleanup library.

Have the existing facade source those libraries in dependency order and
continue exporting every current function and variable name. Move supporting
state with its owning functions, but do not redesign callback protocols,
failure codes, traps, messages, or transaction ordering during extraction.

Keep the existing `scripts/tests/test-verify.sh` behavior coverage passing
unchanged through each slice. Update fixture-copy and harness dependency
inventories when a new internal library becomes a runtime dependency, and add
focused facade tests proving that sourcing `verify-engine.sh` still exposes
the established entry points without consumers sourcing internal files.

## Scope / caveats

- Do not introduce a TypeScript core or move locks, `mktemp`, Git operations,
  process control, or evidence publication out of Bash.
- Preserve all sourced names and the public entry paths used by
  `.husky/pre-commit`, `scripts/verify.sh`, and `scripts/verify-async.sh`.
  Internal libraries are implementation details behind
  `scripts/lib/verify-engine.sh`.
- This is move-only decomposition. Do not combine it with policy redesign,
  callback renaming, state-machine changes, or cleanup-behavior changes.
- [117-verify-metadatash-second-kitchen-sink-shell.md](./117-verify-metadatash-second-kitchen-sink-shell.md)
  addresses the sibling metadata library and explicitly excludes
  `verify-engine.sh`; coordinate internal library names and avoid concurrent
  edits to shared harness fixtures.
- `CQ25-124` in
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md)
  sets the measured boundary against a speculative TypeScript core. It does
  not cover this internal, move-only Bash decomposition.
