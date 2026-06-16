import { test } from "./fixtures.js";
import { uniqueName } from "./helpers/test-data.js";
import { HomebrewPO } from "./page-objects/homebrew.po.js";

test.describe("Homebrew export/import round-trip", () => {
  test("export a collection, re-import the file, and see both collections", async ({
    userPage,
  }) => {
    const { page } = userPage;
    const homebrew = new HomebrewPO(page);
    const collectionName = uniqueName("RoundTrip");
    const featName = uniqueName("Feat");

    await homebrew.goto();
    await homebrew.createCollection(collectionName, "Round-trip export/import check");

    await homebrew.openCollection(collectionName);
    const originalPath = new URL(page.url()).pathname;
    await homebrew.addEntry(featName, "A round-trip test feat.");

    await homebrew.goto();
    const fileBuffer = await homebrew.exportCollection(collectionName);
    await homebrew.importCollection(`${collectionName}.musi-homebrew.json`, fileBuffer);
    await homebrew.expectCollectionCount(collectionName, 2);

    await homebrew.openCollectionCopy(collectionName, originalPath);
    await homebrew.expectEntryVisible(featName);
  });
});
