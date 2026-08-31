import { expect, test } from "./fixtures.js";
import { setupApiUser, setupCampaignOwner } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CampaignDetailPO } from "./page-objects/campaign-detail.po.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";

test.describe("Campaign lifecycle", () => {
  // The lifecycle scenario owns the only campaign it mutates, and each
  // read-only contract seeds a campaign of its own — safe to fan across
  // workers despite the global fullyParallel:false. (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("campaign goes from empty state through rename to deletion", async ({ browser }) => {
    // A user with no campaigns yet: the empty state is the first thing asserted.
    const owner = await setupApiUser(browser, "campaign");
    const campaigns = new CampaignsPO(owner.page);
    const detail = new CampaignDetailPO(owner.page);
    let campaignName = uniqueName("TestCampaign");

    try {
      await test.step("campaigns page shows empty state", async () => {
        await campaigns.goto();
        await campaigns.expectEmptyState();
      });

      await test.step("create campaign via dialog", async () => {
        await campaigns.createCampaign(campaignName, "A test campaign");
        // Create flow auto-navigates into the new campaign's detail page.
        await detail.expectName(campaignName);
      });

      await test.step("update campaign name via settings", async () => {
        await detail.clickTab("Settings");
        const newName = uniqueName("RenamedCampaign");
        await detail.settings.updateCampaignName(newName);
        await detail.expectName(newName);
        campaignName = newName;
      });

      await test.step("delete campaign redirects to campaigns list", async () => {
        await detail.clickTab("Settings");
        await detail.settings.deleteCampaign(campaignName);
        await expect(owner.page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
        await campaigns.expectCampaignGone(campaignName);
      });
    } finally {
      await owner.teardown();
    }
  });

  test("campaign card links to detail page", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "campaignCard",
      campaignPrefix: "CardCampaign",
    });
    const campaigns = new CampaignsPO(owner.page);

    try {
      await campaigns.goto();
      await campaigns.expectCampaignExists(owner.campaignName);
      await campaigns.clickCampaign(owner.campaignName);
      await owner.detail.expectName(owner.campaignName);
    } finally {
      await owner.teardown();
    }
  });

  test("campaign detail shows DM badge", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "campaignBadge",
      campaignPrefix: "BadgeCampaign",
    });

    try {
      await owner.detail.expectDmBadge();
    } finally {
      await owner.teardown();
    }
  });

  test("tab navigation works", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "campaignTabs",
      campaignPrefix: "TabsCampaign",
    });

    try {
      const tabs = ["Overview", "Members", "Chat", "Notes", "NPCs", "Settings"];
      for (const tab of tabs) {
        await owner.detail.expectTabVisible(tab);
      }
      for (const tab of tabs) {
        await owner.detail.clickTab(tab);
      }
    } finally {
      await owner.teardown();
    }
  });
});
