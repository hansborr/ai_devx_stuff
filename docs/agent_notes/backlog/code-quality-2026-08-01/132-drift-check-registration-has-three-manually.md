# 132. Registering a drift-ai check means updating four manually synchronized inventories the compiler never cross-checks

Status: Landed on fix/cq-132
Theme: compiler-verified registration · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Adding or renaming a drift-ai check touches four hand-maintained lists that all
enumerate the same sixteen identities: the `DriftCheckId` union, the metadata
registry, the runtime plugin registry, and the central configuration map. The
metadata registry declares itself the canonical order and says the runtime
registry "mirrors it"; the runtime registry repeats the same sixteen entries in
the same order with its own comment promising the mirror; the config map spells
out the same sixteen keys a third time; and the id union is a fourth copy of the
membership. Nothing ties any of these together at the type level — the claimed
authority relationship is restored only by convention comments, a parity test
suite, and an `interop` cast where `Object.fromEntries` loses the id/config
correlation.

The cost is not silent drift — the parity tests catch a mis-ordered or missing
entry — but recurring coordination friction on the subsystem's most common
extension path: every new check is a four-file synchronized edit whose mistakes
surface as test failures instead of compile errors, and the array-shaped runtime
registry forces a lookup function that returns `undefined`, which in turn forces
a dead "not implemented" branch in the report builder. For a repo meant to be
copied as a harness-engineering reference, this models exactly the pattern —
parallel registries policed by tests where the compiler could prove
exhaustiveness — that its own drift checks exist to flag.

## Evidence

- `scripts/drift-ai/types.ts:3-19` — `DriftCheckId`, a hand-maintained
  16-member string-literal union: the membership inventory.
- `scripts/drift-ai/check-metadata.ts:29-46` — `CHECK_METADATA`, sixteen
  entries; the comment at `:27-28` declares it the "canonical check order" that
  `check-registry.ts` mirrors.
- `scripts/drift-ai/check-registry.ts:23-40` — `CHECK_PLUGINS`, a second
  16-entry array independently repeating membership and order; its comment at
  `:22` promises "The order mirrors `CHECK_METADATA`". Nothing but that comment
  and a test holds the two arrays in sync.
- `scripts/drift-ai/config.ts:144-184` — `DriftAiChecksConfig`, a third
  hand-written inventory: sixteen literal keys, each free to drift from
  `DriftCheckId` (a missing or misspelled key here is only caught where a
  consumer happens to index it).
- `scripts/drift-ai/check-metadata.ts:59-63` — `buildDefaultChecksConfig` loses
  the id/config correlation through `Object.fromEntries` and restores it with a
  compile-time `type-assertion-boundary: interop` cast at `:61-62`.
- `scripts/drift-ai/check-registry.ts:44-46` — `checkPluginFor` returns
  `DriftAiCheckPlugin | undefined` because an array cannot prove totality;
  `scripts/drift-ai/report-builder.ts:60-65` therefore carries a
  "check is not implemented" skip branch that is unreachable for CLI-validated
  ids (`scripts/drift-ai/cli-args.ts:24` builds `CHECK_KEYS` from `ALL_CHECKS`
  and rejects anything else).
- `scripts/drift-ai/check-metadata.test.ts:16-18` — the parity test asserting
  the two arrays enumerate ids in the same order; `:20-32` pins defaults
  alignment between metadata and plugins. Mis-registration is test-caught, not
  compiler-caught.
- `scripts/drift-ai/check-plugin.ts:90` —
  `CheckConfigMetadata<C, Id extends DriftCheckId = DriftCheckId>`: the
  per-check config modules are generic over the union, so the union must exist
  before the metadata entries do.

## Proposed direction

Keep the lightweight-import boundary and both modules, but make one typed
check-id/config declaration authoritative and build runtime order from an
exhaustive plugin-by-id record keyed by it. Concretely:

1. **`DriftCheckId` (`types.ts:3`) is the single membership authority.** It
   cannot be derived from `CHECK_METADATA`: every `*-check-config.ts` is typed
   `CheckConfigMetadata<C, Id extends DriftCheckId>` (`check-plugin.ts:90`), so
   deriving the union from the entries would be a constraint cycle. Adding a
   check starts by adding its id to the union; everything below turns that into
   compile errors at each remaining site.
2. **Key `DriftAiChecksConfig` off the union.** Re-declare the config map in
   `config.ts` so its key set is compiler-tied to `DriftCheckId` (an interface
   whose exhaustiveness is asserted against the union, not a mapped type that
   would erase the per-check doc comments at `config.ts:147-183` — those
   comments stay).
3. **`CHECK_METADATA` stays the single order authority**, with
   compiler-asserted exhaustive id coverage so a missing entry stops compiling
   instead of failing the parity test.
4. **Replace the `CHECK_PLUGINS` array with a plugin-by-id record** in
   `check-registry.ts`, checked with `satisfies Record<DriftCheckId, ...>`, and
   derive runtime order as `ALL_CHECKS.map((id) => PLUGIN_BY_ID[id])`. The new
   import edge (`check-registry.ts` → `check-metadata.ts` for `ALL_CHECKS`) is
   in the permitted direction — the boundary forbids only the reverse.
5. **Harvest the totality.** `checkPluginFor` becomes total, deleting the
   unreachable `undefined` branch at `report-builder.ts:60-65`; the interop
   cast at `check-metadata.ts:61-62` shrinks or retires once the config map is
   keyed by the union. Both moves align with the repo's anti-assertion policy
   (AGENTS.md Code Standards).

Files touched: `types.ts`, `check-metadata.ts`, `check-registry.ts`,
`config.ts`, `check-metadata.test.ts`, `report-builder.ts`, plus the
skip-reason sweep below. TDD against the existing parity suite:
`bun run test:scripts:file -- scripts/drift-ai/check-metadata.test.ts`.

## Scope / caveats

- **Binding ruling — do not merge the registries.**
  [34-drift-ai-typing.md](../code-quality-2026-07-25/34-drift-ai-typing.md#L175)
  (`:175-181`) rules that `check-metadata.ts` and `check-registry.ts` stay
  separate: CLI/config code must enumerate checks without loading the
  jscpd/knip/ts-morph adapters. The direction above keeps two modules and only
  changes how the runtime module proves membership and order; any fix that
  collapses them is out of bounds.
- **The import-boundary suite must stay green.** The second describe block in
  `check-metadata.test.ts:54-186` walks transitive value imports of the
  lightweight surface; nothing in `check-metadata.ts`, `cli-args.ts`,
  `config-parsing.ts`, or `config-defaults.ts` may gain an edge to
  `check-registry.ts` or any `*-check.ts`.
- **Keep the order-parity test.** The ruling above notes the assertion at
  `check-metadata.test.ts:16-18` exists on purpose. After step 4 it pins the
  derivation rather than policing a convention — keep it (or tighten it to
  assert the record's keys equal `ALL_CHECKS`), do not delete it.
- **The skip-reason string has a second reader.** Deleting the
  `report-builder.ts` branch orphans the
  `reason === "check is not implemented"` arm at
  `scripts/drift-ai/report-format.ts:71` and the absence assertion at
  `scripts/drift-ai/hotspots.test.ts:140`; sweep both with the branch. This is
  behavior-preserving: `cli-args.ts:24` already rejects unknown ids, so the
  branch cannot fire today.
- **Out of scope: the sibling parallel-registry findings.** CLI option models
  ([120-cli-option-models-remain-parallel-registries.md](./120-cli-option-models-remain-parallel-registries.md))
  and hotspot lens registration
  ([135-hotspot-lenses-registered-through-parallel.md](./135-hotspot-lenses-registered-through-parallel.md))
  are the same disease in different drift-ai subsystems with different fix
  shapes. No ordering dependency, but avoid working them concurrently with
  this leaf — 120 in particular edits `scripts/drift-ai/types.ts`.
- **Prior pack.** CQ25-10
  ([34-drift-ai-typing.md](../code-quality-2026-07-25/34-drift-ai-typing.md))
  was superseded by its plan into CQ25-45..47 — type-only cycle keys, the knip
  `reportCache` memo, and zod narrowing of triage inputs. None cover check
  registration, so this leaf is novel there. Separately,
  [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md) slice 28.2 (CQ25-35)
  schedules a `scripts/drift-ai/MODULE.md` that promotes the two-registry
  layering law from `check-metadata.ts:1-6` into prose (not yet landed — no
  MODULE.md exists at the pin). If 28.2 lands first, update that prose here to
  describe the derived order; either way, rewrite the mirror comments at
  `check-metadata.ts:27-28` and `check-registry.ts:22` to state the new
  contract (order derived, not mirrored).
