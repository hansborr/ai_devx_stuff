import { expect, test } from "./fixtures.js";
import { setupApiUser } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Character data integrity", () => {
  // One self-seeding scenario against its own registered user — safe to fan
  // across workers despite the global fullyParallel:false.
  // (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  // The claim is about a character built through the *wizard*: its species,
  // proficiencies, and features all follow from choices the wizard makes, and
  // the API fixture cannot express the skill picks. So the eight former tests
  // stay one scenario over one wizard run rather than eight.
  test("wizard-created character's sheet reflects its build", async ({ browser }) => {
    const owner = await setupApiUser(browser, "data-integrity");
    const charName = uniqueName("IntegrityHero");
    const dashboard = new DashboardPO(owner.page);
    const sheet = new CharacterSheetPO(owner.page);

    try {
      await test.step("create character through wizard", async () => {
        const wizard = new CharacterWizardPO(owner.page);

        await dashboard.clickCreateCharacter();
        await wizard.createDefaultCharacter(charName);
        await dashboard.expectCharacterExists(charName);
      });

      await test.step("character sheet shows correct species badge", async () => {
        await dashboard.clickCharacterCard(charName);
        await sheet.expectSpeciesBadge("Human");
      });

      await test.step("character sheet shows correct saving throw proficiencies", async () => {
        await sheet.expectSavingThrowProficient("Strength");
        await sheet.expectSavingThrowProficient("Constitution");
        await sheet.expectSavingThrowNotProficient("Dexterity");
      });

      await test.step("character sheet shows background skill proficiencies", async () => {
        await sheet.expectSkillProficient("Athletics");
        await sheet.expectSkillProficient("Intimidation");
      });

      await test.step("character sheet shows class-selected skill proficiencies", async () => {
        await sheet.expectSkillProficient("Perception");
        await sheet.expectSkillProficient("Survival");
      });

      await test.step("sheet shows class features", async () => {
        await sheet.expectFeatureVisible("Fighting Style");
        await sheet.expectFeatureVisible("Second Wind");
        await sheet.expectFeatureVisible("Weapon Mastery");
      });

      await test.step("sheet shows armor and weapon proficiencies", async () => {
        await sheet.expectProficiencyVisible("Light Armor");
        await sheet.expectProficiencyVisible("Heavy Armor");
        await sheet.expectProficiencyVisible("Simple Weapons");
        await sheet.expectProficiencyVisible("Martial Weapons");
        await sheet.expectProficiencyVisible("Common");
      });

      await test.step("sheet shows background feat", async () => {
        await sheet.expectFeatureVisible("Savage Attacker");
      });
    } finally {
      await owner.teardown();
    }
  });
});

test.describe("Wizard validation", () => {
  test("proficiencies step blocks Continue when no skills selected", async ({
    userPage: { page },
  }) => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);

    await dashboard.clickCreateCharacter();

    // Species → Class → Background with boosts
    await wizard.clickCard("Human");
    await wizard.clickContinue();
    await wizard.clickCard("Fighter");
    await wizard.clickContinue();
    await wizard.clickCard("Soldier");
    await wizard.selectBoosts();
    await wizard.clickContinue();

    // Ability scores
    await wizard.fillAbilityScores();
    await wizard.clickContinue();

    // Proficiencies step — Continue should be disabled without skills
    await expect(page.getByText("Choose Proficiencies")).toBeVisible();
    await wizard.expectContinueDisabled();

    // Select one skill — should become enabled (Fighter needs >= 1)
    await wizard.selectProficiencies("Perception");
    await wizard.expectContinueEnabled({ timeout: 2_000 });
  });
});
