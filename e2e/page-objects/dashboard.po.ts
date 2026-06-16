import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class DashboardPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/dashboard");
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
    await expect(this.page.getByRole("heading", { name: "Your Tables" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectDisplayName(name: string): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible();
  }

  async clickCreateCharacter(): Promise<void> {
    await this.page.getByRole("link", { name: /create character/i }).click();
    await expect(this.page).toHaveURL(/\/characters\/create/, { timeout: TIMEOUT_MEDIUM });
  }

  async clickCampaigns(): Promise<void> {
    await this.page.getByRole("link", { name: "Campaigns" }).click();
    await expect(this.page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
  }

  async clickLogout(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("auth.logout")),
      this.page.getByRole("button", { name: "Logout" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
    await expect(this.page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });
  }

  getCharacterCard(name: string): Locator {
    return this.page.getByRole("link").filter({ hasText: name });
  }

  async clickCharacterCard(name: string): Promise<void> {
    await this.getCharacterCard(name).click();
    await expect(this.page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });
  }

  async expectCharacterExists(name: string): Promise<void> {
    await expect(this.getCharacterCard(name)).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectCharacterGone(name: string): Promise<void> {
    await expect(this.getCharacterCard(name)).not.toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText("No characters yet")).toBeVisible();
  }
}
