import { AxeBuilder } from "@axe-core/playwright";

import { expect, type Page, test } from "./fixtures.js";
import { apiCreateCampaign, apiCreateCharacter, createApiContext } from "./helpers/api.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";
import { CampaignDetailPO } from "./page-objects/campaign-detail.po.js";
import { CharacterSheetPO } from "./page-objects/character-sheet.po.js";
import { DashboardPO } from "./page-objects/dashboard.po.js";
import { LoginPO } from "./page-objects/login.po.js";
import { RegisterPO } from "./page-objects/register.po.js";

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];
type A11yView = "login" | "register" | "characterSheet" | "campaignDetail";

/**
 * Known serious/critical axe debt, per view, as axe rule IDs.
 *
 * Each row is a two-way contract, not a one-way mute:
 * `expectNoUnbaselinedAxeViolations` subtracts these rule IDs from the
 * violations it reports AND asserts each one is still observed. Repaying the
 * debt therefore turns the suite red until the row is deleted, so an exemption
 * cannot outlive the debt it records.
 *
 * The contract holds at rule-ID granularity, not per node: a row stays live
 * while any node on the view still trips the rule, so a repaid node alongside a
 * fresh one under the same rule stays masked.
 *
 * Retirement condition for every row: delete it as soon as the view stops
 * reporting that rule.
 */
const BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS: Record<A11yView, readonly string[]> = {
  // Drain note: existing auth footer links rely on color/hover underline only.
  login: ["link-in-text-block"],
  // Drain note: existing auth footer links rely on color/hover underline only.
  register: ["link-in-text-block"],
  // Drain note: existing sheet save/skill list items override li semantics with role="button".
  characterSheet: ["list"],
  // Drain note: existing muted "No character" member rows fail contrast in campaign cards.
  campaignDetail: ["color-contrast"],
};

function hasSeriousOrCriticalImpact(violation: AxeViolation): boolean {
  return violation.impact === "serious" || violation.impact === "critical";
}

function formatViolation(violation: AxeViolation): string {
  const targets = violation.nodes
    .map((node) => node.target.join(" "))
    .slice(0, 3)
    .join("; ");

  return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} [${targets}]`;
}

async function refreshAccessTokenFromPage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/trpc/auth.refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`auth.refresh failed with ${String(response.status)}`);
    }

    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "result" in payload &&
      typeof payload.result === "object" &&
      payload.result !== null &&
      "data" in payload.result &&
      typeof payload.result.data === "object" &&
      payload.result.data !== null &&
      "accessToken" in payload.result.data &&
      typeof payload.result.data.accessToken === "string"
    ) {
      return payload.result.data.accessToken;
    }

    throw new Error("auth.refresh response did not include an access token");
  });
}

async function expectNoUnbaselinedAxeViolations(
  page: Page,
  view: A11yView,
  viewName: string,
): Promise<void> {
  const baseline = BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS[view];
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter(hasSeriousOrCriticalImpact);
  const violations = seriousOrCritical.filter((violation) => !baseline.includes(violation.id));

  expect(
    violations,
    `${viewName} has unbaselined serious/critical axe violations:\n${violations
      .map(formatViolation)
      .join("\n")}`,
  ).toEqual([]);

  const observedIds = new Set(seriousOrCritical.map((violation) => violation.id));
  const staleBaselineIds = baseline.filter((id) => !observedIds.has(id));

  expect(
    staleBaselineIds,
    `${viewName} no longer has the baselined serious/critical axe violations ` +
      `${staleBaselineIds.map((id) => `"${id}"`).join(", ")}. This is good news: the ` +
      `accessibility debt is repaid. Delete the "${view}" entries for those rule IDs from ` +
      `BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS so the exemption cannot mask a future ` +
      `regression. Do not revert the fix, and do not weaken this assertion.`,
  ).toEqual([]);
}

test.describe("a11y smoke", () => {
  test("login page has no serious or critical axe violations", async ({ page }) => {
    const login = new LoginPO(page);

    await login.goto();
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });

    await expectNoUnbaselinedAxeViolations(page, "login", "Login page");
  });

  test("register page has no serious or critical axe violations", async ({ page }) => {
    const register = new RegisterPO(page);

    await register.goto();
    await expect(page.getByRole("heading", { name: "Register" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });

    await expectNoUnbaselinedAxeViolations(page, "register", "Register page");
  });

  test("authenticated pages have no serious or critical axe violations", async ({
    userPage: { page },
  }) => {
    const api = await createApiContext();
    const accessToken = await refreshAccessTokenFromPage(page);
    const charName = uniqueName("A11yHero");
    const campaignName = uniqueName("A11yCampaign");

    try {
      await apiCreateCharacter(api, accessToken, { name: charName });
      const campaign = await apiCreateCampaign(api, accessToken, { name: campaignName });

      await page.reload();
      await new DashboardPO(page).clickCharacterCard(charName);
      const sheet = new CharacterSheetPO(page);
      await sheet.expectName(charName);
      await expectNoUnbaselinedAxeViolations(page, "characterSheet", "Character sheet");

      await page.goto(`/campaigns/${campaign.id}`);
      const campaignDetail = new CampaignDetailPO(page);
      await campaignDetail.expectName(campaignName);
      await campaignDetail.expectTabVisible("Overview");
      await expectNoUnbaselinedAxeViolations(page, "campaignDetail", "Campaign detail");
    } finally {
      await api.dispose();
    }
  });
});
