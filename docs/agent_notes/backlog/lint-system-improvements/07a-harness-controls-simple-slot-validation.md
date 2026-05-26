# Harness Controls Simple Slot Validation

Status: Parked
Order: 7a

## Context

`harness.controls.json` is already an authoritative inventory, but execution
slots are still wired across package scripts, Husky, verify wrappers, CI,
generated docs, and tests. The source review recommends making the manifest
closer to the execution source of truth.

This is the first sub-leaf from the original execution-manifest task. It only
validates simple command slots. Complex changed-file semantics, tier-wide
metadata, and runner generation stay in `07b`-`07d`.

## Scope

- Re-audit `harness.controls.json`, `scripts/harness-check.ts`,
  `scripts/generate-harness-controls.ts`, package scripts, CI, Husky, verify,
  and generated harness docs for slots that are plain command invocations.
- Mark or derive only simple slots whose command string and generated
  documentation can be validated without modeling staged or changed-file
  inputs.
- Extend `harness:check` and the generated-docs check so copied simple command
  slots cannot drift silently.
- Preserve current behavior. Do not generate runners, add tier metadata, or
  migrate changed-file selectors in this leaf.

## Definition Of Done

At least one simple gate class is validated from `harness.controls.json`, and a
stale command in that class fails a named check without changing runtime
behavior.

## Verification

- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bash scripts/test-generate-harness-controls.sh`
- `bun run verify:changed`
