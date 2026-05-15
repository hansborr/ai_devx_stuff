import { test } from "./fixtures.js";
import { type DmPlayerCampaign, setupDmAndPlayer } from "./helpers/campaign-setup.js";

test.describe("Dice roller", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: DmPlayerCampaign;

  test.beforeAll(async ({ browser }) => {
    ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "diceDM",
      playerPrefix: "dicePlayer",
      campaignPrefix: "DiceCampaign",
      startTab: "Chat",
    });
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("quick die button populates notation input", async () => {
    await ctx.dmDetail.chat.clickQuickDie("d20");
    await ctx.dmDetail.chat.expectDiceNotation("1d20");
  });

  test("roll with quick button shows result in chat", async () => {
    await ctx.dmDetail.chat.clearDiceNotation();
    await ctx.dmDetail.chat.clickQuickDie("d20");
    await ctx.dmDetail.chat.clickRollDice();
    await ctx.dmDetail.chat.expectDiceRollInChat("1d20");
    await ctx.dmDetail.chat.expectDiceNotation("");
  });

  test("roll with custom notation", async () => {
    await ctx.dmDetail.chat.fillDiceNotation("2d6+3");
    await ctx.dmDetail.chat.clickRollDice();
    await ctx.dmDetail.chat.expectDiceRollInChat("2d6+3");
  });

  test("other player sees dice roll result", async () => {
    await ctx.playerDetail.chat.expectDiceRollInChat("2d6+3");
  });

  test("empty notation disables roll button", async () => {
    await ctx.dmDetail.chat.clearDiceNotation();
    await ctx.dmDetail.chat.expectRollButtonDisabled();
  });
});
