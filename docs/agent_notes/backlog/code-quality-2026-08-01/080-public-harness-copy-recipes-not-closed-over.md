# 80. The public harness adoption recipes hand-list copy sets that are not closed over their imports, and the "portable" controls generator imports a file the same document calls a Musi adapter

Status: Landed on fix/cq-080
Theme: portable-harness copy boundary · Area: docs · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

This repo's stated purpose includes being a copyable public harness reference,
and `docs/ai-harness.md` is the outsider-facing front door: a "Portable Core And
Adapters" map plus two step-by-step starters ("Minimal starter", "Advanced
controls starter") that tell an adopter exactly which files to copy. Every one
of those lists is maintained by hand, and none of them is closed over the
implementation's import graph. The six advertised hook/control generator files
alone reach 17 distinct sibling modules that appear in no copy list — manifest
schema and loaders, path constants, hook-shim renderers, atomic-write and
doc-generator helpers. The minimal diagnostics starter has the same defect in
miniature: its four-file copy step omits three `scripts/lib/` helpers its own
entrypoints import on line one of their import blocks.

Worse than the incompleteness, the portable/adapter boundary the document
draws is false at the import-graph level: `generate-harness-controls.ts`,
listed as portable core, statically imports the concrete lint-ratchet registry
that the same document — forty lines later — classifies as a Musi adapter to
replace, not copy.

The cost is concentrated on exactly the audience the document exists for. An
adopter who follows the recipe gets a checkout that cannot compile, with no
mechanical way to discover the rest of the closure except chasing module-not-
found errors one at a time, and no trustworthy line between "machinery I keep"
and "policy I replace". Every refactor of `scripts/harness/` silently widens
the gap, because nothing checks the prose lists against the code.

## Evidence

- `docs/ai-harness.md:189-220` — "Portable core" defined as explicit hand-typed
  file lists; `docs/ai-harness.md:245-264` (minimal starter) and
  `docs/ai-harness.md:266-273` (advanced starter, whose step 2 is "Copy the
  hook wiring and generated-doc scripts listed in portable core") tell adopters
  to copy exactly those lists.
- `docs/ai-harness.md:208-214` — the hook/control bullet names six files:
  `generate-hook-wiring.ts`, `hook-wiring-schema.ts`, `hook-wiring-doc.ts`,
  `generate-harness-controls.ts`, `generate-verify-steps.ts`,
  `verify-step-schema.ts`.
- Measured at the pin by extracting and deduplicating the `from "./…"` /
  `from "../…"` specifiers across those six files: 20 unique relative import
  specifiers, of which only 3 point back inside the list
  (`hook-wiring-schema.js`, `hook-wiring-doc.js`, `verify-step-schema.js`) —
  leaving **17 unique imported modules outside the copy set**, including
  `harness-manifest-loader`, `harness-manifest-schema`, `harness-paths`,
  `hook-shims`, `hook-shim-files`, `generated-surfaces`,
  `generated-surfaces-loader`, `control-field-validation`,
  `verify-step-bridge-divergences`, and five `scripts/lib/` helpers
  (`atomic-write`, `codepoint-compare`, `doc-generator`, `lint-rule-docs`,
  `records`).
- `scripts/harness/generate-hook-wiring.ts:5-11` — the first advertised
  entrypoint alone imports seven of those out-of-list modules before its first
  declaration.
- `scripts/harness/generate-harness-controls.ts:14` —
  `import { lintRatchets } from "../lint-ratchet/lint-ratchet-config.js";` —
  while `docs/ai-harness.md:225-228` classifies
  `scripts/lint-ratchet/lint-ratchet-config.ts` as a Musi adapter ("examples to
  replace, not portable policy"). The only portable→adapter static import edge
  in the recipes.
- Minimal starter omissions: `scripts/harness-audit.ts:44-45` imports
  `scripts/lib/error-message.ts` and `scripts/lib/process-argv.ts`, and
  `scripts/harness/harness-diagnostics-output.ts:16` imports
  `scripts/lib/atomic-write.ts` — none of the three appears anywhere in the
  portable-core section or the starter steps.
- The machinery to make the lists mechanical already exists and is already
  gate-wired: `scripts/harness/generated-surfaces.ts:329,358`
  (`WALKABLE_SOURCE_PATTERN`, `diffFixtureClosure`),
  `scripts/harness/fixture-closure-check.ts:121` (dynamic import of the
  TypeScript-AST closure walker `validateSeedImportClosure` from
  `scripts/worktree-seed-import-closure.ts`, which imports `typescript` at
  `:4`), consumed by `scripts/harness-check.ts:27` — today validating the
  harness-check test-sandbox copy manifest, not these public recipes.
  `harness.controls.json` carries 12 `generatedSurface` facets as the
  registration idiom (first at `:68`).

## Proposed direction

Treat the import graph as authoritative: each public copy recipe becomes a
declared set of entrypoints, and the full file list is derived mechanically —
never hand-copied into prose again (the 17-vs-18 count ambiguity in this very
audit is the argument: counts must come from the walker, not a human).
Three-slice plan, in order:

1. **S1 — closure computation, generated manifest, boundary validator.**
   Declare the two `docs/ai-harness.md` recipes — the minimal diagnostics
   starter and the hook/control core — as entrypoint sets in a
   porting-manifest surface following the existing `harness.controls.json` +
   `generatedSurface` idiom. (The lint-ratchet engine recipe stays where it is:
   `docs/ai-harness.md:204-207` already delegates it to
   `docs/guides/lint-ratchet-adoption.md`.) Reuse the static-import closure
   machinery in `scripts/harness/generated-surfaces.ts` — the same
   `diffFixtureClosure`/`WALKABLE_SOURCE_PATTERN` path
   `fixture-closure-check.ts` uses for the test-sandbox copy manifest — to
   compute each recipe's closure, and emit a generated complete copy manifest
   under `docs/generated/`. Register the new generated doc through the
   single-sourced path: one `generatedSurface` facet in `harness.controls.json`
   plus `bun run verify:steps` regeneration, then `bun run harness:check` to
   prove the wiring. In the same validator, enforce the portable/adapter
   boundary: every closure member must be classified portable or appear in an
   explicit per-recipe adapter-edits allowlist carrying a documented
   replacement note. Today that allowlist surfaces exactly one entry:
   `scripts/harness/generate-harness-controls.ts` →
   `../lint-ratchet/lint-ratchet-config.js`.
2. **S2 — restructure the prose onto the generated surface.** Rewrite the
   "Portable Core And Adapters" starters in `docs/ai-harness.md` to name
   entrypoints and point at the generated closure doc instead of hand-listing
   files. The hand lists at `:192-220` and the starter copy steps become
   pointers; the adapter section keeps its role as the classification
   narrative.
3. **S3 — resolve the adapter edge.** Either keep the S1 allowlist entry with
   its documented "replace this import with your registry" edit, or invert the
   dependency by injecting the ratchet registry into the generator so the
   portable file no longer imports Musi policy. Injection is the only runtime
   behavior change this leaf sanctions, and it is optional.

## Scope / caveats

- **Out of scope** (explicitly deferred by `docs/ai-harness.md:185-187`, which
  defers behavior-preserving splits "until an external adopter needs them"):
  extracting an actual package, any file moves or splits, rewriting
  `docs/guides/lint-ratchet-adoption.md` beyond a closure spot-check of its own
  copy recipe, and runtime behavior changes to the generators other than the
  optional S3 injection.
- **Boundary handling is the hard part of S1, not the walk.** A raw closure
  dump drags in heavy transitive/dev-only edges — e.g.
  `generate-verify-steps.ts:12-13` imports `generated-surfaces.js`, whose
  consumers reach the `typescript`-based walker — and would inflate the
  "portable core" into something unconvincing to adopters. The manifest needs
  external-package and boundary handling in the style of
  `FIXTURE_CLOSURE_EXTERNAL_PACKAGES`
  (`scripts/harness/fixture-closure-check.ts:32`), not a raw dump.
- **Freshness-gate tax.** A generated doc keyed to the import graph churns on
  every `scripts/harness/` refactor; calibrate the staleness check so it warns
  where the existing generated surfaces warn rather than inventing a stricter
  gate.
- **Misclassification risk.** Marking a Musi-policy file portable, or letting
  the adapter allowlist grow without replacement notes, re-falsifies the exact
  boundary this change exists to make true. The allowlist must fail closed on
  unclassified closure members.
- **Do not disturb the prior-pack validator's scope.** The 2026-07-25 pack's
  leaf 68 (`code-quality-2026-07-25/68-lint-ratchet-fixture-copy-closure.md`,
  landed 2026-07-31) already gave the two lint-ratchet *test-sandbox* copy
  lists focused closure assertions, and `fixture-closure-check.ts` already
  validates the harness-check smoke-fixture manifest. Those cover internal
  sandboxes, not these public adoption recipes — extend the idiom alongside
  them; do not fold the new recipes into either existing check.
- **Other sequencing.** Soft file adjacency:
  [168-harness-generator-scenarios-repeat-53-inline.md](./168-harness-generator-scenarios-repeat-53-inline.md)
  edits the same generators' test files, and
  [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md)
  touches the generated-surfaces/smoke-subject seam from the path-policy side —
  both merge-trivial with this doc/validator work. If S3 chooses registry
  injection into `generate-harness-controls.ts`, land it after or coordinated
  with leaf 168's test edits to avoid conflicting test rewrites.
- **Sequencing:** Requires
  [181-harness-diagnostics-live-application.md](./181-harness-diagnostics-live-application.md)
  to land first. Define the public recipe entrypoints and generated closure
  against `@musi/harness-diagnostics`, let leaf 181 own the schema move and
  package-oriented adoption guidance, and then replace the resulting
  hand-maintained copy lists with generated-manifest pointers.
