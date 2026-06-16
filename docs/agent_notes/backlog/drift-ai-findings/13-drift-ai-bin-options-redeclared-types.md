# 13. ResolveJscpdBinOptions / ResolveKnipBinOptions re-declare ResolveToolBinOptions instead of aliasing it

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: duplication · Area: tooling · Severity: quality-low · Size: XS

## Problem
`ResolveJscpdBinOptions` (scripts/drift-ai/jscpd-bin.ts:31-42) and `ResolveKnipBinOptions` (scripts/drift-ai/knip-runner.ts:271-276) each re-declare the exact four fields of the canonical `ResolveToolBinOptions` (scripts/drift-ai/tool-bin.ts:16-21): `analyzedRepoRoot?`, `override?`, `moduleDir?`, `fileExists?`.

Both per-tool option types add no information: `resolveJscpdBin(options)` returns `resolveToolBin(JSCPD_TOOL_BIN, options)` (jscpd-bin.ts:56-58) and `resolveKnipBin(options)` returns `resolveToolBin(KNIP_TOOL_BIN, options)` (knip-runner.ts:283-285) — the options pass straight through to `resolveToolBin`. So the three declarations must be kept in lockstep by hand: any field added to `resolveToolBin` (and thus to `ResolveToolBinOptions`) must be manually mirrored into both copies or the per-tool callers silently can't pass it.

This is an inconsistency, not deliberate divergence: the adjacent sibling types in both files are already expressed as plain aliases — `JscpdBinSource = ToolBinSource` / `JscpdBinResolution = ToolBinResolution` (jscpd-bin.ts:27-29) and `KnipBinSource = ToolBinSource` / `KnipBinResolution = ToolBinResolution` (knip-runner.ts:267-269). Only the options bag was duplicated rather than aliased. Collapsing both to aliases removes the lockstep-maintenance hazard and matches the established pattern in the same files.

Note: jscpd-bin.ts:31-42 carries per-field doc comments that the canonical `ResolveToolBinOptions` lacks (the knip copy has none). If those docs are worth keeping, move them onto the shared `ResolveToolBinOptions` in tool-bin.ts as part of the alias change; otherwise they are lost.

## Evidence
- scripts/drift-ai/tool-bin.ts:16-21 — canonical `ResolveToolBinOptions` (4 fields), consumed by `resolveToolBin` at line 38-40.
- scripts/drift-ai/jscpd-bin.ts:27-29 — `JscpdBinSource`/`JscpdBinResolution` already plain aliases of the tool-bin types.
- scripts/drift-ai/jscpd-bin.ts:31-42 — `ResolveJscpdBinOptions` re-declared with same 4 fields, plus per-field doc comments the canonical lacks.
- scripts/drift-ai/jscpd-bin.ts:56-58 — `resolveJscpdBin` passes `options` straight through to `resolveToolBin(JSCPD_TOOL_BIN, options)`.
- scripts/drift-ai/jscpd-bin.ts:8-13 — import block already pulls `resolveToolBin`, `ToolBinConfig`, `ToolBinResolution`, `ToolBinSource` (not yet `ResolveToolBinOptions`).
- scripts/drift-ai/knip-runner.ts:267-269 — `KnipBinSource`/`KnipBinResolution` already plain aliases.
- scripts/drift-ai/knip-runner.ts:271-276 — `ResolveKnipBinOptions` re-declared with same 4 fields, no docs.
- scripts/drift-ai/knip-runner.ts:283-285 — `resolveKnipBin` passes `options` straight through to `resolveToolBin(KNIP_TOOL_BIN, options)`.
- scripts/drift-ai/knip-runner.ts:13-18 — import block already pulls `resolveToolBin`, `ToolBinConfig`, `ToolBinResolution`, `ToolBinSource` (not yet `ResolveToolBinOptions`).
- `rg "ResolveJscpdBinOptions|ResolveKnipBinOptions"` over scripts/ + packages/ — each type is referenced ONLY in its own declaring file (the param of its delegating function); no external consumers, so the alias is a safe drop-in.

## Proposed fix
1. In scripts/drift-ai/jscpd-bin.ts: add `ResolveToolBinOptions` to the existing `type`-import from `./tool-bin.js` (lines 8-13), then replace the `ResolveJscpdBinOptions` object type (lines 31-42) with `export type ResolveJscpdBinOptions = ResolveToolBinOptions;`. Decide on the per-field docs: either drop them or relocate them onto `ResolveToolBinOptions` in tool-bin.ts:16-21.
2. In scripts/drift-ai/knip-runner.ts: add `ResolveToolBinOptions` to the existing `type`-import from `./tool-bin.js` (lines 13-18), then replace `ResolveKnipBinOptions` (lines 271-276) with `export type ResolveKnipBinOptions = ResolveToolBinOptions;`.
3. Leave the `resolveJscpdBin` / `resolveKnipBin` function bodies and signatures unchanged — they continue to reference the (now aliased) per-tool option type names, preserving the public surface.
4. Tests (TDD norm): these helpers are covered by their unit tests (find via `bun run code:intel -- tests scripts/drift-ai/jscpd-bin.ts` and `... knip-runner.ts`). No new test is required for a pure type-alias refactor. NOTE (review correction): there is **no** `jscpd-bin.spec.ts` — discover real coverage via `bun run code:intel -- tests scripts/drift-ai/jscpd-bin.ts`; the knip side is covered by `scripts/drift-ai/knip-runner.test.ts`. Run those plus `bun run typecheck` to confirm the option types still accept the same shapes. If you want a regression guard, add a `expectTypeOf` / type-level assertion (or a trivial compile-time check) that `ResolveJscpdBinOptions` and `ResolveKnipBinOptions` are assignable to/from `ResolveToolBinOptions`.

## Verification / caveats
- False-positive risk: low. The `rg` sweep confirms neither per-tool type is imported elsewhere, so collapsing to an alias is behavior-preserving and changes no runtime code.
- Scope boundary: type-only change in two scripts files (optionally a doc-comment move into tool-bin.ts). Do not touch the `Source`/`Resolution` aliases — they are already correct and are the pattern being matched.
- Double-check before landing: confirm `ResolveToolBinOptions` is exported from tool-bin.ts (it is, line 16) and the import additions use `type`-only import syntax to match the existing import blocks. Run `bun run typecheck` after the edit; an alias that drops the doc comments will compile identically, so the only loss to weigh is documentation, not type fidelity.
- A config-suppression is not appropriate here; this is a real (if small) code dedup, fixed by the alias.
