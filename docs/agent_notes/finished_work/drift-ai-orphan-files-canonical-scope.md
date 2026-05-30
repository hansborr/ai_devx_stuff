# Drift:ai Orphan Files Canonical Scope

Completed drift-ai review task 16.

`buildOrphanFindings` no longer accepts root information. In current scope, knip's
global orphan output is filtered through `detectorScope.files`, the canonical
current inventory prepared after roots, ignores, regular-file checks, and source
extension policy. Changed scope still filters by the changed-file set.

The orphan-files plugin now calls `buildOrphanFindings(parsed.files,
ctx.detectorScope, provenance)`, so it cannot rederive current root semantics.
The README now documents current-scope orphan reporting as current-inventory
intersection rather than surfacing every knip orphan.

Validation:

- `bun run test -- scripts/drift-ai/knip-orphan-files.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai.test.ts`
- `bun run drift:ai --scope current --root scripts/drift-ai --check orphan-files --format text`
- `bun run drift:ai --scope current --check orphan-files --format text`
