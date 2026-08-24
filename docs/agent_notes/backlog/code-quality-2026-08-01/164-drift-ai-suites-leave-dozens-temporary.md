# 164. Six drift-AI suites leak 58 temporary roots per full run

Status: Landed on fix/cq-164
Theme: temporary test lifecycle · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Six drift-AI test files allocate temporary roots without registering cleanup. A full run leaves 58 directories behind, so repeated local and CI runs accumulate test debris. The suites also demonstrate only the allocation half of the lifecycle even though neighboring tests use a shared helper that pairs allocation with recursive cleanup.

This makes the weaker pattern easy for contributors to copy and leaves future lifecycle fixes distributed across otherwise unrelated suites.

## Evidence

- Static call-site expansion yields 23 roots in `scripts/drift-ai/coldspots.test.ts`: 13 calls to the factory at `:46-58`, nine calls to the second factory at `:286-308`, and the direct config root at `:239`.
- The same measurement yields 25 roots in `scripts/drift-ai/hotspots.test.ts`: 22 calls to the factory at `:34-50`, the config root at `:341`, and two direct roots at `:359` and `:386`.
- `scripts/drift-ai/harness-freshness.test.ts:189-191` allocates through `gitAtEmptyRepo`; its seven call sites are at `:196`, `:205`, `:221`, `:229` (twice), `:241`, and `:251`.
- The remaining three roots are created by command-config cases at `scripts/drift-ai/birth-size-delta-command.test.ts:132`, `scripts/drift-ai/ownership-command.test.ts:103`, and `scripts/drift-ai/test-orphaning-command.test.ts:100`. Together the six files therefore allocate 58 unremoved roots per full run.
- `scripts/test-support/tmp-repo.test-helper.ts:39-52` already tracks every root created through `makeTempRepo` and recursively removes the tracked roots in its registered cleanup hook.
- The helper documents the intended collection-time usage—register once at module scope, then allocate inside tests—at `scripts/test-support/tmp-repo.test-helper.ts:16-21`.

## Proposed direction

Route the six suites through `registerTempRootCleanup`, keeping raw `mkdtempSync` only where a test explicitly owns a distinct lifecycle.

Register one handle at module scope in each file and replace the raw factories with `makeTempRepo`, preserving the existing prefixes. Config cases can continue writing `drift-ai.config.json` beneath the returned root; the Git fakes can return that same tracked root. This changes fixture lifecycle only, not the scenarios or Git responses.

## Scope / caveats

- Do not turn this into a new global or shell-level cleanup registry. The existing TypeScript helper already owns the required lifecycle.
- Do not mechanically replace raw allocation in suites that already implement deliberate cleanup. `scripts/drift-ai/clone-corpus.test.ts:16-24` and `scripts/drift-ai/dead-code-corpus.test.ts:18-33` drain tracked roots in `afterEach`; `scripts/drift-ai/knip-unused-exports.test.ts:124-146` and `scripts/drift-ai/current-inventory.test.ts:73-113` clean their roots explicitly.
- Preserve per-test isolation and existing directory prefixes. Registering cleanup inside an individual test would violate the collection-scope constraint documented at `scripts/test-support/tmp-repo.test-helper.ts:16-21`.
