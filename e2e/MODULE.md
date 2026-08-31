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

Every test owns the state it asserts on. Two things are seeded once for the
whole run and nothing else is: `global-setup.ts` prepares the test database
(migrations, SRD, seeded users) and the `setup` project's `storage.setup.ts`
registers one shared user into `.auth/user-info.json`. Users, campaigns,
characters, invites, items, and browser contexts are otherwise created by the
test that needs them, through `helpers/campaign-setup.ts`. No spec builds state
in a `beforeAll` for the tests below it to consume in source order;
`encounter-combat.spec.ts` is the one exception and keeps that shape by
decision (CQ25-162).

The seeding helpers that open a browser (`setupApiUser`,
`setupUserWithCharacter`, `setupCampaignOwner`, `setupDmAndPlayer`) each return
a `teardown()` that closes the contexts they opened. Call it from a `finally`
so a failing assertion still releases them. `registerApiUser` opens no browser
and hands back nothing to close. The `userPage` fixture is the exception to the
`finally` rule: it owns its context and closes it after the test.

`userPage` hands out that one run-wide shared user, so treat the account as
read-only. A test that mutates its campaigns, characters, spell slots, or
notifications leaks into every other spec that reads it — anything a test
mutates has to come from a seed of its own.

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
  `helpers/auth.setup.ts` `openApiAuthedContext` is the one path that does this
  and waits out the mount-time `auth.refresh`; the `userPage` fixture and every
  browser-opening seeding helper in `helpers/campaign-setup.ts` go through it
  (`registerApiUser` opens no browser at all), so seeding a second user never
  costs a login form.
- Isolation: prefer a seeded test per contract over a whole-file
  `test.describe.configure({ mode: "serial" })` group, which cascade-skips
  every remaining test after one failure. A genuine multi-step workflow becomes
  ONE test whose former titles are `test.step()` names; anything that merely
  needs state to exist seeds its own through `helpers/campaign-setup.ts`
  (`registerApiUser`, `setupApiUser`, `setupCampaignOwner`,
  `setupUserWithCharacter`, `setupDmAndPlayer`) and stands alone. Close what a
  test seeds in a `finally`. Once a describe holds no cross-test mutable state,
  opt it into `mode: "parallel"`: `fullyParallel` is `false`, so dropping
  `serial` on its own changes nothing. `encounter-combat.spec.ts` stays serial
  by decision (CQ25-162). See
  docs/agent_notes/backlog/code-quality-2026-08-01/077-*.md.
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
