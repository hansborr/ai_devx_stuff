import { test } from "./fixtures.js";
import { setupCampaignOwner, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";

test.describe("Campaign NPCs", () => {
  // Both tests seed their own campaign and create every NPC they assert on —
  // safe to fan across workers despite the global fullyParallel:false.
  // (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("DM creates, edits, searches, and deletes NPCs", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "npcsDM",
      campaignPrefix: "NpcsCampaign",
      startTab: "NPCs",
    });
    const npcs = owner.detail.npcs;
    let npcName = uniqueName("Gandalf");
    const secondNpcName = uniqueName("Elminster");

    try {
      await test.step("NPCs tab shows empty state", async () => {
        await npcs.expectNpcsEmpty();
      });

      await test.step("DM creates an NPC", async () => {
        await npcs.createNpc(npcName, "A wise wizard", { visible: true });
        await npcs.expectNpcVisible(npcName);
      });

      await test.step("DM edits an NPC", async () => {
        const originalName = npcName;
        const newName = uniqueName("Merlin");
        npcName = newName;
        await npcs.editNpc(originalName, newName);
        await npcs.expectNpcVisible(npcName);
      });

      await test.step("search filters NPCs", async () => {
        await npcs.createNpc(secondNpcName, "An archmage");
        await npcs.expectNpcVisible(secondNpcName);

        await npcs.searchNpcs(npcName);
        await npcs.expectNpcVisible(npcName);
        await npcs.expectNpcHidden(secondNpcName);

        // Clear search
        await npcs.searchNpcs("");
      });

      await test.step("DM deletes an NPC", async () => {
        await npcs.deleteNpc(secondNpcName);
        await npcs.expectNpcHidden(secondNpcName);
      });
    } finally {
      await owner.teardown();
    }
  });

  test("Player sees visible NPCs but cannot create", async ({ browser }) => {
    const ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "npcsVisDM",
      playerPrefix: "npcsVisPlayer",
      campaignPrefix: "NpcsVisCampaign",
    });
    const npcName = uniqueName("Radagast");

    try {
      await ctx.dmDetail.clickTab("NPCs");
      await ctx.dmDetail.npcs.createNpc(npcName, "A wise wizard", { visible: true });

      // Open the player's NPCs tab only once the NPC exists: the tab fetches on
      // open, so an earlier visit would have nothing to show.
      await ctx.playerDetail.clickTab("NPCs");
      await ctx.playerDetail.npcs.expectCreateNpcHidden();
      await ctx.playerDetail.npcs.expectNpcVisible(npcName);
    } finally {
      await ctx.teardown();
    }
  });
});
