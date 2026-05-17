# Authorization Policy

Use the shared auth helpers rather than open-coding permission checks:

- Campaign membership: `assertCampaignMember`, `assertCampaignDm`
- Character ownership/access: `assertCharacterOwner`, `assertCharacterOwnerOrAccess`

## Core Rules

- `assertCampaignMember` throws `NOT_FOUND` if the campaign does not exist and `FORBIDDEN` if it exists but the caller is not a member.
- Character ownership and access mismatches intentionally return `NOT_FOUND` to avoid leaking whether another user's character exists.
- Campaign members can read campaign-linked characters. Outside a campaign, only `public` characters are visible to other users.
- Character mutation is owner-only by default. A campaign DM may also mutate a campaign-linked character when the procedure accepts `campaignId`.
- During combat there is no hard character lock; live state such as HP, temp HP, conditions, spell slots, death saves, exhaustion, concentration, and inventory remains editable.

## Campaign Notes

- The DM can see every note in the campaign.
- Players can see `shared` notes plus their own `private` notes.
- Players may create `shared` or `private` notes, but not `dmOnly` notes.
- The DM may edit or delete any note; players may only edit or delete their own notes.

## NPCs

- NPC create/update/delete is DM-only.
- The DM sees all NPCs, including hidden ones, and sees full NPC notes.
- Players only see `isVisible` NPCs, and NPC `notes` are redacted from their responses.

## Homebrew

- Collection authors own create/update/delete.
- Other users can read `public` collections.
- `campaign` visibility means the user must be a member of a campaign linked to that collection.
- Only the campaign DM can link or unlink a collection to a campaign.

When adding a new surface, preserve these same visibility semantics and error-code choices unless the procedure has an explicit reason to differ.
