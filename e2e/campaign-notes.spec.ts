import { test } from "./fixtures.js";
import { type DmPlayerCampaign, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";

test.describe("Campaign notes", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: DmPlayerCampaign;

  let sharedNoteTitle: string;
  let secondNoteTitle: string;
  let dmOnlyNoteTitle: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "notesDM",
      playerPrefix: "notesPlayer",
      campaignPrefix: "NotesCampaign",
    });
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("notes tab shows empty state", async () => {
    await ctx.dmDetail.clickTab("Notes");
    await ctx.dmDetail.notes.expectNotesEmpty();
  });

  test("DM creates a shared note", async () => {
    sharedNoteTitle = uniqueName("SharedNote");
    await ctx.dmDetail.notes.createNote(sharedNoteTitle, "Some content", "shared");
    await ctx.dmDetail.notes.expectNoteVisible(sharedNoteTitle);
  });

  test("note card shows title", async () => {
    await ctx.dmDetail.notes.expectNoteVisible(sharedNoteTitle);
  });

  test("DM edits a note", async () => {
    const originalTitle = sharedNoteTitle;
    const newTitle = uniqueName("EditedNote");
    sharedNoteTitle = newTitle;
    await ctx.dmDetail.notes.editNote(originalTitle, newTitle);
    await ctx.dmDetail.notes.expectNoteVisible(sharedNoteTitle);
  });

  test("search filters notes by title", async () => {
    secondNoteTitle = uniqueName("SecondNote");
    await ctx.dmDetail.notes.createNote(secondNoteTitle, "Second note content", "shared");
    await ctx.dmDetail.notes.expectNoteVisible(secondNoteTitle);

    await ctx.dmDetail.notes.searchNotes(sharedNoteTitle);
    await ctx.dmDetail.notes.expectNoteVisible(sharedNoteTitle);
    await ctx.dmDetail.notes.expectNoteHidden(secondNoteTitle);

    // Clear search
    await ctx.dmDetail.notes.searchNotes("");
  });

  test("DM creates a DM-only note", async () => {
    dmOnlyNoteTitle = uniqueName("DmOnlyNote");
    await ctx.dmDetail.notes.createNote(dmOnlyNoteTitle, "Secret content", "dm-only");
    await ctx.dmDetail.notes.expectNoteVisible(dmOnlyNoteTitle);
  });

  test("Player sees shared notes but not DM-only notes", async () => {
    await ctx.playerDetail.clickTab("Notes");
    await ctx.playerDetail.notes.expectNoteVisible(sharedNoteTitle);
    await ctx.playerDetail.notes.expectNoteHidden(dmOnlyNoteTitle);
  });

  test("DM deletes a note", async () => {
    await ctx.dmDetail.notes.deleteNote(secondNoteTitle);
    await ctx.dmDetail.notes.expectNoteHidden(secondNoteTitle);
  });
});
