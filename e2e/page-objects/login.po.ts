import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class LoginPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.locator("#email").fill(email);
    await this.page.locator("#password").fill(password);
    await this.page.getByRole("button", { name: "Log in" }).click();
  }

  async submitEmpty(): Promise<void> {
    await this.page.getByRole("button", { name: "Log in" }).click();
  }

  async expectRedirectToDashboard(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
  }

  async expectError(text: string | RegExp): Promise<void> {
    await expect(this.page.locator('[role="alert"]').first()).toContainText(text);
  }
}
