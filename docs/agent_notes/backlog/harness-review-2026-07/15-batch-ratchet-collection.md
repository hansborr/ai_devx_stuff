# 15. Ratchet collection spawns one sequential ESLint process per registry entry — parallelize with the existing bounded-concurrency pattern

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: ratchet · Area: collection · Severity: med · Size: M · Confidence: high
Theme: ratchet-performance · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`collectCurrentById` runs a plain sequential `for` loop: one `await`ed ESLint child process per registry entry (12 today, growing with every new ratchet). Each spawn is a fresh process with an isolated generated config, and the two `type-aware-ts` entries (`strict-boolean-expressions-*`) run with `projectService: true` and no ESLint cache — every full ratchet run rebuilds TypeScript program state per entry, serially. This cost lands on the hot paths: pre-commit's ratchet slot, `verify:changed`, and CI's `bun run lint:ratchet`. The isolated-config-per-entry design is a documented correctness stance (do not reuse the project flat config with one rule toggled) — the fix is to stop paying for it serially, not to fight the isolation.

## Evidence
- `/workspace/scripts/lint-ratchet/current-collector.ts:161-176` — `for (const ratchet of lintRatchets) { ... await runEslint(ratchet, ruleSourceHash) }`: strictly sequential, one invocation per entry. Verified.
- `/workspace/scripts/lint-ratchet/eslint-runner.ts:60-104,134-140` — each call spawns `node_modules/.bin/eslint` fresh; `eslint-config.ts:42-44` — only `minimal-ts` entries get `--cache`; `:96-101` — type-aware entries use `projectService: true` (or the scripts tsconfig), so type info is rebuilt per spawn.
- `/workspace/scripts/lint-ratchet/lint-ratchet-config.ts:171,207` — the two `type-aware-ts` entries; the other 10 are `minimal-ts`.
- Bounded-concurrency precedent already in-tree for the edit-check path: `edit-check.ts:233-254` (`runGroupsWithConcurrency`, worker-pool over an index), `modes.ts:50` (`DEFAULT_EDIT_CHECK_CONCURRENCY = 3`), `lint-ratchet.ts:20-25` (`AI_RATCHET_REGRESSION_CONCURRENCY` env override, validated ≥ 1). Verified names and locations as cited.
- Isolation stance documented at `docs/guides/lint-ratchet.md:169-178` ("writes isolated ESLint configs for each registry entry. It does not reuse the project's full flat config and toggle one rule").

## Proposed direction
Minimal first (one small commit): apply the edit-check worker-pool pattern to `collectCurrentById` — run entries through a bounded pool (default 3, reusing/generalizing the `AI_RATCHET_REGRESSION_CONCURRENCY` env or a sibling `AI_RATCHET_COLLECT_CONCURRENCY`), collecting into the same `Map`. Each entry is already fully independent (own config file, own cache dir keyed by config+rule-source hash, `sweepStaleCacheSiblings` scoped per ratchet id at `eslint-runner.ts:31-58`), so no shared mutable state blocks this. Keep the concurrency low by default: the two type-aware entries are memory-heavy, and CI runners plus the 4–6GB heap ceilings seen elsewhere in this repo argue against unbounded fan-out.

Record the larger option as a follow-up, not this commit: group registry entries by parser profile (and scripts-project flag) into one generated flat config with per-entry `files`/`ignores`/`rules` blocks, run ESLint once per profile group, and demux findings by `ruleId` + `matchesRatchet` glob. That amortizes the type-aware program build across entries but has real hazards — two entries sharing a `ruleId` with different `ruleOptions` (both `vitest/valid-expect` entries; both `strict-boolean-expressions` entries) can only co-exist in one config if their file sets are disjoint at ESLint's config-matching level, and per-entry cache identity (`cacheKeyHashFor`) no longer maps to one invocation.

## Scope / caveats
- Do not change the isolated-config generation or per-entry cache identity in the minimal commit; only the orchestration loop and a test asserting result-equivalence with the sequential path (order-independence of the returned map).
- Watch pre-commit wall-time and memory on the first landing; if the two type-aware entries thrash when co-scheduled, cap type-aware entries to 1 in-flight (trivial in the pool: sort them to distinct workers or gate on profile).
- The batching follow-up (profile-grouped configs) should be its own leaf/commit with fixture coverage for the shared-ruleId demux hazard; do not fold it in here.
