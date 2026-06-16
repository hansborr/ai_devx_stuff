import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class LoginPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Log in" }).click();
  }

  async submitEmpty(): Promise<void> {
    await this.page.getByRole("button", { name: "Log in" }).click();
  }

  async expectRedirectToDashboard(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
  }

  async expectError(text: string | RegExp): Promise<void> {
    // Field and server errors both render role="alert"; filter by content
    // instead of position so multiple alerts cannot shadow the expected one.
    await expect(this.page.getByRole("alert").filter({ hasText: text })).toBeVisible();
  }
}
