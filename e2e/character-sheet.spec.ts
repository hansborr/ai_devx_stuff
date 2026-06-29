import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import { setupUserWithCharacter } from "./helpers/campaign-setup.js";
import { TIMEOUT_SHORT } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";

const LETHAL_DAMAGE_BUFFER = 100;

test.describe("Character sheet", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let charName: string;
  let sheet: CharacterSheetPO;
  let context: BrowserContext | undefined;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, charName } = await setupUserWithCharacter(browser, { prefix: "sheet" }));
    sheet = new CharacterSheetPO(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("displays correct character name", async () => {
    await sheet.expectName(charName);
  });

  test("HP damage reduces current HP", async () => {
    const before = await sheet.getCurrentHp();

    await sheet.damageHp(3);

    await sheet.expectCurrentHp(before - 3);
  });

  test("HP heal increases current HP", async () => {
    const before = await sheet.getCurrentHp();

    await sheet.healHp(2);

    await sheet.expectCurrentHp(before + 2);
  });

  test("Temp HP sets temporary hit points", async () => {
    await sheet.setTempHp(5);

    await sheet.expectTempHp(5);
  });

  test("death saves appear when HP reaches 0", async () => {
    const before = await sheet.getCurrentHp();

    await sheet.damageHp(before + LETHAL_DAMAGE_BUFFER);

    await sheet.expectCurrentHp(0);
    await expect(sheet.deathSaves).toBeVisible({ timeout: TIMEOUT_SHORT });
  });

  test("level up dialog advances character level", async () => {
    // Heal first so character is alive for level up
    await sheet.healHp(1);
    await sheet.expectLevel(1);

    await sheet.levelUpButton.click();
    await sheet.confirmLevelUp();

    await sheet.expectLevel(2);
  });

  test("inspiration toggle works", async () => {
    await sheet.toggleInspiration();
    await sheet.expectInspirationActive();
  });
});
