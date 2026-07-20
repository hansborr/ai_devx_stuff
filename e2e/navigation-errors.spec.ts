import { expect, test } from "./fixtures.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";
import { LoginPO } from "./page-objects/login.po.js";
import { RegisterPO } from "./page-objects/register.po.js";

test.describe("Navigation and error handling", () => {
  // All tests here are read-only and fixture-isolated (fresh context per
  // userPage/page test, no shared mutable state) — safe to fan across
  // workers despite the global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("visiting /characters/nonexistent-id shows error", async ({ userPage: { page } }) => {
    await page.goto("/characters/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/not found|failed to load/i)).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  });

  test("visiting /campaigns/nonexistent-id shows error", async ({ userPage: { page } }) => {
    await page.goto("/campaigns/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/not found|failed to load/i)).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  });

  test("visiting /join/BADCODE shows error", async ({ userPage: { page } }) => {
    await page.goto("/join/BADCODE123");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  });

  test("registration validates required fields", async ({ page }) => {
    const reg = new RegisterPO(page);
    await reg.goto();
    await reg.submitEmpty();
    await expect(page).toHaveURL(/\/register/);
  });

  test("login validates required fields", async ({ page }) => {
    const login = new LoginPO(page);
    await login.goto();
    await login.submitEmpty();
    await expect(page).toHaveURL(/\/login/);
  });

  test("page reload on dashboard maintains auth session", async ({ userPage: { page } }) => {
    const dash = new DashboardPO(page);
    await dash.expectVisible();
    await page.reload();
    await dash.expectVisible();
  });

  test("direct navigation to protected route works when authenticated", async ({
    userPage: { page },
  }) => {
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  });
});
