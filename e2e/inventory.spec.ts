import { test } from "./fixtures.js";
import { setupApiUser } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { CharacterWizardPO } from "./page-objects/character-wizard.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";

test.describe("Inventory management", () => {
  // One self-seeding scenario against its own registered user — safe to fan
  // across workers despite the global fullyParallel:false.
  // (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  // Kept as one scenario rather than seven seeded tests: the steps
  // progressively mutate a single item set, and the first assertion needs the
  // background starting equipment that only a wizard-created character gets
  // (`character.create` writes it only when the caller passes
  // `startingEquipment`, which the e2e fixture surface excludes on purpose).
  test("inventory items are added, edited, equipped, attuned, and deleted", async ({ browser }) => {
    const owner = await setupApiUser(browser, "inv");
    const charName = uniqueName("InvHero");
    const dashboard = new DashboardPO(owner.page);
    const wizard = new CharacterWizardPO(owner.page);
    const sheet = new CharacterSheetPO(owner.page);

    try {
      await test.step("create character through wizard", async () => {
        await dashboard.clickCreateCharacter();
        await wizard.createDefaultCharacter(charName);
        await dashboard.expectCharacterExists(charName);
        await dashboard.clickCharacterCard(charName);
        await sheet.expectName(charName);
      });

      await test.step("inventory panel shows starting equipment from background", async () => {
        await sheet.expectItemVisible("Spear");
      });

      await test.step("add an item to inventory", async () => {
        await sheet.clickAddItem();
        await sheet.fillItemForm({ name: "Longsword", type: "Weapon", weight: "3" });
        await sheet.submitAddItem();
        await sheet.expectItemVisible("Longsword");
      });

      await test.step("add a second item of different type", async () => {
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

      await test.step("edit an item name", async () => {
        await sheet.clickEditItem("Longsword");
        await sheet.fillEditForm({ name: "Greatsword" });
        await sheet.submitEditItem();
        await sheet.expectItemVisible("Greatsword");
        await sheet.expectItemHidden("Longsword");
      });

      await test.step("equip an item", async () => {
        await sheet.clickEquip("Greatsword");
        await sheet.expectBadge("Greatsword", "Equipped");
      });

      await test.step("attune an item", async () => {
        await sheet.clickAttune("Greatsword");
        await sheet.expectBadge("Greatsword", "Attuned");
        await sheet.expectAttunementCount(/1\/3 attuned/u);
      });

      await test.step("delete an item", async () => {
        await sheet.deleteItem("Healing Potion");
        await sheet.expectItemHidden("Healing Potion");
        await sheet.expectItemVisible("Greatsword");
      });
    } finally {
      await owner.teardown();
    }
  });
});
