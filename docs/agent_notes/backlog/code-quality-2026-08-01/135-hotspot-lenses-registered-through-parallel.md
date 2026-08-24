# 135. Hotspot lenses are wired through five parallel per-lens surfaces, and the three that are not compile-checked fail silently

Status: Landed on fix/cq-135
Theme: single-source lens registry · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The `bun run drift:ai hotspots` advisory has one obvious extension axis: adding
a lens. Today a new lens must be threaded through five modules by hand — the
`HotspotLens` union in the type home, the `CONCRETE_LENSES` array and
`LENS_SELECTIONS` fan-out in argument parsing, the reduction switch, the
renderer if-chain, and the row-identity/baseline-tagging logic — plus three
prose restatements of the lens list in the usage text and the `--lens` error
message. Nothing represents "a lens" as one exhaustive contract.

The cost is uneven, and the uneven part is the trap. The reduction, tagging,
and rendering dispatches are union-typed, so forgetting one of those is a
compile error. But the remaining surfaces are stringly: `CONCRETE_LENSES` is a
plain `readonly ConcreteHotspotLens[]`, so a lens omitted from it silently
drops out of `--lens all` and out of the accepted `--lens` values;
`PATH_KEYED_LENSES` is a `ReadonlySet<string>`, so a lens omitted there makes
`rowKey` return `null`, which the baseline tagger reads as "no prior row" and
tags every row `NEW` — a wrong answer, not an error; and the
suppression-scan gate hard-codes `includes("suppression-churn")`, so a future
lens needing a content scan would silently get empty input. A contributor
adding a lens gets compile errors for the surfaces that were never dangerous
and silence for the ones that are.

## Evidence

- `scripts/drift-ai/hotspots-format.ts:17-23` — the `HotspotLens` union
  (`"churn" | "coupling" | "fragmentation" | "suppression-churn" | "thrash" |
  "all"`), the identity set's type-level home.
- `scripts/drift-ai/hotspots-args.ts:12-18` — `CONCRETE_LENSES` re-enumerates
  the five concrete lenses as a `readonly ConcreteHotspotLens[]`; an array
  missing a member still typechecks, and both the accepted `--lens` values
  (`HOTSPOT_LENS_VALUES`, `:29-32`) and the `all` fan-out derive from it.
- `scripts/drift-ai/hotspots-args.ts:20-27` — `LENS_SELECTIONS` maps every
  lens to its selection by hand (keys are compile-checked via
  `Record<HotspotLens, …>`; the values are not derived).
- `scripts/drift-ai/hotspots-args.ts:37`, `:45`, `:92` — the lens list
  restated as prose three more times: two usage lines and the `parseLens`
  error message.
- `scripts/drift-ai/hotspots.ts:221-240` — `reduceSection` dispatches
  reduction through a five-armed switch (union-exhaustive: a new
  `ConcreteHotspotLens` member fails to compile here).
- `scripts/drift-ai/hotspots.ts:248` — `collectSuppressionRecordsForLens`
  gates the content scan on the literal
  `LENS_SELECTIONS[lens].includes("suppression-churn")` — a per-lens data
  need expressed as a hard-coded string test.
- `scripts/drift-ai/hotspots-format-sections.ts:14-36` — `appendSection`
  renders through a per-lens if-chain (also compile-exhaustive: the final
  `appendThrashSection(lines, section)` call stops narrowing if a section
  type is unhandled).
- `scripts/drift-ai/hotspots-actionability.ts:178-183` — `PATH_KEYED_LENSES:
  ReadonlySet<string>` re-encodes per-lens row-identity policy as untyped
  strings.
- `scripts/drift-ai/hotspots-actionability.ts:193-204` and `:215-216` —
  `rowKey` returns `null` for any lens in neither `PATH_KEYED_LENSES` nor the
  `coupling` branch, and `deltaFor` maps a `null` key to
  `{ status: "new" }`: an unregistered lens silently tags every row `NEW`.
- `scripts/drift-ai/hotspots-actionability.ts:262-273` — `tagSection` repeats
  per-lens handling in a third five-armed switch (union-exhaustive).
- Precedent for the fix already in the same directory:
  `scripts/drift-ai/prototype-subcommand-definitions.ts:50-58` — an
  `as const satisfies` definitions array from which the id union
  (`(typeof …)[number]["id"]`), the id list, and the usage lines are all
  derived.

## Proposed direction

Right family of solution — a typed concrete-lens registry — refined to fit
repo constraints. Two naturally separable parts:

1. **Registry + derivation (the load-bearing half).** Add a new module (e.g.
   `scripts/drift-ai/hotspots-lens-registry.ts`) modeled on the
   `prototype-subcommand-definitions.ts` idiom: an `as const satisfies` array
   of lens definitions from which `ConcreteHotspotLens` is *derived*
   (`(typeof DEFS)[number]["id"]`, with `HotspotLens = ConcreteHotspotLens |
   "all"`), and from which the accepted `--lens` parse values, the
   `LENS_SELECTIONS.all` fan-out, and the usage-line lens list are all
   computed — omissions then fail to compile or cannot exist. Each definition
   owns the currently compile-silent policy: a row-key kind
   (`"path" | "pair"`) replacing the `PATH_KEYED_LENSES` set (`rowKey` must
   keep serving both typed live rows and untrusted baseline
   `Record<string, unknown>` rows), and a needs-suppression-scan flag
   replacing the hard-coded `includes("suppression-churn")` gate in
   `hotspots.ts`.
2. **Dispatch migration (optional, constrained).** For the "registry owns
   reduction and renderer dispatch" half, two constraints apply. (1)
   `hotspots-format.ts` is the documented cycle-free type home (reducers
   import types, never the reverse — see its header at `:9-11`): the registry
   must import reducers/renderers and must never be imported by the type
   home. (2) The repo's no-type-assertion rule makes heterogeneous registry
   dispatch over the per-lens section union a correlated-union typing
   problem — either use the mapped-type correlated pattern
   (`{ [L in ConcreteHotspotLens]: LensDefinition<L> }` with
   `SectionOf<L> = Extract<HotspotSection, { lens: L }>`) assertion-free, or
   keep the existing reduce/tag/append switches (already exhaustively
   compile-checked) and let the registry single-source only the silent
   surfaces. The narrower option is the acceptable minimum and avoids
   `interop` markers.

Calibration to keep in mind while planning: the original framing slightly
overstates the danger of the dispatches. `reduceSection`, `tagSection`, and
the `appendSection` if-chain already fail to compile on a new lens; the real
compile-silent drift points are `CONCRETE_LENSES` plus the usage/error prose
(`hotspots-args.ts:12`, `:34-46`, `:92`), `PATH_KEYED_LENSES`
(`hotspots-actionability.ts:178` — omission silently tags baseline rows
`NEW`), and the suppression-scan gate (`hotspots.ts:248`). Part 1 is where
the correctness value lives; part 2 is consolidation.

## Scope / caveats

- **Hotspots-only.** Coldspots is out of scope: it imports only leaf types
  from `hotspots-format.ts` (`coldspots-baseline.ts:9`,
  `coldspots-format.ts:20`) and has its own baseline module.
- **The advisory brand firewall stands.** `hotspots-format.ts:3-7` documents
  that hotspots is never a trusted finding and not a `CheckPlugin`; the
  registry is lens-internal and must not become a `DriftCheckId` entry or
  emit the `findings` shape.
- **Import direction is a hard constraint.** The type home
  (`hotspots-format.ts`) must never import the registry if the registry
  imports reducers/renderers; putting the registry in the type home and
  importing lens math there recreates the cycle the header forbids.
- **No new type assertions.** If the correlated-union pattern in part 2 turns
  out to need a cast, stop at part 1's single-sourcing — that outcome is
  explicitly acceptable.
- **Split lands naturally as two units** (registry+derivation first, dispatch
  migration second, if at all); part 1 is independently valuable.
- Related leaves in this pack cover sibling "parallel manually synchronized
  registries" in drift-ai over *different* subsystems with different fix
  shapes: [132-drift-check-registration-has-three-manually.md](./132-drift-check-registration-has-three-manually.md)
  (check registration) and
  [120-cli-option-models-remain-parallel-registries.md](./120-cli-option-models-remain-parallel-registries.md)
  (CLI option models). No ordering dependency, but avoid working them
  concurrently in `scripts/drift-ai/`.
- Prior pack: CQ25-10 (2026-07-25 leaf `34-drift-ai-typing.md`) covers the
  drift-ai family but a disjoint defect set (details records, id sets,
  adapter spawn plumbing, positionals, hand-rolled guards); it contains zero
  hotspot or lens mentions, so nothing here is already ruled on or in flight
  there.
