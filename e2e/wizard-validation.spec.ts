import { expect, test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_SHORT } from "./helpers/timeouts.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Wizard step validation", () => {
  test("species step - cannot advance without selecting a species", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    await expect(wizard.continueButton).toBeDisabled();
    await expect(page.getByText("Complete this step to continue")).toBeVisible();
  });

  test("class step - cannot advance without selecting a class", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species step
    await wizard.clickCard("Human");
    await wizard.clickContinue();

    // Now on class step - Continue should be disabled
    await expect(wizard.continueButton).toBeDisabled();
    await expect(page.getByText("Complete this step to continue")).toBeVisible();
  });

  test("background step - cannot advance without selecting background and boosts", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species + class
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();

    // Now on background step - Continue should be disabled (no background selected)
    await expect(wizard.continueButton).toBeDisabled();

    // Select background but don't pick boosts - still disabled
    await wizard.clickCard("Soldier");
    await expect(wizard.continueButton).toBeDisabled();
  });

  test("background +2/+1 mode - must select BOTH +2 and +1 abilities to advance", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species + class
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();

    // Select background
    await wizard.clickCard("Soldier");

    // Select only +2 - should still be disabled
    await expect(wizard.boostPlus2).toBeVisible({ timeout: TIMEOUT_SHORT });
    await wizard.boostPlus2.click();
    await page.getByRole("option", { name: "STR" }).click();
    await expect(wizard.continueButton).toBeDisabled();

    // Now select +1 - should become enabled
    await wizard.boostPlus1.click();
    await page.getByRole("option", { name: "CON" }).click();
    await expect(wizard.continueButton).toBeEnabled();
  });

  test("background +1/+1/+1 mode - must select all three abilities to advance", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species + class
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();

    // Select background
    await wizard.clickCard("Soldier");

    // Switch to +1/+1/+1 mode
    await wizard.boostModeTriple.click();

    // Select only first +1 - should be disabled
    await wizard.boostFirst.click();
    await page.getByRole("option", { name: "STR" }).click();
    await expect(wizard.continueButton).toBeDisabled();

    // Select second +1 - still disabled
    await wizard.boostSecond.click();
    await page.getByRole("option", { name: "DEX" }).click();
    await expect(wizard.continueButton).toBeDisabled();

    // Select third +1 - should become enabled
    await wizard.boostThird.click();
    await page.getByRole("option", { name: "CON" }).click();
    await expect(wizard.continueButton).toBeEnabled();
  });

  test("personality step - cannot advance without entering a name", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species + class + background
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();
    await wizard.clickCard("Soldier");
    await wizard.selectBoosts();
    await wizard.clickContinue();

    // Pass abilities
    await wizard.fillAbilityScores();
    await wizard.clickContinue();

    // Pass proficiencies — Fighter requires 2 class skills
    await wizard.selectProficiencies("Perception", "Survival");
    await wizard.clickContinue();

    // Pass equipment (Option A selected by default)
    await wizard.selectEquipmentOption("A");
    await wizard.clickContinue();

    // Now on personality step - Continue should be disabled without a name
    await expect(page.getByText("Personality & Details")).toBeVisible();
    await expect(wizard.continueButton).toBeDisabled();

    // Enter a name - should become enabled
    await wizard.setCharacterName("Validation Hero");
    await expect(wizard.continueButton).toBeEnabled();
  });
});

test.describe.serial("Character creation with feat backgrounds", () => {
  test("create character with Sage background (Magic Initiate feat)", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("SageMage");

    await dashboard.clickCreateCharacter();
    await wizard.createCharacter({
      species: "Human",
      className: "Fighter",
      background: "Sage",
      skills: ["Perception", "Survival"],
      name: charName,
    });
    await dashboard.expectCharacterExists(charName);
  });

  test("create character with Soldier background (Savage Attacker feat)", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("SoldierBrute");

    await dashboard.clickCreateCharacter();
    await wizard.createCharacter({
      species: "Human",
      className: "Fighter",
      background: "Soldier",
      skills: ["Perception", "Survival"],
      name: charName,
    });
    await dashboard.expectCharacterExists(charName);
  });
});
