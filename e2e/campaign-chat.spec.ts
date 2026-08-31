import { test } from "./fixtures.js";
import { setupCampaignOwner, setupDmAndPlayer } from "./helpers/campaign-setup.js";

test.describe("Campaign chat", () => {
  // Every test seeds its own users and campaign, so no test can observe or
  // disturb another's chat history — safe to fan across workers despite the
  // global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("DM and player exchange messages", async ({ browser }) => {
    const ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "chatDM",
      playerPrefix: "chatPlayer",
      campaignPrefix: "ChatCampaign",
      startTab: "Chat",
    });
    const dmMessage = `Hello from DM ${String(Date.now())}`;
    const playerReply = `Reply from Player ${String(Date.now())}`;

    try {
      await test.step("chat tab shows empty state", async () => {
        await ctx.dmDetail.chat.expectChatEmpty();
      });

      await test.step("DM sends message and sees it", async () => {
        await ctx.dmDetail.chat.sendMessage(dmMessage);
        await ctx.dmDetail.chat.expectMessage(dmMessage);
      });

      await test.step("Player sees DM's message", async () => {
        await ctx.playerDetail.chat.expectMessage(dmMessage);
      });

      await test.step("Player sends reply and DM sees it", async () => {
        await ctx.playerDetail.chat.sendMessage(playerReply);
        await ctx.playerDetail.chat.expectMessage(playerReply);

        await ctx.dmDetail.chat.expectMessage(playerReply);
      });

      await test.step("messages show author name", async () => {
        await ctx.dmDetail.chat.expectMessageAuthor(dmMessage, ctx.dmUser.displayName);
        await ctx.dmDetail.chat.expectMessageAuthor(playerReply, ctx.playerUser.displayName);
      });
    } finally {
      await ctx.teardown();
    }
  });

  test("empty input disables send button", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "chatDisabled",
      campaignPrefix: "ChatDisabledCampaign",
      startTab: "Chat",
    });

    try {
      // The chat input starts empty on a freshly seeded chat tab, so this
      // asserts the page's initial state rather than a manufactured one.
      await owner.detail.chat.expectSendDisabled();
    } finally {
      await owner.teardown();
    }
  });

  test("chat input clears after sending", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "chatClears",
      campaignPrefix: "ChatClearsCampaign",
      startTab: "Chat",
    });

    try {
      await owner.detail.chat.sendMessage("clearing test");
      await owner.detail.chat.expectChatInputEmpty();
    } finally {
      await owner.teardown();
    }
  });
});
