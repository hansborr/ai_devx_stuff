import { test } from "./fixtures.js";
import { setupCampaignOwner, setupDmAndPlayer } from "./helpers/campaign-setup.js";

test.describe("Dice roller", () => {
  // Every test seeds its own campaign chat, so no roll can leak into another
  // test's log — safe to fan across workers despite the global
  // fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("quick die button populates notation input", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "diceQuick",
      campaignPrefix: "DiceQuickCampaign",
      startTab: "Chat",
    });

    try {
      await owner.detail.chat.clickQuickDie("d20");
      await owner.detail.chat.expectDiceNotation("1d20");
    } finally {
      await owner.teardown();
    }
  });

  test("roll with quick button shows result in chat", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "diceRoll",
      campaignPrefix: "DiceRollCampaign",
      startTab: "Chat",
    });

    try {
      await owner.detail.chat.clickQuickDie("d20");
      await owner.detail.chat.clickRollDice();
      await owner.detail.chat.expectDiceRollInChat("1d20");
      await owner.detail.chat.expectDiceNotation("");
    } finally {
      await owner.teardown();
    }
  });

  test("empty notation disables roll button", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "diceEmpty",
      campaignPrefix: "DiceEmptyCampaign",
      startTab: "Chat",
    });

    try {
      // The notation input starts empty on a freshly seeded chat tab, so this
      // asserts the page's initial state rather than a manufactured one.
      await owner.detail.chat.expectRollButtonDisabled();
    } finally {
      await owner.teardown();
    }
  });

  test("a custom notation roll reaches the other player", async ({ browser }) => {
    const ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "diceDM",
      playerPrefix: "dicePlayer",
      campaignPrefix: "DiceCampaign",
      startTab: "Chat",
    });

    try {
      await test.step("roll with custom notation", async () => {
        await ctx.dmDetail.chat.fillDiceNotation("2d6+3");
        await ctx.dmDetail.chat.clickRollDice();
        await ctx.dmDetail.chat.expectDiceRollInChat("2d6+3");
      });

      await test.step("other player sees dice roll result", async () => {
        await ctx.playerDetail.chat.expectDiceRollInChat("2d6+3");
      });
    } finally {
      await ctx.teardown();
    }
  });
});
