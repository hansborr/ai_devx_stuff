import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import { registerAndLogin } from "./helpers/auth.setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Character data integrity", () => {
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext | undefined;
  let page: Page;
  let charName: string;
  let sheet: CharacterSheetPO;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await registerAndLogin(page, "data-integrity");
    charName = uniqueName("IntegrityHero");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("create character through wizard", async () => {
    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);

    await dashboard.clickCreateCharacter();
    await wizard.createDefaultCharacter(charName);
    await dashboard.expectCharacterExists(charName);
  });

  test("character sheet shows correct species badge", async () => {
    const dashboard = new DashboardPO(page);
    await dashboard.clickCharacterCard(charName);
    sheet = new CharacterSheetPO(page);
    await sheet.expectSpeciesBadge("Human");
  });

  test("character sheet shows correct saving throw proficiencies", async () => {
    await sheet.expectSavingThrowProficient("Strength");
    await sheet.expectSavingThrowProficient("Constitution");
    await sheet.expectSavingThrowNotProficient("Dexterity");
  });

  test("character sheet shows background skill proficiencies", async () => {
    await sheet.expectSkillProficient("Athletics");
    await sheet.expectSkillProficient("Intimidation");
  });

  test("character sheet shows class-selected skill proficiencies", async () => {
    await sheet.expectSkillProficient("Perception");
    await sheet.expectSkillProficient("Survival");
  });

  test("sheet shows class features", async () => {
    await sheet.expectFeatureVisible("Fighting Style");
    await sheet.expectFeatureVisible("Second Wind");
    await sheet.expectFeatureVisible("Weapon Mastery");
  });

  test("sheet shows armor and weapon proficiencies", async () => {
    await sheet.expectProficiencyVisible("Light Armor");
    await sheet.expectProficiencyVisible("Heavy Armor");
    await sheet.expectProficiencyVisible("Simple Weapons");
    await sheet.expectProficiencyVisible("Martial Weapons");
  });

  test("sheet shows background feat", async () => {
    await sheet.expectFeatureVisible("Savage Attacker");
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
    await expect(wizard.continueButton).toBeDisabled();

    // Select one skill — should become enabled (Fighter needs >= 1)
    await page.getByRole("button", { name: "Perception", exact: true }).click();
    await expect(wizard.continueButton).toBeEnabled({ timeout: 2_000 });
  });
});
