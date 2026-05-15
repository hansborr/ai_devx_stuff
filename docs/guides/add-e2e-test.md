# Add An E2E Test

Use this path when adding or changing Playwright specs under `e2e/`.

1. Add or extend the page object for the surface in `e2e/page-objects/`.
   Keep route mechanics, setup navigation, and repeated assertions there.
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
12. To explore a route, use the `playwright-cli` skill:
   [`.claude/skills/playwright-cli/SKILL.md`](../../.claude/skills/playwright-cli/SKILL.md)
   or
   [`.codex/skills/playwright-cli/SKILL.md`](../../.codex/skills/playwright-cli/SKILL.md).
   Use the skill quickstart instead of duplicating browser-inspection steps
   here.
13. Verify the new user flow with the narrow Playwright command while
    iterating, then run `bun run verify:changed` before calling the change
    done.

Useful checks:

- `local/e2e-prefer-role-selectors` blocks new raw `.locator(...)` selectors
  under `e2e/` and points back to this guide.
- `eslint-plugin-playwright` rules catch missing awaits, focused or skipped
  tests, discouraged waits, and other Playwright hygiene issues.
- `bun run lint:changed` runs the selector and Playwright lint rules for
  changed e2e files.
- `bun run e2e` runs the browser suite when the change needs full workflow
  coverage.
