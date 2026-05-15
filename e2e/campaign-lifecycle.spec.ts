import { type BrowserContext, expect, type Page, test } from "./fixtures.js";
import { registerAndLogin } from "./helpers/auth.setup.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CampaignDetailPO } from "./page-objects/campaign-detail.po.js";
import { CampaignsPO } from "./page-objects/campaigns.po.js";

test.describe("Campaign lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext | undefined;
  let page: Page;
  let campaignName: string;
  let campaigns: CampaignsPO;
  let detail: CampaignDetailPO;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await registerAndLogin(page, "campaign");
    campaignName = uniqueName("TestCampaign");
    campaigns = new CampaignsPO(page);
    detail = new CampaignDetailPO(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("campaigns page shows empty state", async () => {
    await campaigns.goto();
    await campaigns.expectEmptyState();
  });

  test("create campaign via dialog", async () => {
    await campaigns.createCampaign(campaignName, "A test campaign");
    // Create flow auto-navigates into the new campaign's detail page.
    await detail.expectName(campaignName);
  });

  test("campaign card links to detail page", async () => {
    await campaigns.goto();
    await campaigns.expectCampaignExists(campaignName);
    await campaigns.clickCampaign(campaignName);
    await detail.expectName(campaignName);
  });

  test("campaign detail shows DM badge", async () => {
    await detail.expectDmBadge();
  });

  test("tab navigation works", async () => {
    const tabs = ["Overview", "Members", "Chat", "Notes", "NPCs", "Settings"];
    for (const tab of tabs) {
      await detail.expectTabVisible(tab);
    }
    for (const tab of tabs) {
      await detail.clickTab(tab);
    }
  });

  test("update campaign name via settings", async () => {
    await detail.clickTab("Settings");
    const newName = uniqueName("RenamedCampaign");
    await detail.settings.updateCampaignName(newName);
    await detail.expectName(newName);
    campaignName = newName;
  });

  test("delete campaign redirects to campaigns list", async () => {
    await detail.clickTab("Settings");
    await detail.settings.deleteCampaign(campaignName);
    await expect(page).toHaveURL(/\/campaigns/, { timeout: TIMEOUT_MEDIUM });
    await campaigns.expectCampaignGone(campaignName);
  });
});
