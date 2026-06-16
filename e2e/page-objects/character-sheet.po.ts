import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";
import { SpellsPanelPO } from "./spells-panel.po.js";

export class CharacterSheetPO {
  constructor(private readonly page: Page) {}

  // ── Named locators ──────────────────────────────────────────────────

  readonly sheetHeader = this.page.getByRole("region", { name: "Character summary" });
  readonly hpAdjuster = this.page.getByTestId("hp-adjuster");
  readonly hpInput = this.hpAdjuster.getByLabel("Amount");
  readonly hpBar = this.hpAdjuster.getByRole("progressbar", { name: "Hit points" });
  readonly damageButton = this.page.getByRole("button", { name: "Damage" });
  readonly healButton = this.hpAdjuster.getByRole("button", { name: "Heal" });
  readonly tempHpButton = this.page.getByRole("button", { name: "Temp HP" });
  readonly deathSaves = this.page.getByTestId("death-saves-interactive");
  readonly levelUpButton = this.page.getByRole("button", { name: "Level Up", exact: true });
  readonly levelDisplay = this.page.getByTestId("sheet-level");
  readonly levelUpAverageButton = this.page.getByRole("button", { name: /average/i });
  readonly levelUpConfirmButton = this.page.getByRole("button", { name: /level up to/i });
  readonly inspirationToggle = this.page.getByRole("button", { name: "Toggle inspiration" });
  readonly inventoryPanel = this.page.getByTestId("inventory-panel");
  readonly addItemDialog = this.page.getByRole("dialog", { name: "Add Item" });
  readonly editItemDialog = this.page.getByRole("dialog", { name: "Edit Item" });
  readonly backToDashboardLink = this.page.getByRole("link", { name: /dashboard/i });
  readonly spells = new SpellsPanelPO(this.page);

  // ── Assertions ──────────────────────────────────────────────────────

  async expectName(name: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name, level: 1 })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectLevel(level: number): Promise<void> {
    await expect(this.levelDisplay).toHaveText(`Level ${String(level)}`, {
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectCurrentHp(hp: number): Promise<void> {
    await expect(this.hpAdjuster.getByText(String(hp), { exact: false })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async getCurrentHp(): Promise<number> {
    const value = await this.hpBar.getAttribute("aria-valuenow");
    return Number(value);
  }

  async expectTempHp(amount: number): Promise<void> {
    await expect(this.page.getByText(`+${String(amount)} temp`)).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectSpeciesBadge(species: string): Promise<void> {
    await expect(this.sheetHeader.getByText(species, { exact: true })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  /**
   * Saving-throw row for a full ability name, e.g. "Strength". The sheet
   * mounts the desktop and mobile layouts together, so each row exists twice
   * in the DOM; the visible filter picks the copy the active layout shows.
   */
  private saveRow(ability: string): Locator {
    return this.page.getByTestId(/^save-/).filter({ hasText: ability, visible: true });
  }

  async expectSavingThrowProficient(ability: string): Promise<void> {
    await expect(this.saveRow(ability).getByLabel("Proficient", { exact: true })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async expectSavingThrowNotProficient(ability: string): Promise<void> {
    await expect(this.saveRow(ability).getByLabel("Not proficient", { exact: true })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectSkillProficient(skill: string): Promise<void> {
    // Same dual desktop/mobile mount as saveRow; keep only the visible row.
    const row = this.page.getByTestId(`skill-${skill}`).filter({ visible: true });
    await expect(row.getByLabel("Proficient", { exact: true })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectFeatureVisible(feature: string): Promise<void> {
    await expect(this.page.getByText(feature)).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectProficiencyVisible(proficiency: string): Promise<void> {
    await expect(this.page.getByText(proficiency)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectInspirationActive(): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: "Toggle inspiration", pressed: true }),
    ).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectErrorMessage(text: string | RegExp): Promise<void> {
    await expect(this.page.getByText(text)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  // ── HP actions ──────────────────────────────────────────────────────

  /** Type an amount into the HP input. */
  private async fillHpAmount(amount: number): Promise<void> {
    await this.hpInput.fill(String(amount));
  }

  async damageHp(amount: number): Promise<void> {
    await this.fillHpAmount(amount);
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes("character.adjustHp") && r.request().method() === "POST",
      ),
      this.damageButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async healHp(amount: number): Promise<void> {
    await this.fillHpAmount(amount);
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes("character.adjustHp") && r.request().method() === "POST",
      ),
      this.healButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async setTempHp(amount: number): Promise<void> {
    await this.fillHpAmount(amount);
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes("character.adjustHp") && r.request().method() === "POST",
      ),
      this.tempHpButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  // ── Level up ────────────────────────────────────────────────────────

  /** Confirm level up with "Take Average" HP method. */
  async confirmLevelUp(): Promise<void> {
    await this.levelUpAverageButton.click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("character.levelUp")),
      this.levelUpConfirmButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  // ── Inspiration ─────────────────────────────────────────────────────

  async toggleInspiration(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes("character.updateStats") && r.request().method() === "POST",
      ),
      this.inspirationToggle.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  // ── Inventory ──────────────────────────────────────────────────────

  async expectInventoryEmpty(): Promise<void> {
    await expect(this.inventoryPanel.getByText("No items yet")).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async clickAddItem(): Promise<void> {
    await this.inventoryPanel.getByRole("button", { name: "+ Add" }).click();
  }

  async fillItemForm(opts: {
    name: string;
    type?: string;
    quantity?: string;
    weight?: string;
    description?: string;
  }): Promise<void> {
    await this.addItemDialog.getByLabel("Name", { exact: true }).fill(opts.name);
    if (opts.type) {
      await this.addItemDialog.getByRole("combobox", { name: "Type" }).click();
      await this.page.getByRole("option", { name: opts.type, exact: true }).click();
    }
    if (opts.quantity) await this.addItemDialog.getByLabel("Quantity").fill(opts.quantity);
    if (opts.weight) await this.addItemDialog.getByLabel("Weight (lb)").fill(opts.weight);
    if (opts.description) await this.addItemDialog.getByLabel("Description").fill(opts.description);
  }

  async submitAddItem(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("inventory.create")),
      this.page.getByRole("button", { name: "Add Item" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expandItem(name: string): Promise<void> {
    const toggle = this.page.getByLabel(`Toggle details for ${name}`);
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded !== "true") await toggle.click();
  }

  async clickEquip(name: string): Promise<void> {
    await this.expandItem(name);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("inventory.update")),
      this.inventoryPanel.getByRole("button", { name: "Equip" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async clickAttune(name: string): Promise<void> {
    await this.expandItem(name);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("inventory.update")),
      this.inventoryPanel.getByRole("button", { name: "Attune" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async clickEditItem(name: string): Promise<void> {
    await this.expandItem(name);
    await this.page.getByLabel(`Edit ${name}`).click();
  }

  async fillEditForm(opts: { name?: string }): Promise<void> {
    if (opts.name) await this.editItemDialog.getByLabel("Name", { exact: true }).fill(opts.name);
  }

  async submitEditItem(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("inventory.update")),
      this.page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async deleteItem(name: string): Promise<void> {
    await this.expandItem(name);
    const details = this.page.getByRole("region", { name: `${name} details`, exact: true });
    await details.getByRole("button", { name: "Delete" }).click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("inventory.delete")),
      details.getByRole("button", { name: "Yes" }).click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectItemVisible(name: string): Promise<void> {
    await expect(this.inventoryPanel.getByLabel(`Toggle details for ${name}`)).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectItemHidden(name: string): Promise<void> {
    await expect(this.inventoryPanel.getByLabel(`Toggle details for ${name}`)).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectBadge(name: string, badge: string): Promise<void> {
    const itemRow = this.page.getByLabel(`Toggle details for ${name}`);
    await expect(itemRow.getByText(badge, { exact: true })).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectAttunementCount(text: string | RegExp): Promise<void> {
    await expect(this.inventoryPanel.getByText(text)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  // ── Navigation ──────────────────────────────────────────────────────

  async clickBackToDashboard(): Promise<void> {
    await this.backToDashboardLink.click();
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
  }
}
