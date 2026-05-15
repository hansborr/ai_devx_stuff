import { expect, test } from "./fixtures.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe.serial("Authentication token refresh flow", () => {
  test("session persists after page reload", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    await page.reload();
    await dashboard.expectVisible();
  });

  test("tRPC requests include Authorization header", async ({ userPage: { page } }) => {
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

  test("refresh token cookie is present after login", async ({ userPage: { page } }) => {
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

  test("logout clears session and reload does not restore it", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    await dashboard.expectVisible();

    await dashboard.clickLogout();
    await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });
  });
});
