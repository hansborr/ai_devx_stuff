# Drift:ai coldspots lazy stale-marker context

Completed drift-ai review task 35.

`runParsedColdspots` now passes a memoized stale-marker file-list thunk through
`SectionContext` instead of eagerly walking source files before lens dispatch. The
default `coldspot` lens therefore only pays for parsed args and git history,
while the `stale-markers` reducer still receives the configured file list, reader,
blame runner, and wall-clock reference when selected. `--lens all` still emits
both sections and enumerates marker candidates once.

Validation: `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/coldspots.test.ts
scripts/drift-ai/coldspots-stale-markers.test.ts`.
