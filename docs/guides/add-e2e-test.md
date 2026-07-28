# Add An E2E Test

Use this path when adding or changing Playwright specs under `e2e/`.

1. Add or extend the page object for the surface in `e2e/page-objects/`.
   Keep route mechanics, setup navigation, and repeated assertions there.
   Name the file `<surface>.po.ts` and export a `<Surface>PO` class.
2. Put the spec beside the rest of the browser suite as
   `e2e/<surface>.spec.ts`. Prefer extending an existing focused spec when the
   behavior belongs to an existing flow.
3. Import `test` and `expect` from `e2e/fixtures.ts`. Use `userPage` for
   authenticated flows; use the base `page` fixture only for unauthenticated
   surfaces or auth setup itself.
4. Prefer selectors in this order: `getByRole` -> `getByLabel` ->
   `getByText` -> `getByTestId` -> `locator(css)`. Use raw CSS locators only
   when there is no accessible surface and leave a short reason.
5. For forms, select controls by label, for example
   `page.getByLabel("Character name")`.
6. For buttons, select by role and accessible name, for example
   `page.getByRole("button", { name: "Create campaign" })`.
7. For links, select by role and accessible name, for example
   `page.getByRole("link", { name: "Characters" })`.
8. For menu items, select by role and accessible name, for example
   `page.getByRole("menuitem", { name: "Duplicate" })`.
9. For tabs, select by role and accessible name, for example
   `page.getByRole("tab", { name: "Spells" })`.
10. For transient feedback, prefer `getByRole("alert")` or a control with an
   accessible label. Avoid timing-only assertions.
11. For canvas and VTT internals, use `getByTestId(...)` or a raw locator only
   when the behavior has no role, label, or text surface. Keep those selectors
   inside the page object.
12. To seed data over the API instead of driving the UI, extend
   `e2e/helpers/api.ts`. A new wrapper is a call to `trpcMutate` /`trpcQuery`
   with the dotted `router.procedure` path; both transports infer the payload
   and the response from `AppRouterInputs` / `AppRouterOutputs`, so type the
   wrapper's parameters and return from those maps too — never restate a
   request or response shape, and never re-spell a shared enum. Keep only the
   e2e-specific *defaults* (fixed ability scores, `hpMethod: "average"`,
   square grids) as literals; those are why the wrappers exist. Infer the
   *types*, not the key set: a wrapper that defaults or overwrites part of the
   input should `Pick` the fields a caller actually controls rather than take
   `Partial<Input>` or `Omit<Input, "…">`, so it cannot accept a value it will
   silently drop. `e2e/helpers/__type-tests__/` pins those surfaces. The maps reach
   `e2e/` through the `@musi/server/router-type` `paths` entry in
   `tsconfig.e2e.json`, which is type-only — do not add a value import from
   `@musi/server`.
13. To explore a route, use the `playwright-cli` skill:
   [`.claude/skills/playwright-cli/SKILL.md`](../../.claude/skills/playwright-cli/SKILL.md)
   or
   [`.codex/skills/playwright-cli/SKILL.md`](../../.codex/skills/playwright-cli/SKILL.md).
   Use the skill quickstart instead of duplicating browser-inspection steps
   here.
14. Verify the new user flow with the narrow Playwright command while
    iterating, then run `bun run verify:changed` before calling the change
    done.

Useful checks:

- `local/e2e-prefer-role-selectors` blocks new raw `.locator(...)` selectors
  under `e2e/` and points back to this guide.
- `eslint-plugin-playwright` rules catch missing awaits, focused or skipped
  tests, discouraged waits, and other Playwright hygiene issues.
- `bun run lint:changed` runs the selector and Playwright lint rules for
  changed e2e files.
- `bun run typecheck` runs `tsc -p tsconfig.e2e.json`, which is what catches a
  seeding helper that has drifted from the router contract.
- `bun run e2e` runs the browser suite when the change needs full workflow
  coverage.
