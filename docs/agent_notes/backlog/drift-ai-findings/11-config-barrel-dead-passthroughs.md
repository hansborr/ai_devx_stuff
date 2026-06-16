# 11. config.ts re-exports 5 symbols no consumer pulls through the barrel

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: dead-code · Area: tooling · Severity: quality-low · Size: XS
Source: drift:ai unused-exports / knip-unused-exports (target-config) · Confidence: high

## Problem
`scripts/drift-ai/config.ts` is a partial barrel that re-exports some symbols only for itself (e.g. `loadDriftAiConfig` lives here) but also pass-throughs from sibling modules. Five of those pass-throughs are dead — no consumer reaches them through the `./config.js` barrel:

- config.ts:6-11 re-exports `globsForIgnoredPaths`, `matchesAnyGlob`, `pathHasAnyPrefix`, `pathHasAnySegment` from `./config-match.js`. Every real importer of these four pulls them **directly** from `./config-match.js`, never through `config.js`.
- config.ts:15 re-exports `normalizeRepoPath` (chained config.ts -> config-parsing.ts:21 -> config-paths.ts). Its only live consumers import it directly from `./config-paths.js` (`config-match.ts:4`); the barrel hops are a dead chain.

This is not an intentional facade: config.ts opens straight with imports and carries no `Public facade`/`Public surface` doc comment, unlike `ghost-files.ts:1` ("Public facade for the ghost-file detector") and `class-construction.ts:1` ("Public surface for..."). So these five lines are unreachable re-exports that inflate the module's apparent public surface with zero behavior. knip independently flags exactly these five (and only these) as unused exports.

The four sibling pass-throughs that *are* consumed through the barrel must stay: `collapseRepoPath` and `pathEscapesRepo` (both imported via `config.js` at `current-inventory.ts:5`), plus `DEFAULT_DRIFT_AI_CONFIG` and `parseDriftAiConfig` (imported via `config.js` across many checks/tests).

## Evidence
- `scripts/drift-ai/config.ts:6-11` — dead re-export block: `globsForIgnoredPaths`, `matchesAnyGlob`, `pathHasAnyPrefix`, `pathHasAnySegment` from `./config-match.js`. knip flags all four (config.ts:7,8,9,10).
- `scripts/drift-ai/config.ts:12-18` — re-export block from `./config-parsing.js`; `normalizeRepoPath` (line 15) is dead (knip flags config.ts:15), the other four (`collapseRepoPath`, `DEFAULT_DRIFT_AI_CONFIG`, `parseDriftAiConfig`, `pathEscapesRepo`) are live and must remain.
- `scripts/drift-ai/config-parsing.ts:21` — `export { collapseRepoPath, normalizeRepoPath, pathEscapesRepo } from "./config-paths.js";` knip flags only `normalizeRepoPath` here (col 28); `collapseRepoPath`/`pathEscapesRepo` stay (consumed via the barrel chain and `coverage-config.ts:9`).
- `scripts/drift-ai/config-paths.ts:6` — `normalizeRepoPath` is defined here; only live import is `config-match.ts:4` (`import { normalizeRepoPath } from "./config-paths.js";`).
- Direct importers of the four config-match symbols (confirmed via `rg`, all from `./config-match.js`): `semgrep-runner.ts:13`, `semgrep-candidates-command.ts:13`, `near-duplicates-runner.ts:14`, `near-duplicates-check-config.ts:3`, `module-doc-paths.ts:21`, `ghost-files-current.ts:4`, `ghost-files-changed.ts:3`, `duplicates.ts:5`, `duplicates-runner.ts:13`, `duplicate-shapes.ts:26`, `duplicates-check.ts:3`, `current-inventory.ts:6`, `comments.ts:10`, `commented-out-code.ts:18`.
- `scripts/drift-ai/config.ts:1-5` — no facade/public-surface doc comment (contrast `ghost-files.ts:1`, `class-construction.ts:1`).

## Proposed fix
1. In `scripts/drift-ai/config.ts`, delete the entire re-export block at lines 6-11 (the four `./config-match.js` names).
2. In the `./config-parsing.js` re-export block (config.ts:12-18), drop `normalizeRepoPath` (line 15) while keeping `collapseRepoPath`, `DEFAULT_DRIFT_AI_CONFIG`, `parseDriftAiConfig`, `pathEscapesRepo`.
3. Optionally drop the now-dead `normalizeRepoPath` name from `config-parsing.ts:21`, keeping `collapseRepoPath` and `pathEscapesRepo` there (those two remain consumed). This removes the dead barrel hop; `normalizeRepoPath` stays reachable via its direct `./config-paths.js` import.
4. Re-run `bun run sensor:knip` and confirm config.ts:7-10, config.ts:15, and config-parsing.ts:21 `normalizeRepoPath` drop out of the Unused exports list (the four live symbols must not regress into it). Run the scripts test suite (`bun run test:scripts:changed`) to confirm no import break.

No tests assert these re-exports exist (the scripts suite imports the symbols from their direct modules), so this is a pure deletion — no test additions needed, but the knip + scripts-test gate is the verification per the TDD norm.

## Verification / caveats
- False-positive risk: low. These are plain TS scripts — no dynamic import, string-keyed access, DI, or JSX could reach the barrel symbols implicitly. knip independently corroborates the exact keep/drop split.
- Scope boundary: touch ONLY the five dead names. Do not remove `collapseRepoPath`/`pathEscapesRepo` from config.ts:12-18 or config-parsing.ts:21 — both are live (`current-inventory.ts:5` imports them through `config.js`; `coverage-config.ts:9` imports `collapseRepoPath` from config-paths.js directly). Do not touch `DEFAULT_DRIFT_AI_CONFIG`/`parseDriftAiConfig`.
- This is one small slice of a larger pre-existing knip unused-exports backlog; a code deletion (not a knip suppression) is the right call here since config.ts is not a declared facade. If the team later decides config.ts should become a true facade, add a `Public facade` doc comment instead — but currently nothing reaches these five through it, so deletion is correct.
