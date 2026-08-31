import { type Browser, expect, type Page } from "@playwright/test";

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
import { openApiAuthedContext } from "./auth.setup.js";
import { makeUser, type TestUser, uniqueName } from "./test-data.js";
import { TIMEOUT_MEDIUM } from "./timeouts.js";

export interface DmPlayerCampaign {
  dmPage: Page;
  dmUser: TestUser;
  dmDetail: CampaignDetailPO;
  playerPage: Page;
  playerUser: TestUser;
  playerDetail: CampaignDetailPO;
  campaignName: string;
  campaignId: string;
  teardown: () => Promise<void>;
}

export interface UserWithCharacter {
  page: Page;
  charName: string;
  teardown: () => Promise<void>;
}

/** A registered user and the access token that seeds data on their behalf. */
export interface ApiUser {
  user: TestUser;
  token: string;
}

/** An {@link ApiUser} plus a browser context already logged in as them. */
export interface BrowsingApiUser extends ApiUser {
  page: Page;
  teardown: () => Promise<void>;
}

/** A {@link BrowsingApiUser} sitting on the detail page of a campaign they DM. */
export interface CampaignOwner extends BrowsingApiUser {
  detail: CampaignDetailPO;
  campaignName: string;
}

function defaultCharacterName(prefix: string): string {
  const capitalizedPrefix = `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
  return uniqueName(`${capitalizedPrefix}Hero`);
}

/**
 * Register a user over the API and return an access token for them.
 *
 * The cheapest seed there is: no browser, no login form. Use it when a test
 * needs a *second* actor whose only job is to exist or to mutate state over
 * the API (a player who joins a campaign, an invite recipient).
 */
export async function registerApiUser(prefix: string): Promise<ApiUser> {
  const user = makeUser(prefix);
  const apiCtx = await createApiContext();
  try {
    await apiRegister(apiCtx, user.email, user.password, user.displayName);
    const auth = await apiLogin(apiCtx, user.email, user.password);
    return { user, token: auth.accessToken };
  } finally {
    await apiCtx.dispose();
  }
}

/**
 * {@link registerApiUser} plus a browser context authenticated as that user.
 * Caller is responsible for calling `teardown()`.
 */
export async function setupApiUser(browser: Browser, prefix: string): Promise<BrowsingApiUser> {
  const { user, token } = await registerApiUser(prefix);
  const { context, page } = await openApiAuthedContext(browser, user);
  return {
    user,
    token,
    page,
    async teardown() {
      await context.close();
    },
  };
}

/**
 * Set up one user with a character created via the API.
 * Uses the browser only for the headless login and SPA navigation to the sheet.
 * Caller is responsible for calling `teardown()`.
 */
export async function setupUserWithCharacter(
  browser: Browser,
  opts: { prefix: string; character?: ApiCreateCharacterOptions },
): Promise<UserWithCharacter> {
  const charName = opts.character?.name ?? defaultCharacterName(opts.prefix);
  const character = opts.character ?? { name: charName };

  // --- API setup (fast) ---
  const { user, token } = await registerApiUser(opts.prefix);
  const apiCtx = await createApiContext();
  await apiCreateCharacter(apiCtx, token, character);
  await apiCtx.dispose();

  // --- Browser login (required for session cookies) ---
  const { context, page } = await openApiAuthedContext(browser, user);

  // Navigate via SPA link (avoids full-page reload batch query limit)
  await page.getByRole("link", { name: charName }).click();
  await expect(page).toHaveURL(/\/characters\//, { timeout: TIMEOUT_MEDIUM });

  return {
    page,
    charName,
    async teardown() {
      await context.close();
    },
  };
}

/**
 * Set up a user who DMs one freshly created campaign, with their browser
 * already on that campaign's detail page.
 *
 * This is the single-actor counterpart to {@link setupDmAndPlayer}: use it for
 * contracts that need a campaign to exist but say nothing about a second
 * participant. Caller is responsible for calling `teardown()`.
 */
export async function setupCampaignOwner(
  browser: Browser,
  opts: { prefix: string; campaignPrefix: string; startTab?: string },
): Promise<CampaignOwner> {
  const campaignName = uniqueName(opts.campaignPrefix);

  const { user, token } = await registerApiUser(opts.prefix);
  const apiCtx = await createApiContext();
  const campaign = await apiCreateCampaign(apiCtx, token, { name: campaignName });
  await apiCtx.dispose();

  const { context, page } = await openApiAuthedContext(browser, user);
  await page.goto(`/campaigns/${campaign.id}`);

  const detail = new CampaignDetailPO(page);
  await detail.expectName(campaignName);
  if (opts.startTab) await detail.clickTab(opts.startTab);

  return {
    user,
    token,
    page,
    detail,
    campaignName,
    async teardown() {
      await context.close();
    },
  };
}

/**
 * Set up a campaign with a DM and a player who has already joined.
 * Uses API calls for registration/campaign/invite, browser only for login.
 * Both users end up on the campaign detail page.
 * Caller is responsible for calling `teardown()`, which closes both contexts.
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
  const campaignName = uniqueName(opts.campaignPrefix);

  // --- API setup (fast) ---
  const { user: dmUser, token: dmToken } = await registerApiUser(opts.dmPrefix);
  const { user: playerUser, token: playerToken } = await registerApiUser(opts.playerPrefix);

  const apiCtx = await createApiContext();
  const campaign = await apiCreateCampaign(apiCtx, dmToken, { name: campaignName });
  const invite = await apiCreateInvite(apiCtx, dmToken, { campaignId: campaign.id });
  await apiJoinCampaign(apiCtx, playerToken, { code: invite.code });
  await apiCtx.dispose();

  // --- Browser login (required for session cookies) ---
  const { context: dmContext, page: dmPage } = await openApiAuthedContext(browser, dmUser);
  const { context: playerContext, page: playerPage } = await openApiAuthedContext(
    browser,
    playerUser,
  );

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
    dmPage,
    dmUser,
    dmDetail,
    playerPage,
    playerUser,
    playerDetail,
    campaignName,
    campaignId: campaign.id,
    async teardown() {
      await playerContext.close();
      await dmContext.close();
    },
  };
}
