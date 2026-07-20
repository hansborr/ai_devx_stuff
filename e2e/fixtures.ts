import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";

import { loginViaApi } from "./helpers/auth.setup.js";
import { readSharedUser, type TestUser } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";

type MusiFixtures = {
  /** A fresh browser context with a pre-authenticated user on /dashboard. */
  userPage: { page: Page; user: TestUser };
};

export const test = base.extend<MusiFixtures>({
  userPage: async ({ browser }, use) => {
    const user = readSharedUser();
    const context = await browser.newContext();
    // Headless API login: the context's cookie jar receives its own
    // `musi_refresh` cookie (own session row), so refresh-token rotation
    // stays private to this context. Registration is handled once by the
    // setup project; auth-subject tests drive `loginViaUi` explicitly.
    await loginViaApi(context, user.email, user.password);
    const page = await context.newPage();
    // The client boots without an in-memory access token and re-hydrates it
    // from the cookie via the mount-time auth.refresh; wait for that refresh
    // so tests start from a settled authenticated state on /dashboard.
    const [refreshResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("auth.refresh")),
      page.goto("/dashboard"),
    ]);
    expect(
      refreshResp.ok(),
      `auth.refresh failed (${String(refreshResp.status())}) at ${refreshResp.url()}`,
    ).toBe(true);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
    await use({ page, user });
    await context.close();
  },
});

export { type BrowserContext, expect, type Page };
