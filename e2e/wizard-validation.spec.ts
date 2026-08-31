import { test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Wizard step validation", () => {
  // Fixture-isolated, non-mutating validation checks — safe to fan across
  // workers despite the global fullyParallel:false. Scoped to THIS describe
  // only: the "feat backgrounds" describe.serial block below creates
  // characters and must stay serial. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("species step - cannot advance without selecting a species", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    await wizard.expectContinueDisabled();
    await wizard.expectIncompleteStepHint();
  });

  test("class step - cannot advance without selecting a class", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    await dashboard.clickCreateCharacter();

    // Pass species step
    await wizard.clickCard("Human");
    await wizard.clickContinue();

    // Now on class step - Continue should be disabled
    await wizard.expectContinueDisabled();
    await wizard.expectIncompleteStepHint();
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
    await wizard.expectContinueDisabled();

    // Select background but don't pick boosts - still disabled
    await wizard.clickCard("Soldier");
    await wizard.expectContinueDisabled();
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
    await wizard.selectPlus2Boost("STR");
    await wizard.expectContinueDisabled();

    // Now select +1 - should become enabled
    await wizard.selectPlus1Boost("CON");
    await wizard.expectContinueEnabled();
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
    await wizard.selectTripleBoostMode();

    // Select only first +1 - should be disabled
    await wizard.selectFirstBoost("STR");
    await wizard.expectContinueDisabled();

    // Select second +1 - still disabled
    await wizard.selectSecondBoost("DEX");
    await wizard.expectContinueDisabled();

    // Select third +1 - should become enabled
    await wizard.selectThirdBoost("CON");
    await wizard.expectContinueEnabled();
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
    await wizard.expectPersonalityStep();
    await wizard.expectContinueDisabled();

    // Enter a name - should become enabled
    await wizard.setCharacterName("Validation Hero");
    await wizard.expectContinueEnabled();
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
