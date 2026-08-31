import type { Browser } from "@playwright/test";

import { expect, test } from "./fixtures.js";
import type { ApiCreateCharacterOptions } from "./helpers/api.js";
import { setupUserWithCharacter } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";

/** A level 1 wizard: the minimum character with spell slots to spend. */
function wizardCharacter(): ApiCreateCharacterOptions {
  return {
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
  };
}

async function openWizardSheet(
  browser: Browser,
  prefix: string,
): Promise<{ teardown: () => Promise<void>; sheet: CharacterSheetPO }> {
  const { teardown, page, charName } = await setupUserWithCharacter(browser, {
    prefix,
    character: wizardCharacter(),
  });
  const sheet = new CharacterSheetPO(page);
  await sheet.expectName(charName);
  return { teardown, sheet };
}

test.describe("Spell management & rest mechanics", () => {
  // Each test seeds its own wizard, so known spells, prepared spells, and
  // spell-slot state stay private to it — safe to fan across workers despite
  // the global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("spell panel is visible for a spellcaster", async ({ browser }) => {
    const { teardown, sheet } = await openWizardSheet(browser, "spellPanel");

    try {
      await expect(sheet.spells.spellsPanel).toBeVisible({ timeout: TIMEOUT_MEDIUM });
      await expect(sheet.spells.spellAbility).toBeVisible();
      await expect(sheet.spells.spellSaveDc).toBeVisible();
    } finally {
      await teardown();
    }
  });

  test("short rest completes successfully", async ({ browser }) => {
    const { teardown, sheet } = await openWizardSheet(browser, "spellShortRest");

    try {
      await sheet.spells.performShortRest();
    } finally {
      await teardown();
    }
  });

  test("a leveled spell is learned, prepared, cast, and recovered", async ({ browser }) => {
    const { teardown, sheet } = await openWizardSheet(browser, "spellCast");

    try {
      await test.step("add a cantrip via add-spell dialog", async () => {
        await sheet.spells.addSpell("Cantrips", "Acid Splash");
      });

      await test.step("add a level 1 spell", async () => {
        await sheet.spells.addSpell("1st Level", "Magic Missile");
      });

      await test.step("prepare a level 1 spell", async () => {
        await sheet.spells.prepareSpell(1, "Magic Missile");
      });

      await test.step("cast a level 1 spell and spell slot decrements", async () => {
        const [beforeAvailable] = await sheet.spells.getSpellSlotCount(1);
        await sheet.spells.castSpell(1, "Magic Missile");
        await sheet.spells.expectSpellSlotDecremented(1, beforeAvailable);
      });

      await test.step("long rest restores spell slots", async () => {
        await sheet.spells.performLongRest();
        await sheet.spells.expectSpellSlotsRestored(1);
      });
    } finally {
      await teardown();
    }
  });
});
