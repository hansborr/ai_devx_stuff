# 01. lint-ratchet-baseline-parse.ts re-declares JSON helpers already exported by baseline-hash.ts in the same directory

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: duplication · Area: tooling · Severity: quality-high · Size: XS

Source: drift:ai near-duplicates (drift-baseline near-duplicates-2; confirmed by reading both files) · Confidence: high

## Problem
`scripts/lint-ratchet/lint-ratchet-baseline-parse.ts` privately re-declares five JSON helpers (`isRecord`, `isJsonValue`, `isJsonObjectValue`, `isJsonArrayValue`, `normalizeJsonValue`) at lines 18-52, byte-for-byte identical to the copies in `scripts/lint-ratchet/baseline-hash.ts` lines 18-52 in the same directory. Both files import the same `JsonValue`/`JsonObject` types from `./lint-ratchet-config.js`, and `baseline-hash.ts` already publicly exports `isRecord`, `isJsonValue`, and `normalizeJsonValue`.

This clears the bar as a dedup/maintainability fix: the two `normalizeJsonValue` copies are the canonical sorted-key JSON normalizer used for config-hash stability and baseline parsing. The shared `isJsonValue` carries non-obvious semantics — it rejects non-finite numbers (`Number.isFinite(value)` at line 29) so `NaN`/`Infinity` are not treated as valid JSON. Any future correction to that finite-number rule, the recursive sort, or `null`-coalescing in normalize must be applied to both copies by hand; a one-sided edit silently diverges the hash input from the parse path. The repo already treats `baseline-hash.ts` as the single source — `lint-ratchet-zero-baseline.ts:5` and `baseline-validation.ts:7` import `isRecord`/`isJsonValue`/`normalizeRuleOptions` from it — so the parse file is the lone outlier.

## Evidence
- `scripts/lint-ratchet/lint-ratchet-baseline-parse.ts:18-52` — private copies of `isRecord`/`isJsonValue`/`isJsonObjectValue`/`isJsonArrayValue`/`normalizeJsonValue`; verified byte-identical to baseline-hash.ts.
- `scripts/lint-ratchet/baseline-hash.ts:18-52` — `export function isRecord` (18), `export function isJsonValue` (22), `isJsonObjectValue` (36, not exported), `isJsonArrayValue` (40, not exported), `export function normalizeJsonValue` (44); same directory, same shared types.
- `scripts/lint-ratchet/lint-ratchet-baseline-parse.ts:85,89,99,301` — the parse module's actual callers: `isJsonValue` (85), `normalizeJsonValue` (89), `isRecord` (99, 301). `isJsonObjectValue`/`isJsonArrayValue` are referenced only inside the local `normalizeJsonValue` (45-46).
- `scripts/lint-ratchet/lint-ratchet-zero-baseline.ts:5` and `scripts/lint-ratchet/baseline-validation.ts:7` — established precedent: these import the helpers from `./baseline-hash.js`.

## Proposed fix
1. In `lint-ratchet-baseline-parse.ts`, add `import { isRecord, isJsonValue, normalizeJsonValue } from "./baseline-hash.js";`.
2. Delete the five private function declarations at lines 18-52 in `lint-ratchet-baseline-parse.ts`. After deletion, `isJsonObjectValue`/`isJsonArrayValue` have no remaining callers in the parse file (their only callers were inside the now-imported `normalizeJsonValue`), so they do not need to be re-exported from `baseline-hash.ts` — leave those two private to `baseline-hash.ts`.
3. Confirm `JsonObject` is no longer referenced in `lint-ratchet-baseline-parse.ts` after deletion; if so, drop it from the type import on lines 3-8 to avoid an unused-import lint failure. (`JsonValue` is still used and stays.)
4. TDD: there is no direct unit test for these helpers in the parse module. Add/extend a test under `scripts/lint-ratchet/` (e.g. alongside `lint-ratchet-baseline.test.ts`) asserting `parseBaselineTest` still round-trips `ruleOptions` with nested objects and rejects an option array containing `NaN`/`Infinity` — this pins the `isJsonValue` finite-number contract through the imported helper and guards the dedup. Run `bun run test:scripts:file -- scripts/lint-ratchet/<the test file>`.

## Verification / caveats
- False-positive risk is low: a code change (not a config suppression) is the right call — these are genuine logic helpers, not generated or boundary code.
- Double-check `baseline-hash.ts` has no side-effecting top-level code that would change behavior when newly imported by the parse module; it has none (pure helpers + `createHash` import), so no import-cycle or eval-order concern. Verify no new circular import is introduced: `baseline-hash.ts` imports from `./baseline-constants.js` and `./lint-ratchet-config.js` only, neither of which imports the parse module.
- `lint-ratchet-output.test.ts:33` snapshots `baseline-hash.ts` as a runtime file for harness diagnostics; this change does not alter `baseline-hash.ts`, so that snapshot is unaffected. Re-run that test to be safe.
- Scope is exactly the parse file's five declarations; do not touch the other importers, which are already correct.
