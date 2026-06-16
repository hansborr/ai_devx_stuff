# 12. check-metadata.ts exports DriftAiCheckMetadata type that nothing references

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: dead-code · Area: tooling · Severity: quality-low · Size: XS
Source: drift:ai unused-exports / dead-code (target-config) · Confidence: high

## Problem
`scripts/drift-ai/check-metadata.ts:48` declares an exported derived-type alias that nothing consumes:

```ts
export type DriftAiCheckMetadata = (typeof CHECK_METADATA)[number];
```

A repo-wide search (including hidden files, excluding node_modules) for `DriftAiCheckMetadata` matches ONLY this definition line. `code:intel refs` on `check-metadata.ts:48:13` returns 0 references. It is not promoted to any public surface either: the barrel `scripts/drift-ai.ts:9` re-exports `ALL_CHECKS, DEFAULT_CHECKS, IMPLEMENTED_CHECKS` from this module but deliberately NOT `DriftAiCheckMetadata`. No test imports it (`check-metadata.test.ts:7-12` pulls `ALL_CHECKS, buildDefaultChecksConfig, CHECK_METADATA, DEFAULT_CHECKS` only).

This clears the bar as a small, risk-free dead-code removal: a derived type alias with zero consumers is pure surface that an `unused-exports`/knip sweep will keep re-flagging. Removing it trims the module's public API to what is actually used. Note the sibling exports in the same file (`CHECK_METADATA`, `ALL_CHECKS`, `DEFAULT_CHECKS`, `CHECK_USAGE`, `IMPLEMENTED_CHECKS`, `buildDefaultChecksConfig`) ARE consumed (e.g. `cli-args.ts`, `config-parsing.ts`, `config-defaults.ts`, `config-inspect.ts`, `diagnostics-projection.ts`, and tests) — `DriftAiCheckMetadata` is the sole dead export.

## Evidence
- `scripts/drift-ai/check-metadata.ts:48` — `export type DriftAiCheckMetadata = (typeof CHECK_METADATA)[number];`; the only match for the symbol repo-wide and 0 refs via `code:intel`.
- `scripts/drift-ai/check-metadata.ts:29-46` — `CHECK_METADATA` source array the alias derives from (consumed elsewhere; the array stays).
- `scripts/drift-ai.ts:9` — barrel re-exports `ALL_CHECKS, DEFAULT_CHECKS, IMPLEMENTED_CHECKS` from this module but NOT `DriftAiCheckMetadata`, so it is not a public-API surface.
- `scripts/drift-ai/check-metadata.test.ts:7-12` — test imports `ALL_CHECKS, buildDefaultChecksConfig, CHECK_METADATA, DEFAULT_CHECKS`; never `DriftAiCheckMetadata`.

## Proposed fix
1. Delete line 48 (`export type DriftAiCheckMetadata = (typeof CHECK_METADATA)[number];`) from `scripts/drift-ai/check-metadata.ts`. Nothing downstream needs editing — no import or re-export references it.
2. If a single check-metadata element type is ever needed at a real call site, inline `(typeof CHECK_METADATA)[number]` there rather than re-introducing a top-level export.
3. No new test is warranted for a deletion, but run the existing `scripts/drift-ai/check-metadata.test.ts` plus `typecheck` to confirm nothing relied on the alias transitively. This finding can also be folded into a broader drift-tooling dead-export sweep rather than landed alone.

## Verification / caveats
- False-positive risk: low. The alias is a plain derived type — no dynamic import, string-keyed access, JSX, or DI/router registration could reach it; `code:intel refs` and `rg --hidden` both confirm zero consumers.
- Scope boundary: remove ONLY line 48. The `CHECK_METADATA` array it derives from is live and must stay.
- Double-check before landing: re-run `rg DriftAiCheckMetadata --hidden -g '!node_modules'` at implementation time in case a consumer was added after this audit; if so, this finding is void.
- A config suppression is not appropriate here — there is no lint rule firing, just dead surface; the right action is deletion.
