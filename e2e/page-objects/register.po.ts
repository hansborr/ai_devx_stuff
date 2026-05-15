import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class RegisterPO {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/register");
  }

  async fillForm(email: string, password: string, displayName: string): Promise<void> {
    await this.page.locator("#email").fill(email);
    await this.page.locator("#password").fill(password);
    await this.page.locator("#displayName").fill(displayName);
  }

  async submit(): Promise<void> {
    await this.page.getByRole("button", { name: "Register" }).click();
  }

  async submitEmpty(): Promise<void> {
    await this.page.getByRole("button", { name: "Register" }).click();
  }

  async expectRedirectToLogin(): Promise<void> {
    await expect(this.page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });
  }

  async expectError(text: string | RegExp): Promise<void> {
    await expect(this.page.locator('[role="alert"]').first()).toContainText(text);
  }
}
