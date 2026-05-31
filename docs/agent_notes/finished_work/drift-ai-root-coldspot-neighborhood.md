# Drift:ai Root Coldspot Neighborhood

Completed drift-ai review task 23.

`stale-in-hot-neighborhood` now declines to fire for repo-root files whose
`dirnameOf()` bucket is empty. Root files can still surface through independent
amplifiers such as `write-once-birth-burst`, but they no longer inherit the
combined churn of unrelated root-level config and metadata files.

Nested directory behavior is unchanged.

Validation:

- `bun run test -- scripts/drift-ai/coldspots-coldspot.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai`
- `bun run drift:ai coldspots --lens coldspot --window 90 --top 20`
