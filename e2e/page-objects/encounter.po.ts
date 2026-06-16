import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

/**
 * Page object for encounter interactions within the campaign detail page.
 * Assumes the Encounters tab is already active.
 */
export class EncounterPO {
  constructor(private readonly page: Page) {}

  // ── Encounter list ──────────────────────────────────────────────────

  async createEncounter(name: string): Promise<void> {
    await this.page.getByRole("button", { name: "New Encounter" }).click();
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.create")),
      this.page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async openEncounter(name: string): Promise<void> {
    await this.page.getByText(name, { exact: true }).click();
    await expect(this.page.getByRole("heading", { name, level: 3 })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectEncounterVisible(name: string): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  // ── Add participants ────────────────────────────────────────────────

  async clickAddParticipant(): Promise<void> {
    await this.page.getByRole("button", { name: "Add Participant" }).click();
    await expect(this.page.getByRole("dialog", { name: "Add Participant" })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async addCharacter(characterName: string): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: "Add Participant" });
    // Ensure Characters tab is active
    const charsTab = dialog.getByRole("tab", { name: "Characters" });
    if (!(await charsTab.getAttribute("aria-selected"))?.includes("true")) {
      await charsTab.click();
    }
    // Scope to the character's row via data-testid, then click its Add button
    const row = dialog.getByTestId(/^participant-row-/).filter({ hasText: characterName });
    await expect(row).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    const addButton = row.getByRole("button", { name: "Add", exact: true });
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.addParticipant")),
      addButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
    // Wait for the character row to disappear from the available list
    await expect(row).not.toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async addMonster(searchTerm: string): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: "Add Participant" });
    await dialog.getByRole("tab", { name: "Monsters" }).click();
    await dialog.getByRole("textbox", { name: "Search monsters..." }).fill(searchTerm);
    // Scope to the exact monster's row — hasText is substring so "Goblin Warrior"
    // would also match "Hobgoblin Warrior". Use has: with exact name match instead.
    const row = dialog.getByTestId("monster-row").filter({
      has: this.page.getByRole("button", { name: searchTerm, exact: true }),
    });
    await expect(row).toBeVisible({ timeout: TIMEOUT_SHORT });
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.addParticipant")),
      row.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async closeAddParticipantDialog(): Promise<void> {
    await this.page.getByRole("button", { name: "Done" }).click();
    await expect(this.page.getByRole("dialog", { name: "Add Participant" })).toBeHidden();
  }

  // ── Initiative & combat state ───────────────────────────────────────

  async rollInitiative(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.rollAllInitiative")),
      this.page.getByRole("button", { name: "Roll Initiative" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async startCombat(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.transitionState")),
      this.page.getByRole("button", { name: "Start Combat" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async advanceTurn(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.advanceTurn")),
      this.page.getByRole("button", { name: "Next Turn" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async pause(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.transitionState")),
      this.page.getByRole("button", { name: "Pause" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async resume(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.transitionState")),
      this.page.getByRole("button", { name: "Resume" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async endEncounter(): Promise<void> {
    await this.page.getByRole("button", { name: "End Encounter" }).click();
    await expect(this.page.getByRole("dialog", { name: "End Encounter" })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.transitionState")),
      this.page
        .getByRole("dialog", { name: "End Encounter" })
        .getByRole("button", { name: "End Encounter" })
        .click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  // ── State assertions ────────────────────────────────────────────────

  async expectState(state: "setup" | "active" | "paused" | "resolved"): Promise<void> {
    // The detail card badge renders the raw lowercase state; the list cards
    // render capitalized labels, so the exact match is unique.
    await expect(this.page.getByText(state, { exact: true })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectRound(round: number): Promise<void> {
    await expect(this.page.getByText(`Round ${String(round)}`)).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectTurn(turn: number, total: number): Promise<void> {
    await expect(this.page.getByText(`Turn ${String(turn)} of ${String(total)}`)).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectCurrentParticipant(name: string): Promise<void> {
    // The initiative list renders as "NameCurrent..." for the active participant
    const initList = this.page.getByRole("list", { name: "Initiative order" });
    await expect(initList).toContainText(`${name}Current`, { timeout: TIMEOUT_SHORT });
  }

  /**
   * Reads the name of the participant currently highlighted as "Current" in the
   * initiative list. Used by the live-sync assertion to compare the DM and
   * player views without a manual refresh.
   */
  async currentParticipantName(): Promise<string> {
    // Exactly one initiative row carries the "Current" badge at a time, so the
    // filtered locator resolves to a single element.
    const currentRow = this.page
      .getByRole("list", { name: "Initiative order" })
      .getByRole("listitem")
      .filter({ has: this.page.getByText("Current", { exact: true }) });
    await expect(currentRow).toBeVisible({ timeout: TIMEOUT_SHORT });
    return (await currentRow.textContent()) ?? "";
  }

  // ── End encounter / XP ──────────────────────────────────────────────

  async expectXpSummary(): Promise<void> {
    await expect(this.page.getByText("Total encounter XP")).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectResolvedState(): Promise<void> {
    await expect(this.page.getByText("Encounter resolved")).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  // ── Combat log ──────────────────────────────────────────────────────

  async expectCombatLogEntry(text: string): Promise<void> {
    // Identical entries can repeat, so assert on the log container's text
    // rather than a single entry element. Test id instead of role: the
    // modal VTT drawer aria-hides the panel, which removes it from role
    // lookups while it stays visually on screen.
    await expect(this.page.getByTestId("combat-log")).toContainText(text, {
      timeout: TIMEOUT_SHORT,
    });
  }

  // ── Player-specific assertions ──────────────────────────────────────

  async expectNoEncounterControls(): Promise<void> {
    await expect(this.page.getByRole("button", { name: "Next Turn" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "Pause" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "End Encounter" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "New Encounter" })).toBeHidden();
  }
}
