# 20. drift-ai facade modules re-export companion-type surfaces no consumer pulls through them

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: dead-code · Area: tooling · Severity: quality-low · Size: S
Source: drift:ai knip (exports,types) + rg cross-reference (target-config) · Confidence: med

## Problem
Four drift-ai modules are documented as a "public facade"/"public surface" and re-export the full type surface of their companion `*-types.ts`/match module, but every real consumer imports most of those types **directly from the source module** and only reaches the barrel for a small subset. The result is a half-facade: each barrel advertises a public type surface that nothing pulls through it, so knip flags the re-exports as unused and they churn every time the source types module changes.

Confirmed partial nature per module (live `bunx knip --include exports,types` flags exactly these lines):

- `class-construction.ts` re-exports `CLASS_RISKY_CONTEXTS` (line 35), `ClassDeclarationInfo`/`ClassReferenceBucket`/`ClassReferenceEvent`/`ClassRiskyContext` (lines 42-45) from `./class-construction-types.js`. Barrel consumers pull only a subset: `class-construction-advisory.ts` pulls `ClassConstructionEvidence`/`Inventory`/`Record`; `class-construction-command.ts` pulls `ClassConstructionInventory`/`SourceInput` + `inventoryClasses`; the two test files pull `CLASS_CONSTRUCTION_STANDING_CAVEAT`/`ClassCaveatLabeler`/`Record`/`SourceInput` + `inventoryClasses`/`riskyContextCaveat`. The direct importers `class-construction-declarations.ts:13` and `class-construction-references.ts:10` import the flagged types straight from `./class-construction-types.js`. (`ClassReferenceBucket`/`ClassReferenceEvent` are still used as values inside `class-construction.ts` via its source import on lines 21-22, so the re-export on 43-44 is purely additive dead surface — trimming it orphans nothing.)
- `ghost-files.ts` re-exports `GhostFileMatch`/`GhostFileMatchKind` (lines 23-24), but `ghost-files-current.ts:10` and `ghost-files-findings.ts:1` both import `GhostFileMatch` directly from `./ghost-files-match.js`. Barrel consumers (`runner.ts`, `check-plugin.ts`, `ghost-files-changed.ts`, `ghost-files-check.ts`, `ghost-files.test.ts`) pull only `DirectoryListing`/`RunGhostFilesCheckOptions`/values. `GhostFileMatchKind` is otherwise referenced only inside `ghost-files-match.ts` itself.
- `birth-size-delta-advisory.ts` re-exports ~11 `birth-size-delta-types` types (lines 32-45). Barrel consumers (`birth-size-delta-args.ts`, `birth-size-delta-command.ts`, `birth-size-delta-advisory.test.ts`) pull only `buildBirthSizeDeltaAdvisory` + `BirthBlobReader`; the analysis/format/complexity modules and even the advisory test import the types directly from `./birth-size-delta-types.js`.
- `dolos-runner.ts` re-exports `DolosCommandSource` (line 37), `DolosRunnerTruncation` (42), `DolosToolInfo` (45). Barrel consumers (`runner.ts`, `prototype-subcommands.ts`, `dolos-candidates-command.ts`, tests) pull only `DolosRunner`/`DolosRunnerInput`/`DolosRunnerCaps`/`DolosRunnerResult` + `defaultDolosRunner`; `dolos-advisory.ts:13` imports `DolosToolInfo` directly from `./dolos-runner-types.js`.

This is the same partial-barrel pattern as the `config.ts` finding, spread across the facade modules. It clears the bar as a dead-code/maintainability cleanup: trimming removes recurring knip noise and shrinks each module's apparent-but-unconsumed public surface. Severity is quality-low: tooling-internal (`scripts/drift-ai`), no runtime/correctness impact; cost is churn + knip noise only.

## Evidence
- `scripts/drift-ai/class-construction.ts:33-47` — re-export block; lines 35,42,43,44,45 knip-flagged unused; consumers import these direct from `-types.js`.
- `scripts/drift-ai/class-construction-declarations.ts:13`, `scripts/drift-ai/class-construction-references.ts:10` — direct `-types.js` importers that bypass the barrel.
- `scripts/drift-ai/ghost-files.ts:20-25` — re-export block; 23-24 (`GhostFileMatch`/`GhostFileMatchKind`) knip-flagged. Module header (line 1) says "Public facade".
- `scripts/drift-ai/ghost-files-findings.ts:1`, `scripts/drift-ai/ghost-files-current.ts:10` — import `GhostFileMatch` direct from `./ghost-files-match.js`.
- `scripts/drift-ai/birth-size-delta-advisory.ts:31-46` — `export type` block; lines 32-45 (~11 types) knip-flagged; consumers import direct from `./birth-size-delta-types.js`.
- `scripts/drift-ai/dolos-runner.ts:35-46` — `export type` block; lines 37,42,45 knip-flagged. `scripts/drift-ai/dolos-advisory.ts:13` imports `DolosToolInfo` direct from `./dolos-runner-types.js`.
- `knip.config.ts:18-41` — existing `ignoreIssues` entries (`packages/shared/**`, `components/ui/**`, `e2e/helpers/**` with `["exports","types"]`) are the documented precedent for the "commit to the facade" option.

## Proposed fix
Pick one direction and apply it to all four module families as a single cleanup (do not leave the half-facade):

Option (a) — trim (recommended, lower-risk): delete the unconsumed re-export lines from each barrel:
1. `class-construction.ts`: drop `CLASS_RISKY_CONTEXTS`, `ClassDeclarationInfo`, `ClassReferenceBucket`, `ClassReferenceEvent`, `ClassRiskyContext` from the `export { … } from "./class-construction-types.js"` block (keep the source `import` block at lines 12-29 intact — those symbols are still used internally).
2. `ghost-files.ts`: drop `type GhostFileMatch` / `type GhostFileMatchKind` from the `export { … } from "./ghost-files-match.js"` block.
3. `birth-size-delta-advisory.ts`: trim the `export type { … } from "./birth-size-delta-types.js"` block to only what is consumed through the barrel (`BirthBlobReader`; re-check whether any other type is reached via the barrel before deleting).
4. `dolos-runner.ts`: drop `DolosCommandSource`, `DolosRunnerTruncation`, `DolosToolInfo` from the `export type { … } from "./dolos-runner-types.js"` block (keep the source `import type` block — they are used internally in `dolos-runner.ts`).

Option (b) — commit to the facade: route ALL consumers (declarations/references/findings/current/advisory/analysis/format) through the barrel instead of the `*-types.js`/match source, then add a documented `scripts/drift-ai/{class-construction,ghost-files,birth-size-delta-advisory,dolos-runner}.ts: ["types"]` entry (or a glob) to `knip.config.ts` `ignoreIssues`, mirroring the existing `components/ui/**` precedent. More edits, and it spreads the barrel further.

Verification per repo TDD norm: this is a pure re-export removal with no behavior change — no new unit tests are warranted. After trimming, run `bun run verify:changed` (lint:changed, typecheck, test:changed) plus `bunx knip --include exports,types` to confirm the four families no longer appear and that typecheck still passes (proves every trimmed symbol was reachable via its source import). There is no lint forcing function here: the repo's `no-barrel` ESLint rule only gates `index.ts`/`index.tsx` (the `isIndexFile` gate in `eslint-rules/no-barrel.js`), so these named facade modules are not lint-flagged either way.

## Verification / caveats
- False-positive risk: medium-low. Reachability ruled out by the verifier — no dynamic `import()`/`require()`, string-literal/DI/registry references to any of these barrels; all references are static ESM `from` imports, so knip is not missing a hidden consumer. Re-confirmed: every flagged type is still reachable through its source module after trimming, so option (a) cannot break typecheck (the rg checks show `ClassReferenceBucket`/`ClassReferenceEvent`/`GhostFileMatchKind` are consumed via the source import, not the barrel).
- Before deleting in `birth-size-delta-advisory.ts`, re-grep each of the ~11 type names against `from "./birth-size-delta-advisory.js"` importers to confirm none is pulled through the barrel — the analysis above sampled but did not exhaustively check all 11.
- Orthogonal, out of scope: knip also flags some SOURCE `*-types.ts` definitions (e.g. `birth-size-delta-types.ts:12`, `class-construction-types.ts:108`, `ghost-files-match.ts:13`) as unused. Those are genuinely-unconsumed underlying types, a separate pass from this re-export cleanup — do not bundle them in.
- Prefer option (a): it removes surface rather than spreading the barrel, and avoids growing `knip.config.ts`. Use (b) only if a maintainer wants these modules to remain true single-import facades.
