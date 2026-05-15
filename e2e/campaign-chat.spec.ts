import { expect, test } from "./fixtures.js";
import { type DmPlayerCampaign, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { TIMEOUT_SHORT } from "./helpers/timeouts.js";

test.describe("Campaign chat", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: DmPlayerCampaign;
  let dmDisplayName: string;
  let playerDisplayName: string;
  let dmMessage: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "chatDM",
      playerPrefix: "chatPlayer",
      campaignPrefix: "ChatCampaign",
      startTab: "Chat",
    });
    dmDisplayName = ctx.dmUser.displayName;
    playerDisplayName = ctx.playerUser.displayName;
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("chat tab shows empty state", async () => {
    await ctx.dmDetail.chat.expectChatEmpty();
  });

  test("DM sends message and sees it", async () => {
    dmMessage = `Hello from DM ${String(Date.now())}`;
    await ctx.dmDetail.chat.sendMessage(dmMessage);
    await ctx.dmDetail.chat.expectMessage(dmMessage);
  });

  test("Player sees DM's message", async () => {
    await ctx.playerDetail.chat.expectMessage(dmMessage);
  });

  test("Player sends reply and DM sees it", async () => {
    const reply = `Reply from Player ${String(Date.now())}`;
    await ctx.playerDetail.chat.sendMessage(reply);
    await ctx.playerDetail.chat.expectMessage(reply);

    await ctx.dmDetail.chat.expectMessage(reply);
  });

  test("messages show author name", async () => {
    await expect(ctx.dmDetail.chat.chatMessages.getByText(dmDisplayName).first()).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
    await expect(ctx.dmDetail.chat.chatMessages.getByText(playerDisplayName).first()).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  });

  test("empty input disables send button", async () => {
    await ctx.dmDetail.chat.chatInput.fill("");
    await ctx.dmDetail.chat.expectSendDisabled();
  });

  test("chat input clears after sending", async () => {
    await ctx.dmDetail.chat.sendMessage("clearing test");
    await ctx.dmDetail.chat.expectChatInputEmpty();
  });
});
