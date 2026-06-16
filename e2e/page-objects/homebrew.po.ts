import { expect, type Locator, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM } from "../helpers/timeouts.js";

/** Original plus exactly one imported copy. */
const ROUND_TRIP_COPIES = 2;

export class HomebrewPO {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/homebrew");
    await expect(this.page.getByRole("heading", { name: "Homebrew Collections" })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  // ── Collection index ───────────────────────────────────────────────

  /** Card tiles have no accessible role; the test id is the stable handle. */
  collectionCard(name: string): Locator {
    return this.page.getByTestId("collection-card").filter({ hasText: name });
  }

  collectionLink(name: string): Locator {
    return this.page.getByRole("link", { name, exact: true });
  }

  async createCollection(name: string, description: string): Promise<void> {
    // The empty state renders a second, identically named Create Collection
    // button, so scope to the always-present page-header actions.
    await this.page
      .getByTestId("homebrew-page-actions")
      .getByRole("button", { name: "Create Collection" })
      .click();
    const dialog = this.page.getByRole("dialog", { name: "Create Collection" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Description").fill(description);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await this.expectCollectionCount(name, 1);
  }

  async openCollection(name: string): Promise<void> {
    await this.collectionLink(name).click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }

  /**
   * Open the copy of `name` that is not the collection at `excludedPath`.
   * An imported collection keeps the original's visible name, author, and
   * visibility; its link target (the new collection id) is the only stable
   * difference, so disambiguate by href instead of list position.
   */
  async openCollectionCopy(name: string, excludedPath: string): Promise<void> {
    // Wait for both copies to reach the accessibility tree: role queries
    // match nothing while a closing dialog still aria-hides the page.
    await expect(this.collectionLink(name)).toHaveCount(ROUND_TRIP_COPIES, {
      timeout: TIMEOUT_MEDIUM,
    });
    const copies: { link: Locator; href: string }[] = [];
    let sawOriginal = false;
    for (const link of await this.collectionLink(name).all()) {
      const href = await link.getAttribute("href");
      if (href === excludedPath) sawOriginal = true;
      else if (href !== null) copies.push({ link, href });
    }
    // Requiring the original among the links proves the exclusion key is
    // live; without this a stale `excludedPath` would silently match the
    // original instead of the copy.
    if (!sawOriginal) {
      throw new Error(`Original collection at ${excludedPath} not among "${name}" links`);
    }
    const copy = copies[0];
    if (!copy) throw new Error(`No copy of collection "${name}" outside ${excludedPath}`);
    await copy.link.click();
    await this.page.waitForURL(`**${copy.href}`);
  }

  async expectCollectionCount(name: string, count: number): Promise<void> {
    await expect(this.collectionCard(name)).toHaveCount(count, { timeout: TIMEOUT_MEDIUM });
  }

  // ── Export / import ────────────────────────────────────────────────

  async exportCollection(name: string): Promise<Buffer> {
    const card = this.collectionCard(name);
    await card.hover();
    const downloadPromise = this.page.waitForEvent("download");
    await card.getByRole("button", { name: "Export collection" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer); // type-assertion-boundary: interop - node:stream async iterator yields Buffer chunks under our usage
    return Buffer.concat(chunks);
  }

  async importCollection(fileName: string, buffer: Buffer): Promise<void> {
    await this.page
      .getByTestId("homebrew-page-actions")
      .getByRole("button", { name: "Import" })
      .click();
    const dialog = this.page.getByRole("dialog", { name: "Import Collection" });
    await dialog.getByLabel("Homebrew file").setInputFiles({
      name: fileName,
      mimeType: "application/json",
      buffer,
    });
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    // The dialog closes on success; waiting here keeps callers from racing
    // role queries against the modal's aria-hidden page state.
    await expect(dialog).toBeHidden({ timeout: TIMEOUT_MEDIUM });
  }

  // ── Collection detail (entries) ────────────────────────────────────

  async addEntry(name: string, description: string): Promise<void> {
    // The empty state renders a second, identically named Add Entry button,
    // so scope to the always-present page header.
    await this.page
      .getByTestId("collection-page-header")
      .getByRole("button", { name: "Add Entry" })
      .click();
    const dialog = this.page.getByRole("dialog", { name: "Create Entry" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Description").fill(description);
    await dialog.getByRole("button", { name: "Create Entry" }).click();
    await this.expectEntryVisible(name);
  }

  async expectEntryVisible(name: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name, exact: true })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }
}
