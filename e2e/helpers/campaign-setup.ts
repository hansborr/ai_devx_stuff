import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { CampaignDetailPO } from "../page-objects/campaign-detail.po.js";
import {
  apiCreateCampaign,
  apiCreateCharacter,
  type ApiCreateCharacterOptions,
  apiCreateInvite,
  apiJoinCampaign,
  apiLogin,
  apiRegister,
  createApiContext,
} from "./api.js";
import { loginViaUi } from "./auth.setup.js";
import { makeUser, type TestUser, uniqueName } from "./test-data.js";
import { TIMEOUT_MEDIUM } from "./timeouts.js";

export interface DmPlayerCampaign {
  dmContext: BrowserContext;
  dmPage: Page;
  dmUser: TestUser;
  dmDetail: CampaignDetailPO;
  playerContext: BrowserContext;
  playerPage: Page;
  playerUser: TestUser;
  playerDetail: CampaignDetailPO;
  campaignName: string;
  campaignId: string;
  inviteCode: string;
  teardown(): Promise<void>;
}

export interface UserWithCharacter {
  context: BrowserContext;
  page: Page;
  user: TestUser;
  charName: string;
}

function defaultCharacterName(prefix: string): string {
  const capitalizedPrefix = `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
  return uniqueName(`${capitalizedPrefix}Hero`);
}

/**
 * Set up one user with a character created via the API.
 * Uses the browser only for login and SPA navigation to the sheet.
 * Caller is responsible for closing `context` in afterAll.
 */
export async function setupUserWithCharacter(
  browser: Browser,
  opts: { prefix: string; character?: ApiCreateCharacterOptions },
): Promise<UserWithCharacter> {
  const user = makeUser(opts.prefix);
  const charName = opts.character?.name ?? defaultCharacterName(opts.prefix);
  const character = opts.character ?? { name: charName };

  // --- API setup (fast) ---
  const apiCtx = await createApiContext();
  await apiRegister(apiCtx, user.email, user.password, user.displayName);
  const auth = await apiLogin(apiCtx, user.email, user.password);
  await apiCreateCharacter(apiCtx, auth.accessToken, character);
  await apiCtx.dispose();

  // --- Browser login (required for session cookies) ---
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaUi(page, user.email, user.password);

  // Navigate via SPA link (avoids full-page reload batch query limit)
  await page.getByRole("link", { name: charName }).click();
  await expect(page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });

  return { context, page, user, charName };
}

/**
 * Set up a campaign with a DM and a player who has already joined.
 * Uses API calls for registration/campaign/invite, browser only for login.
 * Both users end up on the campaign detail page.
 * Caller is responsible for calling `teardown()` in afterAll.
 */
export async function setupDmAndPlayer(
  browser: Browser,
  opts: {
    dmPrefix: string;
    playerPrefix: string;
    campaignPrefix: string;
    startTab?: string;
  },
): Promise<DmPlayerCampaign> {
  const dmUser = makeUser(opts.dmPrefix);
  const playerUser = makeUser(opts.playerPrefix);
  const campaignName = uniqueName(opts.campaignPrefix);

  // --- API setup (fast) ---
  const apiCtx = await createApiContext();

  await apiRegister(apiCtx, dmUser.email, dmUser.password, dmUser.displayName);
  await apiRegister(apiCtx, playerUser.email, playerUser.password, playerUser.displayName);

  const dmAuth = await apiLogin(apiCtx, dmUser.email, dmUser.password);
  const playerAuth = await apiLogin(apiCtx, playerUser.email, playerUser.password);

  const campaign = await apiCreateCampaign(apiCtx, dmAuth.accessToken, { name: campaignName });
  const invite = await apiCreateInvite(apiCtx, dmAuth.accessToken, {
    campaignId: campaign.id,
  });
  await apiJoinCampaign(apiCtx, playerAuth.accessToken, { code: invite.code });

  await apiCtx.dispose();

  // --- Browser login (required for session cookies) ---
  const dmContext = await browser.newContext();
  const dmPage = await dmContext.newPage();
  await loginViaUi(dmPage, dmUser.email, dmUser.password);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await loginViaUi(playerPage, playerUser.email, playerUser.password);

  // Navigate directly to campaign detail
  await dmPage.goto(`/campaigns/${campaign.id}`);
  await playerPage.goto(`/campaigns/${campaign.id}`);

  const dmDetail = new CampaignDetailPO(dmPage);
  const playerDetail = new CampaignDetailPO(playerPage);

  if (opts.startTab) {
    await dmDetail.clickTab(opts.startTab);
    await playerDetail.clickTab(opts.startTab);
  }

  return {
    dmContext,
    dmPage,
    dmUser,
    dmDetail,
    playerContext,
    playerPage,
    playerUser,
    playerDetail,
    campaignName,
    campaignId: campaign.id,
    inviteCode: invite.code,
    async teardown() {
      await playerContext.close();
      await dmContext.close();
    },
  };
}
