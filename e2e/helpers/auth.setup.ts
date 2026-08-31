import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { resolveClientBaseUrl } from "./environment.js";
import type { TestUser } from "./test-data.js";
import { TIMEOUT_MEDIUM } from "./timeouts.js";

/**
 * Log in an existing user via a headless API call, storing the issued
 * `musi_refresh` cookie in the browser context's private cookie jar.
 *
 * Each context gets its own session row and its own refresh cookie, so the
 * server's refresh-token rotation can never invalidate a sibling context
 * (testsuite-audit leaf 03 — the reason we avoid a shared storageState file).
 * A page opened afterwards boots unauthenticated in-memory and re-hydrates
 * its access token from the cookie via the mount-time `auth.refresh`.
 *
 * The login POST goes through the browser-visible client origin (Vite proxies
 * `/trpc` to the API server) rather than the direct server URL: the `musi_refresh`
 * cookie carries no `Domain` attribute, so it is scoped to the exact host that
 * set it. Routing through the client origin guarantees the cookie lands on the
 * same host the page loads from, even when `E2E_SERVER_URL` uses a different
 * hostname than the client baseURL (e.g. 127.0.0.1 vs localhost).
 */
export async function loginViaApi(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  const clientBaseUrl = resolveClientBaseUrl();
  const resp = await context.request.post(`${clientBaseUrl}/trpc/auth.login`, {
    data: { email, password },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`API login failed (${String(resp.status())}): ${body}`);
  }

  const clientHost = new URL(clientBaseUrl).hostname;
  const cookies = await context.cookies();
  const refreshCookie = cookies.find(
    (cookie) => cookie.name === "musi_refresh" && cookie.domain.replace(/^\./u, "") === clientHost,
  );
  if (!refreshCookie) {
    const refreshCookieDomains = cookies
      .filter((cookie) => cookie.name === "musi_refresh")
      .map((cookie) => cookie.domain)
      .join(", ");
    const domainDetail = refreshCookieDomains || "none";
    throw new Error(
      `API login succeeded, but no musi_refresh cookie was stored for client host "${clientHost}"; musi_refresh cookie domains: ${domainDetail}.`,
    );
  }
}

/**
 * Open a browser context whose page is already authenticated, using the
 * headless token login above rather than the login form.
 *
 * This is the seeding path: no test that merely *needs* a logged-in user
 * should pay for a full UI login round-trip. The page settles on
 * `/dashboard` only after the mount-time `auth.refresh` has re-hydrated the
 * in-memory access token from the context's own `musi_refresh` cookie, so
 * callers start from an authenticated state rather than a racing one.
 *
 * Login-subject specs keep driving `loginViaUi` explicitly.
 */
export async function openApiAuthedContext(
  browser: Browser,
  user: TestUser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await loginViaApi(context, user.email, user.password);
  const page = await context.newPage();
  const [refreshResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("auth.refresh")),
    page.goto("/dashboard"),
  ]);
  expect(
    refreshResp.ok(),
    `auth.refresh failed (${String(refreshResp.status())}) at ${refreshResp.url()}`,
  ).toBe(true);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
  return { context, page };
}

/** Log in an existing user via the browser UI. Page ends up on `/dashboard`. */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("auth.login") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Log in" }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: TIMEOUT_MEDIUM });
}
