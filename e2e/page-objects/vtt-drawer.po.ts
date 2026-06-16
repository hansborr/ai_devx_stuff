import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

const CELL_SIZE_PX = 40;
const MIN_TOKEN_OPTIONS_IN_DROPDOWN = 2;
const CELL_CENTER_OFFSET = 0.5;

interface Cell {
  readonly x: number;
  readonly y: number;
}

/**
 * Page object for the in-map VTT drawer flow.
 *
 * The map canvas is Konva-rendered, so token interactions use known test token
 * cell coordinates rather than DOM text selectors inside the canvas.
 */
export class VttDrawerPO {
  readonly drawer: Locator;
  readonly mapCanvas: Locator;
  /** Konva marks its canvas container with role="presentation". */
  private readonly konvaContent: Locator;

  constructor(private readonly page: Page) {
    this.drawer = page.getByTestId("vtt-drawer");
    this.mapCanvas = page.getByTestId("combat-map-canvas");
    this.konvaContent = this.mapCanvas.getByRole("presentation");
  }

  async waitForMap(): Promise<void> {
    await expect(this.konvaContent).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async openMySheet(): Promise<void> {
    await this.page.getByTestId("vtt-action-bar-open-sheet").click();
    await this.expectCharacterDrawer();
  }

  /**
   * Pick a token from the open-sheet dropdown by its accessible name: the
   * character name, with the token label in parentheses when they differ.
   */
  async openMySheetFromDropdown(optionName: string): Promise<void> {
    const trigger = this.page.getByTestId("vtt-action-bar-open-sheet");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu", {
      timeout: TIMEOUT_SHORT,
    });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: TIMEOUT_SHORT,
    });
    const options = this.page.getByTestId("vtt-action-bar-token-option");
    await expect
      .poll(async () => options.count(), { timeout: TIMEOUT_SHORT })
      .toBeGreaterThanOrEqual(MIN_TOKEN_OPTIONS_IN_DROPDOWN);
    const option = this.page.getByRole("menuitem", { name: optionName, exact: true });
    await expect(option).toBeVisible({ timeout: TIMEOUT_SHORT });
    await option.click();
    await this.expectCharacterDrawer();
    await expect(trigger).toHaveAttribute("aria-expanded", "false", {
      timeout: TIMEOUT_SHORT,
    });
  }

  async openSheetFromToken(cell: Cell): Promise<void> {
    await this.openTokenContextMenu(cell);
    await this.page.getByRole("menuitem", { name: "Open sheet" }).click();
    await expect(this.drawer).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectNoOpenSheetForToken(cell: Cell): Promise<void> {
    await this.openTokenContextMenu(cell);
    await expect(this.page.getByRole("menuitem", { name: "Open sheet" })).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    await this.page.keyboard.press("Escape");
  }

  async closeDrawer(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await expect(this.drawer).not.toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectCharacterDrawer(): Promise<void> {
    await expect(this.drawer).toHaveAttribute("aria-label", "Character sheet", {
      timeout: TIMEOUT_MEDIUM,
    });
    await expect(this.page.getByTestId("actions-tab")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectReadOnly(): Promise<void> {
    await expect(this.page.getByTestId("vtt-drawer-readonly-badge")).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectEditable(): Promise<void> {
    await expect(this.page.getByTestId("vtt-drawer-readonly-badge")).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectNoActionEconomy(): Promise<void> {
    await expect(this.page.getByTestId("action-economy-strip")).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectMonsterDrawer(): Promise<void> {
    await expect(this.drawer).toHaveAttribute("aria-label", "Monster stat block", {
      timeout: TIMEOUT_MEDIUM,
    });
    await expect(this.page.getByTestId("vtt-drawer-dm-only-badge")).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async attackWithWeapon(weaponName: string, target: Cell): Promise<void> {
    await this.page.getByRole("button", { name: `Attack with ${weaponName}` }).click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.attemptAttack")),
      this.clickCell(target),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectCharacterDrawer();
  }

  async castSingleTargetSpell(spellName: string, target: Cell): Promise<void> {
    await this.page.getByRole("button", { name: `Cast ${spellName}` }).click();
    await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await this.page.getByTestId("cast-rail-place").click();
    await this.clickCell(target);
    const strip = this.page.getByTestId("confirm-cast-strip");
    await expect(strip).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
    await expect(strip).toContainText("1 target", { timeout: TIMEOUT_SHORT });
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("castSpell.cast")),
      this.page.getByTestId("confirm-cast-strip-confirm").click(),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectCharacterDrawer();
  }

  async castAoeSpell(
    spellName: string,
    slotLevel: number,
    placement: Cell,
    expectedTargetCount: number,
  ): Promise<void> {
    await this.page.getByRole("button", { name: `Cast ${spellName}` }).click();
    await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    const slot = this.page.getByTestId(`cast-rail-slot-${String(slotLevel)}`);
    await expect(slot).toBeVisible({ timeout: TIMEOUT_SHORT });
    await slot.click();
    await expect(slot).toHaveAttribute("data-selected", "true", { timeout: TIMEOUT_SHORT });
    await this.page.getByTestId("cast-rail-place").click();
    await this.clickCell(placement);
    const strip = this.page.getByTestId("confirm-cast-strip");
    await expect(strip).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    const targetLabel = `${String(expectedTargetCount)} target${
      expectedTargetCount === 1 ? "" : "s"
    }`;
    await expect(strip).toContainText(targetLabel, { timeout: TIMEOUT_SHORT });
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("castSpell.cast")),
      this.page.getByTestId("confirm-cast-strip-confirm").click(),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectCharacterDrawer();
  }

  async cancelConcentrationConflict(spellName: string): Promise<void> {
    await this.page.getByRole("button", { name: `Cast ${spellName}` }).click();
    await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await this.page.getByTestId("cast-rail-place").click();
    const modal = this.page.getByTestId("cast-rail-concentration-modal");
    await expect(modal).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.page.getByTestId("cast-rail-concentration-modal-cancel").click();
    await expect(modal).not.toBeVisible({ timeout: TIMEOUT_SHORT });
    await expect(this.page.getByTestId("confirm-cast-strip")).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  private async openTokenContextMenu(cell: Cell): Promise<void> {
    await this.waitForMap();
    await this.clickCell(cell, "right");
    await expect(this.page.getByRole("menu")).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  private async clickCell(cell: Cell, button: "left" | "right" = "left"): Promise<void> {
    const position = {
      x: (cell.x + CELL_CENTER_OFFSET) * CELL_SIZE_PX,
      y: (cell.y + CELL_CENTER_OFFSET) * CELL_SIZE_PX,
    };
    await this.konvaContent.click({ button, position });
  }
}
