import { expect, test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";

import { makeUser } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";

/**
 * Playwright auth setup — runs once before all E2E tests.
 * Registers a shared user and saves credentials so that the `userPage`
 * fixture can log in without re-registering each time.
 */
setup("register shared test user", async ({ page }) => {
  mkdirSync(".auth", { recursive: true });
  const user = makeUser("shared");

  await page.goto("/register");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator("#displayName").fill(user.displayName);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("auth.register") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Register" }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });

  writeFileSync(".auth/user-info.json", JSON.stringify(user));
});
