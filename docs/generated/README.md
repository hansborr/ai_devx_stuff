# Harness-Managed Docs

This directory contains reference documents maintained by the harness, but not
every file is machine-generated. Check the ownership contract below before
editing or regenerating a file.

| File | Ownership | Maintenance contract |
|---|---|---|
| `command-catalog.md` | Generated | Do not edit by hand. Per-command purposes come from the registering harness control, or from the `commandCatalog` section of `harness.controls.json` for scripts no single control speaks for (those no control declares, plus the aggregating commands several controls declare); the per-family section blurbs live in `scripts/harness/command-catalog-sections.ts` and the effect legend in `scripts/harness/command-catalog-schema.ts`. Refresh with `bun run docs:command-catalog`; check with `bun run docs:command-catalog:check`. `bun run harness:check` fails when a tracked package.json script has no metadata source, or two. |
| `harness-controls.md` | Generated | Do not edit by hand. Refresh with `bun run docs:harness-controls`; check with `bun run docs:harness-controls:check`. |
| `harness-porting-manifest.md` | Generated | Do not edit by hand. Recipe entrypoints and the portable/adapter classification live in `scripts/harness/porting-recipes.ts`; the copy sets are walked from the import graph. Refresh with `bun run docs:harness-porting`; check with `bun run docs:harness-porting:check`. |
| `local-lint-rules.md` | Generated | Do not edit by hand. Refresh with `bun run docs:lint-guidance`; check with `bun run docs:lint-guidance:check`. |
| `lint-coverage-map.md` | Generated | Do not edit by hand. Coverage policy lives in the typed manifest (`scripts/lint-coverage-map-manifest.ts` and its `-manifest-<area>.ts` entry modules); refresh the document with `bun run docs:lint-coverage-map:generate` and check freshness with `bun run docs:lint-coverage-map:generate:check`. `bun run docs:lint-coverage-map:check` blocks unaccounted tracked surfaces in changed/pre-commit verification, and `bun run docs:lint-coverage-map:audit` adds the full ESLint-reach audit. |
| `observed_flaky_tests.md` | Hand-maintained | Edit the incident log directly when failure triage identifies or closes a known flake. Hook guidance points maintainers here; no generator or content-freshness gate owns it. |

The generated files repeat their generator and refresh command in their
headers, and name the source their content is generated from;
hand-maintained files describe their own update workflow.
