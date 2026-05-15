import { type BrowserContext, type Page, test } from "./fixtures.js";
import { createAuthenticatedContext } from "./helpers/auth.setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Inventory management", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let sheet: CharacterSheetPO;
  let context: BrowserContext | undefined;

  test.beforeAll(async ({ browser }) => {
    const auth = await createAuthenticatedContext(browser, "inv");
    context = auth.context;
    page = auth.page;

    const dashboard = new DashboardPO(page);
    const wizard = new CharacterWizardPO(page);
    const charName = uniqueName("InvHero");

    await dashboard.clickCreateCharacter();
    await wizard.createDefaultCharacter(charName);
    await dashboard.expectCharacterExists(charName);
    await dashboard.clickCharacterCard(charName);

    sheet = new CharacterSheetPO(page);
    await sheet.expectName(charName);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("inventory panel shows starting equipment from background", async () => {
    await sheet.expectItemVisible("Spear");
  });

  test("add an item to inventory", async () => {
    await sheet.clickAddItem();
    await sheet.fillItemForm({ name: "Longsword", type: "Weapon", weight: "3" });
    await sheet.submitAddItem();
    await sheet.expectItemVisible("Longsword");
  });

  test("add a second item of different type", async () => {
    await sheet.clickAddItem();
    await sheet.fillItemForm({
      name: "Healing Potion",
      type: "Consumable",
      quantity: "2",
      weight: "0.5",
    });
    await sheet.submitAddItem();
    await sheet.expectItemVisible("Healing Potion");
    await sheet.expectItemVisible("Longsword");
  });

  test("edit an item name", async () => {
    await sheet.clickEditItem("Longsword");
    await sheet.fillEditForm({ name: "Greatsword" });
    await sheet.submitEditItem();
    await sheet.expectItemVisible("Greatsword");
    await sheet.expectItemHidden("Longsword");
  });

  test("equip an item", async () => {
    await sheet.clickEquip("Greatsword");
    await sheet.expectBadge("Greatsword", "Equipped");
  });

  test("attune an item", async () => {
    await sheet.clickAttune("Greatsword");
    await sheet.expectBadge("Greatsword", "Attuned");
    await sheet.expectAttunementCount(/1\/3 attuned/);
  });

  test("delete an item", async () => {
    await sheet.deleteItem("Healing Potion");
    await sheet.expectItemHidden("Healing Potion");
    await sheet.expectItemVisible("Greatsword");
  });
});
