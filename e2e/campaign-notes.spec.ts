import { test } from "./fixtures.js";
import { setupCampaignOwner, setupDmAndPlayer } from "./helpers/campaign-setup.js";
import { uniqueName } from "./helpers/test-data.js";

test.describe("Campaign notes", () => {
  // Both tests seed their own campaign and create every note they assert on —
  // safe to fan across workers despite the global fullyParallel:false.
  // (testsuite-audit leaf 04)
  test.describe.configure({ mode: "parallel" });

  test("DM creates, edits, searches, and deletes notes", async ({ browser }) => {
    const owner = await setupCampaignOwner(browser, {
      prefix: "notesDM",
      campaignPrefix: "NotesCampaign",
      startTab: "Notes",
    });
    const notes = owner.detail.notes;
    let sharedNoteTitle = uniqueName("SharedNote");
    const secondNoteTitle = uniqueName("SecondNote");

    try {
      await test.step("notes tab shows empty state", async () => {
        await notes.expectNotesEmpty();
      });

      await test.step("DM creates a shared note", async () => {
        await notes.createNote(sharedNoteTitle, "Some content", "shared");
        await notes.expectNoteVisible(sharedNoteTitle);
      });

      await test.step("DM edits a note", async () => {
        const originalTitle = sharedNoteTitle;
        const newTitle = uniqueName("EditedNote");
        sharedNoteTitle = newTitle;
        await notes.editNote(originalTitle, newTitle);
        await notes.expectNoteVisible(sharedNoteTitle);
      });

      await test.step("search filters notes by title", async () => {
        await notes.createNote(secondNoteTitle, "Second note content", "shared");
        await notes.expectNoteVisible(secondNoteTitle);

        await notes.searchNotes(sharedNoteTitle);
        await notes.expectNoteVisible(sharedNoteTitle);
        await notes.expectNoteHidden(secondNoteTitle);

        // Clear search
        await notes.searchNotes("");
      });

      await test.step("DM deletes a note", async () => {
        await notes.deleteNote(secondNoteTitle);
        await notes.expectNoteHidden(secondNoteTitle);
      });
    } finally {
      await owner.teardown();
    }
  });

  test("Player sees shared notes but not DM-only notes", async ({ browser }) => {
    const ctx = await setupDmAndPlayer(browser, {
      dmPrefix: "notesVisDM",
      playerPrefix: "notesVisPlayer",
      campaignPrefix: "NotesVisCampaign",
    });
    const sharedNoteTitle = uniqueName("VisibleNote");
    const dmOnlyNoteTitle = uniqueName("DmOnlyNote");

    try {
      await ctx.dmDetail.clickTab("Notes");
      await ctx.dmDetail.notes.createNote(sharedNoteTitle, "Some content", "shared");
      await ctx.dmDetail.notes.createNote(dmOnlyNoteTitle, "Secret content", "dm-only");

      // Positive control for the hidden-from-player claim below: without it a
      // regression that renders DM-only notes for *nobody* would still satisfy
      // `expectNoteHidden`. `createNote` only asserts the mutation returned
      // 200, so the DM's own board has to be checked explicitly.
      await ctx.dmDetail.notes.expectNoteVisible(dmOnlyNoteTitle);

      // Open the player's Notes tab only once both notes exist: the tab fetches
      // on open, so an earlier visit would have nothing to filter.
      await ctx.playerDetail.clickTab("Notes");
      await ctx.playerDetail.notes.expectNoteVisible(sharedNoteTitle);
      await ctx.playerDetail.notes.expectNoteHidden(dmOnlyNoteTitle);
    } finally {
      await ctx.teardown();
    }
  });
});
