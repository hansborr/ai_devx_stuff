# 255. Make exact-token collection explicit at the near-duplicate runner boundary

Status: Landed on fix/cq-255
Theme: Make near-duplicate exact-token collection an explicit runner choice · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Adjacent near-duplicate APIs give the same optional setting opposite meanings.
Omitting `includeExactTokens` at the extractor enables token collection, while
omitting it at the runner disables collection before the extractor is called.
A future caller can therefore lose exact-clone input or pay the collection
cost depending only on which layer it enters.

The clone-candidates and registered drift-check production runner callers
intentionally need different behavior, but only the drift check states its
choice. The boundary consequently hides policy in
`undefined` instead of making each caller declare whether exact-token analysis
belongs to its workflow.

## Evidence

- `scripts/drift-ai/near-duplicates-fingerprint.ts:38-52` — the extractor
  declares `includeExactTokens` optional and interprets omission as `true`
  through `options.includeExactTokens ?? true`.
- `scripts/drift-ai/near-duplicates-runner.ts:45-56` — the adjacent runner
  exposes an optional property with the identical name.
- `scripts/drift-ai/near-duplicates-runner.ts:114-123` — the runner converts
  omission to `false` with `input.includeExactTokens === true` before invoking
  the extractor, additionally gating collection by exact-clone file
  eligibility.
- `scripts/drift-ai/clone-candidates-command.ts:81-98` — the clone-candidates
  production caller omits `includeExactTokens` and silently relies on the
  runner's false default.
- `scripts/drift-ai/near-duplicates-check.ts:45-56` — the registered
  near-duplicates check explicitly passes `includeExactTokens: true`,
  demonstrating that production callers require different choices.
- `scripts/drift-ai/near-duplicates.test.ts:380-397` — existing runner
  coverage omits the option and observes functions with no exact tokens, but
  `src/totals.ts` is not exact-clone eligible, so this test does not isolate the
  omitted-option behavior.
- `scripts/drift-ai/near-duplicates.test.ts:609-631` — the drift-check test
  records the runner input and asserts that this caller passes `true`.

## Proposed direction

Make `NearDuplicateRunnerInput.includeExactTokens` required. Pass `false`
explicitly from `runFunctionInventory` in
`clone-candidates-command.ts`, and retain the explicit `true` in
`near-duplicates-check.ts`. Update every direct runner construction in focused
tests to state the intended boolean as well.

Keep the extractor's standalone convenience default, but document next to its
option that omission means exact tokens are collected. Add direct
characterization for that standalone default and for an explicit `false`;
because the runner always supplies a boolean after this change, it can no
longer inherit or invert the extractor default accidentally.

In `runTsMorph`, preserve the existing two-part decision:
`includeExactTokens` must be true and the file must satisfy
`isExactCloneFileEligible`. Add a caller-boundary assertion that clone-candidates supplies false. Retain
the existing drift-check assertion that this caller supplies true, plus the
existing runner coverage showing that true collects only for eligible
production files.

## Scope / caveats

- Preserve exact-clone eligibility filtering, including the exclusions for
  tests, fixtures, declarations, and production roots. Requiring the runner
  option must not make `true` bypass `isExactCloneFileEligible`.
- This leaf makes an existing production choice explicit; it does not change
  clone-candidate output, drift-check exact-clone behavior, thresholds, or
  fingerprint contents.
- The extractor's omitted-option behavior remains a documented standalone
  default. If implementation instead makes the extractor option required,
  update every direct extractor caller in the same change and preserve their
  current choice.
- [173-near-duplicate-sensor-gate-tests-buried.md](./173-near-duplicate-sensor-gate-tests-buried.md)
  is a move-only test-ownership proposal and explicitly excludes production
  sensor semantics. Do not combine its file relocation with this API
  correction.
- No prior-pack residual applies to this option contract.
- Coordinate this required-option change with
  [231-fail-closed-when-similarity-ts-output-no-longer.md](./231-fail-closed-when-similarity-ts-output-no-longer.md):
  if 231 lands first, include its new similarity-ts runner fixtures in the
  explicit-boolean caller sweep; if this leaf lands first, 231 must set
  `includeExactTokens: false` in each new similarity-ts fixture. Keep protocol
  validation and exact-token policy as separate changes.
