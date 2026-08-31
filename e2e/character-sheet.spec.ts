import { expect, test } from "./fixtures.js";
import { setupUserWithCharacter } from "./helpers/campaign-setup.js";
import { TIMEOUT_SHORT } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";

const LETHAL_DAMAGE_BUFFER = 100;

test.describe("Character sheet", () => {
  // Each test owns the character it edits, so HP, level, and inspiration
  // changes stay private to it — safe to fan across workers despite the
  // global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("displays correct character name", async ({ browser }) => {
    const { teardown, page, charName } = await setupUserWithCharacter(browser, {
      prefix: "sheetName",
    });
    const sheet = new CharacterSheetPO(page);

    try {
      await sheet.expectName(charName);
    } finally {
      await teardown();
    }
  });

  test("HP tracker applies damage, healing, temp HP, and death saves", async ({ browser }) => {
    const { teardown, page } = await setupUserWithCharacter(browser, { prefix: "sheetHp" });
    const sheet = new CharacterSheetPO(page);

    try {
      await test.step("HP damage reduces current HP", async () => {
        const before = await sheet.getCurrentHp();

        await sheet.damageHp(3);

        await sheet.expectCurrentHp(before - 3);
      });

      await test.step("HP heal increases current HP", async () => {
        const before = await sheet.getCurrentHp();

        await sheet.healHp(2);

        await sheet.expectCurrentHp(before + 2);
      });

      await test.step("Temp HP sets temporary hit points", async () => {
        await sheet.setTempHp(5);

        await sheet.expectTempHp(5);
      });

      await test.step("death saves appear when HP reaches 0", async () => {
        const before = await sheet.getCurrentHp();

        await sheet.damageHp(before + LETHAL_DAMAGE_BUFFER);

        await sheet.expectCurrentHp(0);
        await expect(sheet.deathSaves).toBeVisible({ timeout: TIMEOUT_SHORT });
      });
    } finally {
      await teardown();
    }
  });

  test("level up dialog advances character level", async ({ browser }) => {
    const { teardown, page } = await setupUserWithCharacter(browser, { prefix: "sheetLevel" });
    const sheet = new CharacterSheetPO(page);

    try {
      await sheet.expectLevel(1);

      await sheet.levelUpButton.click();
      await sheet.confirmLevelUp();

      await sheet.expectLevel(2);
    } finally {
      await teardown();
    }
  });

  test("inspiration toggle works", async ({ browser }) => {
    const { teardown, page } = await setupUserWithCharacter(browser, { prefix: "sheetInsp" });
    const sheet = new CharacterSheetPO(page);

    try {
      await sheet.toggleInspiration();
      await sheet.expectInspirationActive();
    } finally {
      await teardown();
    }
  });
});
