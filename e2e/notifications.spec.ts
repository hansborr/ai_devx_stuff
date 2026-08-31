import { test } from "./fixtures.js";
import {
  apiCreateCampaign,
  apiCreateInvite,
  apiJoinCampaign,
  createApiContext,
} from "./helpers/api.js";
import { openApiAuthedContext } from "./helpers/auth.setup.js";
import { registerApiUser, setupApiUser } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";
import { NotificationPO } from "./page-objects/notification.po.js";

/** Give `token`'s user a campaign and return an open invite code for it. */
async function seedInvitedCampaign(token: string, campaignPrefix: string): Promise<string> {
  const apiCtx = await createApiContext();
  try {
    const campaign = await apiCreateCampaign(apiCtx, token, {
      name: uniqueName(campaignPrefix),
    });
    const invite = await apiCreateInvite(apiCtx, token, { campaignId: campaign.id });
    return invite.code;
  } finally {
    await apiCtx.dispose();
  }
}

/** Register a player and join them to `inviteCode`'s campaign over the API. */
async function seedJoinedPlayer(prefix: string, inviteCode: string): Promise<void> {
  const { token } = await registerApiUser(prefix);
  const apiCtx = await createApiContext();
  try {
    await apiJoinCampaign(apiCtx, token, { code: inviteCode });
  } finally {
    await apiCtx.dispose();
  }
}

test.describe("Notifications", () => {
  // Each test registers its own DM and generates only that DM's
  // notifications — safe to fan across workers despite the global
  // fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("a join notification appears, lists, and marks as read", async ({ browser }) => {
    const dm = await setupApiUser(browser, "notifDM");
    const inviteCode = await seedInvitedCampaign(dm.token, "NotifCampaign");
    const player = await setupApiUser(browser, "notifP1");
    const dmNotifs = new NotificationPO(dm.page);

    try {
      await test.step("bell shows no unread initially", async () => {
        await dmNotifs.clickBell();
        await dmNotifs.expectEmpty();
        // Close popover
        await dm.page.keyboard.press("Escape");
        await dmNotifs.expectUnreadCount(0);
      });

      await test.step("notification appears when player joins campaign", async () => {
        const playerCampaigns = new CampaignsPO(player.page);
        await playerCampaigns.goto();
        await playerCampaigns.joinCampaign(inviteCode);

        // DM should see the unread count update over the socket.
        await dmNotifs.expectUnreadCount(1);
      });

      await test.step("popover lists the notification", async () => {
        await dmNotifs.clickBell();
        await dmNotifs.expectNotificationVisible("New member joined");
        await dmNotifs.expectUnreadDot();
      });

      await test.step("clicking a notification marks it as read", async () => {
        await dmNotifs.clickNotification("New member joined");
        // Wait for mark-read response
        await dm.page.waitForResponse((r) => r.url().includes("notification.markRead"));
        await dmNotifs.expectNoUnreadDots();
        // Close popover
        await dm.page.keyboard.press("Escape");
        await dmNotifs.expectUnreadCount(0);
      });
    } finally {
      await player.teardown();
      await dm.teardown();
    }
  });

  test("mark all read clears all unread", async ({ browser }) => {
    // This contract is about mark-all-read, not about live delivery (the
    // scenario above owns that), so the join is seeded *before* the DM's
    // browser opens: the mount fetch of `notification.list` then reports the
    // unread notification on its own. Opening the page first would make the
    // test hostage to whether the socket-connect refetch resolves before or
    // after the `notification:new` cache write
    // (packages/client/src/hooks/use-notifications.ts) — an ordering no
    // assertion on this page can wait out, since the bell renders its
    // zero-unread label while the list query is still loading.
    const dm = await registerApiUser("notifAllDM");
    const inviteCode = await seedInvitedCampaign(dm.token, "NotifAllCampaign");
    await seedJoinedPlayer("notifP2", inviteCode);

    const { context: dmContext, page: dmPage } = await openApiAuthedContext(browser, dm.user);
    const dmNotifs = new NotificationPO(dmPage);

    try {
      await dmNotifs.expectUnreadCount(1);

      await dmNotifs.clickBell();
      await dmNotifs.clickMarkAllRead();
      await dmNotifs.expectMarkAllReadHidden();
      // Close popover
      await dmPage.keyboard.press("Escape");
      await dmNotifs.expectUnreadCount(0);
    } finally {
      await dmContext.close();
    }
  });
});
