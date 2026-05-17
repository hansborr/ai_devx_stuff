import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";
import { CampaignChatPO } from "./campaign-chat.po.js";
import { CampaignNotesPO } from "./campaign-notes.po.js";
import { CampaignNpcsPO } from "./campaign-npcs.po.js";
import { CampaignSettingsPO } from "./campaign-settings.po.js";

export class CampaignDetailPO {
  readonly chat: CampaignChatPO;
  readonly notes: CampaignNotesPO;
  readonly npcs: CampaignNpcsPO;
  readonly settings: CampaignSettingsPO;

  constructor(private readonly page: Page) {
    this.chat = new CampaignChatPO(page);
    this.notes = new CampaignNotesPO(page);
    this.npcs = new CampaignNpcsPO(page);
    this.settings = new CampaignSettingsPO(page);
  }

  // ── Named locators ─────────────────────────────────────────────────
  readonly membersList = this.page.locator('[aria-label="Campaign members"]');
  readonly createInviteButton = this.page.getByRole("button", { name: "Create Invite" });
  readonly inviteCodeDisplay = this.page.locator("code.font-mono").first();
  readonly assignCharacterSelect = this.page.locator('[aria-label="Assign character"]');

  // ── Header ──────────────────────────────────────────────────────────

  async expectName(name: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name, level: 1 })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectDmBadge(): Promise<void> {
    await expect(this.page.getByText("DM", { exact: true })).toBeVisible();
  }

  async expectPlayerBadge(): Promise<void> {
    await expect(this.page.getByText("Player", { exact: true })).toBeVisible();
  }

  // ── Tabs ────────────────────────────────────────────────────────────

  async clickTab(name: string): Promise<void> {
    const tab = this.page.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: TIMEOUT_MEDIUM });
    if (name !== "Overview") {
      const tabSlug = encodeURIComponent(name.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await expect(this.page).toHaveURL(new RegExp(`[?&]tab=${tabSlug}(?:&|$)`), {
        timeout: TIMEOUT_MEDIUM,
      });
    }
  }

  async expectTabVisible(name: string): Promise<void> {
    await expect(this.page.getByRole("tab", { name })).toBeVisible();
  }

  async expectTabHidden(name: string): Promise<void> {
    await expect(this.page.getByRole("tab", { name })).toBeHidden();
  }

  // ── Overview tab ────────────────────────────────────────────────────

  async expectDescription(text: string): Promise<void> {
    await expect(this.page.getByText(text)).toBeVisible();
  }

  // ── Members tab ─────────────────────────────────────────────────────

  async expectMemberVisible(displayName: string): Promise<void> {
    await expect(this.membersList.locator("li", { hasText: displayName })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectMemberCount(count: number): Promise<void> {
    await expect(this.page.getByRole("tab", { name: /Members/ })).toContainText(String(count));
  }

  async assignCharacter(characterName: string): Promise<void> {
    await expect(this.assignCharacterSelect).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    const option = this.assignCharacterSelect.locator("option", { hasText: characterName });
    const value = await option.getAttribute("value");
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("campaign.assignCharacter")),
      this.assignCharacterSelect.selectOption(value ?? ""),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async unassignCharacter(): Promise<void> {
    await this.assignCharacterSelect.selectOption({ index: 0 });
    await this.page.waitForResponse((r) => r.url().includes("campaign.unassignCharacter"));
  }

  // ── Invite panel (DM only, inside Members tab) ──────────────────────

  async createInvite(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("invite.create")),
      this.createInviteButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async getInviteCode(): Promise<string> {
    await expect(this.inviteCodeDisplay).toBeVisible({ timeout: TIMEOUT_SHORT });
    return (await this.inviteCodeDisplay.textContent()) ?? "";
  }

  async revokeInvite(code: string): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("invite.revoke")),
      this.page.getByLabel(`Revoke invite ${code}`).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectInviteGone(code: string): Promise<void> {
    await expect(this.page.locator("code.font-mono").filter({ hasText: code })).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }
}
