import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

export class SpellsPanelPO {
  constructor(private readonly page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────

  readonly spellsPanel = this.page.locator('[data-testid="spells-panel"]');
  readonly spellAbility = this.page.locator('[data-testid="spell-ability"]');
  readonly spellSaveDc = this.page.locator('[data-testid="spell-save-dc"]');
  readonly addSpellButton = this.page.locator('[data-testid="add-spell-btn"]');
  readonly addSpellHeading = this.page.getByRole("heading", { name: "Add Spell" });
  readonly spellLevelFilter = this.page.locator("#spell-level-filter");
  readonly castConfirmButton = this.page.locator('[data-testid="cast-confirm"]');
  readonly shortRestButton = this.page.locator('[data-testid="short-rest-btn"]');
  readonly longRestButton = this.page.locator('[data-testid="long-rest-btn"]');
  readonly restConfirmButton = this.page.locator('[data-testid="rest-confirm"]');
  readonly shortRestResult = this.page.locator('[data-testid="short-rest-result"]');
  readonly longRestResult = this.page.locator('[data-testid="long-rest-result"]');
  readonly shortRestHeading = this.page.getByRole("heading", { name: "Short Rest" });
  readonly longRestHeading = this.page.getByRole("heading", { name: "Long Rest" });
  readonly doneButton = this.page.getByRole("button", { name: "Done" });

  // ── Parameterized locators ─────────────────────────────────────────

  spellLevelGroup(level: number): Locator {
    return this.page.locator(`[data-testid="spell-level-group-${String(level)}"]`);
  }

  spellSlotPips(level: number): Locator {
    return this.page.locator(`[data-testid="spell-slot-pips-${String(level)}"]`);
  }

  // ── Methods (multi-step orchestration) ─────────────────────────────

  /**
   * Open the add-spell dialog, filter by level, add the first available spell.
   * Closes the dialog and returns the spell name (or null if none found).
   */
  async addSpellByLevel(level: string): Promise<string | null> {
    await this.addSpellButton.click();
    await expect(this.addSpellHeading).toBeVisible({ timeout: TIMEOUT_SHORT });

    await this.spellLevelFilter.click();
    await this.page.getByRole("option", { name: level }).click();

    const firstAddBtn = this.page.locator('button[data-testid^="add-srd-spell-"]').first();
    await expect(firstAddBtn).toBeVisible({ timeout: TIMEOUT_MEDIUM });

    const spellName = await firstAddBtn
      .locator("..")
      .locator(".text-sm.font-medium")
      .first()
      .textContent();

    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("characterSpell.add")),
      firstAddBtn.click(),
    ]);
    expect(resp.ok()).toBe(true);

    await this.page.keyboard.press("Escape");

    if (spellName) {
      await expect(this.spellsPanel.getByText(spellName)).toBeVisible({
        timeout: TIMEOUT_SHORT,
      });
    }

    return spellName;
  }

  /** Toggle the prepare checkbox on the first spell in a level group. */
  async prepareSpell(level: number): Promise<void> {
    const group = this.spellLevelGroup(level);
    await expect(group).toBeVisible({ timeout: TIMEOUT_SHORT });

    const checkbox = group.locator('input[type="checkbox"]').first();
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

  /** Click Cast on the first prepared spell in a level group and confirm. */
  async castSpell(level: number): Promise<void> {
    const group = this.spellLevelGroup(level);
    const castBtn = group.locator('button[data-testid^="cast-"]').first();
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
    const text =
      (await pips.locator(".text-xs.text-muted-foreground").last().textContent()) ?? "0/0";
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
