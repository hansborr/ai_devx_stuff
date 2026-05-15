import { test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

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
});
