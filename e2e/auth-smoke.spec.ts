import { expect, test } from "./fixtures.js";
import { makeUser } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";
import { LoginPO } from "./page-objects/login.po.js";
import { RegisterPO } from "./page-objects/register.po.js";

test.describe("Authentication", () => {
  test("register → login → dashboard → logout", async ({ page }) => {
    const user = makeUser("auth-smoke");
    const register = new RegisterPO(page);
    const login = new LoginPO(page);
    const dashboard = new DashboardPO(page);

    await register.goto();
    await register.fillForm(user.email, user.password, user.displayName);
    await register.submit();
    await register.expectRedirectToLogin();

    await login.login(user.email, user.password);
    await login.expectRedirectToDashboard();

    await dashboard.expectVisible();
    await dashboard.clickLogout();
  });

  test("visiting /dashboard without auth redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });
  });

  test("visiting /login while authenticated redirects to /dashboard", async ({
    userPage: { page },
  }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
  });

  // Register is timing-equalized and returns the same opaque response whether
  // the email is available or already registered (account enumeration
  // defense). Verify: (a) the duplicate-register attempt still redirects to
  // login without an error banner, and (b) the existing account is not
  // overwritten — the attacker-chosen password does not log in, the original
  // password does.
  test("register with duplicate email redirects opaquely and does not overwrite the account", async ({
    page,
  }) => {
    const user = makeUser("auth-dup");
    const register = new RegisterPO(page);
    const login = new LoginPO(page);

    await register.goto();
    await register.fillForm(user.email, user.password, user.displayName);
    await register.submit();
    await register.expectRedirectToLogin();

    await register.goto();
    await register.fillForm(user.email, "DifferentAttackerPw999!", "Attacker");
    await register.submit();
    await register.expectRedirectToLogin();

    await login.login(user.email, "DifferentAttackerPw999!");
    await login.expectError(/invalid|incorrect|wrong/i);

    await login.login(user.email, user.password);
    await login.expectRedirectToDashboard();
  });

  test("login with wrong password shows error", async ({ page }) => {
    const user = makeUser("auth-badpw");
    const register = new RegisterPO(page);
    const login = new LoginPO(page);

    await register.goto();
    await register.fillForm(user.email, user.password, user.displayName);
    await register.submit();
    await register.expectRedirectToLogin();

    await login.login(user.email, "WrongPassword999!");
    await login.expectError(/invalid|incorrect|wrong/i);
  });
});
