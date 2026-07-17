# Harness-Managed Docs

This directory contains reference documents maintained by the harness, but not
every file is machine-generated. Check the ownership contract below before
editing or regenerating a file.

| File | Ownership | Maintenance contract |
|---|---|---|
| `harness-controls.md` | Generated | Do not edit by hand. Refresh with `bun run docs:harness-controls`; check with `bun run docs:harness-controls:check`. |
| `local-lint-rules.md` | Generated | Do not edit by hand. Refresh with `bun run docs:lint-guidance`; check with `bun run docs:lint-guidance:check`. |
| `lint-coverage-map.md` | Hand-maintained | Edit the map directly. `bun run docs:lint-coverage-map:check` blocks unaccounted tracked surfaces in changed/pre-commit verification, and `bun run docs:lint-coverage-map:audit` adds the full ESLint-reach audit. |
| `observed_flaky_tests.md` | Hand-maintained | Edit the incident log directly when failure triage identifies or closes a known flake. Hook guidance points maintainers here; no generator or content-freshness gate owns it. |

The generated files repeat their generator and refresh command in their
headers. The hand-maintained files describe their own update workflow.
