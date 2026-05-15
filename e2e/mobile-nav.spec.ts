import { expect, test } from "./fixtures.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { MobileNavPO } from "./page-objects/mobile-nav.po.js";

test.describe("Mobile navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger menu opens sheet and navigates to Campaigns", async ({ userPage: { page } }) => {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });

    const mobileNav = new MobileNavPO(page);
    await mobileNav.openMenu();
    await mobileNav.clickCampaigns();
    await mobileNav.expectOnCampaigns();
    await mobileNav.expectClosed();
  });
});
