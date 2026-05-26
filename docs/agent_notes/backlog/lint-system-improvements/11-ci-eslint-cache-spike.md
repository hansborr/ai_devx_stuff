# CI ESLint Cache Spike

Status: Parked
Order: 11

## Context

CI currently runs ESLint cold. Caching `node_modules/.cache/eslint/` might
reduce type-aware lint time, but a weak cache key can create stale or confusing
diagnostics.

This is a measurement task, not an automatic adoption task.

## Scope

- Measure current CI lint timing before changing cache behavior.
- If testing cache adoption, include enough invalidation inputs in the key:
  lockfile, package manager version, ESLint config and support files, tsconfig
  files, local rule sources, TypeScript/ESLint/plugin versions, and possibly a
  source hash fallback.
- Compare cold, warm, and changed-config runs.
- Record whether the cache improves wall time enough to justify complexity.

## Definition Of Done

The repo either has a correctly keyed ESLint CI cache with measured benefit or
a durable note explaining why caching was rejected for now.

## Verification

- Before/after CI timing data
- CI run after changing ESLint config or local rule source
- `bun run lint -- --max-warnings=0`
