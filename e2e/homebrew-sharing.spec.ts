import { expect, test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { TIMEOUT_MEDIUM } from "./helpers/timeouts.js";

test.describe("Homebrew export/import round-trip", () => {
  test("export a collection, re-import the file, and see both collections", async ({
    userPage,
  }) => {
    const { page } = userPage;
    const collectionName = uniqueName("RoundTrip");
    const featName = uniqueName("Feat");

    await page.goto("/homebrew");

    await page.getByRole("button", { name: "Create Collection" }).first().click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("Name").fill(collectionName);
    await createDialog.getByLabel("Description").fill("Round-trip export/import check");
    await createDialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.locator('[data-testid="collection-card"]').filter({ hasText: collectionName }),
    ).toHaveCount(1, { timeout: TIMEOUT_MEDIUM });

    await page.getByRole("link", { name: collectionName }).click();
    await expect(page.getByRole("heading", { name: collectionName })).toBeVisible();

    await page.getByRole("button", { name: "Add Entry" }).first().click();
    const entryDialog = page.getByRole("dialog");
    await entryDialog.getByLabel("Name").fill(featName);
    await entryDialog.getByLabel("Description").fill("A round-trip test feat.");
    await entryDialog.getByRole("button", { name: "Create Entry" }).click();
    await expect(page.getByText(featName).first()).toBeVisible({ timeout: TIMEOUT_MEDIUM });

    await page.goto("/homebrew");
    const card = page
      .locator('[data-testid="collection-card"]')
      .filter({ hasText: collectionName });
    await card.first().hover();
    const downloadPromise = page.waitForEvent("download");
    await card.first().getByRole("button", { name: "Export collection" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const fileBuffer = Buffer.concat(chunks);

    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Homebrew file").setInputFiles({
      name: `${collectionName}.musi-homebrew.json`,
      mimeType: "application/json",
      buffer: fileBuffer,
    });
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await expect(
      page.locator('[data-testid="collection-card"]').filter({ hasText: collectionName }),
    ).toHaveCount(2, { timeout: TIMEOUT_MEDIUM });

    const imported = page
      .locator('[data-testid="collection-card"]')
      .filter({ hasText: collectionName })
      .last();
    await imported.getByRole("link", { name: collectionName }).click();
    await expect(page.getByText(featName).first()).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  });
});
