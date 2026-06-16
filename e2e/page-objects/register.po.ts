import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class RegisterPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/register");
  }

  async fillForm(email: string, password: string, displayName: string): Promise<void> {
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByLabel("Display Name").fill(displayName);
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
    // Field and server errors both render role="alert"; filter by content
    // instead of position so multiple alerts cannot shadow the expected one.
    await expect(this.page.getByRole("alert").filter({ hasText: text })).toBeVisible();
  }
}
