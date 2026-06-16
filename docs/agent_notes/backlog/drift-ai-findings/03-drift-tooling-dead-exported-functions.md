# 03. 7 dead exported functions: 4 orphaned ratchet builders, 2 abandoned unresolved-runner placeholders, 1 dead repo-path wrapper

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree (all 7 dead exports removed; `docs/guides/lint-ratchet-adoption.md` no longer names `localMaxLinesRatchet`). The body below is the original finding — its cited line numbers predate the fix.
Theme: dead-code · Area: tooling · Severity: quality-med · Size: S
Source: drift:ai dead-code / unused-exports (target-config, knip-corroborated) · Confidence: high

## Problem
Seven exported functions across `scripts/lint-ratchet` and `scripts/drift-ai` have zero references anywhere outside their own definition file (confirmed by `rg -nw`, including all `*.test.ts`). They are dead seams in an actively developed tool; deleting them clarifies which builders/runners are load-bearing.

1. Four ratchet builders in `lint-ratchet-registry-builders.ts` are orphans left after the `lintRatchets` registry was trimmed. `lint-ratchet-config.ts` (lines 5-8) now imports only `localTypeAssertionBoundaryRatchet` and `vitestValidExpectRatchet` from that module. The other four — `coreComplexityRatchet`, `coreNoMagicNumbersRatchet`, `localMaxLinesRatchet`, `regexpNoUnusedCapturingGroupRatchet` — are never imported.

2. Two `unresolved*Runner` placeholders are an abandoned defensive seam. Both carry a comment claiming they "fail loudly if invoked", but the architecture excludes a check from the enabled set rather than injecting an unresolved runner, so nothing can ever invoke them. `runner.ts` (lines 50-51) wires `moduleGraph?` / `nearDuplicates?` as optional overrides; every consumer (`import-cycles-check.ts:30`, `layer-direction-check.ts:23`, `near-duplicates-check.ts:30`) defaults with `?? defaultModuleGraphRunner()` / `?? defaultNearDuplicateRunner()`. The "fails loudly if invoked" comment guards a code path that cannot be reached.

3. `repo-io.ts:14` `safeRepoPath` is a public wrapper that resolves `repoRoot` then delegates to the internal `safeRepoPathFromRoot` (line 69). Every `default*` factory in the file (lines 18/31/47/61) calls `safeRepoPathFromRoot` directly, and `safeRepoPath` has zero importers.

## Evidence
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:28` — `coreComplexityRatchet`, single `rg -nw` hit (its own def).
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:45` — `coreNoMagicNumbersRatchet`, single hit.
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:69` — `localMaxLinesRatchet`, single hit.
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:99` — `regexpNoUnusedCapturingGroupRatchet`, single hit.
- `scripts/lint-ratchet/lint-ratchet-config.ts:5-8` — imports only the two surviving builders; corroborates the four orphans.
- `scripts/drift-ai/import-cycles-graph.ts:73` — `unresolvedModuleGraphRunner`; comment at 70-72 states the check is excluded from the enabled set, so it is never invoked. Single hit.
- `scripts/drift-ai/near-duplicates-runner.ts:95` — `unresolvedNearDuplicateRunner`; identical abandoned pattern. Single hit.
- `scripts/drift-ai/runner.ts:50-51` — runners wired only as optional overrides; consumers default to `default*`, never an unresolved runner.
- `scripts/drift-ai/repo-io.ts:14` — `safeRepoPath` wraps internal `safeRepoPathFromRoot` (line 69); the `default*` factories at 18/31/47/61 call `safeRepoPathFromRoot` directly. Zero importers of `safeRepoPath`.
- `docs/guides/lint-ratchet-adoption.md:259` — prose names `localMaxLinesRatchet` under "What is not portable"; stale doc not updated when the registry was trimmed (documentation, not reachability).

## Proposed fix
1. Delete `coreComplexityRatchet`, `coreNoMagicNumbersRatchet`, `localMaxLinesRatchet`, and `regexpNoUnusedCapturingGroupRatchet` from `lint-ratchet-registry-builders.ts`. After removal, check whether `maxLinesRatchetRuleOptions` (lines 20-26), the `maxLinesPolicy` import (line 6), and the `ParserRatchetFamilyScope` type (lines 16-18) become unused — if so, delete them too. Keep `localTypeAssertionBoundaryRatchet` and `vitestValidExpectRatchet`.
2. Delete `unresolvedModuleGraphRunner` (and comment 70-72) from `import-cycles-graph.ts`, and `unresolvedNearDuplicateRunner` from `near-duplicates-runner.ts`. Leave the `default*` factories and the `ModuleGraphRunner` / `NearDuplicateRunner` types (those are imported as types by `runner.ts`).
3. Delete the `safeRepoPath` wrapper from `repo-io.ts`; the internal `safeRepoPathFromRoot` stays.
4. Update `docs/guides/lint-ratchet-adoption.md:259` to drop the `localMaxLinesRatchet` reference (or rewrite that bullet around the surviving builders), since the builder is gone.
5. Per repo TDD norm: no new tests — these symbols have no test coverage to migrate. Run `bun knip` (or the project knip sensor) to confirm the seven exports disappear from "Unused exports", and run the scripts test suite (`bun run test:scripts`) plus `bun run lint:changed` / `typecheck` to confirm no breakage.

## Verification / caveats
- False-positive risk is low: refutation angles all checked and failed — no dynamic `import()`/`require` of these modules, no `export *` barrel re-export, no string-keyed/DI/router/JSX usage, no test-only references. Knip independently lists all seven at the exact cited lines.
- Scope boundary: deletion only. Do NOT remove the `default*` factories or the runner TYPES (`ModuleGraphRunner`, `NearDuplicateRunner`) — `runner.ts` imports those types. Implementer should re-run `rg -nw` on each symbol after rebasing in case new callers landed.
- Adjacent cleanup (optional, same files): knip also flags unused exported TYPES `ModuleGraphRunnerInput`, `NearDuplicateRunnerInput`, `NearDuplicateRunnerResult`, `RepoPathKind` — verify independently before touching, as some may be referenced via structural typing not caught by `rg`.
- If the unresolved-runner seam is wanted as future-proofing, the right move is still deletion now and re-introduction only when a caller actually injects it; a placeholder that "fails loudly if invoked" is moot when nothing can invoke it. Config-suppression is not appropriate here — this is genuine dead code, not a knip false positive.
