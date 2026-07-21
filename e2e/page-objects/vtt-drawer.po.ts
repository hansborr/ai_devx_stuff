import { expect, type Locator, type Page, type Request } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";
import { type BrowserCombatSpellResponse, readCombatSpellResponse } from "./vtt-drawer-response.js";

// Mirrors client DEFAULT_CELL_SIZE_PX in packages/client/src/stores/map-canvas-store.ts; keep in lockstep if that default changes.
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

  async castSingleTargetCombatSpell(
    spellName: string,
    target: Cell,
  ): Promise<BrowserCombatSpellResponse> {
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
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.castCombatSpell")),
      this.page.getByTestId("confirm-cast-strip-confirm").click(),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectCharacterDrawer();
    return readCombatSpellResponse(await resp.json());
  }

  async castSingleTargetCombatSpellUntilDamage(
    spellName: string,
    target: Cell,
    expectedTargetParticipantId: string,
    maximumAttempts: number,
  ): Promise<{ attempts: number; totalDamage: number }> {
    let attempts = 0;
    let totalDamage = 0;
    while (attempts < maximumAttempts && totalDamage === 0) {
      const result = await this.castSingleTargetCombatSpell(spellName, target);
      expect(result.spellResults).toHaveLength(1);
      const spellResult = result.spellResults[0];
      if (!spellResult) throw new Error(`${spellName} returned no spell result`);
      expect(spellResult.type).toBe("spellAttack");
      expect(spellResult.targetParticipantId).toBe(expectedTargetParticipantId);
      totalDamage += spellResult.totalDamage;
      attempts += 1;
    }
    return { attempts, totalDamage };
  }

  async castAoeCombatSpell(
    spellName: string,
    slotLevel: number,
    placement: Cell,
    minimumTargetCount: number,
  ): Promise<BrowserCombatSpellResponse> {
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
    const targetCount = await readTargetCount(strip);
    expect(targetCount).toBeGreaterThanOrEqual(minimumTargetCount);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.castCombatSpell")),
      this.page.getByTestId("confirm-cast-strip-confirm").click(),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectCharacterDrawer();
    const result = readCombatSpellResponse(await resp.json());
    expect(result.spellResults).toHaveLength(targetCount);
    return result;
  }

  async castAoeSpellCastOnly(
    spellName: string,
    slotLevel: number,
    placement: Cell,
    expectedTargetCount: number,
  ): Promise<void> {
    let combatRequests = 0;
    const trackCombatRequest = (request: Request): void => {
      if (request.url().includes("encounterCombat.castCombatSpell")) combatRequests += 1;
    };
    this.page.on("request", trackCombatRequest);
    try {
      await this.page.getByRole("button", { name: `Cast ${spellName}` }).click();
      await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
      const slot = this.page.getByTestId(`cast-rail-slot-${String(slotLevel)}`);
      await expect(slot).toBeVisible({ timeout: TIMEOUT_SHORT });
      await slot.click();
      await this.page.getByTestId("cast-rail-place").click();
      await this.clickCell(placement);
      const strip = this.page.getByTestId("confirm-cast-strip");
      await expect(strip).toContainText(`${String(expectedTargetCount)} target`, {
        timeout: TIMEOUT_MEDIUM,
      });
      const [resp] = await Promise.all([
        this.page.waitForResponse((r) => r.url().includes("castSpell.cast")),
        this.page.getByTestId("confirm-cast-strip-confirm").click(),
      ]);
      expect(resp.ok()).toBe(true);
      await this.expectCharacterDrawer();
    } finally {
      this.page.off("request", trackCombatRequest);
    }
    expect(combatRequests).toBe(0);
  }

  async castSingleSpellCastOnly(spellName: string): Promise<void> {
    let combatRequests = 0;
    const trackCombatRequest = (request: Request): void => {
      if (request.url().includes("encounterCombat.castCombatSpell")) combatRequests += 1;
    };
    this.page.on("request", trackCombatRequest);
    try {
      await this.page.getByRole("button", { name: `Cast ${spellName}` }).click();
      await expect(this.page.getByTestId("cast-rail")).toBeVisible({ timeout: TIMEOUT_MEDIUM });
      await this.page.getByTestId("cast-rail-place").click();
      const strip = this.page.getByTestId("confirm-cast-strip");
      await expect(strip).toContainText("no target", { timeout: TIMEOUT_MEDIUM });
      const [resp] = await Promise.all([
        this.page.waitForResponse((r) => r.url().includes("castSpell.cast")),
        this.page.getByTestId("confirm-cast-strip-confirm").click(),
      ]);
      expect(resp.ok()).toBe(true);
      await this.expectCharacterDrawer();
    } finally {
      this.page.off("request", trackCombatRequest);
    }
    expect(combatRequests).toBe(0);
  }

  async expectExactlyOneMonsterAttack(actionName: string): Promise<void> {
    const attackControls = this.drawer.getByRole("button", { name: /^Attack with / });
    await expect(attackControls).toHaveCount(1);
    await expect(
      this.drawer.getByRole("button", { name: `Attack with ${actionName}`, exact: true }),
    ).toHaveCount(1);
  }

  async expectNoMonsterAttackControls(): Promise<void> {
    await expect(this.drawer.getByRole("button", { name: /^Attack with / })).toHaveCount(0);
  }

  async attackWithMonsterAction(actionName: string, target: Cell): Promise<void> {
    await this.expectExactlyOneMonsterAttack(actionName);
    await this.page.getByRole("button", { name: `Attack with ${actionName}` }).click();
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("encounterCombat.attemptAttack")),
      this.clickCell(target),
    ]);
    expect(resp.ok()).toBe(true);
    await this.expectMonsterDrawer();
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

async function readTargetCount(strip: Locator): Promise<number> {
  await expect(strip).toContainText(/\d+ targets?/, { timeout: TIMEOUT_MEDIUM });
  const match = (await strip.textContent())?.match(/(\d+) targets?/);
  if (!match?.[1]) throw new Error("Confirm cast strip did not expose a target count");
  return Number.parseInt(match[1], 10);
}
