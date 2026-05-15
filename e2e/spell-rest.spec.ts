import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import { apiCreateCharacter, apiLogin, apiRegister, createApiContext } from "./helpers/api.js";
import { loginViaUi } from "./helpers/auth.setup.js";
import { makeUser, uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";

test.describe("Spell management & rest mechanics", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let sheet: CharacterSheetPO;
  let context: BrowserContext | undefined;
  let charName: string;

  test.beforeAll(async ({ browser }) => {
    const user = makeUser("spell");
    charName = uniqueName("SpellWiz");

    // API setup
    const apiCtx = await createApiContext();
    await apiRegister(apiCtx, user.email, user.password, user.displayName);
    const auth = await apiLogin(apiCtx, user.email, user.password);
    await apiCreateCharacter(apiCtx, auth.accessToken, {
      name: charName,
      speciesId: "species-human",
      classId: "class-wizard",
      backgroundId: "background-sage",
      strength: 8,
      dexterity: 14,
      constitution: 14,
      intelligence: 16,
      wisdom: 12,
      charisma: 10,
    });
    await apiCtx.dispose();

    // Browser login
    context = await browser.newContext();
    page = await context.newPage();
    await loginViaUi(page, user.email, user.password);

    // Navigate via SPA link (avoids full-page reload batch query limit)
    await page.getByRole("link", { name: charName }).click();
    await expect(page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });

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
    const spellName = await sheet.spells.addSpellByLevel("Cantrips");
    expect(spellName).toBeTruthy();
  });

  test("add a level 1 spell", async () => {
    const spellName = await sheet.spells.addSpellByLevel("1st Level");
    expect(spellName).toBeTruthy();
  });

  test("prepare a level 1 spell", async () => {
    await sheet.spells.prepareSpell(1);
  });

  test("cast a level 1 spell and spell slot decrements", async () => {
    const [beforeAvailable] = await sheet.spells.getSpellSlotCount(1);
    await sheet.spells.castSpell(1);
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
