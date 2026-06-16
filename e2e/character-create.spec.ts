import { expect, test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

const WIZARD_CANTRIPS = ["Acid Splash", "Chill Touch", "Dancing Lights"];
const WIZARD_LEVEL1_SPELLS = [
  "Alarm",
  "Burning Hands",
  "Charm Person",
  "Chromatic Orb",
  "Color Spray",
  "Comprehend Languages",
];

test.describe("Character creation wizard", () => {
  test("full wizard flow creates character and returns to dashboard", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("Hero");

    await dashboard.clickCreateCharacter();
    await wizard.createDefaultCharacter(charName);
    await dashboard.expectCharacterExists(charName);
  });

  test("character card appears on dashboard after creation", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("CardCheck");

    await dashboard.clickCreateCharacter();
    await wizard.createDefaultCharacter(charName);

    await dashboard.expectVisible();
    await dashboard.expectCharacterExists(charName);
  });

  test("non-caster flow skips the spell step", async ({ userPage: { page } }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("Fighter");

    await dashboard.clickCreateCharacter();
    // Walk to the equipment step, then advance: a fighter must land on the
    // Personality step, never the Spells step.
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();
    await wizard.clickCard("Soldier");
    await wizard.selectBoosts();
    await wizard.clickContinue();
    await wizard.fillAbilityScores();
    await wizard.clickContinue();
    await wizard.selectProficiencies("Perception", "Survival");
    await wizard.clickContinue();
    await wizard.selectEquipmentOption("A");
    await wizard.clickContinue();

    await expect(page.getByText("Personality & Details")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose Your Spells" })).toHaveCount(0);

    await wizard.setCharacterName(charName);
    await wizard.clickContinue();
    await wizard.submitCreate();
    await dashboard.expectCharacterExists(charName);
  });

  test("a level-1 wizard finishes creation with chosen spells on the sheet", async ({
    userPage: { page },
  }) => {
    const wizard = new CharacterWizardPO(page);
    const sheet = new CharacterSheetPO(page);
    const dashboard = new DashboardPO(page);
    const charName = uniqueName("Mithrandir");

    await dashboard.clickCreateCharacter();
    await wizard.createCharacterToSheet({
      species: "Human",
      className: "Wizard",
      background: "Sage",
      boosts: { mode: "+1/+1/+1", first: "INT", second: "CON", third: "DEX" },
      // Sage auto-grants Arcana + History, so those render as disabled
      // "(background)" buttons in the class-skill list. Pick two skills the
      // Wizard offers that the background does NOT already grant.
      skills: ["Investigation", "Insight"],
      name: charName,
      cantrips: WIZARD_CANTRIPS,
      spells: WIZARD_LEVEL1_SPELLS,
    });

    await sheet.expectName(charName);
    // The promised cantrips and spells are on the sheet, not "No spells known".
    await sheet.spells.expectSpellVisible("Acid Splash");
    await sheet.spells.expectSpellVisible("Burning Hands");
  });
});
