import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import { setupUserWithCharacter } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";

test.describe("Spell management & rest mechanics", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let sheet: CharacterSheetPO;
  let context: BrowserContext | undefined;
  let charName: string;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, charName } = await setupUserWithCharacter(browser, {
      prefix: "spell",
      character: {
        name: uniqueName("SpellWiz"),
        speciesId: "species-human",
        classId: "class-wizard",
        backgroundId: "background-sage",
        strength: 8,
        dexterity: 14,
        constitution: 14,
        intelligence: 16,
        wisdom: 12,
        charisma: 10,
      },
    }));

    sheet = new CharacterSheetPO(page);
    await sheet.expectName(charName);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("spell panel is visible for a spellcaster", async () => {
    await expect(sheet.spells.spellsPanel).toBeVisible({ timeout: TIMEOUT_MEDIUM });
    await expect(sheet.spells.spellAbility).toBeVisible();
    await expect(sheet.spells.spellSaveDc).toBeVisible();
  });

  test("add a cantrip via add-spell dialog", async () => {
    await sheet.spells.addSpell("Cantrips", "Acid Splash");
  });

  test("add a level 1 spell", async () => {
    await sheet.spells.addSpell("1st Level", "Magic Missile");
  });

  test("prepare a level 1 spell", async () => {
    await sheet.spells.prepareSpell(1, "Magic Missile");
  });

  test("cast a level 1 spell and spell slot decrements", async () => {
    const [beforeAvailable] = await sheet.spells.getSpellSlotCount(1);
    await sheet.spells.castSpell(1, "Magic Missile");
    await sheet.spells.expectSpellSlotDecremented(1, beforeAvailable);
  });

  test("short rest completes successfully", async () => {
    await sheet.spells.performShortRest();
  });

  test("long rest restores spell slots", async () => {
    await sheet.spells.performLongRest();
    await sheet.spells.expectSpellSlotsRestored(1);
  });
});
