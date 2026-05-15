import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";
import { readFileSync } from "fs";

import { loginViaUi } from "./helpers/auth.setup.js";
import type { TestUser } from "./helpers/test-data.js";

type MusiFixtures = {
  /** A fresh browser context with a pre-authenticated user on /dashboard. */
  userPage: { page: Page; user: TestUser };
};

function parseTestUser(raw: string): TestUser {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    "password" in value &&
    "displayName" in value &&
    typeof value.email === "string" &&
    typeof value.password === "string" &&
    typeof value.displayName === "string"
  ) {
    return {
      email: value.email,
      password: value.password,
      displayName: value.displayName,
    };
  }
  throw new Error(".auth/user-info.json must contain email, password, and displayName strings.");
}

export const test = base.extend<MusiFixtures>({
  userPage: async ({ browser }, use) => {
    const user = parseTestUser(readFileSync(".auth/user-info.json", "utf-8"));
    const context = await browser.newContext();
    const page = await context.newPage();
    // Login only — registration is handled once by the setup project
    await loginViaUi(page, user.email, user.password);
    await use({ page, user });
    await context.close();
  },
});

export { type BrowserContext, expect, type Page };
