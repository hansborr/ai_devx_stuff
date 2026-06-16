import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SpellsPanelPO {
  constructor(private readonly page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────

  readonly spellsPanel = this.page.getByTestId("spells-panel");
  readonly spellAbility = this.page.getByTestId("spell-ability");
  readonly spellSaveDc = this.page.getByTestId("spell-save-dc");
  readonly addSpellButton = this.page.getByTestId("add-spell-btn");
  readonly addSpellDialog = this.page.getByRole("dialog", { name: "Add Spell" });
  readonly addSpellHeading = this.page.getByRole("heading", { name: "Add Spell" });
  readonly spellLevelFilter = this.addSpellDialog.getByRole("combobox", { name: "Level" });
  readonly castConfirmButton = this.page.getByTestId("cast-confirm");
  readonly shortRestButton = this.page.getByTestId("short-rest-btn");
  readonly longRestButton = this.page.getByTestId("long-rest-btn");
  readonly restConfirmButton = this.page.getByTestId("rest-confirm");
  readonly shortRestResult = this.page.getByTestId("short-rest-result");
  readonly longRestResult = this.page.getByTestId("long-rest-result");
  readonly shortRestHeading = this.page.getByRole("heading", { name: "Short Rest" });
  readonly longRestHeading = this.page.getByRole("heading", { name: "Long Rest" });
  readonly doneButton = this.page.getByRole("button", { name: "Done" });

  // ── Parameterized locators ─────────────────────────────────────────

  spellLevelGroup(level: number): Locator {
    return this.page.getByTestId(`spell-level-group-${String(level)}`);
  }

  spellSlotPips(level: number): Locator {
    return this.page.getByTestId(`spell-slot-pips-${String(level)}`);
  }

  // ── Methods (multi-step orchestration) ─────────────────────────────

  /**
   * Open the add-spell dialog, filter by level, and add the named spell.
   * Closes the dialog and waits for the spell to appear in the panel.
   */
  async addSpell(level: string, spellName: string): Promise<void> {
    await this.addSpellButton.click();
    await expect(this.addSpellHeading).toBeVisible({ timeout: TIMEOUT_SHORT });

    await this.spellLevelFilter.click();
    await this.page.getByRole("option", { name: level }).click();

    const addButton = this.addSpellDialog.getByRole("button", {
      name: `Add ${spellName}`,
      exact: true,
    });
    await expect(addButton).toBeVisible({ timeout: TIMEOUT_MEDIUM });

    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("characterSpell.add")),
      addButton.click(),
    ]);
    expect(resp.ok()).toBe(true);

    await this.page.keyboard.press("Escape");

    await expect(this.spellsPanel.getByText(spellName, { exact: true })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  /** Ensure the named spell's prepare checkbox in a level group is checked. */
  async prepareSpell(level: number, spellName: string): Promise<void> {
    const group = this.spellLevelGroup(level);
    await expect(group).toBeVisible({ timeout: TIMEOUT_SHORT });

    // Accessible name is "Prepare <spell>" or "Unprepare <spell>"; anchored
    // so one spell name containing another cannot collide.
    const checkbox = group.getByRole("checkbox", {
      name: new RegExp(`^(Prepare|Unprepare) ${escapeRegExp(spellName)}$`),
    });
    const wasChecked = await checkbox.isChecked();

    if (!wasChecked) {
      const [resp] = await Promise.all([
        this.page.waitForResponse((r) => r.url().includes("characterSpell.togglePrepared")),
        checkbox.click(),
      ]);
      expect(resp.ok()).toBe(true);
    }

    await expect(checkbox).toBeChecked({ timeout: TIMEOUT_SHORT });
  }

  /** Click Cast on the named prepared spell in a level group and confirm. */
  async castSpell(level: number, spellName: string): Promise<void> {
    // Identify the row by its exact spell-name button so one spell name
    // containing another cannot collide.
    const row = this.spellLevelGroup(level)
      .getByTestId(/^spell-row-/)
      .filter({ has: this.page.getByRole("button", { name: spellName, exact: true }) });
    const castBtn = row.getByRole("button", { name: "Cast", exact: true });
    await expect(castBtn).toBeVisible({ timeout: TIMEOUT_SHORT });
    await castBtn.click();

    await expect(this.castConfirmButton).toBeVisible({ timeout: TIMEOUT_SHORT });

    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("castSpell.cast")),
      this.castConfirmButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  /** Read the "X/Y" spell slot text for a given level. Returns [available, total]. */
  async getSpellSlotCount(level: number): Promise<[number, number]> {
    const pips = this.spellSlotPips(level);
    await expect(pips).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    const text = (await pips.getByText(/^\d+\/\d+$/).textContent()) ?? "0/0";
    const [avail = 0, total = 0] = text.split("/").map(Number);
    return [avail, total];
  }

  /** Assert spell slot count changed after an action. */
  async expectSpellSlotDecremented(level: number, beforeAvailable: number): Promise<void> {
    await expect(async () => {
      const [afterAvailable] = await this.getSpellSlotCount(level);
      expect(afterAvailable).toBeLessThan(beforeAvailable);
    }).toPass({ timeout: TIMEOUT_SHORT });
  }

  /** Assert spell slots are fully restored (available === total). */
  async expectSpellSlotsRestored(level: number): Promise<void> {
    await expect(async () => {
      const [avail, total] = await this.getSpellSlotCount(level);
      expect(avail).toBe(total);
    }).toPass({ timeout: TIMEOUT_SHORT });
  }

  /** Perform a short rest: click button, confirm, wait for result, close. */
  async performShortRest(): Promise<void> {
    await expect(this.shortRestButton).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.shortRestButton.click();

    await expect(this.shortRestHeading).toBeVisible({ timeout: TIMEOUT_SHORT });

    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("rest.shortRest")),
      this.restConfirmButton.click(),
    ]);
    expect(resp.ok()).toBe(true);

    await expect(this.shortRestResult).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.doneButton.click();
  }

  /** Perform a long rest: click button, confirm, wait for result, close. */
  async performLongRest(): Promise<void> {
    await expect(this.longRestButton).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.longRestButton.click();

    await expect(this.longRestHeading).toBeVisible({ timeout: TIMEOUT_SHORT });

    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("rest.longRest")),
      this.restConfirmButton.click(),
    ]);
    expect(resp.ok()).toBe(true);

    await expect(this.longRestResult).toBeVisible({ timeout: TIMEOUT_SHORT });
    await expect(this.page.getByText("Spell Slots Recovered")).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    await this.doneButton.click();
  }

  async expectSpellVisible(name: string): Promise<void> {
    await expect(this.spellsPanel.getByText(name)).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }
}
