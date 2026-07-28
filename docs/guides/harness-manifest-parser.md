# Reading harness.controls.json

`harness.controls.json` is the harness's registration manifest. Three modules
own the seam that reads it, and `harness:check` enforces which files may import
which. If you hit a tripwire failure mentioning `MANIFEST_DIRECT_READERS`, this
page is the answer.

## The three modules

| Module | Owns | May import |
|---|---|---|
| `scripts/harness/harness-manifest.ts` | Path and IO. `harnessManifestPath`, `readHarnessManifest`, `loadHarnessManifest`. No shape opinion. | Node builtins plus the dependency-free guards in `scripts/lib/records.ts` |
| `scripts/harness/harness-manifest-schema.ts` | Shape. The Zod contract, `parseHarnessManifest` / `safeParseHarnessManifest`, and the `HarnessManifest` type. No IO. | Zod and sibling vocabulary |
| `scripts/harness/harness-manifest-loader.ts` | Joining the two: `loadTypedHarnessManifest(repoRoot)` and `loadTypedHarnessManifestIfPresent(repoRoot)`. | both of the above |

**Import the loader.** That is the whole rule for new code:

```ts
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";

const manifest = loadTypedHarnessManifest(repoRoot);
for (const control of manifest.controls) {
  // control is a discriminated union over `kind`
}
```

Use `loadTypedHarnessManifestIfPresent` when the tree may legitimately carry no
manifest at all. It returns `undefined` for an absent file and still throws for
a present-but-invalid one.

## Why the leaf and the schema are separate

Not portability — **fixture copy closure**. `harness-manifest.ts` is copied
verbatim into two reduced trees:

- the lint-ratchet smoke fixture's portable runtime set
  (`PORTABLE_RUNTIME_FILES` in `scripts/tests/test-lint-ratchet.sh`);
- the harness-check fixture copy manifest
  (`scripts/tests/harness-check-fixture-manifest.generated.txt`), which
  `scripts/harness/fixture-closure-check.ts` validates against the real import
  graph.

Every import added to the leaf lands in both closures — both fixture sets
therefore also carry `scripts/lib/records.ts`, the leaf's one non-builtin
import. Keeping the leaf to that narrow set keeps those fixtures small, so the
Zod contract lives one layer up and only trees that actually validate shape copy
it.

## Division of labor

The parser owns **JSON shape**: top-level fields, the per-kind field inventory
(strict keys, so an unknown field is a registration typo), primitive field
typing, control-id uniqueness, and the non-emptiness of `slots`.

Everything else stays with its consumer, keeping that consumer's aggregated,
test-pinned diagnostics authoritative:

| Concern | Owner |
|---|---|
| `generatedSurface` facet | `scripts/harness/generated-surfaces.ts` |
| `hookWiring` facet | `scripts/harness/hook-wiring-schema.ts` |
| `skillWiring` facet | `scripts/harness/skill-inventory-schema.ts` |
| `slots` vocabulary — names, scripts, args, dynamic resolvers, marker bridges | `scripts/harness/generate-verify-steps.ts` |
| Which controls must declare `slots` at all | `scripts/harness/generate-verify-steps.ts` |
| Anything compared against the live tree | `scripts/harness-check.ts` and its `registration-*` collectors |

`slots` is the one place where a cardinality rule sits with the parser rather
than the consumer, and the reason is worth stating: **nothing downstream rejects
an empty array.** `generate-verify-steps.ts` accepts `[]` and renders
`MUSI_PRE_COMMIT_STEPS=()`, the marker-bridge subset check is vacuous over zero
slots, and `scripts/lib/verify-engine.sh` iterates zero entries and writes a
SUCCESS marker. `"slots": []` is therefore a gate that runs nothing and still
passes — so `.min(1)` stays on the carrier in the parser, where every reader of
every slot-carrying kind goes through it.

So when you migrate a consumer, delete its hand-rolled controls-array check,
entry object-ness check, id-presence check and duplicate-id check — those are
the contract's now — and keep its semantic checks.

## The read tripwire

`scripts/harness/manifest-contract-check.ts` scans non-test TS/JS under
`scripts/` for imports of the leaf's read-capable exports
(`readHarnessManifest`, `loadHarnessManifest`, `harnessManifestPath`) and fails
`harness:check` in two directions:

- an importer that is not on the `MANIFEST_DIRECT_READERS` allowlist — the
  bypass regrowth the tripwire exists to stop;
- an allowlisted file that no longer imports one — a stale entry. **The list
  only shrinks.**

Importing `HARNESS_MANIFEST_FILENAME` alone is path-only and never trips it.
`import type` and inline `{ type ... }` specifiers are erased and stay exempt.

The tripwire is import-based and deliberately cooperative. It cannot see
shell/`jq` consumers: `scripts/ai-hooks/check-wiring.sh` parses the manifest
with `jq` on purpose, to validate committed hook configs *without trusting the
generator*. That independence is the point, so it is out of scope by design.

### Migrating a reader

1. Replace the leaf import with `loadTypedHarnessManifest` from the loader.
2. Delete the shape checks the contract now owns; keep the semantic ones.
3. Delete the file's `MANIFEST_DIRECT_READERS` entry.
4. Re-run the gates below. If the consumer is a `generatedSurface` source, the
   closure checks will name the exact `triggerPaths` / `fixturePaths` entries to
   add to `harness.controls.json`; add them and re-run `bun run verify:steps`.

```bash
# the tripwire, the closure checks, and every live-tree comparison
bun run harness:check
# focused
bun run test:scripts:file -- scripts/harness/manifest-contract-check.test.ts
# the reduced fixture trees the closure checks describe
bash scripts/tests/test-harness-check.sh
bash scripts/tests/test-lint-ratchet.sh
```

### When not to migrate

Two readers stay on the allowlist as `sanctioned-reader`, each with its reason
recorded inline. They are the shape of the exceptions worth making:

- **`generate-harness-controls.ts`** owns the one-pass granular registration
  report, so it must read *past* schema-level defects instead of throwing on the
  first. It still goes through the typed parser, at the granularity that allows:
  the loose `categorizedControlFieldsSchema`.
- **`check-registry.ts`** ships in the lint-ratchet portable runtime copy set and
  runs against trees with partial or absent manifests. Importing the typed
  parser would expand that copy closure and couple every `lint:ratchet`
  invocation to whole-manifest validity.

The test: does the throwing whole-manifest parse either destroy a deliberately
worded diagnostic or reach a tree that cannot satisfy the whole contract? If
neither, migrate.

## Where to go next

- `docs/ai-harness.md` — the harness overview and the guide table.
- `docs/generated/harness-controls.md` — the generated inventory of every
  control the manifest declares.
- `docs/guides/verify-gate-lifecycle.md` — how `harness:check` runs inside the
  commit gate.
