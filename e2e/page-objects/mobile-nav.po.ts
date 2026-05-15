import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class MobileNavPO {
  constructor(private page: Page) {}

  private trigger(): Locator {
    return this.page.getByRole("button", { name: /open menu/i });
  }

  private sheet(): Locator {
    return this.page.getByRole("dialog");
  }

  async openMenu(): Promise<void> {
    const trigger = this.trigger();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(this.sheet()).toBeVisible();
  }

  async clickCampaigns(): Promise<void> {
    await this.sheet()
      .getByRole("link", { name: /campaigns/i })
      .click();
  }

  async expectOnCampaigns(): Promise<void> {
    await expect(this.page).toHaveURL(/\/campaigns$/, { timeout: TIMEOUT_MEDIUM });
  }

  async expectClosed(): Promise<void> {
    await expect(this.sheet()).toBeHidden();
  }
}
