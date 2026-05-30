# Drift:ai Tool Bin Resolution Dedupe

Completed drift-ai review task 12.

`scripts/drift-ai/tool-bin.ts` now owns executable lookup for tools-checkout,
target-repo, and override precedence. `resolveJscpdBin` and `resolveKnipBin`
remain the exported wrapper APIs with their module-dir defaults and test seams.

Tests added `resolveKnipBin` coverage in `knip-orphan-files.test.ts`, mirroring
the existing jscpd wrapper assertions for source labels, fallback order, searched
diagnostics, and omitted override behavior.

Validation:

- `bun run test -- scripts/drift-ai/duplicates.test.ts scripts/drift-ai/knip-orphan-files.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/adapter-support.test.ts scripts/drift-ai/duplicates.test.ts scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai.test.ts`
- `bun run drift:ai --scope current --root scripts/drift-ai --check near-duplicates --format text`
