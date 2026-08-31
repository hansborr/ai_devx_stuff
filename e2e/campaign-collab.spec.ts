import { expect, test } from "./fixtures.js";
import { apiCreateCampaign, apiCreateCharacter, createApiContext } from "./helpers/api.js";
import { setupApiUser, setupCampaignOwner } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { CampaignDetailPO } from "./page-objects/campaign-detail.po.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";
import { JoinPO } from "./page-objects/join.po.js";

test.describe("Campaign collaboration", () => {
  // Each test registers its own users and creates the campaign and invites it
  // acts on; the invalid-code contract is read-only — safe to fan across
  // workers despite the global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("DM invites a player who joins and assigns a character", async ({ browser }) => {
    const campaignName = uniqueName("CollabCampaign");
    const playerCharName = uniqueName("PlayerHero");

    const dm = await setupApiUser(browser, "dm");
    const player = await setupApiUser(browser, "player");

    const apiCtx = await createApiContext();
    await apiCreateCharacter(apiCtx, player.token, { name: playerCharName });
    const campaign = await apiCreateCampaign(apiCtx, dm.token, {
      name: campaignName,
      description: "Collaboration test campaign",
    });
    await apiCtx.dispose();

    const dmCampaigns = new CampaignsPO(dm.page);
    const dmDetail = new CampaignDetailPO(dm.page);
    const playerCampaigns = new CampaignsPO(player.page);
    const playerDetail = new CampaignDetailPO(player.page);
    let inviteCode = "";

    try {
      await dm.page.goto(`/campaigns/${campaign.id}`);

      await test.step("DM creates invite code", async () => {
        await dmDetail.clickTab("Members");
        await dmDetail.createInvite();
        inviteCode = await dmDetail.getInviteCode();
        expect(inviteCode).toBeTruthy();
      });

      await test.step("Player joins campaign via invite code", async () => {
        await playerCampaigns.goto();
        await playerCampaigns.joinCampaign(inviteCode);
        await playerCampaigns.expectCampaignExists(campaignName);
      });

      await test.step("Player appears in DM's member list", async () => {
        await dmCampaigns.goto();
        await dmCampaigns.clickCampaign(campaignName);
        await dmDetail.clickTab("Members");
        await dmDetail.expectMemberVisible(player.user.displayName);
      });

      await test.step("Player sees campaign with Player badge", async () => {
        await playerCampaigns.goto();
        await playerCampaigns.clickCampaign(campaignName);
        await playerDetail.expectPlayerBadge();
      });

      await test.step("Player does NOT see Settings tab", async () => {
        await playerDetail.expectTabHidden("Settings");
      });

      await test.step("Player assigns their character to campaign", async () => {
        await playerDetail.clickTab("Members");
        await playerDetail.assignCharacter(playerCharName);
        await playerDetail.expectMemberVisible(playerCharName);
      });

      await test.step("DM sees player's assigned character", async () => {
        await dmCampaigns.goto();
        await dmCampaigns.clickCampaign(campaignName);
        await dmDetail.clickTab("Members");
        await dmDetail.expectMemberVisible(playerCharName);
      });
    } finally {
      await player.teardown();
      await dm.teardown();
    }
  });

  test("Player joins via /join/:code URL", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "joinurlDM",
      campaignPrefix: "JoinUrlCampaign",
      startTab: "Members",
    });
    const joiner = await setupApiUser(browser, "joinurl");

    try {
      await owner.detail.createInvite();
      const directCode = await owner.detail.getInviteCode();

      const joinPO = new JoinPO(joiner.page);
      await joinPO.goto(directCode);
      await joinPO.expectInvitedTo(owner.campaignName);
      await joinPO.clickJoin();
      await joinPO.expectRedirectToCampaign();
    } finally {
      await joiner.teardown();
      await owner.teardown();
    }
  });

  test("joining with invalid code shows error", async ({ userPage: { page } }) => {
    const joinPO = new JoinPO(page);

    await joinPO.goto("BADCODE123");
    await joinPO.expectError(/invalid|expired|not found/iu);
  });

  test("DM revokes invite", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "revokeDM",
      campaignPrefix: "RevokeCampaign",
      startTab: "Members",
    });

    try {
      await owner.detail.createInvite();
      const codeToRevoke = await owner.detail.getInviteCode();
      await owner.detail.revokeInvite(codeToRevoke);
      await owner.detail.expectInviteGone(codeToRevoke);
    } finally {
      await owner.teardown();
    }
  });
});
