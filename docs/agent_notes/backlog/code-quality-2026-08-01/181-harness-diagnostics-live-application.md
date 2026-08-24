# 181. Move the harness diagnostics contract out of the application shared package

Status: Landed on fix/cq-181
Theme: portable harness contract · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The structured diagnostics envelope is a harness protocol, but its schema and
tests live in the application-facing `@musi/shared` package. Every production
consumer is repository tooling, and every one bypasses the package boundary
with a relative import into `packages/shared/src`.

This makes the public harness’s copy boundary misleading. Extracting or adopting
the harness requires taking a source file from an application package, while
moving that file requires application-package edits despite having no
client/server runtime consumers. The shared package’s wildcard export does
nominally include built schemas; the problem is ownership and the surviving
source-relative coupling, not a missing export-map entry.

## Evidence

- `packages/shared/src/schemas/harness-diagnostics.ts:1-10` defines the schema
  version and its permissive tool-id transport contract. Its comment explicitly
  says adopters are told to copy the file verbatim.
- The schema is 215 measured lines and its co-located test is 341 measured lines
  at the pin:
  `packages/shared/src/schemas/harness-diagnostics.ts:1-215` and
  `packages/shared/src/schemas/harness-diagnostics.test.ts:1-341`.
- A tree-wide exact-import scan found exactly 11 non-test TypeScript consumers,
  all in tooling:
  `scripts/lint-agent-envelope.ts:11`,
  `scripts/harness-emit-envelope.ts:7`,
  `scripts/harness-audit.ts:25`,
  `scripts/logs-audit/logs-audit-diagnostics.ts:14`,
  `scripts/lint-ratchet/report.ts:26`,
  `scripts/lint-ratchet/output.ts:3`,
  `scripts/lint-ratchet/info-diagnostics.ts:3`,
  `scripts/lint-ratchet/diagnostics.ts:22`,
  `scripts/harness/harness-diagnostics-output.ts:15`,
  `scripts/drift-ai/diagnostics-projection.ts:13`, and
  `scripts/harness/harness-audit-report.ts:10`.
  The same scan found zero non-test consumers under `packages/client` or
  `packages/server`.
- Representative consumers describe the coupling directly:
  `scripts/drift-ai/diagnostics-projection.ts:1-13` calls this the seam where
  drift analysis couples to `packages/shared`, and
  `scripts/lint-ratchet/diagnostics.ts:13-22` reaches two directories upward
  into the shared source tree.
- `packages/shared/package.json:8-12` exposes schemas through a wildcard
  **dist** export. The 11 consumers do not use that export; they import the
  source file directly.
- The root already admits private tooling packages through `tools/*`
  (`package.json:6-10`). `@musi/lint-ratchet` demonstrates source-mapped
  workspace exports and copy-directory framing
  (`tools/lint-ratchet/package.json:1-8`), and the root consumes it through an
  explicit workspace dev dependency (`package.json:171-180`).
- The generated path-policy subject data records the old schema path, for
  example at
  `scripts/path-policy/path-policy-smoke-subjects-data.ts:60-67`; this file is
  generated and must not be updated by hand.
- Current public documentation names the application-package path at
  `docs/ai-harness.md:183-203`,
  `docs/guides/lint-ratchet-adoption.md:231-238,340-344`, and
  `docs/guides/biome-lint-adoption.md:108-116,196-201`.

## Proposed direction

1. Create a private `tools/harness-diagnostics` workspace package named
   `@musi/harness-diagnostics`; it does not exist today. Model it on the
   portable-tooling seam used by `tools/lint-ratchet`, with:

   - a source-mapped `"./schema.js": "./src/schema.ts"` export and no build
     prerequisite;
   - `zod` as its only runtime dependency;
   - a package description that preserves the “copy this directory” adoption
     framing;
   - a package-local TypeScript and Vitest configuration.

2. Move the 215-line schema and its 341-line test into the package. Preserve the
   tool-id/adoption comment at current lines 5-9 verbatim because it documents
   why the transport schema is intentionally open. Delete the old shared source
   and test; the shared wildcard export requires no separate export-map edit.

   Add `"@musi/harness-diagnostics": "workspace:*"` to the root development
   dependencies. Migrate all 11 production importers and every test importer to
   `@musi/harness-diagnostics/schema.js`. Do not add a `tsconfig` paths alias;
   use normal workspace resolution, matching the established scripts-to-tool
   package seam.

3. Register the relocated tests and package surfaces in the same change:

   - add the package project and its coverage path to `vitest.config.ts`,
     following the existing `tools/lint-ratchet` project at
     `vitest.config.ts:29-38,78-83`;
   - declare each new configuration file once in
     `eslint-config/config-surface-manifest.json` and regenerate the owned
     surface;
   - regenerate path-policy smoke subjects with the existing
     `bun run test:scripts:subjects` command (`package.json:60`), rather than
     hand-editing the generated data;
   - run the existing `bun run harness:check` registration/freshness gate
     (`package.json:136`).

   Confirm that the moved 341-line test is selected by the new Vitest project;
   relocating the file without project registration would silently remove it
   from the ordinary test lane. If mutation coverage is retained through a new
   config, register that config through the same config-surface manifest rather
   than creating an untracked lane.

4. Update every adoption reference to the workspace package and its copy
   boundary. In particular, replace the lint-ratchet guide’s instruction to
   repair imports after moving `harness-diagnostics.ts` with package-oriented
   copy/install guidance, and update the copy-set table and Biome guide.

## Scope / caveats

- Do not change the envelope schema, schema version, tool-id openness, summary
  validation, or serialized behavior. This is an ownership and import-boundary
  move.
- Do not relocate
  `scripts/harness/harness-diagnostics-output.ts`; it is the repository-specific
  writer for `HARNESS_DIAGNOSTICS_OUTPUT`, not the schema package.
  `eslint-config/restricted-syntax-policy.js:215-217` names that writer and
  therefore remains correct.
- Do not fold the schema into `@musi/lint-ratchet`. Lint ratcheting is only one
  of five consumer areas, and its portable engine intentionally avoids Musi
  package dependencies.
- The landed 2026-07-25 harness work, CQ25-119
  ([HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)),
  unified and extended diagnostics behavior but did not schedule package
  ownership. Treat this as its residual package-boundary gap, not a reopening
  of the landed protocol decisions.
- **Prerequisite sequencing:** This leaf must land before
  [080-public-harness-copy-recipes-not-closed-over.md](./080-public-harness-copy-recipes-not-closed-over.md)
  and
  [119-migration-safety-validation-embeds-multiple.md](./119-migration-safety-validation-embeds-multiple.md).
  Both depend on the relocated `@musi/harness-diagnostics` package boundary;
  leaf 080 defines its public recipe closure against that package, and leaf 119
  imports `harnessFindingSchema` from its `./schema.js` export. There are also
  mechanical conflicts with
  [067-lint-ratchet-acceptance-fixtures-emit-321.md](./067-lint-ratchet-acceptance-fixtures-emit-321.md)
  and
  [068-one-lint-ratchet-acceptance-suite-serializes.md](./068-one-lint-ratchet-acceptance-suite-serializes.md)
  around the lint-ratchet acceptance suite, and with
  [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md)
  around the generated path-policy surface. Either order is valid; the second
  change must rebase and regenerate rather than preserve stale paths. Unit 068
  landed first and split `scripts/lint-ratchet/output.test.ts` — the file this
  note originally named — into six `scripts/lint-ratchet/output-*.test.ts`
  suites over `scripts/lint-ratchet/output-fixture.test-helper.ts`, so resolve
  the conflict surface against those files rather than the deleted one.
- Stale adoption prose would defeat the copyability objective even if all code
  imports compile, so documentation updates are part of the completion
  boundary.
