import { test } from "./fixtures.js";
import { type DmPlayerCampaign, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";

test.describe("Campaign NPCs", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: DmPlayerCampaign;

  let npcName: string;
  let secondNpcName: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "npcsDM",
      playerPrefix: "npcsPlayer",
      campaignPrefix: "NpcsCampaign",
    });
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("NPCs tab shows empty state", async () => {
    await ctx.dmDetail.clickTab("NPCs");
    await ctx.dmDetail.npcs.expectNpcsEmpty();
  });

  test("DM creates an NPC", async () => {
    npcName = uniqueName("Gandalf");
    await ctx.dmDetail.npcs.createNpc(npcName, "A wise wizard", { visible: true });
    await ctx.dmDetail.npcs.expectNpcVisible(npcName);
  });

  test("DM edits an NPC", async () => {
    const originalName = npcName;
    const newName = uniqueName("Merlin");
    npcName = newName;
    await ctx.dmDetail.npcs.editNpc(originalName, newName);
    await ctx.dmDetail.npcs.expectNpcVisible(npcName);
  });

  test("search filters NPCs", async () => {
    secondNpcName = uniqueName("Elminster");
    await ctx.dmDetail.npcs.createNpc(secondNpcName, "An archmage");
    await ctx.dmDetail.npcs.expectNpcVisible(secondNpcName);

    await ctx.dmDetail.npcs.searchNpcs(npcName);
    await ctx.dmDetail.npcs.expectNpcVisible(npcName);
    await ctx.dmDetail.npcs.expectNpcHidden(secondNpcName);

    // Clear search
    await ctx.dmDetail.npcs.searchNpcs("");
  });

  test("Player sees visible NPCs but cannot create", async () => {
    await ctx.playerDetail.clickTab("NPCs");
    await ctx.playerDetail.npcs.expectCreateNpcHidden();
    await ctx.playerDetail.npcs.expectNpcVisible(npcName);
  });

  test("DM deletes an NPC", async () => {
    await ctx.dmDetail.npcs.deleteNpc(secondNpcName);
    await ctx.dmDetail.npcs.expectNpcHidden(secondNpcName);
  });
});
