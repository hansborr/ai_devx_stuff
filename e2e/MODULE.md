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

`helpers/api.ts` seeds data by calling tRPC procedures over HTTP with a bearer
token, deliberately bypassing the browser. Its transports are keyed on a dotted
`router.procedure` path and infer both the payload and the response from the
server's `AppRouter`, reached through the type-only `@musi/server/router-type`
`paths` entry in `tsconfig.e2e.json`.

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
- Auth: `userPage` authenticates each context with a headless API login
  (`loginViaApi`), never a shared Playwright `storageState` file — the server
  rotates `musi_refresh` on every refresh, so a shared cookie goes stale after
  the first context boots. Login-subject specs keep an explicit `loginViaUi`.
  See docs/agent_notes/backlog/testsuite-audit/03-*.md for the design decision.
- Keep e2e off the per-commit path unless the harness task explicitly says
  otherwise. `tsconfig.e2e.json` *is* on it — `scripts/typecheck.sh` compiles
  the project, so a seeding helper that has drifted from the router contract
  fails the commit gate rather than a browser test. That lane runs *concurrently*
  with `tsc -b`, so every workspace specifier it can reach must be mapped to
  source in `paths` — resolving to a gitignored `dist/` would make the result
  depend on the build race. `scripts/e2e-tsconfig-resolution.test.ts` guards it.
- Never restate a procedure's request or response shape in `helpers/api.ts`;
  infer it — but infer the field *types*, not the key set. A wrapper that
  defaults or overwrites part of the input `Pick`s the fields a caller controls
  (`ApiCreateCharacterOptions`, `ApiLevelUpCharacterInput`) so it cannot accept
  a value it will drop. `helpers/__type-tests__/` fails the typecheck lane if
  one of those surfaces widens back to the whole procedure input. `page-objects/vtt-drawer-response.ts` is the deliberate exception
  and is not part of that inference surface: it Zod-parses a response
  intercepted from the browser, tolerating both the bare envelope and a batched
  single-element tuple. That runtime validation stays.
