# 125. The manifest hand-copies nearly identical ordered verify slot programs across four gate controls

Status: Landed on fix/cq-125
Theme: single-source gate slot programs · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`harness.controls.json` is the authored source of truth for what the
verification gates run, and it states each gate's ordered slot program four
times over: the `verify`, `verify-changed`, and `verify-parallel` wrapper
controls and the `hook/pre-commit` control each carry their own explicit
`slots` array. The four programs are near-copies of one another. `verify` and
`verify-parallel` carry byte-identical 16-slot arrays; `verify-changed` and
`pre-commit` carry the same 15 name/script pairs in the same order, 13 of the
15 slot objects byte-identical, with the remaining two (`test`, `scripts`)
differing only in reporter args, a dynamic resolver id, `fastCommitSkip`, and
one word of a documentation-only `condition` string.

Every slot addition, rename, or retarget therefore requires four synchronized
manifest edits. The drift risk is only partially guarded today: the generator
already asserts that pre-commit is a token-identical subset of both `verify`
and `verify-changed`, with intentional divergences declared-with-reason in a
hand-maintained allowlist — but nothing asserts `verify` and `verify-parallel`
stay identical, nothing compares `verify-changed` against `verify`, and a slot
simply *omitted* from a subset gate is invisible to a subset assertion. The
variation that actually exists is tiny and regular — one membership delta
(`local-rule-starter` runs only in the two full gates) and a handful of
per-consumer overrides on two slots — yet a reader must diff four ~80-line
JSON blocks to discover that, and a contributor porting this harness pattern
elsewhere copies the four-way duplication along with it.

## Evidence

All measurements below re-derived from the tree at the audit pin.

- `harness.controls.json:627` / `:635` — `verify-wrapper/verify` control id
  and its `slots` array; `:708` / `:716` — `verify-wrapper/verify-changed`;
  `:788` / `:796` — `verify-wrapper/verify-parallel`; `:2075` / `:2083` —
  `hook/pre-commit`. Four hand-authored ordered programs in one file.
- Measured: the `verify` and `verify-parallel` slot arrays are byte-identical,
  16 entries each. `verify-changed` and `pre-commit` share the same 15
  name/script pairs in the same order; 13 of 15 slot objects are
  byte-identical. The `test` slot differs in `args`
  (`--reporter=dot --reporter=json --outputFile.json=$TIMINGS_FILE` vs
  `--reporter=dot`), `dynamic` (absent vs `precommit-test-timings`), and
  `fastCommitSkip`; the `scripts` slot differs in `fastCommitSkip` and one
  word of its `condition` string.
- Sole membership delta across all four programs: `local-rule-starter`
  appears only in `verify` and `verify-parallel`, never in the changed-mode
  gates.
- `scripts/harness/generate-verify-steps.ts:36-62` — the `CONSUMERS` list
  reads all four control ids and compiles them into
  `scripts/verify/steps.generated.sh`, so the duplication lives in authored
  source, not generated output. The porting-knob comment for retargeting
  consumers is at `:35`.
- Existing partial guard: `assertSlotSuperset`
  (`scripts/harness/generate-verify-steps.ts:143`) and
  `assertMarkerBridgeSupersets` (`:179`, invoked at `:381`) enforce that
  pre-commit renders identical command tokens to `verify` and
  `verify-changed` for every shared slot, with 10 reasoned entries in
  `MARKER_BRIDGE_DIVERGENCE_ALLOWLIST`
  (`scripts/harness/verify-step-bridge-divergences.ts:9`). No assertion
  covers the `verify` vs `verify-parallel` pair or `verify-changed` vs
  `verify`, and the subset check cannot see a slot omitted from a subset
  gate.
- Condition wording drift already exists between the copies:
  `harness.controls.json:782` says "when **changed** hook/script/harness
  inputs require script smoke" while `:2152` says "when **staged** …" for the
  same `scripts` slot.
- `harness.controls.json:2` — the manifest's own `$comment` declares
  `condition` documentation-only; executable branching belongs in `dynamic`
  ids with matching `scripts/verify/steps-lib.sh` resolver arms.
- Downstream consumers all read materialized slot arrays:
  `scripts/harness/verify-step-schema.ts:226-235` (`parseVerifyStepSlots`,
  "shared manifest slot parser for every slots consumer"),
  `scripts/harness/control-field-validation.ts:39` (`harness:check` field
  validation), `scripts/harness/generate-harness-controls.ts:186`
  (`formatSlots` in the doc generator), and
  `scripts/drift-ai/harness-controls-parity.test.ts` (drift-ai parity).

## Proposed direction

Single-source the verify slot programs in `harness.controls.json` as one
ordered two-axis catalog, then compose the four gates as thin profiles.
Stage the work as (a) schema + loader + resolution with a byte-identical
parity proof, then (b) allowlist derivation and hand-file retirement.

1. **Catalog.** Each slot declares its full-tree command form once, plus an
   explicit changed-mode disposition: `inherit` (mode-invariant), a
   changed/staged form with a required reason string, or `omit` with reason
   (`local-rule-starter`). No silent default — a new slot without a declared
   disposition fails parse, so a forgotten mode declaration is a parse error
   rather than silent membership drift. Catalog order is execution order for
   every gate; verify during migration that it reproduces all four current
   arrays positionally.
2. **Profiles.** `verify` and `verify-parallel` become `{mode: "full"}` —
   their 16-slot byte-identity becomes structural instead of unguarded.
   `verify-changed` is `{mode: "changed"}` plus its `scripts`
   condition/dynamic. `pre-commit` is `{mode: "changed"}` plus reasoned
   overrides for `test` (dynamic `precommit-test-timings`, dropped json
   reporter args, `fastCommitSkip`) and `scripts` (staged condition,
   `fastCommitSkip`). `fastCommitSkip` stays pre-commit-only.
3. **Early resolution.** Resolve profiles to concrete `VerifyStepSlot[]`
   inside the manifest loader/schema parse so every downstream consumer —
   `generate-verify-steps.ts`, `harness:check` field validation, the doc
   generator, drift-ai parity — keeps seeing materialized arrays. The
   mandatory landing proof is `scripts/verify/steps.generated.sh`
   byte-identical before and after `bun run verify:steps`.
4. **Derive the divergence set.** Build the marker-bridge divergence set from
   the catalog's changed-form reasons plus pre-commit override reasons;
   retire `scripts/harness/verify-step-bridge-divergences.ts` as a hand file,
   but keep `assertMarkerBridgeSupersets` running against the resolved arrays
   (fed the derived set) as defense-in-depth over the resolver.
5. **Pre-work.** Reconcile — or declare as a reasoned override — the
   condition-string wording drift between `verify-changed`'s `scripts` slot
   ("changed", `harness.controls.json:782`) and pre-commit's ("staged",
   `:2152`) so the migration does not silently canonicalize one.
6. **Carry in scope.** Contract comments in
   `scripts/harness/harness-manifest-schema.ts` /
   `scripts/harness/verify-step-schema.ts`; the verify-consumers
   porting-knob note (`generate-verify-steps.ts:35`); the generator test and
   its fixture copies
   (`scripts/fixtures/generate-verify-steps/expected.generated.sh`, read by
   `generate-verify-steps.test.ts:167` — a known fixture copy-set hazard);
   and doc generator output unchanged (it continues rendering materialized
   per-gate programs). Run `bun run harness:check` after the manifest and
   generator surfaces change.

## Scope / caveats

- **Binding rulings** from the direction review; do not relitigate:
  - Do **not** introduce generic include/exclude composition vocabulary for
    gate profiles. Model exactly the two measured axes — per-slot full vs
    changed command forms in one ordered catalog, plus per-gate
    `{mode, reasoned overrides}`.
  - Do **not** add a slot `dependency` field. Ordering stays positional in
    the catalog, and the dist/typecheck deferral stays runtime logic in
    `scripts/verify/steps-lib.sh` (`musi_defer_dist_slot` at `:205`).
  - Do **not** layer profiles on top of the hand-maintained
    `MARKER_BRIDGE_DIVERGENCE_ALLOWLIST` — that double-declares every
    divergence. Derive the set from catalog changed-form reasons plus
    pre-commit override reasons and retire the hand file, keeping
    `assertMarkerBridgeSupersets` as a tripwire over the resolved arrays.
  - Do **not** let downstream consumers see profiles. Resolve to
    materialized slot arrays in the manifest loader so `harness:check`, the
    doc generator, and drift-ai parity are untouched; byte-identical
    `steps.generated.sh` regeneration is the mandatory landing proof.
  - Do **not** allow a silent changed-mode default for catalog slots; every
    slot declares `inherit`, a changed form with reason, or `omit` with
    reason.
  - Do **not** silently canonicalize the "changed" vs "staged" condition
    wording; reconcile or declare it as a reasoned override before
    migrating.
- Runtime behavior of the gates is out of scope: no slot is added, removed,
  or retargeted by this leaf, and `scripts/verify/steps-lib.sh` execution
  logic is untouched.
- This is the repo's most load-bearing manifest — schema, generator plus its
  tests, `harness:check`, the doc generator, and drift-ai parity all ripple
  from the loader seam. The early-resolution seam is what holds the blast
  radius to M; regeneration parity is the safety net.
- Same-file neighbors: leaf
  [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md)
  (generated-surface dependency facets) and leaf
  [126-hook-wiring-repeats-adapter-templates-leaves.md](./126-hook-wiring-repeats-adapter-templates-leaves.md)
  (hook adapter bindings) address distinct duplication problems inside
  `harness.controls.json`. No ordering dependency, but do not edit the
  manifest concurrently with either.
- Leaf
  [110-parallel-verify-dependencies-hidden.md](./110-parallel-verify-dependencies-hidden.md)
  concerns dependency semantics of the generated slot graph in the Bash
  runners; a program-level "canonical slot graph" plan could unify it with
  this leaf, but they edit different surfaces — coordinate at planning time
  rather than merging scope.
- No prior-pack overlap: the live 2026-07-25 pack's AUDIT-SUMMARY explicitly
  scoped `harness.controls.json` internals out ("treated as generator
  input"), which is a scope exclusion, not a ruling against this work.
