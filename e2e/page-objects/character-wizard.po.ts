import { expect, type Page } from "@playwright/test";

import { ABILITY_SCORES } from "../helpers/test-data.js";
import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

export interface BoostOptions {
  mode?: "+2/+1" | "+1/+1/+1";
  plus2?: string;
  plus1?: string;
  first?: string;
  second?: string;
  third?: string;
}

export interface CharacterBuildOptions {
  species: string;
  className: string;
  background: string;
  boosts?: BoostOptions;
  skills: string[];
  equipmentOption?: "A" | "B";
  name: string;
}

export class CharacterWizardPO {
  constructor(private readonly page: Page) {}

  readonly continueButton = this.page.getByRole("button", { name: "Continue" });
  readonly manualEntryButton = this.page.getByRole("button", { name: "Manual Entry" });
  readonly boostPlus2 = this.page.locator("#boost-plus-2");
  readonly boostPlus1 = this.page.locator("#boost-plus-1");
  readonly boostFirst = this.page.locator("#boost-first");
  readonly boostSecond = this.page.locator("#boost-second");
  readonly boostThird = this.page.locator("#boost-third");
  readonly boostModeTriple = this.page.getByText("+1 / +1 / +1");
  readonly charNameInput = this.page.locator("#char-name");
  readonly equipmentOptionA = this.page.getByText("Equipment Pack");
  readonly createCharacterButton = this.page.getByRole("button", { name: "Create Character" });

  /** Click a wizard card (species/class/background) by its heading text. */
  async clickCard(name: string): Promise<void> {
    const card = this.page
      .locator('[role="button"][aria-pressed]')
      .filter({ has: this.page.getByRole("heading", { name, exact: true }) })
      .first();
    await expect(card).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
  }

  /** Click Continue and wait for the button to be enabled first. */
  async clickContinue(): Promise<void> {
    await expect(this.continueButton).toBeEnabled({ timeout: TIMEOUT_SHORT });
    await this.continueButton.click();
  }

  /** Fill the ability scores step with default values (manual entry). */
  async fillAbilityScores(): Promise<void> {
    await expect(this.page.getByText("Set Ability Scores")).toBeVisible();
    await this.manualEntryButton.click();
    for (const { name, value } of ABILITY_SCORES) {
      const card = this.page.locator(".bg-surface").filter({ hasText: name });
      await card.locator('input[type="number"]').fill(value);
    }
  }

  /** Select background ability boosts. Defaults to +2 STR / +1 CON. */
  async selectBoosts(opts?: BoostOptions): Promise<void> {
    const mode = opts?.mode ?? "+2/+1";

    if (mode === "+2/+1") {
      await this.selectSplitBoosts(opts);
      return;
    }

    await this.selectTripleBoosts(opts);
  }

  private async selectBoost(locator: typeof this.boostPlus2, ability: string): Promise<void> {
    await locator.click();
    await this.page.getByRole("option", { name: ability }).click();
  }

  private async selectSplitBoosts(opts?: BoostOptions): Promise<void> {
    await expect(this.boostPlus2).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.selectBoost(this.boostPlus2, opts?.plus2 ?? "STR");
    await this.selectBoost(this.boostPlus1, opts?.plus1 ?? "CON");
  }

  private async selectTripleBoosts(opts?: BoostOptions): Promise<void> {
    await this.boostModeTriple.click();
    await this.selectBoost(this.boostFirst, opts?.first ?? "STR");
    await this.selectBoost(this.boostSecond, opts?.second ?? "DEX");
    await this.selectBoost(this.boostThird, opts?.third ?? "CON");
  }

  /** Set the character name on the personality step. */
  async setCharacterName(name: string): Promise<void> {
    await this.charNameInput.fill(name);
  }

  /** Click skill buttons by name on the proficiencies step. */
  async selectProficiencies(...skills: string[]): Promise<void> {
    await expect(this.page.getByText("Choose Proficiencies")).toBeVisible();
    for (const skill of skills) {
      await this.page.getByRole("button", { name: skill, exact: true }).click();
    }
  }

  /** Select equipment option on the equipment step. Defaults to Option A (equipment pack). */
  async selectEquipmentOption(option: "A" | "B" = "A"): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Starting Equipment" })).toBeVisible();
    const label = option === "A" ? "Equipment Pack" : "Gold Only";
    await this.page.getByText(label).click();
  }

  /** Submit on the review step and wait for API success. */
  async submitCreate(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("character.create")),
      this.createCharacterButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
    await expect(this.page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });
    // Navigate back to dashboard so callers that check the character list still work
    await this.page.goto("/dashboard");
    // Wait for the dashboard heading, not just the URL. The full page reload
    // triggers a refresh-token rotation; we must wait for auth to complete
    // (AuthGuard renders children) before any subsequent navigation, otherwise
    // the next page.goto() aborts the in-flight Set-Cookie response and the
    // rotated token is lost.
    await expect(this.page.getByRole("heading", { name: "Your Tables" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  /** Run the full wizard flow with the given options. */
  async createCharacter(opts: CharacterBuildOptions): Promise<void> {
    // Step 0: Species
    await this.clickCard(opts.species);
    await this.clickContinue();
    // Step 1: Class
    await this.clickCard(opts.className);
    await this.clickContinue();
    // Step 2: Background + boosts
    await this.clickCard(opts.background);
    await this.selectBoosts(opts.boosts);
    await this.clickContinue();
    // Step 3: Ability scores
    await this.fillAbilityScores();
    await this.clickContinue();
    // Step 4: Proficiencies
    await this.selectProficiencies(...opts.skills);
    await this.clickContinue();
    // Step 5: Equipment (Option A is selected by default)
    await this.selectEquipmentOption("A");
    await this.clickContinue();
    // Step 6: Personality
    await expect(this.page.getByText("Personality & Details")).toBeVisible();
    await this.setCharacterName(opts.name);
    await this.clickContinue();
    // Step 7: Review & Create
    await expect(this.page.getByText("Review & Create")).toBeVisible();
    await this.submitCreate();
  }

  /**
   * Run the full wizard flow: Human Fighter Soldier with default ability scores.
   */
  async createDefaultCharacter(charName: string): Promise<void> {
    await this.createCharacter({
      species: "Human",
      className: "Fighter",
      background: "Soldier",
      skills: ["Perception", "Survival"],
      name: charName,
    });
  }
}
