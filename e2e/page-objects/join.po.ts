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

  /**
   * The logged-out bounce parks the invite on `/login` as a `returnTo` param.
   * Asserted through `URL` rather than a URL regex so an invite code containing
   * regex-significant characters cannot make this pass by accident.
   */
  async expectLoginWithReturnTo(target: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/login\?/, { timeout: TIMEOUT_MEDIUM });
    const url = new URL(this.page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("returnTo")).toBe(target);
  }

  /** Signing in resumed the invite itself, not the dashboard fallback. */
  async expectResumedInvite(code: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/join\//, { timeout: TIMEOUT_LONG });
    expect(new URL(this.page.url()).pathname).toBe(`/join/${code}`);
  }

  /** The invite preview names the campaign before any membership is created. */
  async expectInvitedTo(campaignName: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name: campaignName })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  /** Joining is an explicit confirmation; landing on `/join/:code` joins nothing. */
  async clickJoin(): Promise<void> {
    const joinButton = this.page.getByRole("button", { name: "Join campaign" });
    await expect(joinButton).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await joinButton.click();
  }

  async expectError(text: string | RegExp): Promise<void> {
    await expect(this.page.getByRole("alert")).toContainText(text, {
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async clickGoToCampaigns(): Promise<void> {
    await this.page.getByRole("button", { name: "Go to Campaigns" }).click();
    await expect(this.page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
  }
}
