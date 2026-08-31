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
   `getByText` -> `getByTestId` -> `locator(css)`. A raw CSS locator is not a
   free fallback: `local/e2e-prefer-role-selectors` is an error on every
   `.locator(...)` call under `e2e/` and never inspects comments, so a prose
   reason beside the call changes nothing. The one sanctioned escape is a
   reasoned suppression:
   `// eslint-disable-next-line local/e2e-prefer-role-selectors -- <reason>`.
   The rule reports on the member expression, not on `.locator`, so the
   directive goes on the line immediately above the line where the locator
   chain's receiver (`page` / `this.page`) starts, wherever that line sits.
   Any other line silences nothing and trips
   `eslint-comments/no-unused-disable` as well.
   The `-- <reason>` suffix is itself enforced by
   `eslint-comments/require-description`, and a new inline suppression cannot
   land without its `suppression-ledger.json` entry in the same diff — run
   `bun scripts/suppression-ledger.ts --update` and commit the result.
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
11. For canvas and VTT internals, reach for `getByTestId(...)` first. A raw
   locator is allowed only when the behavior has no role, label, or text
   surface, and only through step 4's reasoned suppression plus its ledger
   entry — having no accessible surface does not exempt the call from the rule.
   Keep those selectors, and the suppression comment, inside the page object.
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
13. Give each contract its own state. A multi-step workflow is ONE `test()`
   whose stages are `test.step()` calls — not N tests sharing a `beforeAll`,
   which is what `test.describe.configure({ mode: "serial" })` exists to prop
   up and which cascade-skips every later test after one failure. A check that
   merely needs state to exist seeds it with `e2e/helpers/campaign-setup.ts`
   (`registerApiUser`, `setupApiUser`, `setupCampaignOwner`,
   `setupUserWithCharacter`, `setupDmAndPlayer`) and stands alone; close what
   it seeds in a `finally`. When a describe holds no cross-test mutable state,
   give it `test.describe.configure({ mode: "parallel" })` with a comment
   saying why — `fullyParallel` is `false`, so removing `serial` alone buys
   nothing.
14. To explore a route, use the `playwright-cli` skill:
   [`.claude/skills/playwright-cli/SKILL.md`](../../.claude/skills/playwright-cli/SKILL.md)
   or
   [`.codex/skills/playwright-cli/SKILL.md`](../../.codex/skills/playwright-cli/SKILL.md).
   Use the skill quickstart instead of duplicating browser-inspection steps
   here.
15. Verify the new user flow with the narrow Playwright command while
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
