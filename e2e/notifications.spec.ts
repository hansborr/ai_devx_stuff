import { type BrowserContext, type Page, test } from "./fixtures.js";
import {
  apiCreateCampaign,
  apiCreateInvite,
  apiLogin,
  apiRegister,
  createApiContext,
} from "./helpers/api.js";
import { loginViaUi } from "./helpers/auth.setup.js";
import { makeUser, uniqueName } from "./helpers/test-data.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";
import { NotificationPO } from "./page-objects/notification.po.js";

test.describe("Notifications", () => {
  test.describe.configure({ mode: "serial" });

  let dmContext: BrowserContext | undefined;
  let dmPage: Page;
  let dmNotifs: NotificationPO;
  let player1Context: BrowserContext | undefined;
  let player1Page: Page;
  let player2Context: BrowserContext | undefined;
  let player2Page: Page;
  let campaignName: string;
  let inviteCode: string;

  test.beforeAll(async ({ browser }) => {
    const dmUser = makeUser("notifDM");
    const player1User = makeUser("notifP1");
    const player2User = makeUser("notifP2");
    campaignName = uniqueName("NotifCampaign");

    // API setup
    const apiCtx = await createApiContext();
    await apiRegister(apiCtx, dmUser.email, dmUser.password, dmUser.displayName);
    await apiRegister(apiCtx, player1User.email, player1User.password, player1User.displayName);
    await apiRegister(apiCtx, player2User.email, player2User.password, player2User.displayName);

    const dmAuth = await apiLogin(apiCtx, dmUser.email, dmUser.password);
    const campaign = await apiCreateCampaign(apiCtx, dmAuth.accessToken, { name: campaignName });
    const invite = await apiCreateInvite(apiCtx, dmAuth.accessToken, {
      campaignId: campaign.id,
    });
    inviteCode = invite.code;
    await apiCtx.dispose();

    // Browser logins
    dmContext = await browser.newContext();
    dmPage = await dmContext.newPage();
    await loginViaUi(dmPage, dmUser.email, dmUser.password);
    dmNotifs = new NotificationPO(dmPage);

    player1Context = await browser.newContext();
    player1Page = await player1Context.newPage();
    await loginViaUi(player1Page, player1User.email, player1User.password);

    player2Context = await browser.newContext();
    player2Page = await player2Context.newPage();
    await loginViaUi(player2Page, player2User.email, player2User.password);
  });

  test.afterAll(async () => {
    await player1Context?.close();
    await player2Context?.close();
    await dmContext?.close();
  });

  test("bell shows no unread initially", async () => {
    await dmNotifs.expectUnreadCount(0);
    await dmNotifs.clickBell();
    await dmNotifs.expectEmpty();
    // Close popover
    await dmPage.keyboard.press("Escape");
  });

  test("notification appears when player joins campaign", async () => {
    // Player 1 joins
    const p1Campaigns = new CampaignsPO(player1Page);
    await p1Campaigns.goto();
    await p1Campaigns.joinCampaign(inviteCode);

    // DM should see unread count update (with fallback: reload if socket didn't deliver)
    await dmNotifs.expectUnreadCount(1);
  });

  test("popover lists the notification", async () => {
    await dmNotifs.clickBell();
    await dmNotifs.expectNotificationVisible("New member joined");
    await dmNotifs.expectUnreadDot();
  });

  test("clicking a notification marks it as read", async () => {
    await dmNotifs.clickNotification("New member joined");
    // Wait for mark-read response
    await dmPage.waitForResponse((r) => r.url().includes("notification.markRead"));
    await dmNotifs.expectNoUnreadDots();
    // Close popover
    await dmPage.keyboard.press("Escape");
    await dmNotifs.expectUnreadCount(0);
  });

  test("mark all read clears all unread", async () => {
    // Player 2 joins to generate another notification
    const p2Campaigns = new CampaignsPO(player2Page);
    await p2Campaigns.goto();
    await p2Campaigns.joinCampaign(inviteCode);

    // Wait for DM to see unread
    await dmNotifs.expectUnreadCount(1);

    await dmNotifs.clickBell();
    await dmNotifs.clickMarkAllRead();
    await dmNotifs.expectMarkAllReadHidden();
    // Close popover
    await dmPage.keyboard.press("Escape");
    await dmNotifs.expectUnreadCount(0);
  });
});
