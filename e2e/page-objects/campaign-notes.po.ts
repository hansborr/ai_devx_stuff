import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

export class CampaignNotesPO {
  constructor(private readonly page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────
  readonly newNoteButton = this.page.getByRole("button", { name: /new note/i });

  // ── Actions ────────────────────────────────────────────────────────

  async createNote(title: string, content: string, visibility?: string): Promise<void> {
    await this.newNoteButton.click();
    await expect(
      this.page.getByRole("dialog").getByRole("heading", { name: "New Note" }),
    ).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await this.page.locator("#note-title").fill(title);
    await this.page.locator("#note-content").fill(content);
    if (visibility) {
      const visibilitySelect = this.page.locator("#note-visibility");
      await expect(visibilitySelect).toBeEnabled({ timeout: TIMEOUT_MEDIUM });
      await visibilitySelect.click();
      await this.page
        .getByRole("option", { name: new RegExp(visibility.replace("-", "[- ]?"), "i") })
        .click();
    }
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("note.create")),
      this.page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async editNote(title: string, newTitle: string): Promise<void> {
    await this.page.getByLabel(`Edit ${title}`).click();
    await this.page.locator("#note-title").fill(newTitle);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("note.update")),
      this.page.getByRole("button", { name: "Update" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async deleteNote(title: string): Promise<void> {
    await this.page.getByLabel(`Delete ${title}`).click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("note.delete")),
      this.page.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async searchNotes(query: string): Promise<void> {
    await this.page.getByLabel("Search notes").fill(query);
  }

  async filterNotesByVisibility(value: string): Promise<void> {
    await this.page.getByLabel("Filter by visibility").click();
    await this.page.getByRole("option", { name: value }).click();
  }

  // ── Assertions ─────────────────────────────────────────────────────

  async expectNoteVisible(title: string): Promise<void> {
    await expect(this.page.getByText(title)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectNoteHidden(title: string): Promise<void> {
    await expect(this.page.getByText(title)).not.toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectNotesEmpty(): Promise<void> {
    await expect(this.page.getByText(/no notes/i)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }
}
