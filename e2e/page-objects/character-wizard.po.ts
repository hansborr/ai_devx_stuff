import { expect, type Page } from "@playwright/test";

import { ABILITY_SCORES } from "../helpers/test-data.js";
import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Accessible name matcher for a spell/cantrip selection button. Concentration
 * spells render a trailing " C" badge inside the button (e.g. "Dancing Lights
 * C"), so an exact match fails. Anchor to the spell name and allow the optional
 * badge while still rejecting prefix collisions like "Light" vs "Lightning".
 */
function spellButtonName(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}( C)?$`);
}

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
  /** Cantrip names to choose on the Spells step (caster classes only). */
  cantrips?: string[];
  /** Level-1 spell names to choose on the Spells step (caster classes only). */
  spells?: string[];
}

export class CharacterWizardPO {
  constructor(private readonly page: Page) {}

  readonly continueButton = this.page.getByRole("button", { name: "Continue" });
  readonly manualEntryButton = this.page.getByRole("button", { name: "Manual Entry" });
  readonly boostPlus2 = this.page.getByRole("combobox", { name: "+2 Ability" });
  readonly boostPlus1 = this.page.getByRole("combobox", { name: "+1 Ability" });
  readonly boostFirst = this.page.getByRole("combobox", { name: "First +1" });
  readonly boostSecond = this.page.getByRole("combobox", { name: "Second +1" });
  readonly boostThird = this.page.getByRole("combobox", { name: "Third +1" });
  readonly boostModeTriple = this.page.getByText("+1 / +1 / +1");
  readonly charNameInput = this.page.getByLabel("Name *");
  readonly equipmentOptionA = this.page.getByText("Equipment Pack");
  readonly createCharacterButton = this.page.getByRole("button", { name: "Create Character" });

  /** Click a wizard card (species/class/background) by its heading text. */
  async clickCard(name: string): Promise<void> {
    const card = this.page
      .getByRole("button")
      .filter({ has: this.page.getByRole("heading", { name, exact: true }) });
    await expect(card).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
  }

  /** Click Continue and wait for the button to be enabled first. */
  async clickContinue(): Promise<void> {
    await this.expectContinueEnabled({ timeout: TIMEOUT_SHORT });
    await this.continueButton.click();
  }

  /** Assert the current step is incomplete: Continue is still disabled. */
  async expectContinueDisabled(): Promise<void> {
    await expect(this.continueButton).toBeDisabled();
  }

  /** Assert the current step is satisfied: Continue has become enabled. */
  async expectContinueEnabled(opts?: { timeout?: number }): Promise<void> {
    await expect(this.continueButton).toBeEnabled(opts);
  }

  /** Assert the wizard is showing its "step incomplete" hint under Continue. */
  async expectIncompleteStepHint(): Promise<void> {
    await expect(this.page.getByText("Complete this step to continue")).toBeVisible();
  }

  /** Assert the personality step is showing. */
  async expectPersonalityStep(): Promise<void> {
    await expect(this.page.getByText("Personality & Details")).toBeVisible();
  }

  /** Fill the ability scores step with default values (manual entry). */
  async fillAbilityScores(): Promise<void> {
    await expect(this.page.getByText("Set Ability Scores")).toBeVisible();
    await this.manualEntryButton.click();
    for (const { name, value } of ABILITY_SCORES) {
      await this.page.getByLabel(`${name} score`).fill(value);
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

  /**
   * Choose the +2 ability in the background step's +2/+1 mode. Waits for the
   * boost controls to render, so this is the first boost call on the step.
   */
  async selectPlus2Boost(ability: string): Promise<void> {
    await expect(this.boostPlus2).toBeVisible({ timeout: TIMEOUT_SHORT });
    await this.selectBoost(this.boostPlus2, ability);
  }

  /** Choose the +1 ability in the background step's +2/+1 mode. */
  async selectPlus1Boost(ability: string): Promise<void> {
    await this.selectBoost(this.boostPlus1, ability);
  }

  /** Switch the background step from the default +2/+1 mode to +1/+1/+1. */
  async selectTripleBoostMode(): Promise<void> {
    await this.boostModeTriple.click();
  }

  /** Choose the first ability in the background step's +1/+1/+1 mode. */
  async selectFirstBoost(ability: string): Promise<void> {
    await this.selectBoost(this.boostFirst, ability);
  }

  /** Choose the second ability in the background step's +1/+1/+1 mode. */
  async selectSecondBoost(ability: string): Promise<void> {
    await this.selectBoost(this.boostSecond, ability);
  }

  /** Choose the third ability in the background step's +1/+1/+1 mode. */
  async selectThirdBoost(ability: string): Promise<void> {
    await this.selectBoost(this.boostThird, ability);
  }

  private async selectBoost(locator: typeof this.boostPlus2, ability: string): Promise<void> {
    await locator.click();
    await this.page.getByRole("option", { name: ability }).click();
  }

  private async selectSplitBoosts(opts?: BoostOptions): Promise<void> {
    await this.selectPlus2Boost(opts?.plus2 ?? "STR");
    await this.selectPlus1Boost(opts?.plus1 ?? "CON");
  }

  private async selectTripleBoosts(opts?: BoostOptions): Promise<void> {
    await this.selectTripleBoostMode();
    await this.selectFirstBoost(opts?.first ?? "STR");
    await this.selectSecondBoost(opts?.second ?? "DEX");
    await this.selectThirdBoost(opts?.third ?? "CON");
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

  /** Select cantrips and level-1 spells on the Spells step (caster classes only). */
  async selectSpells(cantrips: string[], spells: string[]): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Choose Your Spells" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
    const cantripGroup = this.page.getByRole("group", { name: "Cantrips" });
    for (const name of cantrips) {
      await cantripGroup.getByRole("button", { name: spellButtonName(name) }).click();
    }
    const spellGroup = this.page.getByRole("group", { name: "Level 1 spells" });
    for (const name of spells) {
      await spellGroup.getByRole("button", { name: spellButtonName(name) }).click();
    }
  }

  /** Submit on the review step and wait for the resulting sheet to load. */
  async submitCreateToSheet(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("character.create")),
      this.createCharacterButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
    await expect(this.page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });
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

  /** Walk every wizard step up to (and including) the Review step. */
  private async fillWizardThroughReview(opts: CharacterBuildOptions): Promise<void> {
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
    // Step 6: Spells (caster classes only — non-casters skip this step)
    if (opts.cantrips || opts.spells) {
      await this.selectSpells(opts.cantrips ?? [], opts.spells ?? []);
      await this.clickContinue();
    }
    // Step 7: Personality
    await this.expectPersonalityStep();
    await this.setCharacterName(opts.name);
    await this.clickContinue();
    // Step 8: Review & Create
    await expect(this.page.getByText("Review & Create")).toBeVisible();
  }

  /** Run the full wizard flow with the given options, returning to dashboard. */
  async createCharacter(opts: CharacterBuildOptions): Promise<void> {
    await this.fillWizardThroughReview(opts);
    await this.submitCreate();
  }

  /** Run the full wizard flow and stay on the resulting character sheet. */
  async createCharacterToSheet(opts: CharacterBuildOptions): Promise<void> {
    await this.fillWizardThroughReview(opts);
    await this.submitCreateToSheet();
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
