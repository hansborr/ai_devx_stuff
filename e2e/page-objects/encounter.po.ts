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
    await expect(
      this.page.getByRole("heading", { name, level: 3 }).or(this.page.getByText(name).first()),
    ).toBeVisible({ timeout: TIMEOUT_SHORT });
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
    const row = dialog
      .locator('[data-testid^="participant-row-"]')
      .filter({ hasText: characterName });
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
    const row = dialog.locator('[data-testid="monster-row"]').filter({
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
    await expect(this.page.getByText(state, { exact: true }).first()).toBeVisible({
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

  async expectParticipantHp(_name: string, current: number, max: number): Promise<void> {
    await expect(this.page.getByText(`${String(current)}/${String(max)}`).first()).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  // ── Attack dialog ───────────────────────────────────────────────────

  async openAttack(participantName: string): Promise<void> {
    await this.page
      .getByRole("button", { name: `Attack with ${participantName}` })
      .first()
      .click();
    await expect(this.page.getByRole("dialog", { name: /Attack/ })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async performAttack(opts: {
    targetName: string;
    attackName: string;
    attackBonus: number;
    damageDice?: string;
  }): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: /Attack/ });
    // Select target
    await dialog.getByRole("button", { name: new RegExp(opts.targetName) }).click();
    // Fill form
    await dialog.getByRole("textbox", { name: "Attack Name" }).fill(opts.attackName);
    await dialog.getByRole("spinbutton", { name: "Attack Bonus" }).fill(String(opts.attackBonus));
    if (opts.damageDice) {
      await dialog.getByRole("textbox", { name: "Damage Dice" }).fill(opts.damageDice);
    }
    // Submit
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.attemptAttack")),
      dialog.getByRole("button", { name: "Roll Attack" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectAttackResult(): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: /Attack/ });
    // Result shows either HIT, MISS, CRITICAL HIT, or CRITICAL MISS
    await expect(dialog.getByText("HIT").or(dialog.getByText("MISS"))).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async closeDialog(): Promise<void> {
    await this.page.getByRole("button", { name: "Close" }).click();
  }

  // ── Spell cast dialog ───────────────────────────────────────────────

  async openSpell(participantName: string): Promise<void> {
    await this.page
      .getByRole("button", { name: `Cast spell with ${participantName}` })
      .first()
      .click();
    await expect(this.page.getByRole("dialog", { name: /Cast Spell/ })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async performSpellAttack(opts: {
    targetName: string;
    spellName: string;
    attackBonus: number;
    damageDice?: string;
    damageType?: string;
  }): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: /Cast Spell/ });
    // Select target
    await dialog.getByRole("button", { name: new RegExp(opts.targetName) }).click();
    // Ensure Spell Attack mode is selected (default)
    await dialog.getByRole("button", { name: "Spell Attack" }).click();
    // Fill form
    await dialog.getByLabel("Spell Name").fill(opts.spellName);
    await dialog.getByLabel("Attack Bonus").fill(String(opts.attackBonus));
    if (opts.damageDice) {
      await dialog.getByLabel("Damage Dice").fill(opts.damageDice);
    }
    if (opts.damageType) {
      await dialog.getByLabel("Damage Type").fill(opts.damageType);
    }
    // Submit
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.castCombatSpell")),
      dialog.getByRole("button", { name: "Cast Spell" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectSpellResult(): Promise<void> {
    const dialog = this.page.getByRole("dialog", { name: /Cast Spell/ });
    await expect(dialog.getByText("HIT").or(dialog.getByText("MISS"))).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  // ── HP adjustment dialog ────────────────────────────────────────────

  async adjustHp(
    participantName: string,
    mode: "Damage" | "Heal" | "Temp HP",
    amount: number,
  ): Promise<void> {
    await this.page.getByRole("button", { name: `Adjust HP for ${participantName}` }).click();
    await expect(this.page.getByRole("dialog", { name: /HP/ })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    const dialog = this.page.getByRole("dialog", { name: /HP/ });
    await dialog.getByRole("button", { name: mode }).click();
    await dialog.getByRole("spinbutton", { name: "Amount" }).fill(String(amount));
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounter.updateParticipant")),
      dialog.getByRole("button", { name: "Apply" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
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
    await expect(this.page.getByText(text).first()).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  // ── Player-specific assertions ──────────────────────────────────────

  async expectNoEncounterControls(): Promise<void> {
    await expect(this.page.getByRole("button", { name: "Next Turn" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "Pause" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "End Encounter" })).toBeHidden();
    await expect(this.page.getByRole("button", { name: "New Encounter" })).toBeHidden();
  }

  async expectAttackButton(participantName: string): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: `Attack with ${participantName}` }).first(),
    ).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectSpellButton(participantName: string): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: `Cast spell with ${participantName}` }).first(),
    ).toBeVisible({ timeout: TIMEOUT_SHORT });
  }
}
