import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { makeUser, type TestUser } from "./test-data.js";
import { TIMEOUT_MEDIUM } from "./timeouts.js";

/** Log in an existing user via the browser UI. Page ends up on `/dashboard`. */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("auth.login") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Log in" }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
}

/**
 * Register a new user and log them in. The page ends up on `/dashboard`.
 * Returns the created user details.
 */
export async function registerAndLogin(page: Page, prefix: string): Promise<TestUser> {
  const user = makeUser(prefix);

  // Register
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByLabel("Display Name").fill(user.displayName);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("auth.register") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Register" }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });

  // Login
  await loginViaUi(page, user.email, user.password);

  return user;
}

export interface AuthenticatedContext {
  context: BrowserContext;
  page: Page;
  user: TestUser;
}

/**
 * Create an independent browser context with a freshly registered & logged-in user.
 * Used for multi-user tests (e.g. DM + Player).
 * Caller is responsible for calling `context.close()` in afterAll.
 */
export async function createAuthenticatedContext(
  browser: Browser,
  prefix: string,
): Promise<AuthenticatedContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await registerAndLogin(page, prefix);
  return { context, page, user };
}
