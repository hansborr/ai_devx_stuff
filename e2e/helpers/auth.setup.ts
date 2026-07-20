import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { resolveClientBaseUrl } from "./environment.js";
import { makeUser, type TestUser } from "./test-data.js";
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

/**
 * Register a new user and log them in. The page ends up on `/dashboard`.
 * Returns the created user details.
 */
export async function registerAndLogin(page: Page, prefix: string): Promise<TestUser> {
  const user = makeUser(prefix);

  // Register
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByLabel("Display Name").fill(user.displayName);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("auth.register") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Register" }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/, { timeout: TIMEOUT_MEDIUM });

  // Login
  await loginViaUi(page, user.email, user.password);

  return user;
}

export interface AuthenticatedContext {
  context: BrowserContext;
  page: Page;
  user: TestUser;
}

/**
 * Create an independent browser context with a freshly registered & logged-in user.
 * Used for multi-user tests (e.g. DM + Player).
 * Caller is responsible for calling `context.close()` in afterAll.
 */
export async function createAuthenticatedContext(
  browser: Browser,
  prefix: string,
): Promise<AuthenticatedContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await registerAndLogin(page, prefix);
  return { context, page, user };
}
