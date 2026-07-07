# Fixture copy-set vs import-graph guard

Status: Parked
Date: 2026-07-07
Source: agent-cli consolidation burn-in incident (drift-triage fix workflow,
2026-07-07); routed out of the agent-cli pack — not a wrapper defect.

## Context

A new leaf module (`scripts/harness/harness-paths.ts`) broke sandboxing test
fixtures in three separate copy sets, each surfacing only at the next-deeper
gate (changed smokes → full scripts slot → full test slot). The tail cost
three fix rounds across dispatched lanes because nothing enumerates which
fixture copy sets must mirror a new module.

## Scope

- A repo-level guard that compares each sandboxing fixture copy set against
  the import graph of the entry points it sandboxes, so adding a leaf module
  fails one fast check that lists every copy set needing the file — instead of
  failing gate-by-gate.
- Until the guard exists: dispatch missions that add leaf modules under
  `scripts/` should require a fixture-copy-set sweep up front (prompt-side
  mitigation; noted in the agent-cli pack index).

## Verification

- A fixture proving that a module missing from a copy set fails the guard
  with a diagnostic naming the copy set and the missing file.
- `bun run test:scripts:changed` green after wiring.
