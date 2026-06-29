# e2e module

Concepts: Playwright e2e, page objects, browser contexts, auth setup, campaign setup

See: docs/guides/add-e2e-test.md before adding or changing e2e coverage.

## Purpose

Playwright end-to-end tests live here. Specs exercise real browser flows against
the app, while helpers and page objects keep setup, selectors, and repeated UI
actions out of individual specs.

## Data Flow

Specs compose API setup helpers from `helpers/`, page objects from
`page-objects/`, and shared fixtures from `fixtures.ts`. Prefer navigating
through page-object methods when a stable flow already exists.

## External Entry Points

`*.spec.ts` files are the executable tests. `global-setup.ts`, `storage.setup.ts`,
and `helpers/auth.setup.ts` own browser/auth bootstrap behavior; page objects own
screen-specific selectors and actions.

## State Ownership

E2e tests may create users, campaigns, characters, maps, and browser contexts.
Keep setup isolated per spec and close created browser contexts/pages in the
existing fixture lifecycle.

## Test Seams

Run focused specs with `bun run e2e -- <spec>` or the task-specific command
named by the leaf you are working from. Update or add page-object methods before
copying selectors across specs.

## Gotchas

- Use role/text/test-id locators over styling selectors.
- Keep e2e off the per-commit path unless the harness task explicitly says
  otherwise.
