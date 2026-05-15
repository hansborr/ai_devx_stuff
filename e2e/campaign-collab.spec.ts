import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import {
  apiCreateCampaign,
  apiCreateCharacter,
  apiLogin,
  apiRegister,
  createApiContext,
  DEFAULT_CHARACTER_INPUT,
} from "./helpers/api.js";
import { createAuthenticatedContext, loginViaUi } from "./helpers/auth.setup.js";
import { makeUser, type TestUser, uniqueName } from "./helpers/test-data.js";
import { CampaignDetailPO } from "./page-objects/campaign-detail.po.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";
import { JoinPO } from "./page-objects/join.po.js";

test.describe("Campaign collaboration", () => {
  test.describe.configure({ mode: "serial" });

  // DM context
  let dmContext: BrowserContext | undefined;
  let dmPage: Page;
  let dmUser: TestUser;
  let dmCampaigns: CampaignsPO;
  let dmDetail: CampaignDetailPO;

  // Player context
  let playerContext: BrowserContext | undefined;
  let playerPage: Page;
  let playerUser: TestUser;
  let playerCampaigns: CampaignsPO;
  let playerDetail: CampaignDetailPO;

  let campaignName: string;
  let campaignId: string;
  let dmCharName: string;
  let playerCharName: string;
  let inviteCode: string;

  test.beforeAll(async ({ browser }) => {
    dmUser = makeUser("dm");
    playerUser = makeUser("player");
    campaignName = uniqueName("CollabCampaign");
    dmCharName = uniqueName("DmHero");
    playerCharName = uniqueName("PlayerHero");

    // API setup
    const apiCtx = await createApiContext();
    await apiRegister(apiCtx, dmUser.email, dmUser.password, dmUser.displayName);
    await apiRegister(apiCtx, playerUser.email, playerUser.password, playerUser.displayName);

    const dmAuth = await apiLogin(apiCtx, dmUser.email, dmUser.password);
    const playerAuth = await apiLogin(apiCtx, playerUser.email, playerUser.password);

    await apiCreateCharacter(apiCtx, dmAuth.accessToken, {
      name: dmCharName,
      ...DEFAULT_CHARACTER_INPUT,
    });
    await apiCreateCharacter(apiCtx, playerAuth.accessToken, {
      name: playerCharName,
      ...DEFAULT_CHARACTER_INPUT,
    });

    const campaign = await apiCreateCampaign(apiCtx, dmAuth.accessToken, {
      name: campaignName,
      description: "Collaboration test campaign",
    });
    campaignId = campaign.id;
    await apiCtx.dispose();

    // Browser login — DM
    dmContext = await browser.newContext();
    dmPage = await dmContext.newPage();
    await loginViaUi(dmPage, dmUser.email, dmUser.password);
    await dmPage.goto(`/campaigns/${campaignId}`);
    dmCampaigns = new CampaignsPO(dmPage);
    dmDetail = new CampaignDetailPO(dmPage);

    // Browser login — Player
    playerContext = await browser.newContext();
    playerPage = await playerContext.newPage();
    await loginViaUi(playerPage, playerUser.email, playerUser.password);
    playerCampaigns = new CampaignsPO(playerPage);
    playerDetail = new CampaignDetailPO(playerPage);
  });

  test.afterAll(async () => {
    await playerContext?.close();
    await dmContext?.close();
  });

  test("DM creates invite code", async () => {
    await dmDetail.clickTab("Members");
    await dmDetail.createInvite();
    inviteCode = await dmDetail.getInviteCode();
    expect(inviteCode).toBeTruthy();
  });

  test("Player joins campaign via invite code", async () => {
    await playerCampaigns.goto();
    await playerCampaigns.joinCampaign(inviteCode);
    await playerCampaigns.expectCampaignExists(campaignName);
  });

  test("Player appears in DM's member list", async () => {
    await dmCampaigns.goto();
    await dmCampaigns.clickCampaign(campaignName);
    await dmDetail.clickTab("Members");
    await dmDetail.expectMemberVisible(playerUser.displayName);
  });

  test("Player sees campaign with Player badge", async () => {
    await playerCampaigns.goto();
    await playerCampaigns.clickCampaign(campaignName);
    await playerDetail.expectPlayerBadge();
  });

  test("Player does NOT see Settings tab", async () => {
    await playerDetail.expectTabHidden("Settings");
  });

  test("Player assigns their character to campaign", async () => {
    await playerDetail.clickTab("Members");
    await playerDetail.assignCharacter(playerCharName);
    await playerDetail.expectMemberVisible(playerCharName);
  });

  test("DM sees player's assigned character", async () => {
    await dmCampaigns.goto();
    await dmCampaigns.clickCampaign(campaignName);
    await dmDetail.clickTab("Members");
    await dmDetail.expectMemberVisible(playerCharName);
  });

  test("Player joins via /join/:code URL", async ({ browser }) => {
    // DM creates another invite for the direct-URL test
    await dmDetail.clickTab("Members");
    await dmDetail.createInvite();
    const directCode = await dmDetail.getInviteCode();

    // Create a new player context
    const newPlayerCtx = await createAuthenticatedContext(browser, "joinurl");
    const joinPO = new JoinPO(newPlayerCtx.page);

    await joinPO.goto(directCode);
    await joinPO.expectRedirectToCampaign();

    await newPlayerCtx.context.close();
  });

  test("joining with invalid code shows error", async ({ browser }) => {
    const tempCtx = await createAuthenticatedContext(browser, "badcode");
    const joinPO = new JoinPO(tempCtx.page);

    await joinPO.goto("BADCODE123");
    await joinPO.expectError(/invalid|expired|not found/i);

    await tempCtx.context.close();
  });

  test("DM revokes invite", async () => {
    await dmCampaigns.goto();
    await dmCampaigns.clickCampaign(campaignName);
    await dmDetail.clickTab("Members");
    await dmDetail.createInvite();
    const codeToRevoke = await dmDetail.getInviteCode();
    await dmDetail.revokeInvite(codeToRevoke);
    await dmDetail.expectInviteGone(codeToRevoke);
  });
});
