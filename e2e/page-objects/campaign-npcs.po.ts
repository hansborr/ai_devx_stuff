import { expect, type Page } from "@playwright/test";

import { TIMEOUT_SHORT } from "../helpers/timeouts.js";

export class CampaignNpcsPO {
  constructor(private page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────
  readonly newNpcButton = this.page.getByRole("button", { name: /new npc/i });

  // ── Actions ────────────────────────────────────────────────────────

  async createNpc(name: string, description?: string, opts?: { visible?: boolean }): Promise<void> {
    await this.newNpcButton.click();
    await this.page.locator("#npc-name").fill(name);
    if (description) {
      await this.page.locator("#npc-description").fill(description);
    }
    if (opts?.visible) {
      await this.page.locator("#npc-visible").check();
    }
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("npc.create")),
      this.page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async editNpc(name: string, newName: string): Promise<void> {
    await this.page.getByLabel(`Edit ${name}`).click();
    await this.page.locator("#npc-name").fill(newName);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("npc.update")),
      this.page.getByRole("button", { name: "Update" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async deleteNpc(name: string): Promise<void> {
    await this.page.getByLabel(`Delete ${name}`).click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("npc.delete")),
      this.page.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async searchNpcs(query: string): Promise<void> {
    await this.page.getByLabel("Search NPCs").fill(query);
  }

  async filterNpcsByStatus(value: string): Promise<void> {
    await this.page.getByLabel("Filter by status").click();
    await this.page.getByRole("option", { name: value }).click();
  }

  // ── Assertions ─────────────────────────────────────────────────────

  async expectNpcVisible(name: string): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectNpcHidden(name: string): Promise<void> {
    await expect(this.page.getByText(name)).not.toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectNpcsEmpty(): Promise<void> {
    await expect(this.page.getByText(/no npcs/i).first()).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectCreateNpcHidden(): Promise<void> {
    await expect(this.newNpcButton).toBeHidden();
  }
}
