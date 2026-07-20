import { expect, test } from "./fixtures.js";
import { loginViaUi } from "./helpers/auth.setup.js";
import { readSharedUser } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Authentication token refresh flow", () => {
  // Context-isolated tests: each gets its own browser context and session
  // (API login via userPage, or an explicit UI login for login-subject
  // tests), and the per-token session model (login creates a fresh session
  // row; logout/refresh touch only their own tokenHash/session id) means no
  // test can disturb a sibling's session — safe to fan across workers despite
  // the global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("session persists after page reload", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    await page.reload();
    await dashboard.expectVisible();
  });

  // Login-subject test: asserts post-login request state, so it must drive a
  // real UI login rather than the fixture's pre-seeded API session.
  test("tRPC requests include Authorization header", async ({ page }) => {
    const user = readSharedUser();
    await loginViaUi(page, user.email, user.password);
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    const trpcRequestPromise = page.waitForRequest(
      (req) => req.url().includes("/trpc/") && req.method() === "GET",
    );

    await page.reload();

    const trpcRequest = await trpcRequestPromise;
    const authHeader = trpcRequest.headers()["authorization"];
    expect(authHeader).toBeTruthy();
    expect(authHeader).toMatch(/^Bearer .+/);
  });

  // Login-subject test: its subject is that login *produces* the cookie, so a
  // pre-seeded session would test nothing — keep the real UI login.
  test("refresh token cookie is present after login", async ({ page }) => {
    const user = readSharedUser();
    await loginViaUi(page, user.email, user.password);
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    const cookies = await page.context().cookies();
    const refreshCookie = cookies.find((c) => c.name === "musi_refresh");
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie!.httpOnly).toBe(true);
  });

  test("multiple page reloads maintain session", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    for (let i = 0; i < 3; i++) {
      await page.reload();
      await dashboard.expectVisible();
    }
  });

  // Login-subject test: asserts the login → logout lifecycle end to end, so it
  // keeps the real UI login instead of the fixture's API session.
  test("logout clears session and reload does not restore it", async ({ page }) => {
    const user = readSharedUser();
    await loginViaUi(page, user.email, user.password);
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    await dashboard.clickLogout();
    await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });
  });
});
