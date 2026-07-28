import { test } from "./fixtures.js";
import {
  apiCreateCampaign,
  apiCreateInvite,
  apiLogin,
  apiRegister,
  createApiContext,
} from "./helpers/api.js";
import { makeUser, uniqueName } from "./helpers/test-data.js";
import { JoinPO } from "./page-objects/join.po.js";
import { LoginPO } from "./page-objects/login.po.js";

/**
 * The logged-out invite round-trip (backlog `F1` + `F8`).
 *
 * `AuthGuard` and `GuestGuard` both render `<Navigate to=... href=... />` and
 * rely on `href` winning over `to` at runtime. That precedence is a router
 * implementation detail, `@tanstack/react-router` is caret-ranged, and every
 * unit assertion about it reads `data-href` off the hand-written `Navigate`
 * stub in `packages/client/src/test/mock-react-router.tsx`. So the unit suite
 * cannot tell the difference between "the redirect works" and "our stub says it
 * works". This spec is the only place the real router is asked, and it fails
 * loudly if a router bump restores the exact bug F1 fixed: the invite code
 * silently dropped on the way through login.
 */
test.describe("Invite link opened while logged out", () => {
  test("carries the invite code through login and resumes the invite", async ({ page }) => {
    const dm = makeUser("returnto-dm");
    const invitee = makeUser("returnto-player");
    const campaignName = uniqueName("ReturnToCampaign");

    const apiCtx = await createApiContext();
    await apiRegister(apiCtx, dm.email, dm.password, dm.displayName);
    await apiRegister(apiCtx, invitee.email, invitee.password, invitee.displayName);
    const dmAuth = await apiLogin(apiCtx, dm.email, dm.password);
    const campaign = await apiCreateCampaign(apiCtx, dmAuth.accessToken, { name: campaignName });
    const invite = await apiCreateInvite(apiCtx, dmAuth.accessToken, { campaignId: campaign.id });
    await apiCtx.dispose();

    const joinPO = new JoinPO(page);
    const loginPO = new LoginPO(page);

    // The default `page` fixture has never logged in: no `musi_refresh` cookie,
    // which is exactly the state a real invite recipient arrives in.
    await joinPO.goto(invite.code);
    await joinPO.expectLoginWithReturnTo(`/join/${invite.code}`);

    await loginPO.login(invitee.email, invitee.password);

    await joinPO.expectResumedInvite(invite.code);
    // The code survived, so the preview can still name the campaign.
    await joinPO.expectInvitedTo(campaignName);

    // And nothing was claimed along the way: the confirmation still joins.
    await joinPO.clickJoin();
    await joinPO.expectRedirectToCampaign();
  });
});
