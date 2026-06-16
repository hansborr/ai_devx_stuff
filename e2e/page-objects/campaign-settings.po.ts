import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

export class CampaignSettingsPO {
  constructor(private readonly page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────
  // Scoped to the active tab panel: the settings form is the only "Name"
  // field mounted while the Settings tab is selected.
  readonly settingsNameInput = this.page.getByRole("tabpanel").getByLabel("Name", { exact: true });
  readonly saveChangesButton = this.page.getByRole("button", { name: "Save Changes" });
  readonly deleteCampaignButton = this.page.getByRole("button", { name: "Delete Campaign" });
  readonly deleteDialog = this.page.getByRole("dialog");
  // The confirm field's label embeds the campaign name, so match the only
  // textbox inside the delete dialog instead.
  readonly confirmDeleteInput = this.deleteDialog.getByRole("textbox");
  readonly deleteConfirmButton = this.deleteDialog.getByRole("button", { name: "Delete Campaign" });

  // ── Actions ────────────────────────────────────────────────────────

  async updateCampaignName(name: string): Promise<void> {
    await this.settingsNameInput.fill(name);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("campaign.update")),
      this.saveChangesButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async deleteCampaign(campaignName: string): Promise<void> {
    await this.deleteCampaignButton.click();
    await this.confirmDeleteInput.fill(campaignName);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("campaign.delete")),
      this.deleteConfirmButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
    await expect(this.page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
  }
}
