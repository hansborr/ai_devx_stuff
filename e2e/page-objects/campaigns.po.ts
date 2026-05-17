import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class CampaignsPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/campaigns");
    await expect(this.page.getByRole("heading", { name: "Campaigns" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText("No campaigns yet")).toBeVisible();
  }

  async createCampaign(name: string, description?: string): Promise<void> {
    await this.page.getByRole("button", { name: "Create Campaign" }).first().click();
    await this.page.locator("#campaign-name").fill(name);
    if (description) {
      await this.page.locator("#campaign-description").fill(description);
    }
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("campaign.create")),
      this.page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async joinCampaign(code: string): Promise<void> {
    await this.page.getByRole("button", { name: "Join Campaign" }).click();
    await this.page.locator("#invite-code").fill(code);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("invite.join")),
      this.page.getByRole("button", { name: "Join" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  getCampaignCard(name: string): Locator {
    return this.page.locator("a[href*='/campaigns/']").filter({ hasText: name });
  }

  async clickCampaign(name: string): Promise<void> {
    await this.getCampaignCard(name).click();
    await expect(this.page).toHaveURL(/\/campaigns\//, { timeout: TIMEOUT_MEDIUM });
  }

  async expectCampaignExists(name: string): Promise<void> {
    await expect(this.getCampaignCard(name)).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectCampaignGone(name: string): Promise<void> {
    await expect(this.getCampaignCard(name)).not.toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }
}
