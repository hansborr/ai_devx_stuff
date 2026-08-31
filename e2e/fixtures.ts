import { expect, type Page, test as base } from "@playwright/test";

import { openApiAuthedContext } from "./helpers/auth.setup.js";
import { readSharedUser, type TestUser } from "./helpers/test-data.js";

type MusiFixtures = {
  /** A fresh browser context with a pre-authenticated user on /dashboard. */
  userPage: { page: Page; user: TestUser };
};

export const test = base.extend<MusiFixtures>({
  userPage: async ({ browser }, use) => {
    const user = readSharedUser();
    // Headless API login: the context's cookie jar receives its own
    // `musi_refresh` cookie (own session row), so refresh-token rotation
    // stays private to this context. Registration is handled once by the
    // setup project; auth-subject tests drive `loginViaUi` explicitly.
    const { context, page } = await openApiAuthedContext(browser, user);
    await use({ page, user });
    await context.close();
  },
});

export { expect, type Page };
