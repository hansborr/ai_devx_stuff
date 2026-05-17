import { expect, type Page } from "@playwright/test";

import { TIMEOUT_LONG, TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class JoinPO {
  constructor(private readonly page: Page) {}

  async goto(code: string): Promise<void> {
    await this.page.goto(`/join/${code}`);
  }

  async expectRedirectToCampaign(): Promise<void> {
    await expect(this.page).toHaveURL(/\/campaigns\//, { timeout: TIMEOUT_LONG });
  }

  async expectError(text: string | RegExp): Promise<void> {
    await expect(this.page.locator('[role="alert"]')).toContainText(text, {
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async clickGoToCampaigns(): Promise<void> {
    await this.page.getByRole("button", { name: "Go to Campaigns" }).click();
    await expect(this.page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
  }
}
